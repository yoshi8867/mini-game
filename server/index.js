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
const {Room, newCode, okPin, LIMIT_MS} = require("./room.js");
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
function toRoom(room, t, o){ for (const ws of room.seats) send(ws, t, o); }

/* ─── 대국 목록 ────────────────────────────────────────────────────── */
function listing(){
  const out = [];
  for (const r of rooms.values()) if (!r.empty) out.push(r.info());
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
  for (const ws of room.seats)
    if (ws) send(ws, "state", Object.assign({side: ws.side}, st));
}

/* 끝난 판의 승패를 남긴다. 끊겨서 끝난 판은 남기지 않는다 — 결과가 아니다. */
function record(room){
  if (!room.over || room.saved || room.over.why === "gone") return;
  room.saved = true;
  db.saveGame({code: room.code, first: room.first, winner: room.over.winner,
               why: room.over.why, plies: room.ply, startedAt: room.startedAt})
    .catch(() => {});
}
function ended(room){
  toRoom(room, "over", room.over);
  record(room);
  pushState(room);
  pushList();
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
      pushList();
      return done(200, {ok: true, cup: c.full(), size: r.size, byes: r.byes});
    }
    case "close": {
      const c = cup();
      if (!c) return done(404, {ok: false, why: "nocup"});
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
      case "rename":  return onRename(ws, msg);
      case "rematch": return onRematch(ws);
      case "leave":   return onLeave(ws);
      default:        return send(ws, "error", {why: "unknown"});
    }
  });

  ws.on("close", () => {
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
}

function onRematch(ws){
  const room = ws.room;
  if (!room) return;
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
