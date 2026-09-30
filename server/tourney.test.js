/* node tourney.test.js — 대진표 자기검사.
   부전승이 한쪽에 몰리거나, 진 사람이 다시 올라오거나, 대회가 안 끝나면
   여기서 터진다. */
"use strict";
const assert = require("assert");
const {Tourney, roundName} = require("./tourney.js");
const players = require("./players.js");

let seq = 0;
const who = () => players.get("pid-t-" + (++seq) + "-" + Math.random().toString(36).slice(2));

function open(n){
  const t = new Tourney("TEST", {pin: "1234", title: "검사용"});
  for (let i = 0; i < n; i++) t.join(who());
  return t;
}
/* 끝까지 둔다. pick 이 승자를 고른다 */
function runAll(t, pick){
  let guard = 0;
  while (t.state === "running" && guard++ < 500){
    const now = t.ready();
    assert.ok(now.length, "둘 수 있는 대국이 없는데 대회가 안 끝났다");
    for (const m of now){
      m.state = "playing";
      t.report(m.id, pick(m), "catch");
    }
  }
  assert.strictEqual(t.state, "done", "500번 안에 안 끝났다");
}

/* ── 1. 라운드 이름 ──────────────────────────────────────────────────── */
{
  assert.strictEqual(roundName(1), "결승");
  assert.strictEqual(roundName(2), "준결승");
  assert.strictEqual(roundName(4), "8강");
  assert.strictEqual(roundName(8), "16강");
  assert.strictEqual(roundName(16), "32강");
  console.log("name    1 결승 · 2 준결승 · 4 8강 · 8 16강");
}

/* ── 2. 접수 ─────────────────────────────────────────────────────────── */
{
  const t = new Tourney("TEST", {pin: "1234"});
  const a = who();
  assert.ok(t.join(a).ok);
  assert.ok(t.join(a).again, "같은 사람이 두 번 들어갔다");
  assert.strictEqual(t.people.size, 1);
  assert.ok(t.quit(a.pid));
  assert.strictEqual(t.people.size, 0);

  assert.strictEqual(t.start().err, "few", "혼자인데 대회가 열렸다");
  t.join(who()); t.join(who());
  assert.ok(t.start().ok);
  assert.strictEqual(t.join(who()).err, "closed", "시작했는데 참가가 됐다");
  assert.strictEqual(t.quit([...t.people.keys()][0]), false, "시작 뒤에 빠졌다");
  console.log("join    중복 무시 · 시작 뒤 접수 마감 · 두 명 미만이면 거절");
}

/* ── 3. 부전승 — 고르게 흩어지고, 한 대국에 둘이 몰리지 않는다 ───────── */
{
  for (const n of [2,3,5,7,9,13,16,17,25,28,30,31,33,64,65]){
    const t = open(n);
    const r = t.start();
    assert.ok(r.ok, `${n}명에서 대진이 안 짜였다`);
    const size = 1 << Math.ceil(Math.log2(n));
    assert.strictEqual(r.size, size);
    assert.strictEqual(r.byes, size - n, `${n}명 부전승 수가 틀렸다`);

    const first = t.rounds[0];
    assert.strictEqual(first.length, size / 2);
    /* 첫 라운드에 사람이 하나도 없는 대국은 없어야 한다 */
    first.forEach(m => assert.ok(m.a || m.b, `${n}명: 빈 대국이 생겼다`));
    /* 실제로 판을 두는 사람 수가 맞아야 한다 */
    const seats = first.reduce((s, m) => s + (m.a?1:0) + (m.b?1:0), 0);
    assert.strictEqual(seats, n, `${n}명인데 자리가 ${seats}개다`);
    /* 부전승은 그 자리에서 올라가 있어야 한다 */
    const byeDone = first.filter(m => m.why === "bye").length;
    assert.strictEqual(byeDone, size - n, `${n}명: 부전승이 안 올라갔다`);
  }
  console.log("bye     2~65명 · 빈 대국 없음 · 자리 수 일치 · 부전승 즉시 진출");
}

