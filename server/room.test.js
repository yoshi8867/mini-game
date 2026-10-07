/* node room.test.js — 심판 자기검사.
   서버가 규칙을 어기거나, 자리를 잘못 내주거나, 연승을 잘못 세면 여기서 터진다. */
"use strict";
const assert = require("assert");
const {Room, newCode, okPin, LIMIT_MS, EG} = require("./room.js");
const players = require("./players.js");

let seq = 0;
const who = () => players.get("pid-test-" + (++seq) + "-" + Math.random().toString(36).slice(2));
const sockA = {id:"A"}, sockB = {id:"B"}, sockC = {id:"C"};

/* ── 1. 대국 코드 ────────────────────────────────────────────────────── */
{
  const seen = new Set();
  for (let i = 0; i < 2000; i++){
    const c = newCode(x => seen.has(x));
    assert.match(c, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/, `이상한 코드 ${c}`);
    seen.add(c);
  }
  assert.strictEqual(seen.size, 2000, "코드가 겹쳤다");
  console.log("code    4글자 2000개 무충돌 · 헷갈리는 I O 0 1 없음");
}

/* ── 2. 닉네임과 뱃지 ────────────────────────────────────────────────── */
{
  const a = players.get("pid-name-check"), b = players.get("pid-name-check");
  assert.strictEqual(a, b, "같은 pid 인데 다른 사람이 됐다");
  assert.strictEqual(a.name, players.nameOf("pid-name-check"), "닉네임이 pid 에서 안 나온다");
  assert.ok(/^\S+ \S+$/.test(a.name), `닉네임 모양이 이상하다: ${a.name}`);

  assert.strictEqual(players.badge(0), null);
  assert.strictEqual(players.badge(1), null);
  assert.strictEqual(players.badge(2), "navy");
  assert.strictEqual(players.badge(4), "navy");
  assert.strictEqual(players.badge(5), "crimson");
  assert.strictEqual(players.badge(9), "crimson");
  assert.strictEqual(players.badge(10), "gold");
  assert.strictEqual(players.badge(37), "gold");
  const combos = players.HEAD.length * players.TAIL.length;
  console.log(`name    pid 에서 결정 · ${combos}가지 · 뱃지 2 남색 / 5 크림슨 / 10 금색`);
}

/* ── 2-1. 이름 다시 굴리기 ──────────────────────────────────────────── */
{
  assert.strictEqual(players.HEAD.length, 96, "앞말이 96개가 아니다");
  assert.strictEqual(players.TAIL.length, 96, "뒷말이 96개가 아니다");
  assert.strictEqual(new Set(players.HEAD).size, 96, "앞말이 겹친다");
  assert.strictEqual(new Set(players.TAIL).size, 96, "뒷말이 겹친다");

  const p = players.get("pid-roll-check");
  p.streak = 3;
  for (let i = 0; i < 500; i++){        // 앞말만 굴리면 뒷말은 그대로다
    const was = players.view(p);
    assert.ok(players.reroll(p, "head"));
    const now = players.view(p);
    assert.notStrictEqual(now.head, was.head, "같은 앞말이 다시 나왔다");
    assert.strictEqual(now.tail, was.tail, "앞말을 굴렸는데 뒷말이 바뀌었다");
    assert.strictEqual(now.name, now.head + " " + now.tail, "이름이 안 맞는다");
  }
  for (let i = 0; i < 500; i++){        // 뒷말도 마찬가지
    const was = players.view(p);
    assert.ok(players.reroll(p, "tail"));
    const now = players.view(p);
    assert.notStrictEqual(now.tail, was.tail, "같은 뒷말이 다시 나왔다");
    assert.strictEqual(now.head, was.head, "뒷말을 굴렸는데 앞말이 바뀌었다");
  }
  assert.strictEqual(p.streak, 3, "이름을 바꿨다고 연승이 날아갔다");
  assert.strictEqual(players.reroll(p, "name"), false, "엉뚱한 자리를 굴렸다");
  assert.strictEqual(players.reroll(null, "head"), false);

  /* 한쪽으로 쏠리지 않는지 — 96자리를 1만 번 굴려 전부 나오는가 */
  const hit = new Set();
  for (let i = 0; i < 10000; i++){ players.reroll(p, "head"); hit.add(players.view(p).head); }
  assert.strictEqual(hit.size, 96, `안 나오는 앞말이 있다 (${hit.size}/96)`);
  console.log("roll    앞말·뒷말 따로 · 늘 다른 말 · 96자리 고루 나옴 · 연승 유지");
}

