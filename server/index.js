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
const {WebSocketServer} = require("ws");
const httpSide = require("./http.js");
const bots = require("./bots.js");
const {Room, newCode, okPin, LIMIT_MS} = require("./room.js");
const players = require("./players.js");
const admin = require("./admin.js");
const {Tourney, roundName, MAX_ENTRANTS} = require("./tourney.js");
const {Quiz, MAX_ENTRANTS: QUIZ_MAX} = require("./quiz.js");
const {Bid, MAX_ENTRANTS: BID_MAX} = require("./bid.js");

const PORT = process.env.PORT || 3000;

/* 대국은 메모리에만 둔다. 무료 인스턴스는 영구 디스크가 없고, 재배포하면
   어차피 다 날아간다. 기록으로 남길 것은 끝난 판의 승패뿐이다. */
const rooms = new Map();
const cups  = new Map();                 // 대회. 이것도 메모리에만 둔다 —
                                         // 서버가 다시 뜨면 대회는 사라진다
const MAX_CUPS = 20;
const quizzes = new Map();               // 한글 퀴즈. 이것도 메모리에만 둔다
const bids    = new Map();               // 돌림판 비딩. 마찬가지다
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
  /* 관전은 대회 안에서만이다. 그러지 않으면 코드만 알면 남의 비공개 대국을
     들여다볼 수 있다 — 관전 창구가 엿보기 창구가 된다. */
  if (!room.cup || room.cup.code !== ws.cup)
    return send(ws, "error", {why: "notyours"});
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
      (room.only && room.only.some(bots.isBot))) return;
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

/* 연습 상대는 소켓을 모른다. 알리는 일은 여기서 한다 */
const BOT = {
  alive: room => rooms.has(room.code),
  moved: (room, r, side) =>
    toRoom(room, "moved", {m: r.m, by: side, ply: r.ply, left: r.left}),
  ended: room => ended(room),
  state: room => pushState(room),
};
const botTick = room => bots.tick(room, BOT);

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
      if (bots.isBot(pid)) room.seat({bot: true}, players.get(pid), null);
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
    out.match = {room: m.room, id: m.id, round: roundName(cup.rounds[m.round].length),
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

/* ─── 관리자가 시키는 일 ───────────────────────────────────────────── */
/* ─── 한글 퀴즈 ───────────────────────────────────────────────────────
   대회와 같은 창구에 서지만 대국은 없다. 팀으로 나눠 찢긴 글자를 맞힌다.
   심판은 quiz.js 다 — 여기서는 알리는 일만 한다.

   낱장은 **지금 보여 줄 한 장만** 내려간다. 셋을 한꺼번에 주면 소스를 열어
   겹치면 그만이다. 답도 맞히기 전까지는 아예 나가지 않는다. */
function pushQuiz(quiz){
  const now = Date.now();
  for (const ws of wss.clients){
    if (ws.readyState !== 1 || ws.quiz !== quiz.code || !ws.person) continue;
    const v = quiz.view(ws.person.pid, now);
    if (v) send(ws, "quizme", v);
  }
}
/* 학생이 고르는 목록 — 접수 중인 것이 위로 */
function quizList(){
  const out = [...quizzes.values()].map(q => ({
    code: q.code, title: q.title, state: q.state, people: q.people.size,
    nth: q.nth + 1, total: q.order.length}));
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === "open" ? -1 : 1));
  return out;
}

