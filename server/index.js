/* ══════════════════════════════════════════════════════════════════════
   미니쇼기 온라인 서버.

   하는 일은 셋뿐이다 — 대국 목록을 보여주고, 수를 심판하고, 사실을 알린다.
   탐색은 하지 않는다. AI 는 클라이언트 워커에 있다. 그래서 이 서버는
   Render 무료 인스턴스에서도 논다.

   HTTP  GET  /healthz  깨우기용. 상태를 JSON 으로 돌려준다
         GET  /stats    얼마나 뒀는지 집계
         POST /local    브라우저가 혼자 둔 판의 결과를 보내온다
         POST /admin/*  대회를 열고 닫는다. 관리자만
         GET  /         사람이 열었을 때 볼 한 줄
   WS    /ws           목록과 대국
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
require("./env.js");                     // .env 를 먼저 읽는다 (로컬 전용)
const db = require("./db.js");
const http = require("http");
const {WebSocketServer} = require("ws");
const {Room, newCode, okPin, LIMIT_MS, EG} = require("./room.js");
const players = require("./players.js");
const admin = require("./admin.js");
const {Tourney, MAX_ENTRANTS} = require("./tourney.js");

const PORT = process.env.PORT || 3000;
const STARTED = Date.now();

/* 대국은 메모리에만 둔다. 무료 인스턴스는 영구 디스크가 없고, 재배포하면
   어차피 다 날아간다. 기록으로 남길 것은 끝난 판의 승패뿐이다. */
const rooms = new Map();
const cups  = new Map();                 // 대회. 이것도 메모리에만 둔다 —
                                         // 서버가 다시 뜨면 대회는 사라진다
const MAX_CUPS = 20;
const EMPTY_TTL = 10 * 60 * 1000;        // 아무도 없는 대국은 10분 뒤 치운다
const MAX_ROOMS = 200;

const send = (ws, t, o) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({t: t}, o || {})));
};
function toRoom(room, t, o){
  for (const ws of room.seats) send(ws, t, o);
  if (room.fans) for (const ws of room.fans) send(ws, t, o);
}

/* ─── 대국 목록 ────────────────────────────────────────────────────── */
function listing(){
  const out = [];
  for (const r of rooms.values()) if (!r.empty && !r.cup) out.push(r.info());
  /* 기다리는 대국이 위로. 그 다음은 만들어진 순서 */
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === "waiting" ? -1 : 1));
  return out;
}
let listDirty = false;
function pushList(){                     // 한 박자 모아서 한 번만 보낸다
  if (listDirty) return;
  listDirty = true;
  setTimeout(() => {
    listDirty = false;
    const rows = listing();
    for (const ws of wss.clients) if (ws.readyState === 1 && !ws.room)
      send(ws, "rooms", {rooms: rows});
  }, 30);
}

function pushState(room){
  const st = room.state();
  st.fans = room.fans ? room.fans.size : 0;
  for (const ws of room.seats)
    if (ws) send(ws, "state", Object.assign({side: ws.side}, st));
  if (room.fans)
    for (const ws of room.fans) send(ws, "state", Object.assign({spect: true}, st));
}

/* ─── 관전 ─────────────────────────────────────────────────────────────
   두는 사람에게도 몇 명이 보고 있는지 알려 준다. 누가 내 판을 본다는 것은
   대회에서 꽤 큰 일이다 — 우쭐하거나 긴장되거나 한다. */
function watchStop(ws){
  const room = ws.fan;
  if (!room) return;
  ws.fan = null;
  if (room.fans){
    room.fans.delete(ws);
    if (rooms.has(room.code)) pushState(room);     // 관전자 수가 줄었다
  }
}
function onWatch(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  const room = rooms.get(String(msg.code || "").toUpperCase());
  if (!room) return send(ws, "error", {why: "nocode"});
  if (room.seats.indexOf(ws) >= 0) return send(ws, "error", {why: "playing"});
  watchStop(ws);
  if (!room.fans) room.fans = new Set();
  room.fans.add(ws); ws.fan = room;
  send(ws, "watching", {code: room.code,
                        people: room.people.map(players.view)});
  pushState(room);
}

