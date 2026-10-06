/* node omrws.test.js — 블라인드 소켓 왕복 검사.
   서버를 실제로 띄우고 관리자가 열고, 여섯이 들어가 명제를 받고, 시계를
   당겨 가며 마킹하고 채점까지 간다. 40분을 기다릴 수는 없으니 omrwarp 로
   건너뛴다. DB 는 끄고, 관리자 비번은 ADMIN_PW 로 넣는다. */
"use strict";
const assert = require("assert");
const {spawn} = require("child_process");
const path = require("path");
const WebSocket = require("ws");
const {KEY, QUESTIONS, PRINTED, PER, STEP, SIT, END, OPEN, SCORE, LEN,
       grade} = require("./omr.js");
const {PROPS, COMMON} = require("./props.js");

const PORT = 3989;
const PW = "omr-test-pw";
const BASE = `http://127.0.0.1:${PORT}`;
const WSU  = `ws://127.0.0.1:${PORT}/ws`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const M = 60000;

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

  const made = await admin("omropen", {pin: "4321", title: "소켓 시험"});
  assert.ok(made.ok, "블라인드가 안 열렸다: " + made.why);
  const code = made.omr.code;
  assert.strictEqual(made.omr.state, "open");
  assert.deepStrictEqual(made.omr.hints, COMMON.map(c => c.text), "공통 힌트가 안 들어갔다");

  /* ─── 학생이 목록을 보고 들어온다 ─── */
  const kids = [];
  for (let i = 0; i < 6; i++) kids.push(await hello("wstest-omr-" + i + "-zzzz"));

  kids[0].send("omrs", {});
  const list = await kids[0].next("omrs");
  assert.ok(list.omrs.some(o => o.code === code), "목록에 블라인드가 없다");

  kids[0].send("omrjoin", {code, pin: "0000"});
  assert.strictEqual((await kids[0].next("error")).why, "badpin", "틀린 비번이 통했다");

  for (const c of kids) c.send("omrjoin", {code, pin: "4321"});
  for (const c of kids){
    const v = await c.next("omrme");
    assert.strictEqual(v.state, "open", "대기 상태가 아니다");
    assert.ok(v.name, "닉네임이 없다");
    assert.strictEqual(v.printed, PRINTED, "40번까지 안 찍힌다");
    assert.strictEqual(v.questions, QUESTIONS, "쓰는 문제가 스무 개가 아니다");
    assert.ok(Array.isArray(v.plan) && v.plan.length > 5, "진행표가 안 왔다");
    assert.ok(!v.key, "시작도 안 했는데 정답이 왔다");
  }
  /* 새로고침해서 돌아오면 비번 없이 들어온다 */
  kids[0].drain();
  kids[0].send("omrjoin", {code});
  assert.ok((await kids[0].next("omrme")).name, "돌아온 사람이 막혔다");

  /* ─── 시작 — 명제를 한 줄씩 받는다 ─── */
  for (const c of kids) c.drain();
  const begun = await admin("omrstart", {code});
  assert.ok(begun.ok, "시작이 안 됐다: " + begun.why);
  assert.strictEqual(begun.people, 6, "여섯이 아니다");

  for (const c of kids) await c.next("omrme", 5000, m => m.state === "running");
  const look = await admin("state");
  const seat = look.omrs.find(o => o.code === code);
  assert.strictEqual(seat.entrants.length, 6, "관리자 명단이 틀리다");
  assert.ok(seat.entrants.every(e => e.prop), "명제를 못 받은 사람이 있다");
  assert.strictEqual(new Set(seat.entrants.map(e => e.prop)).size, 6,
                     "같은 명제를 둘이 받았다");

  /* 내 명제는 공개하는 1분 동안만, 나에게만 */
  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 4});
  const solos = [];
  for (const c of kids){
    const v = await c.next("omrme", 5000, m => m.now && m.now.gone);
    assert.ok(v.now.say, "내 명제가 안 왔다");
    assert.ok(v.now.left > 0 && v.now.left <= M, "사라질 때까지가 안 센다");
    solos.push(v.now.say);
  }
  assert.strictEqual(new Set(solos).size, 6, "남의 명제가 섞여 왔다");

  /* 공통 힌트는 모두에게 같은 것이 간다 */
  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 11});            // 15분
  const hint = [];
  for (const c of kids) hint.push((await c.next("omrme", 5000, m => m.now && m.now.gone)).now.say);
  assert.strictEqual(new Set(hint).size, 1, "공통 힌트가 사람마다 다르다");
  assert.strictEqual(hint[0], COMMON[0].text, "1차 공통 힌트가 틀리다");

  /* ─── 마킹 ─── */
  kids[0].drain();
  kids[0].send("omrmark", {q: 1, n: 3});
  assert.strictEqual((await kids[0].next("error")).why, "early", "착석 전에 마킹이 됐다");

  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 17});            // 32분 — 착석
  for (const c of kids) await c.next("omrme", 5000, m => m.spent >= SIT);

  kids[0].drain();
  kids[0].send("omrmark", {q: 21, n: 1});
  assert.strictEqual((await kids[0].next("error")).why, "noq", "21번이 마킹됐다");

  /* 셋은 다 맞히고, 셋은 다 틀린다 */
  for (let i = 0; i < kids.length; i++){
    for (let q = 1; q <= QUESTIONS; q++)
      kids[i].send("omrmark", {q, n: i < 3 ? KEY[q - 1] : (KEY[q - 1] % 5) + 1});
  }
  kids[0].send("omrbet", {v: 95});
  const marked = await kids[0].next("omrme", 5000,
    m => Object.keys(m.marks).length === QUESTIONS && m.guess === 95);
  assert.strictEqual(marked.marks[1], KEY[0], "마킹이 안 남았다");
  assert.ok(!marked.key, "마킹 중에 정답이 내려왔다");

  /* 남의 답안은 안 보인다 */
  const mine0 = await (async () => { kids[0].drain(); kids[0].send("omrmark", {q: 1, n: KEY[0]});
    await kids[0].next("omrme"); kids[0].send("omrmark", {q: 1, n: KEY[0]});
    return kids[0].next("omrme"); })();
  assert.strictEqual(Object.keys(mine0).includes("people"), true);
  assert.ok(!JSON.stringify(mine0).includes("\"pid\""), "남의 것이 섞여 왔다");

  /* ─── 종료령 — 마킹이 닫힌다 ─── */
  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 3});             // 35분
  for (const c of kids) await c.next("omrme", 5000, m => m.spent >= END);
  kids[0].drain();
  kids[0].send("omrmark", {q: 2, n: 1});
  assert.strictEqual((await kids[0].next("error")).why, "late", "종료령 뒤에 마킹이 됐다");

  const shut = await admin("state");
  const sheet = shut.omrs.find(o => o.code === code);
  assert.strictEqual(sheet.board.length, 6, "관리자 점수판이 안 떴다");
  assert.strictEqual(sheet.board[0].score, QUESTIONS * PER, "만점이 안 나왔다");

  /* ─── 정답 공개 — 1번부터 5초에 하나씩 ─── */
  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 1});             // 36분
  const first = await kids[0].next("omrme", 5000, m => m.key && m.key.length >= 1);
  assert.strictEqual(first.key[0], KEY[0], "첫 정답이 틀리다");
  assert.ok(first.key.length < QUESTIONS, "정답이 한꺼번에 다 왔다");
  const second = await kids[0].next("omrme", STEP + 4000, m => m.key && m.key.length >= 2);
  assert.strictEqual(second.key[1], KEY[1], "둘째 정답이 틀리다");

  /* ─── 점수 공개 ─── */
  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 2});             // 38분
  const top = await kids[0].next("omrme", 5000, m => !!m.result);
  assert.strictEqual(top.result.score, QUESTIONS * PER, "만점이 아니다");
  assert.strictEqual(top.result.rank, 1, "1등이 아니다");
  /* 여섯 중 1등은 상위 16.7% 라 2등급이다 — 5등급제에서 한 반이 작으면
   1등급이 안 나온다. 실제 교실(21명)이면 두 명까지 1등급이다 */