function onQuizJoin(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  const quiz = quizzes.get(String(msg.code || "").toUpperCase());
  if (!quiz) return send(ws, "error", {why: "noquiz"});
  /* 이미 들어온 사람은 비번 없이 돌아온다 — 새로고침했을 뿐이다 */
  const back = quiz.people.has(ws.person.pid);
  if (!back){
    if (quiz.pin && msg.pin !== quiz.pin) return send(ws, "error", {why: "badpin"});
    const r = quiz.join(ws.person);
    if (r.err) return send(ws, "error", {why: r.err});
  }
  ws.quiz = quiz.code;
  send(ws, "quizme", quiz.view(ws.person.pid, Date.now()));
  if (!back) pushQuiz(quiz);                 // 몇 명 들어왔는지가 바뀌었다
}
function onQuizLeave(ws){
  const quiz = ws.quiz && quizzes.get(ws.quiz);
  ws.quiz = null;
  send(ws, "quizme", null);
  if (!quiz || !ws.person) return;
  /* 팀을 짠 뒤에 빠지면 그 팀에 구멍이 난다. 명단은 그대로 둔다 */
  if (quiz.state === "open"){ quiz.quit(ws.person.pid); pushQuiz(quiz); }
}
/* 답 하나. 맞으면 다 같이 공개를 보고, 틀리면 낸 사람에게만 붉게 알린다 */
function onQuizSay(ws, msg){
  const quiz = ws.quiz && quizzes.get(ws.quiz);
  if (!quiz || !ws.person) return send(ws, "error", {why: "noquiz"});
  const r = quiz.say(ws.person.pid, msg.text, Date.now());
  if (r.err) return send(ws, "error", {why: r.err});
  if (!r.right) send(ws, "quizmiss", {lost: r.lost || 0, again: !!r.again});
  pushQuiz(quiz);                            // 점수가 바뀌었으니 다 다시 그린다
}

/* ─── 돌림판 비딩 ─────────────────────────────────────────────────────
   퀴즈와 같은 창구다. 다른 것은 조마다 **대표 한 명만** 값을 부른다는 것.
   나머지는 관전이다. 심판은 bid.js 이고, 여기서는 알리는 일만 한다. */
function pushBid(bid){
  const now = Date.now();
  for (const ws of wss.clients){
    if (ws.readyState !== 1 || ws.bid !== bid.code || !ws.person) continue;
    const v = bid.view(ws.person.pid, now);
    if (v) send(ws, "bidme", v);
  }
}
function bidList(){
  const out = [...bids.values()].map(b => ({
    code: b.code, title: b.title, state: b.state, people: b.people.size,
    teams: b.teams.length, nth: b.nth + 1, total: b.order.length}));
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === "open" ? -1 : 1));
  return out;
}
function onBidJoin(ws, msg){
  if (!ws.person) return send(ws, "error", {why: "nohello"});
  const bid = bids.get(String(msg.code || "").toUpperCase());
  if (!bid) return send(ws, "error", {why: "nobid"});
  const back = bid.people.has(ws.person.pid);
  if (!back && bid.pin && msg.pin !== bid.pin)
    return send(ws, "error", {why: "badpin"});
  const r = bid.join(ws.person, !!msg.rep);
  if (r.err) return send(ws, "error", {why: r.err});
  ws.bid = bid.code;
  send(ws, "bidme", bid.view(ws.person.pid, Date.now()));
  if (!back || msg.rep) pushBid(bid);
}
function onBidLeave(ws){
  const bid = ws.bid && bids.get(ws.bid);
  ws.bid = null;
  send(ws, "bidme", null);
  if (!bid || !ws.person) return;
  /* 팀을 차지한 뒤에 빠지면 그 자리가 빈다. 시작 전에만 뺀다 */
  if (bid.state === "open"){ bid.quit(ws.person.pid); pushBid(bid); }
}
/* 값 하나. 좋은 룰렛이면 올려 부르고, 받기 싫은 룰렛이면 내고 빠진다 */
function onBidSay(ws, msg){
  const bid = ws.bid && bids.get(ws.bid);
  if (!bid || !ws.person) return send(ws, "error", {why: "nobid"});
  const now = Date.now();
  const r = msg.t === "bidflee" ? bid.flee(ws.person.pid, msg.n, now)
                                : bid.bid(ws.person.pid, msg.n, now);
  if (r.err) return send(ws, "error", {why: r.err});
  pushBid(bid);                              // 값이 바뀌었으니 다 다시 그린다
}