/* 끝난 판의 승패를 남긴다. 끊겨서 끝난 판은 남기지 않는다 — 결과가 아니다. */
function record(room){
  if (!room.over || room.saved) return;
  /* 끊겨서 끝난 판은 결과가 아니다. 다만 대회에서는 몰수패라 결과가 맞다 */
  if (room.over.why === "gone" && !room.cup) return;
  /* 연습 참가자끼리 둔 판은 집계에 넣지 않는다. 사람이 둔 것이 아니다 */
  if (room.seats.some(w => w && w.bot) ||
      (room.only && room.only.some(isBot))) return;
  room.saved = true;
  db.saveGame({code: room.code, first: room.first, winner: room.over.winner,
               why: room.over.why, plies: room.ply, startedAt: room.startedAt,
               mode: room.cup ? "cup" : "online"})
    .catch(() => {});
}
function ended(room){
  toRoom(room, "over", room.over);
  record(room);
  pushState(room);
  pushList();
  if (room.cup) cupDone(room);
}

/* ─── 연습 상대 ────────────────────────────────────────────────────────
   대회 리허설용이다. mock- 으로 시작하는 참가자는 사람이 아니라 서버가
   대신 둔다. 수업 전에 대진표가 어떻게 굴러가는지 눈으로 보려는 것이다.

   서버는 원래 탐색을 하지 않는다 — 그래야 무료 인스턴스가 논다. 이것은
   그 원칙의 예외이므로 생각하는 시간을 아주 짧게 준다. */
const isBot  = pid => typeof pid === "string" && pid.slice(0, 5) === "mock-";
const BOT_MS = +(process.env.BOT_MS || 1100);    // 사람이 따라 볼 수 있는 속도
const BOT_THINK = 25;

function botTick(room){
  if (!room || room.over || !rooms.has(room.code)) return;
  const side = room.pos.turn;
  const seat = room.seats[side];
  if (!seat || !seat.bot) return;
  setTimeout(() => {
    if (room.over || !rooms.has(room.code)) return;
    if (room.pos.turn !== side) return;
    const now = room.seats[side];
    if (!now || !now.bot) return;
    const past = [...room.seen].filter(e => e[1] >= 2).map(e => e[0]);
    const res = EG.best({b: room.pos.b, hand: room.pos.hand, turn: side},
                        {ms: BOT_THINK, margin: 120, past});
    if (!res || !res.move) return;
    const r = room.play(side, res.move, room.ply);
    if (r.err) return;
    toRoom(room, "moved", {m: r.m, by: side, ply: r.ply, left: r.left});
    if (r.over) return ended(room);
    pushState(room);
    botTick(room);
  }, BOT_MS);
}

/* ─── 대회 ─────────────────────────────────────────────────────────────
   대진표가 "이제 둘 수 있다"고 하면 그 자리에 방을 하나 세우고, 두 사람에게
   알린다. 판이 끝나면 결과를 대진표에 돌려주고 다음 대국을 세운다. */
function runCup(cup){
  for (const m of cup.ready()){
    if (m.room) continue;
    const code = newCode(c => rooms.has(c) || cups.has(c));
    const room = new Room(code, {open: false, pin: null});
    room.cup  = {code: cup.code, match: m.id};
    room.only = [m.a, m.b];                  // 이 둘만 앉는다. a 가 선공
    room.onEvent = (r, what) => { if (what === "over") ended(r); };
    rooms.set(code, room);
    m.room = code; m.state = "playing"; m.began = Date.now();
    /* 연습 참가자는 사람이 안 오니 서버가 대신 앉는다 */
    [m.a, m.b].forEach(pid => {
      if (isBot(pid)) room.seat({bot: true}, players.get(pid), null);
    });
    botTick(room);
  }
  pushCup(cup);
}