assert.strictEqual(top.result.grade, grade(1, 6), "등급 셈이 틀렸다");
assert.strictEqual(grade(2, 21), 1, "스물하나 중 2등이 1등급이 아니다");
  assert.strictEqual(top.result.people, 6, "응시자 수가 틀리다");
  const low = await kids[5].next("omrme", 5000, m => !!m.result);
  assert.strictEqual(low.result.score, 0, "다 틀렸는데 점수가 있다");
  assert.deepStrictEqual(low.key, KEY, "끝났는데 정답이 다 안 열렸다");

  /* ─── 끝 ─── */
  for (const c of kids) c.drain();
  await admin("omrwarp", {code, m: 3});             // 41분 → 40분에서 멎는다
  await kids[0].next("omrme", 5000, m => m.state === "done");

  const bye2 = await admin("omrclose", {code});
  assert.ok(bye2.ok, "닫기가 안 됐다");
  await kids[0].next("omrgone", 3000);
  const health = await (await fetch(`${BASE}/healthz`)).json();
  assert.strictEqual(health.omrs, 0, "닫았는데 블라인드가 남았다");

  for (const c of kids) c.close();
  console.log("소켓 왕복 통과 — 열기 · 참가 · 명제 배부 · 공통 힌트 · 마킹 · " +
              "종료령 · 정답 공개 · 점수 · 닫기");
  bye(0);
})();