/* ── 4. 끝까지 — 언제나 우승자 한 명 ────────────────────────────────── */
{
  for (const n of [2,3,5,12,25,30,33]){
    const t = open(n);
    t.start();
    runAll(t, m => Math.random() < .5 ? m.a : m.b);
    assert.ok(t.champion, `${n}명: 우승자가 없다`);
    const out = [...t.people.values()].filter(p => p.out).length;
    assert.strictEqual(out, n - 1, `${n}명: 탈락자가 ${out}명이다`);
    const first = [...t.people.values()].filter(p => p.place === 1);
    assert.strictEqual(first.length, 1, "1위가 하나가 아니다");
    assert.strictEqual(first[0].pid, t.champion);
  }
  console.log("run     2~33명 전부 완주 · 우승 1명 · 탈락 n-1명");
}

/* ── 5. 등수 ─────────────────────────────────────────────────────────── */
{
  const t = open(16); t.start();
  runAll(t, m => m.a);                     // 늘 a 가 이긴다
  const place = [...t.people.values()].map(p => p.place).sort((x,y) => x-y);
  assert.strictEqual(place[0], 1, "우승이 1위가 아니다");
  assert.strictEqual(place[1], 2, "준우승이 2위가 아니다");
  assert.strictEqual(place.filter(p => p === 3).length, 2, "3위가 둘이 아니다");
  assert.strictEqual(place.filter(p => p === 5).length, 4, "5위가 넷이 아니다");
  assert.strictEqual(place.filter(p => p === 9).length, 8, "9위가 여덟이 아니다");
  console.log("place   1 · 2 · 공동3 둘 · 공동5 넷 · 공동9 여덟");
}

/* ── 6. 결과 검사 ────────────────────────────────────────────────────── */
{
  const t = open(4); t.start();
  const m = t.ready()[0];
  assert.strictEqual(t.report("없는대국", m.a, "catch").err, "nomatch");
  assert.strictEqual(t.report(m.id, "남의pid", "catch").err, "stranger",
                     "그 대국에 없는 사람이 이겼다");
  assert.ok(t.report(m.id, m.a, "catch").ok);
  assert.strictEqual(t.report(m.id, m.b, "catch").err, "done", "끝난 판이 뒤집혔다");
  /* 진 사람은 다시 못 올라온다 */
  const loser = m.b;
  assert.ok(t.people.get(loser).out);
  assert.strictEqual(t.matchOf(loser), null, "탈락자가 아직 대국에 걸려 있다");
  console.log("report  없는 대국 · 남의 이름 · 끝난 판 다시 — 전부 거절");
}

/* ── 7. 관전 기본값 ──────────────────────────────────────────────────── */
{
  const t = open(8); t.start();
  const r0 = t.rounds[0];
  r0.forEach(m => { m.state = "playing"; });

  /* 첫 대국만 끝낸다 — 진 사람은 자기를 꺾은 사람의 대국을 봐야 하는데,
     그 사람은 아직 다음 대국이 없다. 그러면 null 이고 대진표를 띄운다. */
  const win = r0[0].a, lose = r0[0].b;
  t.report(r0[0].id, win, "catch");
  assert.strictEqual(t.watchFor(lose), null, "볼 대국이 없는데 뭔가를 내줬다");

  /* 이긴 사람은 자기 다음 상대를 가릴 대국을 본다 */
  const should = r0[1];
  assert.strictEqual(t.watchFor(win), should,
                     "이긴 사람이 다음 상대 가릴 대국을 못 본다");

  /* 그 대국이 끝나면 둘이 만난다 — 더 볼 것이 없다 */
  t.report(should.id, should.a, "catch");
  assert.strictEqual(t.watchFor(win), null);
  const up = t.rounds[1][0];
  assert.deepStrictEqual([up.a, up.b], [win, should.a], "8강 자리가 안 채워졌다");
  console.log("watch   진 쪽은 나를 꺾은 사람 · 이긴 쪽은 다음 상대 가릴 대국");
}

/* ── 8. 내보내는 모습 ────────────────────────────────────────────────── */
{
  const t = open(6); t.start();
  const b = t.board();
  assert.strictEqual(b.length, 3, "6명이면 8강 대진 세 라운드다");
  assert.deepStrictEqual(b.map(r => r.name), ["8강", "준결승", "결승"]);
  assert.ok(b[0].matches.every(m => !m.a || m.a.name), "대진표에 이름이 없다");
  const f = t.full();
  assert.strictEqual(f.entrants.length, 6);
  assert.strictEqual(f.pin, "1234", "관리자는 비번을 봐야 한다");
  assert.strictEqual(t.info().pin, undefined, "학생에게 비번이 새 나갔다");
  console.log("board   라운드 이름 · 이름 실림 · 비번은 관리자에게만");
}

console.log("\n전부 통과");
