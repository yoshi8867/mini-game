/* node quizws.test.js — 한글 퀴즈 소켓 왕복 검사.
   서버를 실제로 띄우고 관리자가 열고, 여섯이 들어가 팀을 짜고, 틀리고
   맞히고 공개가 끝나 다음 문제로 넘어가는 데까지 돌린다.
   DB 는 끄고, 관리자 비번은 ADMIN_PW 로 넣는다. */
"use strict";
const assert = require("assert");
const {spawn} = require("child_process");
const path = require("path");
const WebSocket = require("ws");
const {WHOLE, SHOW, MISS, FLIP} = require("./quiz.js");

const PORT = 3988;
const PW = "quiz-test-pw";
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
  const bad = await admin("login", {pw: "틀린것"});
  assert.ok(!bad.ok, "엉뚱한 비번으로 들어갔다");
  const got = await admin("login", {pw: PW});
  assert.ok(got.ok && got.token, "관리자 비번이 안 먹었다");
  token = got.token;

  const made = await admin("quizopen", {pin: "4321", title: "소켓 시험"});
  assert.ok(made.ok, "퀴즈가 안 열렸다: " + made.why);
  const code = made.quiz.code;
  assert.strictEqual(made.quiz.state, "open");
  assert.strictEqual(made.quiz.total, 23, "문제가 스물셋이 아니다");

  /* ─── 학생이 목록을 보고 들어온다 ─── */
  const kids = [];
  for (let i = 0; i < 6; i++) kids.push(await hello("wstest-quiz-" + i + "-zzzz"));

  kids[0].send("quizzes", {});
  const list = await kids[0].next("quizzes");
  assert.ok(list.quizzes.some(q => q.code === code), "목록에 퀴즈가 없다");

  kids[0].send("quizjoin", {code, pin: "0000"});
  assert.strictEqual((await kids[0].next("error")).why, "badpin", "틀린 비번이 통했다");

  for (const c of kids) c.send("quizjoin", {code, pin: "4321"});
  for (const c of kids){
    const v = await c.next("quizme");
    assert.strictEqual(v.state, "open", "대기 상태가 아니다");
    assert.ok(v.name, "닉네임이 없다");
    assert.ok(!v.team, "시작 전에 팀이 있다");
  }
  /* 새로고침해서 돌아오면 비번 없이 들어온다 */
  kids[0].drain();
  kids[0].send("quizjoin", {code});
  assert.ok((await kids[0].next("quizme")).name, "돌아온 사람이 막혔다");

  /* ─── 팀을 짜고 시작한다 ─── */
  for (const c of kids) c.drain();
  const begun = await admin("quizstart", {code});
  assert.ok(begun.ok, "시작이 안 됐다: " + begun.why);
  assert.strictEqual(begun.teams, 2, "여섯이 두 팀이 아니다");

  const mine = [];
  for (const c of kids){
    const v = await c.next("quizme", 5000, m => !!m.ask);
    mine.push(v);
    assert.strictEqual(v.state, "running");
    assert.ok(v.team && v.team.mates.length === 3, "팀이 셋이 아니다");
    assert.strictEqual(v.ask.sheet.length, v.ask.len, "낱장 글자 수가 안 맞는다");
    assert.strictEqual(v.board.length, 2, "순위가 두 줄이 아니다");
    assert.ok(v.board.every(t => t.score === 0), "시작부터 점수가 있다");
  }
  /* 답은 화면으로 나가지 않는다 */
  const look = await admin("state");
  const word = look.quizzes.find(q => q.code === code).word;
  assert.ok(word, "관리자가 지금 낱말을 못 본다");
  for (const v of mine)
    assert.ok(!JSON.stringify(v).includes(word), "답이 학생 화면으로 나갔다");

  /* 낱장은 4초마다 넘어간다 */
  const flip = await kids[0].next("quizme", FLIP + 2000, m => m.ask && m.ask.page === 1);
  assert.strictEqual(flip.ask.page, 1, "둘째 장이 안 왔다");

  /* ─── 틀렸다 ─── */
  const teamOf = v => v.team.id;
  const a = mine.findIndex(v => teamOf(v) === 0);
  const b = mine.findIndex(v => teamOf(v) === 1);
  assert.ok(a >= 0 && b >= 0, "두 팀이 안 갈렸다");

  for (const c of kids) c.drain();
  kids[b].send("quizsay", {text: "아무거나"});
  const miss = await kids[b].next("quizmiss");
  assert.strictEqual(miss.lost, MISS, "오답이 20초 안 깎였다");
  /* 틱이 낱장을 넘기면서 보낸 것이 아니라, 깎인 것이 담긴 것을 기다린다 */
  const after = await kids[a].next("quizme", 4000,
    m => m.board && m.board.some(t => t.id === 1 && t.score === -MISS));
  assert.strictEqual(after.board.find(t => t.id === 1).score, -MISS,
                     "다른 사람 화면에 감점이 안 보인다");

  /* ─── 맞혔다 ─── */
  for (const c of kids) c.drain();
  kids[a].send("quizsay", {text: word});
  for (const c of kids){
    const v = await c.next("quizme", 5000, m => !!m.reveal);
    assert.strictEqual(v.reveal.word, word, "공개인데 낱말이 없다");
    assert.strictEqual(v.reveal.whole.length, word.length, "성한 글씨가 모자라다");
    assert.strictEqual(v.reveal.sheets.length, 3, "낱장 셋이 안 왔다");
    assert.strictEqual(v.reveal.by, 0, "득점 팀이 틀리다");
    assert.strictEqual(v.reveal.mates.length, 3, "득점 팀 닉네임이 셋이 아니다");
    assert.ok(v.reveal.left > 0, "공개가 벌써 끝났다");
    assert.ok(!v.ask, "공개 중에 문제가 같이 왔다");
  }

  /* ─── 공개가 끝나면 다음 문제 ─── */
  for (const c of kids) c.drain();
  const nextQ = await kids[0].next("quizme", WHOLE + SHOW + 3000,
                                   m => m.ask && m.nth === 2);
  assert.strictEqual(nextQ.nth, 2, "둘째 문제가 안 왔다");
  assert.ok(!JSON.stringify(nextQ).includes(word), "지난 답이 아직 보인다");

  /* ─── 넘기기 ─── */
  for (const c of kids) c.drain();
  const skip = await admin("quizskip", {code});
  assert.ok(skip.ok, "넘기기가 안 됐다: " + skip.why);
  const given = await kids[0].next("quizme", 3000, m => !!m.reveal);
  assert.strictEqual(given.reveal.by, null, "넘긴 문제에 득점 팀이 있다");

  /* ─── 닫기 ─── */
  const shut = await admin("quizclose", {code});
  assert.ok(shut.ok, "닫기가 안 됐다");
  await kids[0].next("quizgone", 3000);

  const health = await (await fetch(`${BASE}/healthz`)).json();
  assert.strictEqual(health.quizzes, 0, "닫았는데 퀴즈가 남았다");

  for (const c of kids) c.close();
  console.log("소켓 왕복 통과 — 열기 · 참가 · 팀 · 오답 · 정답 · 공개 · 넘기기 · 닫기");
  bye(0);
})();