/* ── 2-2. pid 에서 뽑는 첫 이름이 쏠리지 않는가 ─────────────────────────
   해시의 낮은 비트가 안 섞이면 어떤 말이 열 배 자주 나온다. 실제로 그랬다. */
{
  const N = 60000, H = new Array(96).fill(0), T = new Array(96).fill(0);
  const seen = new Set();
  for (let i = 0; i < N; i++){
    const pid = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    const [h, t] = players.nameOf(pid).split(" ");
    H[players.HEAD.indexOf(h)]++; T[players.TAIL.indexOf(t)]++;
    seen.add(h + " " + t);
  }
  const chi = a => { const e = N / 96; return a.reduce((s, v) => s + (v - e) * (v - e) / e, 0); };
  const ch = chi(H), ct = chi(T);
  /* 자유도 95면 카이제곱은 95 언저리다. 200 을 넘으면 우연이 아니다 */
  assert.ok(ch < 200, `앞말이 쏠린다 (카이제곱 ${ch.toFixed(0)})`);
  assert.ok(ct < 200, `뒷말이 쏠린다 (카이제곱 ${ct.toFixed(0)})`);
  /* 조합 전부(9216)를 보려면 8만 번 넘게 뽑아야 한다 — 쿠폰수집가다.
     여기서 볼 것은 96자리가 하나도 빠지지 않는가다 */
  assert.strictEqual(H.filter(v => v === 0).length, 0, "한 번도 안 나오는 앞말이 있다");
  assert.strictEqual(T.filter(v => v === 0).length, 0, "한 번도 안 나오는 뒷말이 있다");
  console.log(`seed    ${N}개 pid · 카이제곱 앞말 ${ch.toFixed(0)} 뒷말 ${ct.toFixed(0)} · ` +
              `${seen.size}가지 · 빠진 말 없음`);
}

/* ── 3. 자리 ─────────────────────────────────────────────────────────── */
{
  const r = new Room("TEST");
  const pa = who(), pb = who(), pc = who();
  const a = r.seat(sockA, pa, null), b = r.seat(sockB, pb, null);
  assert.strictEqual(a.side, 0);
  assert.strictEqual(b.side, 1);
  assert.ok(a.token && b.token && a.token !== b.token, "자리표가 겹쳤다");
  assert.strictEqual(r.seat(sockC, pc, null).err, "full", "세 번째가 앉았다");
  assert.ok(r.ready);

  r.drop(sockA);                          // 아직 한 수도 안 뒀으니 그냥 빈다
  assert.ok(!r.ready);
  const again = r.seat(sockA, pa, a.token);
  assert.strictEqual(again.side, 0, "자리표를 들고 왔는데 다른 자리로 갔다");
  console.log("seat    두 자리 · 정원 초과 거절 · 자리표로 복귀");
}

/* ── 4. 시계는 둘이 앉아야 돈다 ─────────────────────────────────────── */
{
  const r = new Room("TEST");
  assert.strictEqual(r.left(), 0, "아무도 없는데 시계가 돈다");
  r.seat(sockA, who(), null);
  assert.strictEqual(r.left(), 0, "혼자 기다리는데 시계가 돈다");   // ← 회귀
  r.seat(sockB, who(), null);
  assert.ok(r.left() > LIMIT_MS - 1000, "둘이 앉았는데 시계가 안 돈다");

  r.play(0, EG.gen(r.pos)[0], 0);
  assert.ok(r.left() > LIMIT_MS - 1000, "수를 둬도 시계가 안 돌아갔다");
  r.drop(sockB);
  assert.strictEqual(r.left(), 0, "상대가 끊겼는데 시계가 계속 돈다");
  console.log(`clock   혼자면 멈춤 · 둘이면 ${LIMIT_MS/1000}초 · 끊기면 멈춤`);
}

/* ── 5. 수 심판 ──────────────────────────────────────────────────────── */
{
  const r = new Room("TEST");
  r.seat(sockA, who(), null); r.seat(sockB, who(), null);
  const legal = EG.gen(r.pos);
  assert.strictEqual(r.play(1, legal[0], 0).err, "turn",    "차례가 아닌 쪽이 뒀다");
  assert.strictEqual(r.play(0, legal[0], 7).err, "stale",   "엉뚱한 ply 를 받았다");
  assert.strictEqual(r.play(0, 0x7fffff, 0).err, "illegal", "불법 수를 받았다");
  assert.strictEqual(r.play(0, 1.5, 0).err,      "bad",     "정수가 아닌 수를 받았다");
  assert.ok(r.play(0, legal[0], 0).ok, "정상 수가 막혔다");
  assert.strictEqual(r.play(0, EG.gen(r.pos)[0], 1).err, "turn", "연속으로 뒀다");
  console.log("judge   차례 · ply · 불법 · 정수 검사 통과");
}
{
  const r = new Room("TEST");
  r.seat(sockA, who(), null);
  assert.strictEqual(r.play(0, EG.gen(r.pos)[0], 0).err, "waiting");
  console.log("wait    상대가 없으면 수를 받지 않는다");
}

