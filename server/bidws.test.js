/* node bidws.test.js — 돌림판 비딩 소켓 왕복 검사.
   서버를 실제로 띄우고 관리자가 열고, 대표 셋과 구경꾼 하나가 들어가
   작전타임을 끊고 값을 부르고 낙찰까지 받는 데까지 돌린다.
   작전타임과 품목 시간은 짧게 열어 검사가 몇 초에 끝나게 한다. */
"use strict";
const assert = require("assert");
const {spawn} = require("child_process");
const path = require("path");
const WebSocket = require("ws");
const {SHOW, OPEN, MINSECS, TOKENS} = require("./bid.js");

const PORT = 3989;
const PW = "bid-test-pw";
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
    next(t, ms = 8000, pred = null, tag = ""){
      const i = box.findIndex(m => m.t === t && (!pred || pred(m)));
      if (i >= 0) return Promise.resolve(box.splice(i, 1)[0]);
      return new Promise((go, fail) => {
        const w = {t, pred, go};
        waiters.push(w);
        setTimeout(() => {
          const j = waiters.indexOf(w);
          if (j >= 0){ waiters.splice(j, 1); fail(new Error(`${t} 를 못 받았다 ${tag}`)); }
        }, ms);
      });
    },
    drain(){ box.length = 0; },
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
    env: Object.assign({}, process.env,
                       {PORT: String(PORT), DATABASE_URL: "", ADMIN_PW: PW}),
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", () => {});
  srv.stderr.on("data", d => process.stderr.write(d));
  const bye = code => { try { srv.kill(); } catch (e) {} process.exit(code); };
  process.on("uncaughtException", e => { console.error(e); bye(1); });

  for (let i = 0; i < 60; i++){
    try { await fetch(`${BASE}/healthz`); break; } catch (e) { await wait(100); }
  }

  /* ─── 관리자가 연다 ─── */
  const got = await admin("login", {pw: PW});
  assert.ok(got.ok && got.token, "관리자 비번이 안 먹었다");
  token = got.token;

  const made = await admin("bidopen", {pin: "4321", title: "소켓 시험",
                                       secs: MINSECS, plan: 1000});
  assert.ok(made.ok, "비딩이 안 열렸다: " + made.why);
  const code = made.bid.code;
  assert.strictEqual(made.bid.state, "open");
  assert.strictEqual(made.bid.total, 18, "품목이 열여덟이 아니다");

  /* ─── 대표 셋과 구경꾼 하나 ─── */
  const reps = [];
  for (let i = 0; i < 3; i++) reps.push(await hello("wstest-bid-r" + i + "-zzzz"));
  const fan = await hello("wstest-bid-fan-zzzz");

  reps[0].send("bids", {});
  const list = await reps[0].next("bids");
  assert.ok(list.bids.some(b => b.code === code), "목록에 비딩이 없다");

  reps[0].send("bidjoin", {code, pin: "0000", rep: true});
  assert.strictEqual((await reps[0].next("error")).why, "badpin", "틀린 비번이 통했다");

  for (const c of reps) c.send("bidjoin", {code, pin: "4321", rep: true});
  for (const c of reps){
    const v = await c.next("bidme", 8000, m => !!m.me, "join");
    assert.strictEqual(v.state, "open", "대기 상태가 아니다");
    assert.ok(v.me && v.me.name, "팀을 못 받았다");
    assert.strictEqual(v.me.tokens, TOKENS, "처음 토큰이 안 맞는다");
    assert.strictEqual(v.sheet.length, 24, "경매 현황이 스물넷이 아니다");
    assert.ok(v.sheet.every(w => w.at === "left"), "시작 전인데 끝난 룰렛이 있다");
  }
  fan.send("bidjoin", {code, pin: "4321"});
  const fv = await fan.next("bidme");
  assert.ok(!fv.me, "구경꾼이 팀을 받았다");

  /* ─── 시작 — 먼저 작전타임 ─── */
  for (const c of reps) c.drain();
  const begun = await admin("bidstart", {code});
  assert.ok(begun.ok, "시작이 안 됐다: " + begun.why);
  assert.strictEqual(begun.teams, 3, "팀 수가 안 맞는다");

  const planning = await reps[0].next("bidme", 8000, m => m.state === "plan", "plan");
  assert.ok(planning.plan.left > 0, "작전타임이 안 돈다");

  /* 관리자가 작전타임을 끊는다 */
  const cut = await admin("bidgo", {code});
  assert.ok(cut.ok, "작전타임을 못 끊었다: " + cut.why);
  let v = await reps[0].next("bidme", 8000, m => m.state === "running" && m.lot, "lot1");
  assert.strictEqual(v.lot.nth, 1, "첫 품목이 아니다");
  assert.ok(v.lot.wheel.cells.length === 3, "룰렛 칸이 셋이 아니다");
  assert.strictEqual(v.sheet.filter(w => w.at === "now").length, 1,
                     "현황에 지금 걸린 것이 하나가 아니다");

  /* ─── 값 부르기 ─── */
  const bad = v.lot.bad;
  console.log("  첫 품목은 " + (bad ? "받기 싫은 것 — 비밀 입찰" : "좋은 것 — 올려 부르기"));
  for (const c of reps) c.drain();
  if (bad){
    /* 비밀 입찰 — 남의 값은 안 나가고, 몇 팀이 냈는지만 나간다 */
    reps[0].send("bidseal", {n: 0});
    assert.strictEqual((await reps[0].next("error")).why, "min", "0 이 통과됐다");
    reps[0].send("bidseal", {n: 5});
    v = await reps[1].next("bidme", 8000, m => m.lot && m.lot.sent === 1, "sent1");
    assert.strictEqual(v.lot.mine, undefined, "남의 값이 보인다");
    assert.strictEqual((await (async () => {
      reps[0].send("bidseal", {n: 2});
      return reps[0].next("error");
    })()).why, "already", "두 번 냈다");
    const own = await reps[0].next("bidme", 8000, m => m.lot && m.lot.mine === 5, "mine5");
    assert.strictEqual(own.lot.mine, 5, "내가 낸 값이 안 보인다");
    /* 같은 값이면 늦게 낸 쪽이 받는다 — 순서를 또렷이 벌려 둔다.
       소켓 둘을 잇달아 쏘면 서버에 닿는 차례가 뒤집힐 수 있다 */
    reps[1].send("bidseal", {n: 2});
    await reps[1].next("bidme", 8000, m => m.lot && m.lot.sent === 2, "sent2");
    await wait(250);
    reps[2].send("bidseal", {n: 2});
    /* 다 내면 그 자리에서 열린다. 2 가 둘인데 늦게 낸 쪽이 받는다 */
    v = await reps[0].next("bidme", 8000, m => m.lot && m.lot.done, "done");
    assert.strictEqual(v.lot.done.why, "sealed", "비밀 입찰로 안 열렸다");
    assert.strictEqual(v.lot.done.team, 2, "같은 값에 늦게 낸 팀이 안 받았다");
    assert.strictEqual(v.lot.done.bids.length, 3, "공개된 입찰이 모자란다");
    assert.strictEqual(v.board.find(t => t.id === 2).tokens, undefined,
                       "남의 토큰이 보인다");
    /* v 는 reps[0] 이 받은 것이다. 내 것은 내 화면에 실려 온다 */
    assert.strictEqual(v.me.tokens, TOKENS - 5, "적어 낸 만큼 안 빠졌다");
    assert.strictEqual(v.board.find(t => t.id === 0).tokens, TOKENS - 5,
                       "내 토큰은 순위판에도 실려야 한다");
    const own2 = await reps[2].next("bidme", 8000, m => m.me && m.lot && m.lot.done, "own2");
    assert.strictEqual(own2.me.tokens, TOKENS, "받은 팀의 토큰이 빠졌다");
  } else {
    reps[0].send("bidup", {n: 1});
    v = await reps[1].next("bidme", 8000, m => m.lot && m.lot.price === 1, "price1");
    reps[0].send("bidup", {n: 2});
    assert.strictEqual((await reps[0].next("error")).why, "yours", "자기 값을 자기가 올렸다");
    reps[1].send("bidup", {n: 1});
    assert.strictEqual((await reps[1].next("error")).why, "low", "같은 값이 통했다");
    reps[1].send("bidup", {n: 99});
    assert.strictEqual((await reps[1].next("error")).why, "broke", "없는 토큰을 불렀다");
    reps[1].send("bidup", {n: 4});
    v = await reps[0].next("bidme", 8000, m => m.lot && m.lot.price === 4, "price4");
    assert.strictEqual(v.lot.who, 1, "마지막으로 부른 팀이 아니다");
    /* 10초 동안 조용하면 낙찰된다 */
    v = await reps[0].next("bidme", (MINSECS + 15) * 1000, m => m.lot && m.lot.done, "sold");
    assert.strictEqual(v.lot.done.team, 1, "낙찰 팀이 다르다");
    assert.strictEqual(v.lot.done.price, 4, "낙찰가가 다르다");
    assert.strictEqual(v.board.find(t => t.id === 1).tokens, undefined,
                       "남의 토큰이 보인다");
    const own = await reps[1].next("bidme", 8000, m => m.me && m.lot && m.lot.done, "own1");
    assert.strictEqual(own.me.tokens, TOKENS - 4, "토큰이 안 빠졌다");
  }
  /* 구경꾼은 값을 못 부른다 */
  fan.drain();
  fan.send("bidup", {n: 1});
  assert.ok(["watcher", "wait", "notup"].indexOf((await fan.next("error")).why) >= 0,
            "구경꾼이 값을 불렀다");

  /* 낙찰이 끝나면 다음 품목으로 저절로 넘어간다 */
  /* 비밀 입찰은 열어 둔 채 15초를 둔다. 좋은 룰렛의 3초로는 모자란다 */
  const nextLot = await reps[0].next("bidme", (bad ? OPEN : SHOW) + 6000,
                                     m => m.lot && m.lot.nth === 2 && !m.lot.done,
                                     "nextLot");
  assert.ok(nextLot.lot.price === 0, "새 품목인데 값이 남았다");
  assert.strictEqual(nextLot.sheet.filter(w => w.at === "done").length, 1,
                     "현황에 끝난 것이 안 쌓인다");

  /* ─── 닫기 ─── */
  const shut = await admin("bidclose", {code});
  assert.ok(shut.ok, "닫기가 안 됐다");
  await reps[0].next("bidgone", 3000);

  const health = await (await fetch(`${BASE}/healthz`)).json();
  assert.strictEqual(health.bids, 0, "닫았는데 비딩이 남았다");

  for (const c of reps) c.close();
  fan.close();
  console.log("소켓 왕복 통과 — 열기 · 대표/구경 · 작전타임 · 호가 · 비밀 입찰 · 토큰 비공개 · 낙찰 · 닫기");
  bye(0);
})();