/* 대회 대국이 끝났다. 무승부는 선공 승으로 바꿔 올린다. */
function cupDone(room){
  const cup = cups.get(room.cup.code);
  if (!cup) return;
  const m = cup.find(room.cup.match);
  if (!m || m.state === "done") return;
  const r = room.cupResult();
  if (!r) return;
  cup.report(m.id, r.winner === 0 ? m.a : m.b, r.why);

  /* 끝난 대회 대국은 그 자리에서 치운다. 자리를 붙들고 있으면 다음 라운드에
     못 앉는다. 결과는 이미 양쪽에 보냈다. */
  for (const ws of room.seats) if (ws){ ws.room = null; ws.side = null; }
  room.seats = [null, null];
  if (room.fans){ for (const ws of room.fans) ws.fan = null; room.fans.clear(); }
  room.stopClock();
  rooms.delete(room.code);

  runCup(cup);                               // 다음 대국이 섰을 수도 있다
}

/* 그 사람이 지금 대회에서 어떤 처지인지 */
function cupView(cup, pid){
  const me = cup.people.get(pid);
  if (!me) return null;
  const out = {code: cup.code, title: cup.title, state: cup.state,
               people: cup.people.size, rounds: cup.rounds.length,
               name: me.name, out: me.out, place: me.place,
               champion: cup.champion && cup.nameOf(cup.champion)};
  const m = cup.matchOf(pid);
  if (m && m.state === "playing"){
    const foe = m.a === pid ? m.b : m.a;
    out.match = {room: m.room, id: m.id,
                 round: cup.rounds[m.round].length === 1 ? "결승"
                      : cup.rounds[m.round].length === 2 ? "준결승"
                      : (cup.rounds[m.round].length * 2) + "강",
                 side: m.a === pid ? 0 : 1, foe: cup.nameOf(foe)};
  } else if (m){
    out.waiting = true;                      // 상대가 아직 안 정해졌다
  }
  /* 볼 만한 대국을 골라 준다. 없으면 대진표를 띄우게 한다 */
  const w = cup.watchFor(pid);
  if (w && w.room) out.watch = {room: w.room, id: w.id,
                                a: cup.nameOf(w.a), b: cup.nameOf(w.b)};
  return out;
}
function pushCup(cup){
  for (const ws of wss.clients){
    if (ws.readyState !== 1 || ws.cup !== cup.code || !ws.person) continue;
    const v = cupView(cup, ws.person.pid);
    if (v) send(ws, "cupme", v);
  }
}
/* 학생이 고르는 목록 — 접수 중인 대회가 위로 */
function cupList(){
  const out = [...cups.values()].map(c => ({
    code: c.code, title: c.title, state: c.state, people: c.people.size}));
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === "open" ? -1 : 1));
  return out;
}

/* ─── HTTP ─────────────────────────────────────────────────────────── */
/* 오프라인 판은 브라우저가 보내온다. 페이지는 github.io, 서버는 onrender.com
   이라 남남이다 — 문을 열어 둔다. 남기는 것은 결과 숫자뿐이라 숨길 것이 없다. */
function cors(res){
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "86400");
}

/* 본문은 바이트로 모았다가 한 번에 읽는다. 글자로 이어 붙이면 한글 한 자가
   덩이 두 개에 걸칠 때 깨진다. */
function readBody(req, limit, then){
  const bits = [];
  let n = 0;
  req.on("data", c => {
    n += c.length;
    if (n > limit){ bits.length = 0; return req.destroy(); }
    bits.push(c);
  });
  req.on("end", () => {
    let o = null;
    try { o = JSON.parse(Buffer.concat(bits).toString("utf8") || "{}"); }
    catch (e) {}
    then(o);
  });
}

/* 아무나 부를 수 있는 창구다. 한 곳에서 쏟아붓지 못하게 막아 둔다 */
const RATE = new Map();                  // ip → {n, until}
const RATE_MAX = 60, RATE_WINDOW = 10 * 60 * 1000;
function tooMany(ip){
  const now = Date.now();
  let r = RATE.get(ip);
  if (!r || now > r.until){ r = {n: 0, until: now + RATE_WINDOW}; RATE.set(ip, r); }
  if (RATE.size > 5000) RATE.clear();    // 무료 인스턴스다. 무한정 쌓지 않는다
  return ++r.n > RATE_MAX;
}

