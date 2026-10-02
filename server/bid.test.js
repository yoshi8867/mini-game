/* 돌림판 비딩 검사. 시계는 넣어 준다 — 기다리지 않고 끝까지 돌려 본다 */
"use strict";
const assert = require("assert");
const {Bid, TOKENS, LOTS, BLOCK, SECS, EXTEND, SHOW, SPIN} = require("./bid.js");
const {WHEELS, byId} = require("./wheels.js");

const who = n => ({pid: "pid-" + n, name: "참가자" + n});

/* 대표 n 명으로 연 판. 작전타임은 꺼 두고 시작한다 */
function open(n, opt){
  const b = new Bid("AAAA", Object.assign({plan: 0}, opt || {}));
  for (let i = 0; i < n; i++) b.join(who(i), true);
  return b;
}

/* ─── 룰렛 ──────────────────────────────────────────────────────────── */
{
  assert.strictEqual(WHEELS.length, 24, "룰렛이 스물넷이 아니다");
  assert.strictEqual(WHEELS.filter(w => w.bad).length, 5, "받기 싫은 것이 다섯이 아니다");
  WHEELS.forEach(w => {
    assert.strictEqual(w.cells.length, 3, w.id + "번 칸이 셋이 아니다");
    w.cells.forEach(v => assert.ok(Number.isInteger(v / 10), w.id + "번에 10단위가 아닌 칸"));
    assert.strictEqual(w.ev, Math.round((w.cells[0]+w.cells[1]+w.cells[2]) / 3 * 100) / 100,
                       w.id + "번 기댓값이 틀렸다");
  });
  const good = WHEELS.filter(w => !w.bad).map(w => w.ev);
  assert.ok(Math.min(...good) >= 10 && Math.max(...good) <= 100, "기댓값이 10~100 밖이다");
  /* 같은 기댓값에 분산이 다른 짝이 있어야 수업이 된다 */
  const pairs = {};
  WHEELS.forEach(w => (pairs[w.ev] = pairs[w.ev] || []).push(w));
  const twins = Object.values(pairs).filter(v => v.length > 1);
  assert.ok(twins.length >= 8, "같은 기댓값 짝이 너무 적다");
  twins.forEach(v => {
    const spread = v.map(w => Math.max(...w.cells) - Math.min(...w.cells));
    assert.ok(new Set(spread).size > 1, v[0].ev + " 짝의 분산이 다 같다");
  });
  console.log("wheel   스물넷 · 받기 싫은 것 다섯 · 10단위 · 같은 값 다른 분산 짝 " + twins.length);
}

/* ─── 접수 ──────────────────────────────────────────────────────────── */
{
  const b = open(0);
  assert.ok(b.join(who(1), false).ok, "관전이 안 들어간다");
  assert.strictEqual(b.teams.length, 0, "관전인데 팀이 생겼다");
  b.join(who(2), true); b.join(who(3), true);
  assert.strictEqual(b.teams.length, 2, "대표 둘인데 팀이 둘이 아니다");
  assert.ok(b.join(who(2), true).again, "같은 사람이 두 번 앉았다");
  assert.strictEqual(b.teams.length, 2, "두 번 앉아 팀이 늘었다");
  assert.ok(b.teams.every(t => t.tokens === TOKENS), "처음 토큰이 " + TOKENS + " 이 아니다");
  assert.strictEqual(b.start().err, undefined, "둘인데 시작이 안 된다");

  const c = open(1);
  assert.strictEqual(c.start().err, "few", "혼자인데 시작됐다");
  console.log("join    대표만 팀을 차지 · 관전은 팀 없음 · 두 팀부터 시작");
}

