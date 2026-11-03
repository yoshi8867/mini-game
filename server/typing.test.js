/* node typing.test.js — 타자 올림픽: 팀 고르기, 대진, 판정, 네 종목 한 바퀴 */
"use strict";
const assert = require("assert");
const T = require("./typing.js");
const {Typing, standings, formGroups, keys} = T;
const players = require("./players.js");

const who = n => players.get("ttest-" + n + "-aaaaaaaa");

/* ─── 순수 계산 ─── */
assert.strictEqual(keys("까"), 2, "ㄲ 은 1타");
assert.strictEqual(keys("과"), 3, "ㅘ 는 ㅗ+ㅏ 2타");
assert.strictEqual(keys("닭"), 4, "ㄺ 은 ㄹ+ㄱ 2타");

/* 한영키를 쓰지 않는다 — 친 글자에 영문이 들면 막히므로 인용문·문장에 로마자가 없어야 한다 */
const D = require("./typing-data.js");
assert.deepStrictEqual(D.QUOTES.filter(q => /[A-Za-z]/.test(q.text)).map(q => q.text), [], "로마자가 든 인용문");
assert.ok(!D.E3_BANK.some(x => /[A-Za-z]/.test(JSON.stringify(x))), "로마자가 든 3종목 문장");

/* 대진 — 1번(만난 팀 피하기) 다음 2번(실력 비슷한 팀끼리). 1-2 · 3-4 · 5-6 다음, 점수 200 100 220 160 140 120 */
const norm = ps => ps.map(p => p.slice().sort().join("-")).sort().join(" ");
const ban = new Set(["0-1", "2-3", "4-5"]), power = {0: 200, 1: 100, 2: 220, 3: 160, 4: 140, 5: 120};
for (let i = 0; i < 20; i++)
  assert.strictEqual(norm(T.matchUp([0, 1, 2, 3, 4, 5].sort(() => Math.random() - .5), power, ban)), "0-2 1-5 3-4", "1-3 · 2-6 · 4-5 여야 한다");
assert.strictEqual(norm(T.matchUp([0, 1, 2, 3, 4, 5], {0: 0, 1: -1, 2: -2, 3: -3, 4: -4, 5: -5}, new Set())), "0-1 2-3 4-5", "앞 종목 순위가 붙은 팀끼리");
assert.strictEqual(norm(T.matchUp([0, 1, 2, 3, 4, 5], {0: 0, 1: -1, 2: -2, 3: -3, 4: -4, 5: -5}, new Set(["0-1", "2-3", "4-5"]))).split(" ").some(p => ["0-1", "2-3", "4-5"].includes(p)), false, "바로 앞 판 상대는 피한다");
assert.strictEqual(T.LEAGUE_GAMES, 2);

const st = standings([{a: 0, b: 1, sa: 10, sb: 5}, {a: 0, b: 2, sa: 3, sb: 3}], [0, 1, 2]);
assert.deepStrictEqual(st.map(x => x.pts), [3, 1, 0], "승 2 · 무 1");

/* 조 해체: 9 · 3 · 2 · 6 → 2명 조부터 없앤다 */
const pick = {}; const pids = [...Array(20).keys()].map(String);
pids.forEach((p, i) => pick[p] = i < 9 ? 0 : i < 12 ? 1 : i < 14 ? 2 : 3);
const f = formGroups(pick, pids);
assert.ok(f.gone.includes(2), "2명 조가 없어지지 않았다");
assert.ok(f.groups.every(g => g.ps.length >= T.E1_MIN || f.groups.length === 1), "4명 밑인 조가 남았다");
assert.strictEqual(f.groups.reduce((n, g) => n + g.ps.length, 0), 20, "흩어진 사람이 사라졌다");

/* ─── 팀 고르기 ─── */
const g = new Typing("TY1", {pin: "1234", title: "시험"});
for (let i = 0; i < 5; i++) g.join(who(i));
assert.strictEqual(g.setTeam(who(0).pid, 2).ok, true);
assert.strictEqual(g.start().err, "lobby", "마감 전에는 시작하지 않는다");
g.close();
assert.strictEqual(g.setTeam(who(1).pid, 3).err, "closed", "마감 뒤에는 학생이 못 옮긴다");
assert.ok([...g.people.values()].every(p => p.team !== null), "마감하면 모두 팀이 있다");
assert.strictEqual(g.start().err, "teams", "여섯 팀이 다 차야 시작한다");
for (let i = 5; i < 24; i++) g.join(who(i), true);    // 연습 참가자는 아무 팀에나 들어간다
g.reopen(); g.close();
for (let t = 0; t < 6; t++) if (!g.members(t).length) g.move(g.members([...Array(6).keys()].sort((a, b) => g.members(b).length - g.members(a).length)[0])[0].pid, t);
assert.strictEqual(g.start().ok, true, "여섯 팀이 찼는데 시작하지 않는다");
assert.strictEqual(g.join(who(99)).err, "started", "시작한 뒤에는 못 들어온다");