const WHYS = ["catch", "try", "repeat", "stuck", "time", "resign"];
/* 브라우저 말은 그대로 믿지 않는다. 모양이 맞는 것만 통과시킨다 */
function cleanLocal(o){
  if (!o || typeof o !== "object") return null;
  const mode = o.mode === "ai" ? "ai" : o.mode === "duo" ? "duo" : null;
  if (!mode) return null;
  if (WHYS.indexOf(o.why) < 0) return null;
  const plies = o.plies | 0;
  if (plies < 0 || plies > 500) return null;
  const winner = o.winner === 0 || o.winner === 1 ? o.winner : null;
  const first  = o.first === 1 ? 1 : 0;
  /* 3수 이하의 시간초과는 대국이 아니다. 열어만 두고 자리를 뜬 화면이다 */
  if (o.why === "time" && plies <= 3) return null;
  const now = Date.now();
  let started = +o.startedAt;
  if (!Number.isFinite(started) || started > now || now - started > 24 * 3600 * 1000)
    started = now;
  return {code: "LOCAL", mode, first, winner, why: o.why, plies, startedAt: started,
          aiSide: mode === "ai" ? 1 : null};
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  cors(res);

  if (req.method === "OPTIONS"){ res.writeHead(204); return res.end(); }

  if (url === "/local"){
    if (req.method !== "POST"){
      res.writeHead(405, {"content-type": "application/json; charset=utf-8"});
      return res.end(JSON.stringify({ok: false, why: "post only"}));
    }
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
            || (req.socket.remoteAddress || "?");
    const done = (code, body) => {
      res.writeHead(code, {"content-type": "application/json; charset=utf-8",
                           "cache-control": "no-store"});
      res.end(JSON.stringify(body));
    };
    if (tooMany(ip)) return done(429, {ok: false, why: "too many"});
    /* 결과 한 줄이 그리 클 리 없다 */
    readBody(req, 2000, o => {
      const g = cleanLocal(o);
      if (!g) return done(400, {ok: false, why: "bad"});
      /* 기다리게 하지 않는다. 브라우저는 이미 다음 판을 놓고 있다 */
      done(202, {ok: true});
      db.saveGame(g).catch(() => {});
    });
    return;
  }

  if (url === "/healthz"){
    let people = 0, playing = 0;
    for (const r of rooms.values()){
      people += (r.seats[0] ? 1 : 0) + (r.seats[1] ? 1 : 0);
      if (r.ready && !r.over) playing++;
    }
    const done = body => {
      res.writeHead(200, {"content-type": "application/json; charset=utf-8",
                          "cache-control": "no-store"});
      res.end(JSON.stringify(body));
    };
    const base = {ok: true, uptime: Math.round((Date.now() - STARTED) / 1000),
                  rooms: rooms.size, players: people, playing,
                  db: db.enabled() ? "on" : "off", node: process.version};
    /* DB 가 잠들어 있으면 응답이 늦는다. healthz 는 깨우는 용도라 기다리지 않는다. */
    if (!db.enabled()) return done(base);
    let sent = false;
    const once = extra => { if (!sent){ sent = true; done(Object.assign(base, extra)); } };
    const t = setTimeout(() => once({games: null}), 1500);
    db.count().then(n => { clearTimeout(t); once({games: n}); })
              .catch(() => { clearTimeout(t); once({games: null}); });
    return;
  }

  /* ─── 관리자 ──────────────────────────────────────────────────────
     검사는 여기서 한다. 페이지에서 하면 소스를 열어 건너뛴다. */
  if (url.slice(0, 7) === "/admin/"){
    if (req.method !== "POST"){
      res.writeHead(405, {"content-type": "application/json; charset=utf-8"});
      return res.end(JSON.stringify({ok: false, why: "post only"}));
    }
    const done = (code, body) => {
      res.writeHead(code, {"content-type": "application/json; charset=utf-8",
                           "cache-control": "no-store"});
      res.end(JSON.stringify(body));
    };
    readBody(req, 4000, m => {
      if (!m || typeof m !== "object") return done(400, {ok: false, why: "bad"});
      onAdmin(url.slice(7), m, done);
    });
    return;
  }

  if (url === "/stats"){
    if (!db.enabled()){
      res.writeHead(503, {"content-type": "application/json; charset=utf-8"});
      return res.end(JSON.stringify({ok: false, why: "db off"}));
    }
    db.stats().then(s => {
      res.writeHead(s ? 200 : 503, {"content-type": "application/json; charset=utf-8",
                                    "cache-control": "no-store"});
      res.end(JSON.stringify(s ? Object.assign({ok: true}, s) : {ok: false, why: "db error"}));
    });
    return;
  }

  if (url === "/"){
    res.writeHead(200, {"content-type": "text/plain; charset=utf-8"});
    return res.end("미니쇼기 온라인 서버입니다. 대국은 웹 페이지에서 엽니다.\n");
  }
  res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
  res.end("없는 주소입니다\n");
});

