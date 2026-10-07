/* node quiz.test.js — 팀 짜기, 점수, 공개, 순위 */
"use strict";
const assert = require("assert");
const {Quiz, split, tidy, MINUTE, MISS, FLIP, WHOLE, SHOW} = require("./quiz.js");
const players = require("./players.js");

const who = n => players.get("qtest-" + n + "-aaaaaaaa");
function filled(n, pin){
  const q = new Quiz("QZ" + n, {pin: pin || "1234", title: "시험"});
  for (let i = 0; i < n; i++) q.join(who(i));
  return q;
}

/* ─── 팀 짜기 ──────────────────────────────────────────────────────── */
assert.strictEqual(split(2), null, "두 팀을 못 만들면 시작하지 않는다");
assert.strictEqual(split(5), null, "다섯은 두 팀이 안 된다");
assert.deepStrictEqual(split(6), [3, 3], "여섯은 셋씩 두 팀이다");
for (let n = 19; n <= 24; n++){
  const s = split(n);
  assert.strictEqual(s.reduce((a, b) => a + b, 0), n, n + "명이 다 안 들어갔다");
  assert.ok(s.every(x => x === 3 || x === 4), n + "명 — 셋도 넷도 아닌 팀이 있다 " + s);
  assert.ok(s.length >= 6 && s.length <= 8, n + "명 — 팀이 " + s.length + "개다");
}
assert.deepStrictEqual(split(24), [3, 3, 3, 3, 3, 3, 3, 3], "스물넷은 셋씩 여덟 팀이다");
assert.deepStrictEqual(split(19).sort(), [3, 3, 3, 3, 3, 4], "열아홉은 넷 하나다");

/* 참가 */
const q0 = filled(5);
assert.strictEqual(q0.people.size, 5, "다섯이 안 들어왔다");
assert.strictEqual(q0.join(who(0)).again, true, "같은 사람이 두 번 들어갔다");
assert.strictEqual(q0.start(Date.now()).err, "few", "다섯으로 시작됐다");
assert.strictEqual(q0.quit(who(0).pid), true, "시작 전엔 빠질 수 있다");

/* ─── 한 판 ────────────────────────────────────────────────────────── */
const T0 = 1700000000000;
const q = filled(21);
assert.strictEqual(q.state, "open");
const r = q.start(T0);
assert.ok(r.ok, "시작이 안 됐다");
assert.strictEqual(r.teams, 7, "스물하나가 일곱 팀이 아니다");
assert.strictEqual(q.state, "running");
assert.strictEqual(q.nth, 0, "첫 문제가 안 떴다");
assert.ok(q.teams.every(t => t.pids.length === 3), "스물하나인데 4인팀이 있다");
assert.strictEqual(new Set(q.teams.map(t => t.name)).size, 7, "팀 이름이 겹친다");
/* 모두가 어느 팀엔가 들어갔고, 두 팀에 걸친 사람은 없다 */
const seats = q.teams.flatMap(t => t.pids);
assert.strictEqual(seats.length, 21, "자리가 스물하나가 아니다");
assert.strictEqual(new Set(seats).size, 21, "두 팀에 든 사람이 있다");

/* 낱장은 한 장만 나간다 */
const me = q.teams[0].pids[0];
let v = q.view(me, T0);
assert.ok(v.ask, "문제가 안 보인다");
assert.strictEqual(v.ask.sheet.length, v.ask.len, "낱장의 글자 수가 안 맞는다");
assert.strictEqual(v.ask.cap, v.ask.len * MINUTE, "최고점이 글자수 x 1분이 아니다");
assert.ok(!("sheets" in v.ask), "낱장 셋이 한꺼번에 나갔다");
assert.ok(!JSON.stringify(v).includes(q.ask.word), "답이 화면으로 나갔다");

