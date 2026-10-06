/* node omr.test.js — 명제 배부, 마킹 참, 정답을 늦게 여는 것, 채점과 등급 */
"use strict";
/* 진짜 판이 .env 에 있어도 검사는 연습판으로 돌린다 */
process.env.OMR_PROPS = "";
const assert = require("assert");
const {Omr, PLAN, KEY, PROPS, stepAt, openedAt, grade,
       QUESTIONS, PER, STEP, SIT, END, OPEN, SCORE, LEN} = require("./omr.js");
const {deal, DROP, COMMON} = require("./props.js");
const players = require("./players.js");

const who = n => players.get("otest-" + n + "-aaaaaaaa");
function filled(n){
  const o = new Omr("OM" + n, {pin: "1234", title: "블라인드"});
  for (let i = 0; i < n; i++) o.join(who(i));
  return o;
}
const T0 = 1700000000000;

/* ─── 명제 ─────────────────────────────────────────────────────────── */
assert.strictEqual(PROPS.length, 23, "나눠 주는 명제가 스물셋이 아니다");
assert.strictEqual(PROPS.filter(p => p.star).length, 6, "☆ 가 여섯이 아니다");
assert.strictEqual(COMMON.length, 3, "공통 힌트가 셋이 아니다");
COMMON.forEach(c => assert.ok(!PROPS.some(p => p.id === c.id || p.id === c.was),
  c.id + " 이 나눠 주는 명제에도 남아 있다"));
/* P10 하나면 답이 못 박힌다. 그래서 맨 뒤에 둔다 */
assert.deepStrictEqual(COMMON.map(c => c.id), ["C1", "C2", "C3"],
  "공통 힌트 번호가 C1 C2 C3 가 아니다");
assert.strictEqual(PLAN.filter(p => p.hint !== undefined).length, COMMON.length,
  "공통 힌트 수와 공개 자리 수가 다르다");
assert.deepStrictEqual(DROP.slice().sort(),
  PROPS.filter(p => p.star).map(p => p.id).sort(), "빼는 순서에 ★ 가 섞였다");
assert.strictEqual(deal(23).length, 23, "스물셋이면 다 쓴다");
assert.strictEqual(deal(17).length, 17, "열일곱이면 ☆ 를 다 뺀다");
assert.ok(deal(17).every(p => !p.star), "열일곱인데 ☆ 가 남았다");
assert.strictEqual(deal(22).map(p => p.id).includes("P24"), false,
  "스물둘이면 P24 가 가장 먼저 빠진다");
assert.strictEqual(deal(30).length, 23, "사람이 많아도 명제는 스물셋뿐이다");

/* ─── 정답 ─────────────────────────────────────────────────────────── */
assert.strictEqual(KEY.length, QUESTIONS, "정답이 스무 개가 아니다");
assert.ok(KEY.every(n => n >= 1 && n <= 5), "정답에 1~5 가 아닌 것이 있다");

/* ─── 접수 ─────────────────────────────────────────────────────────── */
const o0 = filled(5);
assert.strictEqual(o0.people.size, 5, "다섯이 안 들어왔다");
assert.strictEqual(o0.join(who(0)).again, true, "같은 사람이 두 번 들어갔다");
assert.strictEqual(o0.quit(who(4).pid), true, "나가지지 않는다");
assert.strictEqual(o0.people.size, 4, "나갔는데 명단에 남아 있다");
assert.strictEqual(new Omr("OM1", {}).start(T0).err, "few", "혼자서도 시작됐다");

/* ─── 시작 — 1인 1명제 ─────────────────────────────────────────────── */
const o = filled(21);
assert.strictEqual(o.view(who(0).pid, T0).state, "open", "접수 중이 아니다");
assert.strictEqual(o.view(who(0).pid, T0).now, undefined, "시작도 안 했는데 안내가 떴다");
const r = o.start(T0);
assert.strictEqual(r.ok, true, "시작이 안 됐다");
assert.strictEqual(r.props, 21, "스물하나인데 명제가 " + r.props + "개다");
assert.strictEqual(r.short, false, "스물하나까지는 1인 1명제다");
assert.strictEqual(o.join(who(99)).err, "closed", "시작한 뒤에 들어와졌다");

const given = [...o.people.values()].map(p => p.prop.id);
assert.strictEqual(given.length, 21, "명제를 못 받은 사람이 있다");
assert.strictEqual(new Set(given).size, 21, "같은 명제를 둘이 받았다");
const few = filled(18); few.start(T0);
const fewIds = [...few.people.values()].map(p => p.prop.id);
assert.strictEqual(new Set(fewIds).size, 18, "열여덟인데 명제가 겹쳤다");
assert.ok(!fewIds.includes("P24") && !fewIds.includes("P19") &&
          !fewIds.includes("P08") && !fewIds.includes("P14"),
  "열여덟인데 ☆ 네 개가 안 빠졌다");

