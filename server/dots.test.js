/* node dots.test.js — 점판과 낱장 가르기 */
"use strict";
const assert = require("assert");
const DOTS = require("./dots.js");
const GLYPHS = require("./glyphs.js");
const D = DOTS(GLYPHS);

const N = D.N;

/* ── 점판 ─────────────────────────────────────────────────────────── */
assert.strictEqual(N, 14, "점판 한 변은 14다");
for (const [c, v] of Object.entries(D.GRID))
  assert.strictEqual(v.length, N * 4, c + " — 점판 길이가 어긋났다");

/* 문제 목록의 글자가 모두 점판에 있다 */
for (const w of D.WORDS){
  assert.ok(w.length >= 1 && w.length <= 4, w + " — 1~4글자만 낸다");
  for (const c of w) assert.ok(D.GRID[c], w + " — " + c + " 가 점판에 없다");
}
assert.strictEqual(new Set(D.WORDS).size, D.WORDS.length, "같은 낱말이 두 번 있다");

/* 성한 글자는 글자마다 한 벌이다 */
const full = D.whole("청출어람");
assert.strictEqual(full.length, 4, "네 글자가 네 벌로 안 나왔다");
assert.ok(full.every(v => v.length === N * 4), "줄이 모자라다");
assert.notStrictEqual(full[0], full[1], "글자가 다 똑같이 나왔다");

/* ── 가르기 ───────────────────────────────────────────────────────── */
/* 셋을 겹치면 원본이고, 한 장이 원본이 되지는 않는다 */
for (const w of ["귤", "파이썬", "두텁바위"]){
  const all = new Set(D.spell(w));
  const lay = D.share(D.lumps([...all], D.LUMP, D.rand(7)), D.rand(7));
  const seen = lay.flat();
  assert.strictEqual(new Set(seen).size, all.size, w + " — 겹쳐도 원본이 안 된다");
  assert.strictEqual(seen.length, all.size, w + " — 같은 점이 두 장에 들었다");
  for (const one of lay){
    assert.ok(one.length > 0, w + " — 빈 장이 있다");
    assert.ok(one.length < all.size, w + " — 한 장에 쏠렸다");
  }
  const most = Math.max(...lay.map(x => x.length));
  const least = Math.min(...lay.map(x => x.length));
  assert.ok(most - least <= D.LUMP * 2,
            w + " — 낱장이 고르지 않다 " + lay.map(x => x.length));
}

/* 낱장 셋의 글자 수와 줄 수 */
const cut = D.cut("일취월장", 1);
assert.strictEqual(cut.length, 3, "낱장이 셋이 아니다");
assert.ok(cut.every(one => one.length === 4), "글자 수가 안 맞는다");
assert.ok(cut.every(one => one.every(v => v.length === N * 4)), "줄이 모자라다");

/* 같은 씨앗이면 같은 낱장, 다른 씨앗이면 다른 낱장 */
const key = c => JSON.stringify(c);
assert.strictEqual(key(D.cut("단풍", 5)), key(D.cut("단풍", 5)), "같은 씨앗인데 딴 낱장이다");
assert.notStrictEqual(key(D.cut("단풍", 5)), key(D.cut("단풍", 6)), "씨앗을 바꿔도 그대로다");

/* 한 장만 보고는 글자를 알 수 없다 — 성한 글자와 같은 장이 있으면 안 된다 */
for (const w of D.WORDS)
  for (const one of D.cut(w, 11))
    assert.notStrictEqual(key(one), key(D.whole(w)), w + " — 한 장이 원본 그대로다");

if (require.main === module){
  console.log("점판 " + Object.keys(D.GRID).length + "자 · 문제 " + D.WORDS.length + "개");
  for (const w of ["밤", "앞뜰", "해질녘", "괄목상대"]){
    const lay = D.share(D.lumps(D.spell(w), D.LUMP, D.rand(3)), D.rand(3));
    console.log("  " + w + "  점 " + D.spell(w).length + "개 → 낱장 " +
                lay.map(x => x.length).join(" · "));
  }
  console.log("전부 통과");
}