/* 낱장은 4초마다 넘어간다 */
assert.strictEqual(q.tick(T0 + 100), false, "가만히 있는데 넘어갔다");
assert.strictEqual(q.tick(T0 + FLIP), true, "4초에 안 넘어갔다");
assert.strictEqual(q.view(me, T0 + FLIP).ask.page, 1, "둘째 장이 아니다");
assert.strictEqual(q.tick(T0 + FLIP * 3), true, "세 장을 돌고 안 돌아왔다");
assert.strictEqual(q.view(me, T0 + FLIP * 3).ask.page, 0, "처음 장으로 안 돌아왔다");

/* ─── 오답 ─────────────────────────────────────────────────────────── */
const word = q.ask.word;
const other = q.teams[1].pids[0];
let s = q.say(other, "아무거나", T0 + 5000);
assert.ok(s.ok && !s.right, "오답이 안 틀렸다고 나온다");
assert.strictEqual(q.teams[1].score, -MISS, "오답이 20초 안 깎였다");
/* 같은 오답을 또 내도 한 번만 깎는다 */
s = q.say(other, "아무거나", T0 + 7000);
assert.strictEqual(s.again, true, "같은 오답이 또 먹혔다");
assert.strictEqual(q.teams[1].score, -MISS, "같은 오답에 두 번 깎였다");
/* 연타는 흘린다 */
assert.strictEqual(q.say(other, "딴것", T0 + 7100).err, "slow", "연타가 먹혔다");
/* 띄어쓰기는 눈감아 준다 */
assert.strictEqual(tidy(" 청출 어람 "), "청출어람");

/* ─── 정답 ───────────────────────────────────────────────────── */
/* 오답으로 꼴류에 서 있는 팀이 30초 만에 맞혔다 — 3인팀이니 그대로 30점 */
s = q.say(other, " " + word + " ", T0 + 30000);
assert.ok(s.right, "정답이 안 맞았다고 나온다");
assert.strictEqual(s.got, 30, "30초가 안 들어왔다");
assert.strictEqual(q.teams[1].score, 30 - MISS, "점수가 안 올랐다");
/* 공개 중에는 답을 받지 않는다 */
assert.strictEqual(q.say(me, word, T0 + 31000).err, "wait", "공개 중에 답이 먹혔다");

/* 공개 — 성한 글싨와 낱장 셋이 다 나간다. 이제 답을 숨길 까닭이 없다 */
v = q.view(me, T0 + 31000);
assert.ok(v.reveal, "공개가 안 듰다");
assert.strictEqual(v.reveal.word, word, "공개인데 낱말이 없다");
assert.strictEqual(v.reveal.whole.length, word.length, "성한 글싨가 모자라다");
assert.strictEqual(v.reveal.sheets.length, 3, "낱장 셋이 안 나왔다");
assert.strictEqual(v.reveal.got, 30, "획득 점수가 안 나왔다");
assert.strictEqual(v.reveal.team, q.teams[1].name, "득점 팀 이름이 없다");
assert.strictEqual(v.reveal.mates.length, 3, "득점 팀 닉네임이 셋이 아니다");
assert.strictEqual(v.reveal.from, 7, "꼴류에서 오른 것이 아니다");
assert.strictEqual(v.reveal.to, 1, "1위로 안 올랐다");
assert.ok(!v.ask, "공개 중에 문제가 같이 떴다");

/* 공개가 끝나면 다음 문제 */
assert.strictEqual(q.tick(T0 + 31000), false, "공개가 일촍 끝났다");
assert.strictEqual(q.tick(T0 + 30000 + WHOLE + SHOW), true, "다음 문제로 안 갔다");
assert.strictEqual(q.nth, 1, "둘째 문제가 아니다");
assert.notStrictEqual(q.ask.word, word, "같은 낱말이 또 나왔다");

/* 순위 — 같은 점수는 같은 뒠수 */
const board = q.board();
assert.strictEqual(board.length, 7, "순위가 일곱 줄이 아니다");
assert.strictEqual(board[0].score, 30 - MISS, "1위가 득점 팀이 아니다");
assert.strictEqual(board[0].rank, 1, "1위가 1위가 아니다");
const tied = board.filter(t => t.score === 0);
assert.strictEqual(tied.length, 6, "0점 팀이 여섯이 아니다");
assert.strictEqual(new Set(tied.map(t => t.rank)).size, 1, "같은 점수인데 뒠수가 다르다");
assert.strictEqual(tied[0].rank, 2, "0점 팀이 공동 2위가 아니다");