/* 사람이 명제보다 많으면 돌려 가며 겹친다 */
const many = filled(30); many.start(T0);
assert.strictEqual(new Set([...many.people.values()].map(p => p.prop.id)).size, 23,
  "서른 명에게 명제 스물셋을 다 못 돌렸다");

/* ─── 내 명제는 나에게만, 그것도 1분만 ──────────────────────────────── */
const mine = o.people.get(who(0).pid).prop.text;
const atSolo = o.view(who(0).pid, T0 + 4 * 60000 + 1000);
assert.strictEqual(atSolo.now.say, mine, "내 명제가 안 뜬다");
assert.ok(atSolo.now.left > 0 && atSolo.now.left <= 60000, "사라질 때까지가 안 센다");
/* 4차 공통 힌트는 25분에 뜨고 26분에 사라진다 — 다음 단계는 32분이라 빈 참이 있다 */
assert.ok(o.view(who(0).pid, T0 + 26 * 60000 - 1).now, "1분이 안 됐는데 힌트가 사라졌다");
assert.strictEqual(o.view(who(0).pid, T0 + 26 * 60000).now, undefined,
  "1분이 지났는데 힌트가 남아 있다");
assert.notStrictEqual(o.view(who(1).pid, T0 + 4 * 60000 + 1000).now.say, mine,
  "남의 명제가 내 화면에 왔다");
const seen = JSON.stringify(o.view(who(0).pid, T0 + 10 * 60000));
PROPS.forEach(p => assert.ok(!seen.includes(p.text), p.id + " 이 화면으로 샜다"));

/* ─── 공통 힌트 ────────────────────────────────────────────────────── */
PLAN.forEach(p => {
  if (p.hint === undefined) return;
  assert.strictEqual(o.view(who(0).pid, T0 + p.m * 60000 + 1).now.say, o.hints[p.hint],
    p.t + " 가 안 뜬다");
});
const named = new Omr("OMH", {hints: ["가", "", "다"]});
assert.deepStrictEqual([named.hints[0], named.hints[2]], ["가", "다"], "넣은 힌트가 안 들어갔다");
assert.strictEqual(named.hints.length, COMMON.length, "힌트 수가 줄었다");
assert.strictEqual(named.hints[1], o.hints[1], "빈 칸이 기본값으로 안 채워졌다");

/* ─── 마킹 참 ──────────────────────────────────────────────────────── */
const pid = who(0).pid;
assert.strictEqual(o.mark(pid, 1, 5, T0 + 10 * 60000).err, "early",
  "착석 전에 마킹이 됐다");
assert.strictEqual(o.mark(pid, 1, 5, T0 + SIT).ok, true, "착석 뒤에 마킹이 안 된다");
assert.strictEqual(o.mark(pid, 21, 5, T0 + SIT).err, "noq", "21번이 마킹됐다");
assert.strictEqual(o.mark(pid, 0, 5, T0 + SIT).err, "noq", "0번이 마킹됐다");
assert.strictEqual(o.mark(pid, 1, 9, T0 + SIT).err, "non", "9번 보기가 마킹됐다");
o.mark(pid, 1, 5, T0 + SIT);                              // 같은 칸을 또 눌렀다
assert.strictEqual(o.people.get(pid).marks[1], undefined, "또 눌렀는데 안 지워진다");
o.mark(pid, 1, 3, T0 + SIT); o.mark(pid, 1, 5, T0 + SIT);
assert.strictEqual(o.people.get(pid).marks[1], 5, "다른 보기로 안 바뀐다");
assert.strictEqual(o.mark(pid, 2, 2, T0 + END).err, "late", "종료령 뒤에 마킹이 됐다");
assert.strictEqual(o.bet(pid, 70, T0 + SIT).guess, 70, "예상점수가 안 적힌다");
assert.strictEqual(o.bet(pid, 70, T0 + END).err, "late", "종료령 뒤에 예상점수가 고쳐졌다");

/* ─── 정답은 늦게, 하나씩 ───────────────────────────────────────────── */
assert.strictEqual(openedAt(END - 1), 0, "종료령 전에 정답이 열렸다");
assert.strictEqual(openedAt(OPEN - 1), 0, "공개 전에 정답이 열렸다");
assert.strictEqual(openedAt(OPEN), 1, "공개인데 첫 문제가 안 열렸다");
assert.strictEqual(openedAt(OPEN + STEP * 3), 4, "5초에 하나씩이 아니다");
assert.strictEqual(openedAt(OPEN + STEP * 100), QUESTIONS, "스무 개를 넘겼다");
assert.strictEqual(o.view(pid, T0 + END).key, undefined, "종료령에 정답이 다 내려갔다");
assert.deepStrictEqual(o.view(pid, T0 + OPEN + STEP * 2).key, KEY.slice(0, 3),
  "열린 것보다 많이 내려갔다");