/* ─── 관리자가 시키는 일 ───────────────────────────────────────────── */
function onAdmin(what, m, done){
  /* 들어오는 문은 하나뿐이다. 나머지는 표를 들고 와야 한다 */
  if (what === "login"){
    if (!admin.ok(m.pw)) return done(401, {ok: false, why: "no"});
    return done(200, {ok: true, token: admin.grant()});
  }
  if (!admin.holds(m.token)) return done(401, {ok: false, why: "stale"});

  const cup = () => cups.get(String(m.code || "").toUpperCase());

  switch (what){
    case "state": {
      const list = [...cups.values()].map(c => c.full());
      list.sort((a, b) => b.made - a.made);
      return done(200, {ok: true, cups: list, rooms: rooms.size,
                        players: wss.clients.size});
    }
    case "open": {
      if (cups.size >= MAX_CUPS) return done(409, {ok: false, why: "busy"});
      if (!okPin(m.pin)) return done(400, {ok: false, why: "badpin"});
      const code = newCode(c => cups.has(c) || rooms.has(c));
      const c = new Tourney(code, {pin: m.pin, title: m.title});
      cups.set(code, c);
      pushList();
      return done(200, {ok: true, cup: c.full()});
    }
    case "start": {
      const c = cup();
      if (!c) return done(404, {ok: false, why: "nocup"});
      const r = c.start();
      if (r.err) return done(409, {ok: false, why: r.err});
      runCup(c);
      pushList();
      return done(200, {ok: true, cup: c.full(), size: r.size, byes: r.byes});
    }
    case "close": {
      const c = cup();
      if (!c) return done(404, {ok: false, why: "nocup"});
      for (const [code, room] of rooms)
        if (room.cup && room.cup.code === c.code){
          toRoom(room, "cupgone", {});
          room.stopClock(); rooms.delete(code);
        }
      for (const ws of wss.clients) if (ws.cup === c.code){ watchStop(ws); ws.cup = null; }
      cups.delete(c.code);
      pushList();
      return done(200, {ok: true});
    }
    /* 리허설용 — 수업 전에 대진표가 어떻게 그려지는지 보려고 쓴다.
       접수 중인 대회에만 넣을 수 있다. */
    case "mock": {
      const c = cup();
      if (!c) return done(404, {ok: false, why: "nocup"});
      if (c.state !== "open") return done(409, {ok: false, why: "started"});
      let n = m.n | 0;
      if (n < 1) n = 1;
      if (c.people.size + n > MAX_ENTRANTS) n = MAX_ENTRANTS - c.people.size;
      for (let i = 0; i < n; i++)
        c.join(players.get("mock-" + c.code + "-" + Date.now().toString(36) +
                           "-" + i + "-" + Math.random().toString(36).slice(2, 8)));
      return done(200, {ok: true, cup: c.full()});
    }
    default:
      return done(404, {ok: false, why: "unknown"});
  }
}

/* ─── WebSocket ────────────────────────────────────────────────────── */
const wss = new WebSocketServer({server, path: "/ws"});