/* ─── 작전타임 ──────────────────────────────────────────────────────── */
{
  const b = new Bid("BBBB", {});                 // 작전타임 그대로 3분
  for (let i = 0; i < 3; i++) b.join(who(i), true);
  let t = 1000;
  b.start(t);
  assert.strictEqual(b.state, "plan", "첫 작전타임이 없다");
  assert.strictEqual(b.tick(t + b.plan - 1), false, "작전타임이 일찍 끝났다");
  assert.ok(b.tick(t + b.plan), "작전타임이 안 끝난다");
  assert.strictEqual(b.state, "running", "작전타임 뒤가 경매가 아니다");
  assert.strictEqual(b.nth, 0, "첫 품목이 아니다");

  /* 여섯을 치우면 다시 작전타임 */
  t += b.plan;
  for (let i = 0; i < BLOCK; i++){
    b.lot.done = {at: t, team: null, price: 0, why: "none"};
    b.tick(t += SHOW);
  }
  assert.strictEqual(b.state, "plan", BLOCK + "개 뒤에 작전타임이 안 온다");
  assert.strictEqual(b.go(t).err, undefined, "작전타임을 못 끊는다");
  assert.strictEqual(b.state, "running", "끊었는데 경매가 아니다");
  assert.strictEqual(b.nth, BLOCK, "묶음이 어긋났다");
  console.log("plan    작전타임 3분 → 경매 " + BLOCK + "개 · 관리자가 끊을 수 있다");
}

/* ─── 좋은 룰렛 ─────────────────────────────────────────────────────── */
{
  const b = open(3);
  let t = 1000;
  b.start(t);
  /* 좋은 것이 걸릴 때까지 넘긴다 */
  while (b.lot.bad){ b.settle(t); b.tick(t += SHOW); }
  const lot = b.lot;

  assert.strictEqual(b.bid("pid-0", 0, t).err, "low", "0 이 통과됐다");
  assert.ok(b.bid("pid-0", 1, t).ok, "첫 호가가 막혔다");
  assert.strictEqual(b.bid("pid-1", 1, t).err, "low", "같은 값이 통과됐다");
  assert.ok(b.bid("pid-1", 5, t).ok, "올려 부른 것이 막혔다");
  assert.strictEqual(b.bid("pid-0", TOKENS + 1, t).err, "broke", "가진 것보다 많이 불렀다");
  assert.strictEqual(b.bid("pid-9", 9, t).err, "watcher", "관전이 값을 불렀다");

  /* 막판 호가는 시간을 되돌린다 */
  const near = lot.ends - 2000;
  b.bid("pid-2", 7, near);
  assert.strictEqual(lot.ends, near + EXTEND, "막판 호가에 연장이 안 됐다");

  /* 마감 — 마지막으로 부른 팀이 가져가고 토큰이 빠진다 */
  b.tick(lot.ends);
  assert.ok(lot.done, "시간이 지났는데 안 끝났다");
  assert.strictEqual(lot.done.team, 2, "마지막으로 부른 팀이 안 가져갔다");
  assert.strictEqual(b.teams[2].tokens, TOKENS - 7, "토큰이 안 빠졌다");
  assert.deepStrictEqual(b.teams[2].won, [lot.wheel.id], "룰렛이 안 들어갔다");
  assert.strictEqual(b.teams[0].tokens, TOKENS, "안 가져간 팀의 토큰이 빠졌다");
  console.log("up      1 이상 올려 부르기 · 가진 만큼만 · 막판 10초 연장 · 낙찰에 차감");
}

/* 아무도 안 부르면 유찰이고, 아무도 못 가져간다 */
{
  const b = open(2);
  let t = 1000;
  b.start(t);
  while (b.lot.bad){ b.settle(t); b.tick(t += SHOW); }
  const id = b.lot.wheel.id;
  b.tick(b.lot.ends);
  assert.strictEqual(b.lot.done.why, "none", "안 불렀는데 낙찰됐다");
  assert.ok(b.teams.every(x => x.won.indexOf(id) < 0), "유찰인데 누가 가져갔다");
  assert.strictEqual(b.sheet().find(w => w.id === id).at, "done", "유찰이 아직으로 남았다");
  console.log("none    아무도 안 부르면 유찰 · 현황에는 끝난 것으로");
}

