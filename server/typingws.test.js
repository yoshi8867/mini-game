/* node typingws.test.js — 타자 올림픽 소켓 왕복 검사.
   서버를 실제로 띄우고 교사가 열고, 학생 둘과 연습 참가자가 팀을 골라
   시작한 뒤, 1종목 한 게임에서 학생이 단어를 쳐서 갖는 데까지 돌린다.
   DB 는 끄고, 관리자 비번은 ADMIN_PW 로 넣는다. */
"use strict";
const assert = require("assert");
const {spawn} = require("child_process");
const path = require("path");
const WebSocket = require("ws");

const PORT = 3991;
const PW = "type-test-pw";
const BASE = `http://127.0.0.1:${PORT}`;
const WSU  = `ws://127.0.0.1:${PORT}/ws`;
const wait = ms => new Promise(r => setTimeout(r, ms));

function client(){
  const ws = new WebSocket(WSU);
  const box = [], waiters = [];
  ws.on("message", raw => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex(w => w.t === m.t && (!w.pred || w.pred(m)));
    if (i >= 0) waiters.splice(i, 1)[0].go(m); else box.push(m);
  });
  return {
    ws,
    open: () => new Promise(r => ws.on("open", r)),
    send: (t, o) => ws.send(JSON.stringify(Object.assign({t}, o || {}))),
    next(t, ms = 5000, pred = null){
      const i = box.findIndex(m => m.t === t && (!pred || pred(m)));
      if (i >= 0) return Promise.resolve(box.splice(i, 1)[0]);
      return new Promise((go, fail) => {
        const w = {t, pred, go};
        waiters.push(w);
        setTimeout(() => {
          const j = waiters.indexOf(w);
          if (j >= 0){ waiters.splice(j, 1); fail(new Error(`${t} 를 못 받았다`)); }
        }, ms);
      });
    },
    /* 조건에 맞는 typeme 가 올 때까지 — 사이에 온 것은 버린다 */
    async until(pred, ms = 5000){
      const end = Date.now() + ms;
      for (;;){
        const i = box.findIndex(m => m.t === "typeme" && m && pred(m));
        if (i >= 0) return box.splice(i, 1)[0];
        box.length = 0;
        if (Date.now() > end) throw new Error("기다리던 모습이 안 왔다");
        await wait(50);
      }
    },
    close: () => ws.close(),
  };
}
async function hello(pid){
  const c = client(); await c.open();
  c.send("hello", {pid});
  c.me = await c.next("me");
  await c.next("rooms");
  return c;
}
let token = null;
async function admin(what, body){
  const r = await fetch(`${BASE}/admin/${what}`, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify(Object.assign({token}, body || {})),
  });
  return r.json();
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: Object.assign({}, process.env, {PORT: String(PORT), DATABASE_URL: "", ADMIN_PW: PW}),
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", () => {});
  srv.stderr.on("data", d => process.stderr.write(d));
  const bye = code => { try { srv.kill(); } catch (e) {} process.exit(code); };
  process.on("uncaughtException", e => { console.error(e); bye(1); });
  process.on("unhandledRejection", e => { console.error(e); bye(1); });
  for (let i = 0; i < 60; i++){
    try { await fetch(`${BASE}/healthz`); break; } catch (e) { await wait(100); }
  }

  token = (await admin("login", {pw: PW})).token;
  const made = await admin("typeopen", {pin: "4321", title: "타자 시험"});
  assert.ok(made.ok, "타자 올림픽이 안 열렸다: " + made.why);
  const code = made.typing.code;

  const a = await hello("wstest-type-a-zzzz"), b = await hello("wstest-type-b-zzzz");
  a.send("typings", {});
  assert.ok((await a.next("typings")).typings.some(x => x.code === code), "목록에 없다");
  a.send("typejoin", {code, pin: "0000"});
  assert.strictEqual((await a.next("error")).why, "badpin", "틀린 비번이 통했다");
  a.send("typejoin", {code, pin: "4321"}); b.send("typejoin", {code, pin: "4321"});
  const va = await a.next("typeme");
  assert.strictEqual(va.state, "open"); assert.strictEqual(va.me.team, null, "고르기 전에 팀이 있다");

  /* 교실 앞 화면 */
  const fan = client(); await fan.open();
  fan.send("typewatch", {code, pin: "4321"});
  assert.ok(!(await fan.next("typeme")).me, "교실 앞 화면이 명단에 들어갔다");

  a.send("typeteam", {team: 0}); b.send("typeteam", {team: 1});
  const v2 = await a.until(m => m.me && m.me.team === 0);
  assert.strictEqual(v2.teams[0].ps.length, 1);

  assert.ok((await admin("typeact", {code, act: "mock", n: 16})).ok, "연습 참가자가 안 들어왔다");
  assert.ok((await admin("typeact", {code, act: "close"})).ok);
  const st = await admin("typeact", {code, act: "start"});
  if (!st.ok){                                  // 빈 팀이 있으면 교사가 채운다
    const v = await a.until(m => !m.lobby);
    for (const t of v.teams) if (!t.ps.length){
      const big = v.teams.slice().sort((x, y) => y.ps.length - x.ps.length)[0];
      await admin("typeact", {code, act: "move", pid: big.ps.find(p => !p.pid.startsWith("wstest")).pid, team: t.t});
      big.ps.shift();
    }
    assert.ok((await admin("typeact", {code, act: "start"})).ok, "여섯 팀을 채웠는데 시작이 안 된다");
  }
  await a.until(m => m.ph.k === "intro");

  /* 1종목 — 조를 고르고 한 게임 */
  await admin("typeact", {code, act: "go"});
  await a.until(m => m.ph.k === "pick");
  a.send("typetheme", {i: 2});
  await a.until(m => m.pick && m.pick.mine === 2);
  await admin("typeact", {code, act: "go"});                 // 마감 → 조가 선다
  await a.until(m => m.ph.k === "formed");
  await admin("typeact", {code, act: "go"});                 // 시작
  const play = await a.until(m => m.ph.k === "play" && m.mine && m.mine.items);
  const it = play.mine.items[0];
  a.send("typeclaim", {i: it.i, text: it.text + "ㅋ"});
  assert.strictEqual((await a.next("typemiss")).why, "wrong", "틀린 글자가 통했다");
  a.send("typeclaim", {i: it.i, text: it.text});
  assert.ok((await a.next("typegot")).val >= 10, "맞게 쳤는데 점수가 없다");
  const after = await a.until(m => m.mine && m.mine.ps.find(p => p.pid === a.me.pid).got === 1);
  assert.ok(!after.mine.items.some(x => x.i === it.i), "끝난 단어가 그대로 깔려 있다");
  assert.strictEqual(after.mine.items.length, 10, "새 단어가 안 채워졌다");

  /* 교사가 경기를 끝낸다 → 게임 결과 */
  await admin("typeact", {code, act: "go"});
  const res = await a.until(m => m.ph.k === "after");
  assert.ok(res.mine.table && res.mine.table.length >= 4, "조 순위표가 없다");
  assert.ok(res.medals.some(m => m.who === a.me.pid), "점수를 낸 학생에게 메달이 없다");
  assert.ok(res.medals.every(m => res.mine.ps.concat(...res.races.map(r => r.ps)).find(p => p.pid === m.who).score > 0), "0점에게 메달이 갔다");

  const closed = await admin("typeclose", {code});
  assert.ok(closed.ok);
  await a.next("typegone");
  console.log("typingws.test.js 통과");
  bye(0);
})();