wss.on("connection", ws => {
  ws.alive = true; ws.room = null; ws.side = null; ws.person = null;
  ws.cup = null; ws.fan = null;
  ws.on("pong", () => { ws.alive = true; });

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return send(ws, "error", {why: "bad"}); }
    if (!msg || typeof msg.t !== "string") return;
    switch (msg.t){
      case "hello":   return onHello(ws, msg);
      case "list":    return send(ws, "rooms", {rooms: listing()});
      case "open":    return onOpen(ws, msg);
      case "join":    return onJoin(ws, msg);
      case "move":    return onMove(ws, msg);
      case "cups":    return send(ws, "cups", {cups: cupList()});
      case "cupjoin": return onCupJoin(ws, msg);
      case "cupleave":return onCupLeave(ws);
      case "cupboard":return onCupBoard(ws);
      case "watch":   return onWatch(ws, msg);
      case "unwatch": return watchStop(ws);
      case "rename":  return onRename(ws, msg);
      case "rematch": return onRematch(ws);
      case "leave":   return onLeave(ws);
      default:        return send(ws, "error", {why: "unknown"});
    }
  });

  ws.on("close", () => {
    watchStop(ws);
    const room = ws.room;
    if (!room) return;
    room.drop(ws);
    ws.room = null; ws.side = null;
    toRoom(room, "peer", {what: "left"});
    pushState(room);
    pushList();
  });
});

/* 사람을 알아본다. pid 는 브라우저가 만들어 들고 온다. */
function onHello(ws, msg){
  const pid = typeof msg.pid === "string" && msg.pid.length >= 8 && msg.pid.length <= 64
            ? msg.pid : null;
  if (!pid) return send(ws, "error", {why: "badpid"});
  ws.person = players.get(pid);
  send(ws, "me", players.view(ws.person));
  send(ws, "rooms", {rooms: listing()});
}

/* 이름 다시 굴리기 — 앞말이나 뒷말 한쪽만. 직접 고르는 길은 없다.
   대국에 앉은 뒤에는 안 바꾼다. 두는 도중에 상대 이름이 바뀌면 곤란하다. */
function onRename(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  if (ws.room)    return send(ws, "error", {why: "joined"});
  const now = Date.now();
  if (now - (ws.rolled || 0) < 200) return;      // 연타는 흘린다
  ws.rolled = now;
  if (!players.reroll(ws.person, msg.part)) return send(ws, "error", {why: "bad"});
  send(ws, "me", players.view(ws.person));
}

/* ─── 대회 참가 ───────────────────────────────────────────────────── */
function onCupJoin(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  const cup = cups.get(String(msg.code || "").toUpperCase());
  if (!cup) return send(ws, "error", {why: "nocup"});
  /* 이미 참가한 사람은 비번 없이 돌아온다 — 새로고침했을 뿐이다 */
  const back = cup.people.has(ws.person.pid);
  if (!back){
    if (cup.pin && msg.pin !== cup.pin) return send(ws, "error", {why: "badpin"});
    const r = cup.join(ws.person);
    if (r.err) return send(ws, "error", {why: r.err});
  }
  ws.cup = cup.code;
  const v = cupView(cup, ws.person.pid);
  send(ws, "cupme", v);
  pushCup(cup);
}
/* 대진표. 관전할 대국을 고르라고 내려 준다 */
function onCupBoard(ws){
  const cup = ws.cup && cups.get(ws.cup);
  if (!cup) return send(ws, "error", {why: "nocup"});
  send(ws, "cupboard", {code: cup.code, title: cup.title, state: cup.state,
                        me: ws.person && ws.person.pid,
                        champion: cup.champion && cup.nameOf(cup.champion),
                        rounds: cup.board().map(r => Object.assign({}, r, {
                          matches: r.matches.map(m => Object.assign({}, m, {
                            fans: m.room && rooms.get(m.room)
                                ? (rooms.get(m.room).fans || {size: 0}).size : 0,
                          })),
                        }))});
}

function onCupLeave(ws){
  const cup = ws.cup && cups.get(ws.cup);
  watchStop(ws);
  ws.cup = null;
  send(ws, "cupme", null);
  if (!cup || !ws.person) return;
  if (cup.state === "open"){ cup.quit(ws.person.pid); pushCup(cup); }
  send(ws, "rooms", {rooms: listing()});
}