/* ─── 받기 싫은 룰렛 ────────────────────────────────────────────────── */
{
  const b = open(3);
  let t = 1000;
  b.start(t);
  while (!b.lot.bad){ b.settle(t); b.tick(t += SHOW); }
  const lot = b.lot;

  assert.strictEqual(b.bid("pid-0", 3, t).err, "notup", "받기 싫은 것에 호가가 됐다");
  assert.ok(b.flee("pid-0", 1, t).ok, "첫 탈출이 막혔다");
  assert.strictEqual(b.teams[0].tokens, TOKENS - 1, "탈출에 토큰이 안 빠졌다");
  assert.strictEqual(b.flee("pid-0", 5, t).err, "already", "두 번 탈출했다");
  assert.strictEqual(b.flee("pid-1", 1, t).err, "low", "같은 값으로 탈출됐다");

  assert.ok(b.flee("pid-1", 2, t).ok, "둘째 탈출이 막혔다");
  /* 둘이 빠지면 남은 하나가 그 자리에서 받는다 */
  assert.ok(lot.done, "마지막 한 팀만 남았는데 안 끝났다");
  assert.strictEqual(lot.done.team, 2, "남은 팀이 안 받았다");
  assert.strictEqual(lot.done.why, "stuck", "끝난 까닭이 다르다");
  assert.strictEqual(b.teams[2].tokens, TOKENS, "받은 팀의 토큰이 빠졌다");
  assert.deepStrictEqual(b.teams[2].won, [lot.wheel.id], "룰렛이 안 들어갔다");
  /* 낸 토큰은 아무에게도 가지 않는다 */
  assert.strictEqual(b.teams[0].tokens + b.teams[1].tokens + b.teams[2].tokens,
                     TOKENS * 3 - 3, "사라졌어야 할 토큰이 남았다");
  assert.strictEqual(lot.done.burned, 3, "사라진 토큰 수가 안 맞는다");
  console.log("down    토큰 내고 탈출 · 늦을수록 비싸다 · 꼴지가 공짜로 받는다 · 낸 것은 소각");
}

/* 마지막 한 팀은 빠질 수 없다 */
{
  const b = open(2);
  let t = 1000;
  b.start(t);
  while (!b.lot.bad){ b.settle(t); b.tick(t += SHOW); }
  b.flee("pid-0", 1, t);
  assert.ok(b.lot.done, "둘 중 하나가 빠졌는데 안 끝났다");
  assert.strictEqual(b.lot.done.team, 1, "남은 팀이 안 받았다");
  console.log("last    둘이면 하나가 빠지는 순간 끝난다");
}

/* 토큰이 모자라면 빠질 수 없다 — 빈털터리가 받는다 */
{
  const b = open(3);
  let t = 1000;
  b.start(t);
  while (!b.lot.bad){ b.settle(t); b.tick(t += SHOW); }
  b.teams[0].tokens = 0;
  assert.strictEqual(b.flee("pid-0", 1, t).err, "broke", "빈털터리가 빠졌다");
  b.flee("pid-1", 1, t);
  b.flee("pid-2", 2, t);
  assert.strictEqual(b.lot.done.team, 0, "빈털터리가 안 받았다");
  console.log("broke   토큰이 모자라면 못 빠진다");
}

/* 시간이 다 됐는데 둘 이상 남으면 토큰이 가장 많은 팀이 받는다 */
{
  const b = open(3);
  let t = 1000;
  b.start(t);
  while (!b.lot.bad){ b.settle(t); b.tick(t += SHOW); }
  b.teams[0].tokens = 5; b.teams[1].tokens = 20; b.teams[2].tokens = 9;
  b.tick(b.lot.ends);
  assert.strictEqual(b.lot.done.why, "time", "시간으로 끝난 것이 아니다");
  assert.strictEqual(b.lot.done.team, 1, "토큰이 가장 많은 팀이 안 받았다");
  console.log("time    아무도 안 빠지면 가장 넉넉한 팀이 받는다");
}