/* ─── 네 종목을 시계로 돌린다 ─── 사람(0~4)은 손을 놓고, 연습 참가자만 친다 */
let now = 1e6;
const run = (secs) => { for (let i = 0; i < secs * 10; i++){ now += 100; g.tick(now); } };
const human = who(0).pid;

/* 1종목 — 두 게임 */
g.go(now);                                     // intro → pick
assert.strictEqual(g.ph.k, "pick");
assert.strictEqual(g.setTheme(human, 1).ok, true);
g.go(now);                                     // pick → formed
assert.strictEqual(g.ph.k, "formed");
g.go(now);                                     // formed → play
assert.strictEqual(g.ph.k, "play");
/* 판정: 사람이 내 조의 문제를 친다 */
const r1 = g.raceOf(human), i0 = r1.slots[0], w = r1.items[i0].text;
assert.strictEqual(g.claim(human, i0, w + "x", now).err, "wrong", "틀린 글자를 받았다");
assert.strictEqual(g.claim(human, i0, w, now).ok, true, "맞는 글자를 안 받았다");
assert.strictEqual(g.claim(human, i0, w, now).err, "gone", "끝난 칸을 또 받았다");
assert.strictEqual(r1.slots.length, 10, "끝난 자리에 새 단어가 안 들어왔다");
assert.ok(!r1.slots.includes(i0), "끝난 자리가 그대로다");
run(61);
assert.strictEqual(g.ph.k, "after", "시간이 다 됐는데 안 끝났다");
const v1 = g.view(human, now);
assert.ok(v1.mine && v1.mine.table, "게임 결과 순위표가 없다");
assert.ok(r1.items.some(it => it.late), "후반 문제가 안 나왔다");
assert.ok(r1.items.filter(it => it.late).every(it => it.pts >= 30), "후반 배점이 30·40·50 이 아니다");
const g1medals = g.medals.filter(m => m.ev === 0).length;
/* 조마다 금은동 — 0점은 메달이 없으니 득점한 사람이 셋 안 되는 조는 그만큼 적다 */
const want = g.races.reduce((n, r) => n + Math.min(3, r.ps.filter(id => (r.sc[id] || {}).score > 0).length), 0);
assert.strictEqual(g1medals, want, "조마다 금은동이 아니다");
g.go(now); assert.strictEqual(g.ph.k, "pick", "2게임 조 고르기로 안 갔다");
g.go(now); g.go(now); run(61);
g.go(now);                                     // → ceremony
assert.strictEqual(g.ph.k, "ceremony");
assert.ok(g.res && g.res.rows.length === 24, "1종목 결과에 모두가 없다");
assert.ok([...g.people.values()].filter(p => p.bot).every(p => p.cpm > 0), "연습 참가자 타수가 안 쟀다");
run(61);
assert.strictEqual(g.ph.k, "intro", "1분이 지나도 다음 종목으로 안 갔다");
assert.strictEqual(g.ev, 1);

/* 2·3·4종목 — 판마다 미리 보기 15초 → 경기 → 결과 */
const seen = [];
for (const ev of [1, 2, 3]){
  assert.strictEqual(g.ev, ev);
  g.go(now);                                   // → preview
  for (const rd of [0, 1]){
    assert.strictEqual(g.ph.k, "preview", ev + "종목 " + rd + "판 미리 보기가 아니다");
    assert.strictEqual(g.races.length, 3, "한 판에 세 경기가 아니다");
    g.races.forEach(r => seen.push([r.a, r.b].sort().join("-")));
    run(16);
    assert.strictEqual(g.ph.k, "play", "15초가 지나도 경기가 안 섰다");
    if (ev === 3){
      const r = g.raceOf(human);
      assert.strictEqual(r.kind, "table");
      assert.strictEqual(g.tableDone(human, 2, now).val, 30, "표 30점 과제가 30점이 아니다");
    }
    if (ev === 2){
      const r = g.raceOf(human), it = r.items[r.slots[0]];
      assert.ok(it.ch >= 2, "고칠 곳이 둘 미만이다");
      assert.strictEqual(g.claim(human, r.slots[0], it.text, now).ok, true, "고친 문장을 안 받았다");
    }
    run(T.LIMIT[ev] + 1);
    assert.strictEqual(g.ph.k, "after");
    const sc = g.races.map(r => g.teamScore(r, r.a) + g.teamScore(r, r.b));
    assert.ok(sc.every(x => x > 0), ev + "종목 — 아무도 점수를 못 냈다");
    g.go(now);
  }
  assert.strictEqual(g.ph.k, "ceremony");
  assert.strictEqual(g.medals.filter(m => m.ev === ev).length, 3, ev + "종목 메달이 셋이 아니다");
  if (ev === 1) assert.ok(g.races.length === 3);
  g.go(now);                                   // 교사가 1분을 건너뛴다
}
assert.strictEqual(g.state, "done");
assert.strictEqual(g.ph.k, "finale");
/* 여섯 판 — 바로 앞 판 상대와는 다시 붙지 않는다 (같은 종목 두 판도 이것으로 갈린다) */
assert.strictEqual(seen.length, 18);
for (let i = 3; i < 18; i += 3)
  assert.ok(seen.slice(i, i + 3).every(p => !seen.slice(i - 3, i).includes(p)), (i / 3 + 1) + "번째 판이 앞 판 상대와 또 붙었다");