/* ── 6. 자기대국 — 반드시 끝나고, 끝나면 더 못 둔다 ────────────────── */
{
  const tally = {}, plies = [];
  for (let g = 0; g < 4; g++){
    const r = new Room("TEST");
    r.seat(sockA, who(), null); r.seat(sockB, who(), null);
    let guard = 0;
    while (!r.over && guard++ < 400){
      const side = r.pos.turn;
      const past = [...r.seen].filter(e => e[1] >= 2).map(e => e[0]);
      const res = EG.best({b: r.pos.b, hand: r.pos.hand, turn: side},
                          {ms: 30, margin: 140, past});
      const out = r.play(side, res.move, r.ply);
      assert.ok(out.ok, `심판이 엔진 수를 거절했다: ${out.err}`);
    }
    assert.ok(r.over, "400수 안에 안 끝났다");
    tally[r.over.why] = (tally[r.over.why] || 0) + 1;
    plies.push(r.ply);
    assert.strictEqual(r.play(r.pos.turn, EG.gen(r.pos)[0] || 1, r.ply).err, "over");
  }
  const t = Object.entries(tally).map(e => `${e[0]} ${e[1]}`).join(" · ");
  console.log(`self    4판 완주 · ${t} · 최장 ${Math.max(...plies)}수`);
}

/* ── 7. 연승 ─────────────────────────────────────────────────────────── */
{
  const win = who(), lose = who();
  for (let i = 0; i < 10; i++){
    const r = new Room("TEST");
    r.seat(sockA, win, null); r.seat(sockB, lose, null);
    r.play(0, EG.gen(r.pos)[0], 0);        // 한 수는 둬야 판이 선다
    r.finish(0, "catch");
    assert.strictEqual(win.streak, i + 1, `연승이 안 쌓인다 (${i})`);
    assert.strictEqual(lose.streak, 0, "진 쪽 연승이 남아 있다");
  }
  assert.strictEqual(players.view(win).badge, "gold", "10연승인데 금색이 아니다");

  // 무승부는 연승을 건드리지 않는다
  const r2 = new Room("TEST");
  r2.seat(sockA, win, null); r2.seat(sockB, lose, null);
  r2.finish(null, "repeat");
  assert.strictEqual(win.streak, 10, "무승부에 연승이 깨졌다");

  // 지면 깨진다
  const r3 = new Room("TEST");
  r3.seat(sockA, win, null); r3.seat(sockB, lose, null);
  r3.finish(1, "catch");
  assert.strictEqual(win.streak, 0, "졌는데 연승이 남았다");
  console.log("streak  이기면 쌓이고 · 무승부는 그대로 · 지면 깨진다");
}

/* ── 8. 나가기는 패, 끊김은 패가 아니다 ────────────────────────────── */
{
  const a = who(), b = who();
  a.streak = 4;
  const r = new Room("TEST");
  r.seat(sockA, a, null); r.seat(sockB, b, null);
  r.play(0, EG.gen(r.pos)[0], 0);
  r.leave(sockA);
  assert.deepStrictEqual({w: r.over.winner, y: r.over.why}, {w: 1, y: "leave"},
                         "나가기가 패로 처리되지 않았다");
  assert.strictEqual(a.streak, 0, "나가기로 졌는데 연승이 남았다");
  assert.strictEqual(b.streak, 1, "남은 쪽이 못 이겼다");

  // 끊김은 패가 아니다 — 다만 연달아 셋이면 연승을 인정하지 않는다
  const c = who();
  c.streak = 6;
  for (let i = 1; i <= 3; i++){
    const rr = new Room("TEST");
    rr.seat(sockA, c, null); rr.seat(sockB, who(), null);
    rr.play(0, EG.gen(rr.pos)[0], 0);
    rr.finish(null, "gone", 0);
    if (i < 3) assert.strictEqual(c.streak, 6, `끊겼다고 연승이 깨졌다 (${i}회)`);
  }
  assert.strictEqual(c.streak, 0, "끊김 3회인데 연승이 남았다");
  console.log("exit    나가기 = 패 · 끊김 = 패 아님 · 끊김 3연속이면 연승 취소");
}

