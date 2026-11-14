/* node keys.test.js — 단축키 올림픽: 문제가 다 풀리는가, 세 종목 × 두 판이 맞대결로 도는가 */
"use strict";
const assert = require("assert");
const {Typing, MODES} = require("./typing.js");
const K = require("../shared/keyed.js");
const players = require("./players.js");

/* ─── 문제 ─── 만든 문제를 적어 둔 풀이(sol)대로 실제 편집 계산으로 풀어 본다 */
assert.strictEqual(K.EVENTS.length, MODES.keys.events.length, "종목 수가 서버와 화면에서 다르다");
K.EVENTS.forEach((e, i) => assert.strictEqual(e.name, MODES.keys.events[i], "종목 이름이 서버와 화면에서 다르다"));
for (let ev = 0; ev < 3; ev++) for (let i = 0; i < 2000; i++){
  const p = K.gen(ev);
  assert.ok(!K.same(p.code, p.target), "시작부터 정답인 문제");
  assert.ok(p.tier >= 0 && p.tier <= 2, "등급은 0·1·2");
  const r = K.solve(p);
  assert.ok(K.same(r.v, p.target), `${ev + 1}종목 문제가 풀이대로 풀리지 않는다\n${p.code}\n→ ${p.sol}`);
  assert.strictEqual(p.save, ev === 2, "저장은 3종목만");
  if (p.save) assert.strictEqual(r.dirty, false, "3종목은 저장으로 끝난다");
  assert.ok(!/\bdef\b|in \[/.test(p.target), "함수나 리스트 for 는 쓰지 않는다");
  if (ev < 2) assert.ok(!p.sol.some(x => /^N:|^save$/.test(x)), "1·2종목에 이름 바꾸기·저장이 나왔다");
  if (ev < 1) assert.ok(p.sol.every(x => /^L|^up$|^down$/.test(x)), "1종목에 줄 옮기기 말고 다른 것이 나왔다");
}
assert.strictEqual(K.POOL.length, 30, "문제 재료 서른 가지");
K.POOL.forEach(s => {
  const [sh, lg] = s.ren, L = s.code.split("\n");
  assert.ok(L.length >= 6 && L.every(l => l.trim()), "재료는 여섯 줄 이상, 빈 줄 없이");
  assert.ok(new RegExp("(?<!\\w)" + sh + "(?!\\w)").test(s.code) && !s.code.includes(lg), "바꿀 이름이 코드에 없다: " + sh);
  assert.ok(L.some(l => /^\s*print\(/.test(l)), "주석 걸 print 줄이 있어야 한다");
});
{ /* 세 줄 이상을 한꺼번에 옮기는 문제가 넉넉히 나온다 */
  let big = 0, all = 0;
  for (let i = 0; i < 3000; i++) for (const x of K.gen(0).sol){ const r = x.match(/^L(\d+)-(\d+)$/); if (/^L/.test(x)) all++; if (r && r[2] - r[1] >= 2) big++; }
  assert.ok(big / all > 0.2, "세 줄 이상 묶음이 너무 적다: " + (big / all).toFixed(2));
}
/* 편집 계산 몇 가지 */
const at = (v, line) => { const o = v.split("\n").slice(0, line).join("\n").length + (line ? 1 : 0); return {v, s: o, e: o}; };
assert.strictEqual(K.edit(at("a\nb\nc", 1), "up").v, "b\na\nc");
assert.strictEqual(K.edit(at("a\nb\nc", 2), "down"), null, "맨 아래 줄은 더 못 내려간다");
assert.strictEqual(K.edit(at("if x:\nprint(x)", 1), "indent").v, "if x:\n    print(x)");
assert.strictEqual(K.edit(at("    print(x)", 0), "comment").v, "    # print(x)", "주석은 들여쓴 자리에 붙는다");
assert.strictEqual(K.edit(at("    # print(x)", 0), "comment").v, "    print(x)");
assert.strictEqual(K.rename({v: "ab = 1\nprint(ab, a)", s: 0, e: 0}, "x").v, "x = 1\nprint(x, a)", "낱말이 통째로 같은 것만 바꾼다");
assert.strictEqual(K.rename({v: "ab = 1", s: 0, e: 0}, "한글"), null, "영문 이름만 받는다");

/* ─── 대회 ─── */
const who = n => players.get("ktest-" + n + "-aaaaaaaa");
const g = new Typing("KY1", {pin: "1234", mode: "keys"});
assert.strictEqual(g.title, "단축키 올림픽");
assert.strictEqual(new Typing("TY9", {pin: "1234", mode: "없는것"}).mode, "typing", "모르는 종류는 타자 올림픽");
for (let i = 0; i < 18; i++){ g.join(who(i)); g.setTeam(who(i).pid, i % 6); }
g.close();
assert.strictEqual(g.start().ok, true);
let now = 1e6;
const v0 = g.view(who(0).pid, now);
assert.deepStrictEqual(v0.events, ["줄 옮기기", "주석과 들여쓰기", "이름 바꾸기와 저장"]);
assert.strictEqual(v0.mode, "keys");
assert.strictEqual(v0.limit, 90, "한 판 90초");

const met = [];                                   // 종목마다 만난 쌍
for (let ev = 0; ev < 3; ev++){
  assert.deepStrictEqual([g.ph.k, g.ev], ["intro", ev]);
  g.go(now);                                      // 소개 → 첫 판 대진 (조 고르기는 없다)
  const seen = new Set();
  for (let rd = 0; rd < 2; rd++){
    assert.strictEqual(g.ph.k, "preview", "단축키 올림픽은 종목마다 바로 팀 대 팀이다");
    assert.strictEqual(g.races.length, 3, "여섯 팀이면 세 경기");
    g.races.forEach(r => { const key = [r.a, r.b].sort().join("-");
      assert.ok(!seen.has(key), "같은 종목에서 같은 팀과 다시 붙었다"); seen.add(key);
      assert.strictEqual(r.kind, "keys"); });
    g.go(now);                                    // 미리 보기 → 경기
    assert.strictEqual(g.ph.k, "play");
    assert.strictEqual(g.ph.until - now, 90000, "90초");
    const me = who(0).pid, mine = g.view(me, now).mine;
    assert.strictEqual(mine.kind, "keys");
    assert.ok(mine.goal, "내 과제 정보(후반·×2)가 내려온다");
    assert.strictEqual(g.claim(me, 0, "x", now).err, "bad", "친 글자로는 점수를 못 얻는다");
    assert.strictEqual(g.tableDone(me, 0, now).val, 10, "전반 1등급 10점");
    assert.strictEqual(g.tableDone(who(1).pid, 2, now).val, 30);
    now += 46000;                                 // 후반
    assert.ok([10, 20].includes(g.tableDone(me, 0, now).val), "전반에 받은 과제는 늦게 풀어도 전반 점수 (×2 면 20)");
    assert.ok([30, 60].includes(g.tableDone(me, 0, now).val), "후반에 받은 과제는 1등급 30점 (×2 면 60)");
    now += 45000; g.tick(now);                    // 시간 끝
    assert.strictEqual(g.ph.k, "after");
    assert.strictEqual(g.tableDone(me, 0, now).err, "notplaying", "끝난 뒤에는 점수가 없다");
    g.go(now);                                    // 다음 판 대진 또는 종목 결과
  }
  met.push(seen);
  assert.strictEqual(g.ph.k, "ceremony");
  assert.strictEqual(g.res.cols[1], "푼 문제");
  g.go(now);
}
assert.deepStrictEqual([g.state, g.ph.k], ["done", "finale"]);
assert.strictEqual(g.medals.length, 9, "종목마다 금은동 — 아홉 개");
assert.ok(g.medals.every(m => !m.who), "개인 메달은 없다");
assert.ok(met.every(s => s.size === 6), "종목마다 두 판 × 세 경기, 상대가 매번 다르다");

/* 맡기기 · 되살리기 — 종류가 따라온다 */
const back = Typing.revive(JSON.parse(JSON.stringify(g.snapshot())));
assert.strictEqual(back.mode, "keys");
assert.deepStrictEqual(back.view(null, now).events, v0.events);
/* 한 게임 더 */
assert.strictEqual(back.extra(3, now).err, "bad", "종목은 셋뿐이다");
assert.strictEqual(back.extra(1, now).ok, true);
assert.strictEqual(back.ph.k, "preview");

/* 연습 참가자(리허설)도 푼다 */
const b = new Typing("KY2", {pin: "1234", mode: "keys"});
for (let i = 0; i < 12; i++){ b.join(who(100 + i), true); }
[...b.people.values()].forEach((p, i) => p.team = i % 6);
b.close(); b.start(); b.go(now); b.go(now);
for (let i = 0; i < 900; i++){ now += 100; b.tick(now); }
assert.strictEqual(b.ph.k, "after");
assert.ok(b.races.some(r => r.ps.some(pid => r.sc[pid].got > 0)), "연습 참가자가 한 문제도 못 풀었다");

/* ─── 아이템 ─── 진 팀이 다음 경기 미리 보기에서 고른다 */
{
  const {ITEMS, DARK, PREVIEW_ITEM, PREVIEW} = require("./typing.js");
  assert.deepStrictEqual(ITEMS, ["nerf", "dark", "none"]);
  const h = new Typing("KY3", {pin: "1234", mode: "keys"});
  const P = n => who(200 + n).pid;                        // 팀 t 의 두 사람은 P(t), P(t + 6)
  for (let i = 0; i < 12; i++){ h.join(who(200 + i)); h.setTeam(P(i), i % 6); }
  h.close(); h.start();
  let t = 5e6;
  h.go(t);                                                // 1종목 첫 판 미리 보기 — 아직 아무도 아이템이 없다
  assert.ok(h.races.every(r => !r.it), "첫 경기부터 아이템이 있다");
  assert.strictEqual(h.ph.until - t, PREVIEW * 1000);
  assert.strictEqual(h.setItem(P(0), "none").err, "noitem");
  h.go(t);
  const first = h.races.map(r => [r.a, r.b]);
  /* 첫 경기는 a 가 이기고, 둘째 경기는 b 가 이기고, 셋째는 비긴다 */
  h.tableDone(P(first[0][0]), 2, t); h.tableDone(P(first[1][1]), 2, t);
  h.tableDone(P(first[1][0]), 0, t);                      // 진 팀에서도 한 명은 10점을 냈다 — 나머지 한 명이 최하위
  t += 90000; h.tick(t);
  assert.deepStrictEqual(h.owed.slice().sort(), [first[0][1], first[1][0]].sort(), "진 두 팀만 아이템을 받는다 — 비긴 팀은 없다");
  h.go(t);                                                // 둘째 판 미리 보기
  assert.strictEqual(h.owed.length, 0, "받은 아이템은 대진이 서면 그 판 것이 된다");
  assert.strictEqual(h.ph.until - t, PREVIEW_ITEM * 1000, "아이템을 고르는 판은 미리 보기가 길다");
  const L1 = first[0][1], L2 = first[1][0], W = first[0][0];
  const foeOf = team => { const r = h.races.find(r => r.a === team || r.b === team); return r.a === team ? r.b : r.a; };
  const v = h.view(P(L1), t);
  assert.ok(v.mine.item && v.mine.item.kind === null, "진 팀 화면에 고를 것이 내려온다");
  assert.deepStrictEqual(v.mine.item.foes.map(f => f.pid).sort(), [P(foeOf(L1)), P(foeOf(L1) + 6)].sort(), "고를 상대는 맞붙는 팀 사람들");
  assert.strictEqual(v.mine.used, undefined, "미리 보기에서는 고른 것이 드러나지 않는다");
  assert.strictEqual(h.view(P(W), t).mine.item, undefined, "이긴 팀에는 없다");
  assert.strictEqual(h.setItem(P(W), "nerf", P(foeOf(W))).err, "noitem", "이긴 팀은 못 고른다");
  assert.strictEqual(h.setItem(P(L1), "nerf", P(L1 + 6)).err, "bad", "우리 팀에는 못 쓴다");
  assert.strictEqual(h.setItem(P(L1), "nerf", P(foeOf(foeOf(L1) === L2 ? W : L2))).err, "bad", "다른 경기 사람에게는 못 쓴다");
  assert.strictEqual(h.setItem(P(L1), "폭탄", P(foeOf(L1))).err, "bad");
  const victim = P(foeOf(L1)), blind = P(foeOf(L2) + 6);
  assert.strictEqual(h.setItem(P(L1), "dark", victim).ok, true);
  assert.strictEqual(h.setItem(P(L1 + 6), "nerf", victim).ok, true, "팀의 누구나, 마지막에 고른 것이 쓰인다");
  assert.strictEqual(h.view(P(L1), t).mine.item.kind, "nerf");
  assert.strictEqual(h.setItem(P(L2), "dark", blind).ok, true);
  h.go(t);                                                // 경기
  assert.strictEqual(h.setItem(P(L1), "none").err, "noitem", "경기가 시작되면 못 바꾼다");
  const vv = h.view(victim, t), F = foeOf(L2);
  assert.strictEqual(vv.mine.nerf, true);
  assert.deepStrictEqual(vv.mine.used.filter(u => u.team === L1).map(u => [u.kind, u.target]), [["nerf", victim]], "경기가 시작되면 드러난다");
  /* 연막탄 — 상대 팀 전체. 터뜨리는 것은 우리 팀 최하위(지금까지 득점이 가장 낮은 사람)만, 한 번 */
  assert.strictEqual(h.view(P(F), t).mine.dark, undefined, "누르기 전에는 연막탄이 없다");
  assert.strictEqual(h.view(P(L2 + 6), t).mine.fire, true, "0점인 팀원에게 버튼이 있다");
  assert.strictEqual(h.view(P(L2), t).mine.fire, undefined, "10점을 낸 팀원에게는 없다");
  assert.strictEqual(h.fire(P(L2), t).err, "noitem", "버튼이 없는 팀원은 못 터뜨린다");
  assert.strictEqual(h.fire(P(L1), t).err, "noitem", "너프를 고른 팀에는 버튼이 없다");
  assert.ok(h.view(P(F), t).mine.used.some(u => u.team === L2 && u.kind === "dark" && u.foe === F && u.fired === false), "상대도 연막탄이 걸려 있음을 안다");
  t += 20000;
  assert.strictEqual(h.fire(P(L2 + 6), t).ok, true);
  for (const p of [P(F), P(F + 6)]) assert.deepStrictEqual(h.view(p, t).mine.dark, {at: t, until: t + DARK}, "연막탄은 상대 팀 전체, 누른 때부터 10초");
  assert.strictEqual(h.view(P(L2 + 6), t).mine.dark, F === L1 ? undefined : undefined, "쓴 팀은 멀쩡하다");
  assert.strictEqual(h.view(P(L2 + 6), t).mine.fire, undefined, "쓰면 버튼이 사라진다");
  assert.strictEqual(h.fire(P(L2 + 6), t).err, "noitem", "한 번만");
  assert.strictEqual(h.tableDone(victim, 2, t).val, 20, "너프 — 30점이 20점");
  assert.strictEqual(h.tableDone(victim, 0, t).val, 7, "너프 — 10점이 7점");
  assert.strictEqual(h.tableDone(P(L1), 2, t).val, 30, "다른 사람은 그대로");
  const back = Typing.revive(JSON.parse(JSON.stringify(h.snapshot())));
  assert.strictEqual(back.view(victim, t).mine.nerf, true, "되살려도 아이템이 남는다");
  /* 안 고르면 상남자 */
  t += 90000; h.tick(t); h.go(t); h.go(t);                // 종목 결과 → 2종목 소개
  h.go(t);                                                // 2종목 첫 판 미리 보기 — 앞 종목 마지막 판에서 진 팀이 받는다
  assert.ok(h.races.some(r => r.it), "종목이 바뀌어도 진 팀은 다음 경기에 받는다");
  h.go(t);
  assert.ok(h.races.every(r => !r.nerf && !r.dark && !h.used(r).length), "안 고르면 아무 일도 없다");
  /* 연습 참가자가 버튼을 가지면 아무 때나 저절로 터진다 */
  for (let n = 0; n < 20; n++){
    const b = new Typing("KY4", {pin: "1234", mode: "keys"});
    for (let i = 0; i < 12; i++) b.join(who(300 + i), true);
    [...b.people.values()].forEach((p, i) => p.team = i % 6);
    b.close(); b.start(); let u = 9e6; b.go(u); b.go(u);
    for (let i = 0; i < 900; i++){ u += 100; b.tick(u); }
    b.go(u); b.go(u);
    for (let i = 0; i < 900; i++){ u += 100; b.tick(u); }
    b.races.forEach(r => Object.values(r.it || {}).forEach(x => { if (x.kind === "dark") assert.ok(x.at && r.dark, "연습 참가자의 연막탄이 터지지 않았다"); }));
  }
  /* 타자 올림픽에는 아이템이 없다 */
  assert.strictEqual(MODES.typing.items, undefined);
}

console.log(`keys.test.js 통과 — 문제 6000개 풀림, 세 종목 ${met.reduce((n, s) => n + s.size, 0)}경기, 메달 ${g.medals.length}개`);