/* ─── 최고점과 4인팀 ───────────────────────────────────────────────── */
const q4 = filled(19);
q4.start(T0);
const four = q4.teams.find(t => t.full);
assert.ok(four, "열아홉인데 4인팀이 없다");
assert.strictEqual(four.pids.length, 4, "4인팀이 넷이 아니다");
const cap = q4.cap();
/* 최고점을 못 채웠으면 3/4 */
q4.say(four.pids[0], q4.ask.word, T0 + 40000);
assert.strictEqual(four.score, Math.floor(Math.min(40, cap) * 3 / 4),
                   "4인팀에 3/4 이 안 걸렸다");
/* 최고점에 닿았으면 그대로 */
q4.tick(T0 + 40000 + WHOLE + SHOW);
const was = four.score, cap2 = q4.cap();
q4.say(four.pids[0], q4.ask.word, T0 + 40000 + WHOLE + SHOW + (cap2 + 30) * 1000);
assert.strictEqual(four.score - was, cap2, "최고점인데 3/4 이 걸렸다");
assert.strictEqual(q4.reveal.topped, true, "최고점이라고 안 알린다");

/* ─── 넘기기와 끝 ──────────────────────────────────────────────────── */
const q2 = filled(6);
q2.start(T0);
assert.strictEqual(q2.teams.length, 2, "여섯이 두 팀이 아니다");
let t = T0;
for (let i = 0; i < q2.order.length; i++){
  assert.strictEqual(q2.state, "running", (i + 1) + "번째에서 멎었다");
  assert.ok(q2.give(t).ok, (i + 1) + "번째를 못 넘겼다");
  assert.strictEqual(q2.reveal.by, null, "넘긴 문제에 득점 팀이 있다");
  t += WHOLE + SHOW;
  q2.tick(t);
}
assert.strictEqual(q2.state, "done", "스물세 문제를 다 냈는데 안 끝났다");
assert.strictEqual(q2.ask, null, "끝났는데 문제가 남았다");
assert.ok(q2.teams.every(x => x.score === 0), "아무도 못 맞혔는데 점수가 있다");
assert.strictEqual(q2.say(q2.teams[0].pids[0], "밤", t).err, "notrunning",
                   "끝난 판에 답이 먹혔다");

if (require.main === module){
  console.log("문제 " + q.order.length + "개 · 팀 이름 " +
              q.teams.map(x => x.name).join(" "));
  for (const b of board)
    console.log("  " + b.rank + "위 " + b.name + "  " + b.score + "초  " +
                b.mates.join(", "));
  /* ─── 맡겼다 되살리기 — 서버가 다시 떠도 퀴즈가 이어진다 ──────────────── */
{
  const T = 1700000000000;
  const a = filled(9); a.start(T);
  for (let t = T; t < T + 3000; t += 250) a.tick(t);
  const pids = [...a.people.keys()];
  a.say(pids[0], "틀린말", T + 3000);             // 오답 하나 — said 가 차야 한다
  const b = Quiz.revive(JSON.parse(JSON.stringify(a.snapshot())));
  const at = T + 3500;
  pids.forEach(p => assert.deepStrictEqual(b.view(p, at), a.view(p, at), "되살린 퀴즈의 모습이 다르다"));
  assert.deepStrictEqual(b.full(at), a.full(at), "되살린 퀴즈의 관리자 모습이 다르다");
  assert.deepStrictEqual(b.ask.sheets, a.ask.sheets, "낱장을 다시 잘라 낸 것이 다르다");
  /* 같은 오답을 또 내면 되살린 판도 알아본다 */
  assert.deepStrictEqual(b.say(pids[0], "틀린말", at), a.say(pids[0], "틀린말", at),
                         "되살린 퀴즈가 이미 낸 오답을 잊었다");
  console.log("revive  맡겼다 되살려도 팀 · 문제 · 낱장 · 낸 오답이 그대로");
}

console.log("전부 통과");
}