function onAdmin(what, m, done, ip){
  /* 들어오는 문은 하나뿐이다. 나머지는 표를 들고 와야 한다 */
  if (what === "login"){
    /* scrypt 는 한 번에 0.2초를 쓴다. 문지기가 없으면 비번을 마구 넣어 보는
       것만으로 무료 인스턴스가 멎는다. */
    if (httpSide.tooMany("admin:" + ip, 20)) return done(429, {ok: false, why: "toomany"});
    if (!admin.ok(m.pw)) return done(401, {ok: false, why: "no"});
    return done(200, {ok: true, token: admin.grant()});
  }
  if (!admin.holds(m.token)) return done(401, {ok: false, why: "stale"});

  const cup  = () => cups.get(String(m.code || "").toUpperCase());
  const quiz = () => quizzes.get(String(m.code || "").toUpperCase());
  const bid  = () => bids.get(String(m.code || "").toUpperCase());

  switch (what){
    case "state": {
      const list = [...cups.values()].map(c => c.full());
      list.sort((a, b) => b.made - a.made);
      const qs = [...quizzes.values()].map(q => q.full());
      const bs = [...bids.values()].map(b => b.full());
      qs.sort((a, b) => b.made - a.made);
      return done(200, {ok: true, cups: list, quizzes: qs, bids: bs, rooms: rooms.size,
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
    /* ─── 한글 퀴즈 ─── */
    case "quizopen": {
      if (quizzes.size >= MAX_CUPS) return done(409, {ok: false, why: "busy"});
      if (!okPin(m.pin)) return done(400, {ok: false, why: "badpin"});
      const code = newCode(c => cups.has(c) || rooms.has(c) || quizzes.has(c));
      const q = new Quiz(code, {pin: m.pin, title: m.title});
      quizzes.set(code, q);
      return done(200, {ok: true, quiz: q.full()});
    }
    case "quizstart": {
      const q = quiz();
      if (!q) return done(404, {ok: false, why: "noquiz"});
      const r = q.start(Date.now());
      if (r.err) return done(409, {ok: false, why: r.err});
      pushQuiz(q);
      return done(200, {ok: true, quiz: q.full(), teams: r.teams, sizes: r.sizes});
    }
    /* 아무도 못 맞히는 문제를 넘긴다. 공개는 똑같이 한다 */
    case "quizskip": {
      const q = quiz();
      if (!q) return done(404, {ok: false, why: "noquiz"});
      const r = q.give(Date.now());
      if (r.err) return done(409, {ok: false, why: r.err});
      pushQuiz(q);
      return done(200, {ok: true, quiz: q.full()});
    }
    case "quizclose": {
      const q = quiz();
      if (!q) return done(404, {ok: false, why: "noquiz"});
      for (const ws of wss.clients)
        if (ws.quiz === q.code){ ws.quiz = null; send(ws, "quizgone", {}); }
      quizzes.delete(q.code);
      return done(200, {ok: true});
    }
    /* 리허설용 — 수업 전에 팀이 어떻게 갈리는지 보려고 쓴다 */
    case "quizmock": {
      const q = quiz();
      if (!q) return done(404, {ok: false, why: "noquiz"});
      if (q.state !== "open") return done(409, {ok: false, why: "started"});
      let n = m.n | 0;
      if (n < 1) n = 1;
      if (q.people.size + n > QUIZ_MAX) n = QUIZ_MAX - q.people.size;
      for (let i = 0; i < n; i++)
        q.join(players.get("mock-" + q.code + "-" + Date.now().toString(36) +
                           "-" + i + "-" + Math.random().toString(36).slice(2, 8)));
      return done(200, {ok: true, quiz: q.full()});
    }
    /* ─── 돌림판 비딩 ─── */
    case "bidopen": {
      if (bids.size >= MAX_CUPS) return done(409, {ok: false, why: "busy"});
      if (!okPin(m.pin)) return done(400, {ok: false, why: "badpin"});
      const code = newCode(c => cups.has(c) || rooms.has(c) || quizzes.has(c) || bids.has(c));
      const b = new Bid(code, {pin: m.pin, title: m.title, secs: m.secs, plan: m.plan});
      bids.set(code, b);
      return done(200, {ok: true, bid: b.full()});
    }
    case "bidstart": {
      const b = bid();
      if (!b) return done(404, {ok: false, why: "nobid"});
      const r = b.start(Date.now());
      if (r.err) return done(409, {ok: false, why: r.err});
      pushBid(b);
      return done(200, {ok: true, bid: b.full(), teams: r.teams, lots: r.lots});
    }
    /* 작전타임을 끊고 바로 경매로 간다 */
    case "bidgo": {
      const b = bid();
      if (!b) return done(404, {ok: false, why: "nobid"});
      const r = b.go(Date.now());
      if (r.err) return done(409, {ok: false, why: r.err});
      pushBid(b);
      return done(200, {ok: true, bid: b.full()});
    }
    case "bidclose": {
      const b = bid();
      if (!b) return done(404, {ok: false, why: "nobid"});
      for (const ws of wss.clients)
        if (ws.bid === b.code){ ws.bid = null; send(ws, "bidgone", {}); }
      bids.delete(b.code);
      return done(200, {ok: true});
    }
    /* 리허설용 — 수업 전에 경매가 어떻게 돌아가는지 보려고 쓴다 */
    case "bidmock": {
      const b = bid();
      if (!b) return done(404, {ok: false, why: "nobid"});
      if (b.state !== "open") return done(409, {ok: false, why: "started"});
      let n = m.n | 0;
      if (n < 1) n = 1;
      if (b.people.size + n > BID_MAX) n = BID_MAX - b.people.size;
      for (let i = 0; i < n; i++)
        b.join(players.get("mock-" + b.code + "-" + Date.now().toString(36) +
                           "-" + i + "-" + Math.random().toString(36).slice(2, 8)), true);
      return done(200, {ok: true, bid: b.full()});
    }
    default:
      return done(404, {ok: false, why: "unknown"});
  }
}

/* ─── 서버 ─────────────────────────────────────────────────────────────
   HTTP 쪽은 http.js 가 맡는다. 여기서는 안쪽 사정을 알려 줄 뿐이다. */
const server = httpSide.create({
  db,
  snapshot(){
    let people = 0, playing = 0;
    for (const r of rooms.values()){
      people += (r.seats[0] ? 1 : 0) + (r.seats[1] ? 1 : 0);
      if (r.ready && !r.over) playing++;
    }
    return {rooms: rooms.size, players: people, playing, cups: cups.size,
            quizzes: quizzes.size, bids: bids.size};
  },
  admin: (what, m, done, ip) => onAdmin(what, m, done, ip),
});
const wss = new WebSocketServer({server, path: "/ws"});

wss.on("connection", ws => {
  ws.alive = true; ws.room = null; ws.side = null; ws.person = null;
  ws.cup = null; ws.fan = null; ws.quiz = null; ws.bid = null;
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
      case "quizzes": return send(ws, "quizzes", {quizzes: quizList()});
      case "quizjoin":return onQuizJoin(ws, msg);
      case "quizleave":return onQuizLeave(ws);
      case "quizsay": return onQuizSay(ws, msg);
      case "bids":    return send(ws, "bids", {bids: bidList()});
      case "bidjoin": return onBidJoin(ws, msg);
      case "bidleave":return onBidLeave(ws);
      case "bidup":
      case "bidflee": return onBidSay(ws, msg);
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

/* 퀴즈는 저절로 굴러간다 — 낱장이 4초마다 넘어가고, 공개가 끝나면 다음 문제다.
   심판이 바뀐 것이 있다고 할 때만 내려보낸다. */
setInterval(() => {
  const now = Date.now();
  for (const q of quizzes.values()) if (q.tick(now)) pushQuiz(q);
  /* 비딩도 저절로 굴러간다 — 시간이 다하면 낙찰, 묶음이 차면 작전타임 */
  for (const b of bids.values()) if (b.tick(now)) pushBid(b);
}, 250).unref();

db.init().catch(() => {});               // 첫 손님이 오기 전에 미리 깨워둔다

server.listen(PORT, () => {
  console.log(`미니쇼기 서버 :${PORT}  (healthz → /healthz, 대국 → /ws)`);
});