/* 한 게임 더 — 종합 발표에서 종목을 골라 한 게임만. 메달·MVP 는 그대로 */
const medals0 = JSON.stringify(g.medals), rec0 = JSON.stringify(g.rec);
for (const xev of [2, 0, 3, 3]){
  assert.strictEqual(g.extra(xev, now).ok, true, xev + "종목 한 게임 더가 안 열렸다");
  assert.strictEqual(g.extra(1, now).err, "notdone", "한 게임 더 도중에 또 열렸다");
  assert.strictEqual(g.view(null, now).extra.ev, xev);
  if (xev === 0){ assert.strictEqual(g.ph.k, "pick"); g.go(now); g.go(now); }
  else { assert.strictEqual(g.ph.k, "preview"); assert.strictEqual(g.races.length, 3); run(16); }
  assert.strictEqual(g.ph.k, "play");
  run(T.LIMIT[xev] + 1);
  assert.strictEqual(g.ph.k, "after", "한 게임 더가 끝나지 않았다");
  g.go(now);
  assert.strictEqual(g.ph.k, "finale", "한 게임 더 뒤에 종합 발표로 안 돌아왔다");
  assert.strictEqual(g.state, "done");
}
assert.strictEqual(g.bonus, 4);
assert.strictEqual(JSON.stringify(g.medals), medals0, "한 게임 더가 메달을 바꿨다");
assert.strictEqual(JSON.stringify(g.rec), rec0, "한 게임 더가 MVP 기록을 바꿨다");
assert.strictEqual(g.view(null, now).extra, undefined);
/* 종합 MVP — 셋, 팀마다 한 명, 득점 합 순 */
const mv = g.view(null, now).mvp;
assert.strictEqual(mv.length, 3, "MVP 가 셋이 아니다");
assert.strictEqual(new Set(mv.map(x => x.team)).size, 3, "한 팀에서 MVP 가 둘 나왔다");
assert.ok(mv[0].sum >= mv[1].sum && mv[1].sum >= mv[2].sum, "MVP 가 득점 순이 아니다");

/* ×2 는 지는 팀의 가장 약한 학생에게만 */
const x2 = [];
const g2 = Typing.revive(JSON.parse(JSON.stringify(g.snapshot())));
assert.strictEqual(g2.state, "done", "되살린 판이 다르다");
assert.strictEqual(g2.medals.length, g.medals.length);

/* 되살리기 — 경기 도중에도 이어진다 */
const g3 = new Typing("TY3", {});
for (let i = 0; i < 18; i++) g3.join(who(100 + i), true);
g3.close();
for (let t = 0; t < 6; t++) if (!g3.members(t).length) g3.move(g3.members([...Array(6).keys()].sort((a, b) => g3.members(b).length - g3.members(a).length)[0])[0].pid, t);
g3.start(); g3.ev = 1; g3.ph = {k: "intro", ev: 1};
g3.go(now); g3.go(now);                         // preview → play
const back = Typing.revive(JSON.parse(JSON.stringify(g3.snapshot())));
const r3 = back.races[0], j = r3.slots[0];
assert.strictEqual(back.claim(r3.ps[0], j, r3.items[j].text, now).ok, true, "되살린 경기에서 못 친다");
for (let i = 0; i < 1600; i++){ now += 100; back.tick(now); }
assert.strictEqual(back.ph.k, "after", "되살린 경기가 시간이 돼도 안 끝났다");
/* ×2 문제가 나왔다면 지는 팀 사람에게 갔다 */
back.races.forEach(r => r.items.filter(it => it.x2).forEach(it => x2.push(it.x2)));
assert.ok(x2.every(pid => back.people.has(pid)), "×2 가 엉뚱한 사람에게 갔다");

/* 보여 줄 모습 — 남의 경기 문제는 안 내려간다 */
const v = back.view(r3.ps[0], now);
assert.ok(v.races.every(r => !r.items), "남의 경기 문제가 내려갔다");

console.log("typing.test.js 통과 — 여섯 판 대진 " + new Set(seen).size + "쌍, 메달 " + g.medals.length + "개");