/* ─── 경매 현황 ─────────────────────────────────────────────────────── */
{
  const b = open(3);
  let t = 1000;
  b.start(t);
  const sheet0 = b.sheet();
  assert.strictEqual(sheet0.length, 24, "현황에 스물넷이 다 안 나온다");
  assert.strictEqual(sheet0.filter(w => w.at === "now").length, 1, "지금 걸린 것이 하나가 아니다");
  assert.strictEqual(sheet0.filter(w => w.at === "left").length, 23, "남은 것 수가 안 맞는다");

  b.bid("pid-0", 4, t) || b.flee("pid-0", 4, t);
  b.tick(b.lot.ends);
  const one = b.lot.wheel.id;
  const row = b.sheet().find(w => w.id === one);
  assert.strictEqual(row.at, "done", "끝난 것이 현황에 안 반영됐다");
  assert.ok(row.name, "가져간 팀 이름이 없다");
  console.log("sheet   스물넷 통째로 · 끝난 것 / 지금 것 / 아직인 것");
}

/* ─── 끝까지 ────────────────────────────────────────────────────────── */
{
  const b = open(4);
  let t = 1000;
  b.start(t);
  let guard = 0;
  while (b.state !== "spin" && guard++ < 500){
    if (b.state === "plan"){ b.go(t); continue; }
    const lot = b.lot;
    if (lot.bad){                                  // 앞의 둘이 빠진다
      b.flee("pid-0", lot.price + 1, t);
      if (!lot.done) b.flee("pid-1", lot.price + 1, t);
      if (!lot.done) b.flee("pid-2", lot.price + 1, t);
    } else {
      b.bid("pid-" + (b.nth % 4), 1, t);
    }
    if (!lot.done) b.tick(t = lot.ends);
    b.tick(t += SHOW);
  }
  assert.strictEqual(b.state, "spin", "열여덟을 다 치우고 돌리기로 안 갔다");
  assert.strictEqual(b.nth + 1, LOTS, "품목 수가 " + LOTS + " 이 아니다");
  const got = b.teams.reduce((n, x) => n + x.won.length, 0);
  assert.ok(got > 0 && got <= LOTS, "가져간 룰렛 수가 이상하다");

  /* 돌리기 — 한 차례에 팀마다 하나씩, 점수는 바퀴가 멎은 뒤에 */
  const rounds = b.rounds();
  assert.ok(rounds >= 1, "돌릴 것이 없다");
  const first = b.spins[0];
  assert.ok(first.length >= 1, "첫 차례에 돌릴 것이 없다");
  assert.ok(b.teams.every(x => x.score === 0), "바퀴가 돌기도 전에 점수가 올랐다");
  assert.strictEqual(b.tick(t + SPIN - 1), false, "바퀴가 일찍 멎었다");
  b.tick(t += SPIN);
  first.forEach(s => assert.ok(b.teams[s.team].score !== 0 || s.got === 0,
                               "멎었는데 점수가 안 올랐다"));

  guard = 0;
  while (b.state !== "done" && guard++ < 100) b.tick(t += SPIN);
  assert.strictEqual(b.state, "done", "돌리기가 안 끝난다");
  /* 합계는 실제로 멈춘 칸의 합이다 */
  b.teams.forEach(x => {
    const sum = b.spins.flat().filter(s => s.team === x.id)
                             .reduce((n, s) => n + s.got, 0);
    assert.strictEqual(x.score, sum, x.name + " 합계가 안 맞는다");
  });
  const ranked = b.board();
  assert.ok(ranked[0].rank === 1, "1위가 없다");
  console.log("spin    " + LOTS + "품목 → 차례마다 한꺼번에 " + (SPIN/1000) + "초 · 합계는 멈춘 칸의 합");
}

console.log("\n전부 통과");