/* ─── 채점 ─────────────────────────────────────────────────────────── */
const g = filled(21); g.start(T0);
const all = [...g.people.values()];
all.forEach((p, i) => {                       /* i 번째 사람은 i 개를 맞힌다 */
  for (let q = 1; q <= QUESTIONS; q++)
    g.mark(p.pid, q, q <= i ? KEY[q - 1] : (KEY[q - 1] % 5) + 1, T0 + SIT);
});
assert.strictEqual(g.points(all[20]), 20 * PER, "다 맞혔는데 만점이 아니다");
assert.strictEqual(g.points(all[0]), 0, "다 틀렸는데 점수가 있다");
const tal = g.tally();
assert.strictEqual(tal.people, 21, "응시자 수가 틀렸다");
assert.strictEqual(tal.list[0].rank, 1, "1등이 없다");
assert.strictEqual(tal.list[0].score, 100, "1등이 만점이 아니다");
assert.strictEqual(tal.list[20].rank, 21, "꼴찌 등수가 틀렸다");
assert.strictEqual(tal.avg, tal.list.reduce((s, p) => s + p.score, 0) / 21, "평균이 틀렸다");

const top = g.view(all[20].pid, T0 + SCORE);
assert.strictEqual(top.result.score, 100, "결과 점수가 틀렸다");
assert.strictEqual(top.result.rank, 1, "결과 등수가 틀렸다");
assert.strictEqual(top.result.grade, 1, "만점인데 1등급이 아니다");
assert.strictEqual(o.view(pid, T0 + SCORE - 1).result, undefined,
  "38분 전에 점수가 나갔다");

/* 내신 5등급제 — 누적 10 · 34 · 66 · 90 % */
assert.strictEqual(grade(1, 100), 1, "상위 1%가 1등급이 아니다");
assert.strictEqual(grade(10, 100), 1, "상위 10%가 1등급이 아니다");
assert.strictEqual(grade(11, 100), 2, "상위 11%가 2등급이 아니다");
assert.strictEqual(grade(34, 100), 2, "상위 34%가 2등급이 아니다");
assert.strictEqual(grade(35, 100), 3, "상위 35%가 3등급이 아니다");
assert.strictEqual(grade(66, 100), 3, "상위 66%가 3등급이 아니다");
assert.strictEqual(grade(90, 100), 4, "상위 90%가 4등급이 아니다");
assert.strictEqual(grade(100, 100), 5, "꼴찌가 5등급이 아니다");

/* ─── 시계 ─────────────────────────────────────────────────────────── */
const c = filled(21); c.start(T0);
assert.strictEqual(c.tick(T0 + 1000), true, "첫 단계를 안 알린다");
assert.strictEqual(c.tick(T0 + 2000), false, "같은 단계인데 또 알린다");
assert.strictEqual(c.tick(T0 + 5 * 60000), true, "본령을 안 알린다");
assert.strictEqual(c.tick(T0 + 15 * 60000), true, "1차 공통 힌트를 안 알린다");
assert.strictEqual(c.tick(T0 + OPEN + STEP), true, "정답이 열리는 것을 안 알린다");
assert.strictEqual(c.tick(T0 + LEN), true, "40분인데 안 끝난다");
assert.strictEqual(c.state, "done", "40분이 지났는데 running 이다");
assert.strictEqual(c.tick(T0 + LEN + 1000), false, "끝났는데 또 알린다");

/* ─── 단계 ─────────────────────────────────────────────────────────── */
assert.strictEqual(stepAt(-1), -1, "시작 전인데 단계가 있다");
assert.strictEqual(stepAt(0), 0, "준비령이 0번이 아니다");
assert.strictEqual(PLAN[stepAt(SIT)].t, "착석 안내", "착석 안내 자리가 틀렸다");
assert.strictEqual(stepAt(LEN), PLAN.length - 1, "마지막 단계가 틀렸다");

/* ─── 관리자가 보는 것 ─────────────────────────────────────────────── */
const f = g.full(T0 + SCORE);
assert.strictEqual(f.entrants.length, 21, "명단이 안 나온다");
assert.ok(f.entrants.every(e => e.prop), "명제를 못 받은 사람이 명단에 있다");
assert.strictEqual(f.board.length, 21, "점수판이 안 나온다");
assert.strictEqual(f.board[0].score, 100, "점수판 1등이 틀렸다");
assert.strictEqual(g.full(T0 + 10 * 60000).board.length, 0,
  "종료령 전에 점수판이 나왔다");

if (require.main === module){
  console.log("개별 명제 " + PROPS.length + "개 (☆ " + PROPS.filter(p => p.star).length +
              ") · 공통 힌트 " + COMMON.length + "개 · 문제 " + QUESTIONS +
              "개 · " + (LEN / 60000) + "분");
  console.log("  21명 → 명제 " + r.props + "개 배부, " +
              "만점 " + QUESTIONS * PER + "점, 평균 " + tal.avg.toFixed(1) + "점");
  console.log("전부 통과");
}