/* ── 9. 비공개 대국 ──────────────────────────────────────────────────── */
{
  assert.ok(okPin("0000") && okPin("4821"));
  assert.ok(!okPin("12") && !okPin("12345") && !okPin("12a4") && !okPin(1234));
  const open = new Room("TEST");
  assert.strictEqual(open.open, true);
  assert.strictEqual(open.pin, null);
  const shut = new Room("TEST", {open: false, pin: "4821"});
  assert.strictEqual(shut.open, false);
  assert.strictEqual(shut.pin, "4821");
  const bad = new Room("TEST", {open: false, pin: "abc"});
  assert.strictEqual(bad.pin, null, "이상한 비번이 들어갔다");
  console.log("pin     숫자 4자리만 · 공개가 기본");
}

/* ── 10. 목록에 보이는 모습 ─────────────────────────────────────────── */
{
  const r = new Room("WXYZ");
  const a = who(); a.streak = 5;
  r.seat(sockA, a, null);
  let i = r.info();
  assert.deepStrictEqual([i.code, i.state, i.open], ["WXYZ", "waiting", true]);
  assert.strictEqual(i.people.length, 1);
  assert.strictEqual(i.people[0].badge, "crimson", "뱃지가 목록에 안 실린다");
  r.seat(sockB, who(), null);
  i = r.info();
  assert.strictEqual(i.state, "playing");
  assert.strictEqual(i.people.length, 2, "대국 중인데 둘이 안 보인다");
  console.log("list    대기(1명) → 대국 중(2명) · 뱃지가 함께 실린다");
}

/* ── 11. 재대국 ──────────────────────────────────────────────────────── */
{
  const r = new Room("TEST");
  r.seat(sockA, who(), null); r.seat(sockB, who(), null);
  r.finish(1, "catch");
  assert.strictEqual(r.wantRematch(0), false, "한쪽만 눌렀는데 다시 시작했다");
  assert.strictEqual(r.wantRematch(1), true,  "양쪽이 눌렀는데 안 시작했다");
  assert.strictEqual(r.over, null);
  assert.strictEqual(r.first, 1, "선공이 안 넘어갔다");
  assert.strictEqual(r.pos.turn, 1);
  assert.ok(r.left() > LIMIT_MS - 1000, "새 판인데 시계가 안 돈다");
  console.log("again   양쪽 동의로 재대국 · 선공 교대 · 시계 재시작");
}

/* ─── 맡겼다 되살리기 — 대회 대국은 서버가 넘어져도 이어진다 ──────────── */
{
  const r = new Room("RVV1", {open: false});
  r.only = ["pid-revive-a1", "pid-revive-b2"]; r.cup = {code: "CUPR", match: "m1"};
  for (let i = 0; i < 8; i++){
    const g = EG.gen(r.pos); if (!g.length) break;
    EG.make(r.pos, g[(i * 7) % g.length]); r.ply++;
    const h = EG.hash(r.pos); r.seen.set(h, (r.seen.get(h) || 0) + 1);
  }
  /* JSON 을 한 바퀴 돈다 — Neon 의 jsonb 에 들어갔다 나오는 것과 같다.
     판은 Int8Array 라 그대로 넣으면 빈 객체가 된다. 그것을 잡는 검사다. */
  const b = Room.revive(JSON.parse(JSON.stringify(r.snapshot())));
  const x = r.state(), y = b.state();
  assert.deepStrictEqual(y.b, x.b, "되살린 판이 다르다");
  assert.strictEqual(y.b.length, 12, "되살린 판이 비었다 — Int8Array 를 풀지 않고 적었다");
  assert.deepStrictEqual(y.hand, x.hand, "되살린 손패가 다르다");
  assert.strictEqual(y.turn, x.turn, "되살린 차례가 다르다");
  assert.strictEqual(b.ply, r.ply, "되살린 수 번호가 다르다");
  assert.deepStrictEqual(EG.gen(b.pos), EG.gen(r.pos), "되살린 판에서 둘 수 있는 수가 다르다");
  assert.deepStrictEqual([...b.seen], [...r.seen], "같은 국면 횟수를 잊었다 — 천일수 판정이 틀어진다");
  assert.deepStrictEqual(b.only, r.only, "대회 대국의 두 사람을 잊었다");
  console.log("revive  맡겼다 되살려도 판 · 손패 · 차례 · 같은 국면 횟수가 그대로");
}

console.log("\n전부 통과");