function onOpen(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  if (ws.room)    return send(ws, "error", {why: "joined"});
  if (rooms.size >= MAX_ROOMS) return send(ws, "error", {why: "busy"});
  const open = msg.open !== false;
  if (!open && !okPin(msg.pin)) return send(ws, "error", {why: "badpin"});
  const code = newCode(c => rooms.has(c));
  const room = new Room(code, {open: open, pin: open ? null : msg.pin});
  room.onEvent = (r, what) => { if (what === "over") ended(r); };
  rooms.set(code, room);
  sit(ws, room, null);
}

function onJoin(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  if (ws.room)    return send(ws, "error", {why: "joined"});
  const code = typeof msg.code === "string" ? msg.code.trim().toUpperCase() : "";
  const room = rooms.get(code);
  if (!room) return send(ws, "error", {why: "nocode"});
  const token = typeof msg.token === "string" ? msg.token : null;
  if (room.only){                            // 대회 대국 — 비번이 아니라 명단이다
    if (room.only.indexOf(ws.person.pid) < 0)
      return send(ws, "error", {why: "notyours"});
    return sit(ws, room, token);
  }
  const known = token && room.tokens.indexOf(token) >= 0;
  if (!room.open && !known && msg.pin !== room.pin)
    return send(ws, "error", {why: "badpin"});
  sit(ws, room, token);
}

function sit(ws, room, token){
  const got = room.seat(ws, ws.person, token);
  if (got.err) return send(ws, "error", {why: got.err});
  ws.room = room; ws.side = got.side;
  send(ws, "seated", {code: room.code, side: got.side, token: got.token,
                      limit: LIMIT_MS, open: room.open});
  pushState(room);
  const peer = room.seats[1 - got.side];
  if (peer) send(peer, "peer", {what: "joined"});
  pushList();
  botTick(room);
}

function onMove(ws, msg){
  const room = ws.room;
  if (!room) return send(ws, "error", {why: "noroom"});
  const r = room.play(ws.side, msg.m | 0, msg.ply | 0);
  if (r.err){
    send(ws, "error", {why: r.err});
    return pushState(room);                 // 어긋났으면 진실을 다시 내려준다
  }
  toRoom(room, "moved", {m: r.m, by: ws.side, ply: r.ply, left: r.left});
  if (r.over) return ended(room);
  pushState(room);
  botTick(room);
}

function onRematch(ws){
  const room = ws.room;
  if (!room || room.cup) return;             // 대회에 재대국은 없다
  if (room.wantRematch(ws.side)) toRoom(room, "restart", {});
  else toRoom(room, "peer", {what: "rematch", side: ws.side});
  pushState(room);
  pushList();
}

/* 나가기 — 두던 중이면 패다 */
function onLeave(ws){
  const room = ws.room;
  if (!room) return;
  room.leave(ws);
  ws.room = null; ws.side = null;
  if (room.over) toRoom(room, "over", room.over);
  record(room);
  if (room.cup && room.over) cupDone(room);
  toRoom(room, "peer", {what: "left"});
  pushState(room);
  if (room.empty) rooms.delete(room.code);
  send(ws, "rooms", {rooms: listing()});
  pushList();
}

/* ─── 뒷정리 ───────────────────────────────────────────────────────── */
/* 프록시가 조용한 연결을 끊는다. 30초마다 두드려서 살아있는지 본다 */
setInterval(() => {
  for (const ws of wss.clients){
    if (!ws.alive){ ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000).unref();

setInterval(() => {
  const now = Date.now();
  let gone = false;
  for (const [code, room] of rooms){
    if (room.empty && now - room.touched > EMPTY_TTL){
      room.stopClock(); rooms.delete(code); gone = true;
    }
  }
  if (gone) pushList();
}, 60000).unref();

db.init().catch(() => {});               // 첫 손님이 오기 전에 미리 깨워둔다

server.listen(PORT, () => {
  console.log(`미니쇼기 서버 :${PORT}  (healthz → /healthz, 대국 → /ws)`);
});
