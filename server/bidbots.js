/* ══════════════════════════════════════════════════════════════════════
   연습 대표.

   대회의 bots.js 와 같은 뜻이다 — 수업 전에 혼자 한 바퀴 돌려 보려는 것.
   mock- 으로 시작하는 참가자는 사람이 아니라 서버가 대신 값을 부른다.

   영리할 까닭이 없다. 기댓값에 견주어 배짱을 한 번 정하고, 사람처럼 몇 초
   머뭇거렸다가 부른다. 비밀 입찰은 한 번만 적어 낸다.

   품목마다 기억이 새로 시작한다. 그 기억은 lot 에 붙이지 않고 여기 WeakMap
   에 둔다 — bid.js 는 연습 대표가 있는지조차 몰라야 한다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

const {WHEELS} = require("./wheels.js");
const {TOKENS, LOTS} = require("./bid.js");

const isBot = pid => typeof pid === "string" && pid.slice(0, 5) === "mock-";

const MEM = new WeakMap();              // lot → Map(teamId → 머릿속)
const rnd = n => (Math.random() * n) | 0;

function memo(lot){
  let m = MEM.get(lot);
  if (!m){ m = new Map(); MEM.set(lot, m); }
  return m;
}

/* 1점은 토큰 몇 개인가.

   고정된 숫자를 적어 두면 토큰 수를 고치거나 룰렛 값을 손볼 때마다 연습
   대표가 혼자 헐값을 부른다. 그래서 판에서 끌어낸다 — 풀린 토큰을 경매에
   나올 양수 룰렛의 기댓값 합으로 나눈 값이 곧 시장가다. 0.7 은 음수 경매가
   태워 없앨 몫을 어림한 것이다. */
function rate(bid){
  const pool = WHEELS.filter(w => w.ev > 0).reduce((n, w) => n + w.ev, 0) *
               LOTS / WHEELS.length;
  if (!pool) return .2;
  return TOKENS * Math.max(2, bid.teams.length) * .7 / pool;
}
/* 좋은 룰렛에 얼마까지 낼 배짱인가. 시장가 언저리에서 한 뼘씩 어긋난다 */
const nerve = (ev, r) => Math.max(1, Math.round(ev * r) + rnd(3) - 1);
/* 받기 싫은 룰렛을 피하려고 얼마를 적을까. 깊을수록 많이 적는다.
   값을 적고도 못 피하면 그냥 태우는 것이니 시장가의 절반까지만 건다 */
const fear  = (ev, r) => Math.max(1, Math.round(Math.abs(ev) * r / 2) + rnd(3));

/* 바뀐 것이 있으면 true. 부르는 쪽에서 다시 그린다 */
function tick(bid, now){
  if (!bid || bid.state !== "running") return false;
  const lot = bid.lot;
  if (!lot || lot.done) return false;
  const m = memo(lot);
  const r = rate(bid);
  let moved = false;

  for (const t of bid.teams){
    if (!isBot(t.pid)) continue;
    let s = m.get(t.id);
    if (!s){
      /* 품목이 뜨자마자 다 같이 달려들면 사람이 따라 볼 수가 없다 */
      s = lot.bad
        ? {when: lot.at + 2000 + rnd(13000), sent: false}
        : {when: lot.at + 1000 + rnd(4000), cap: nerve(lot.wheel.ev, r)};
      m.set(t.id, s);
    }
    if (now < s.when) continue;

    if (lot.bad){
      if (s.sent) continue;
      s.sent = true;                               // 한 번만 적어 낸다
      if (t.tokens < 1) continue;                  // 빈털터리는 못 낸다
      if (bid.seal(t.pid, Math.min(t.tokens, fear(lot.wheel.ev, r)), now).ok)
        moved = true;
    } else {
      if (lot.who === t.id) continue;              // 자기 값엔 자기가 못 올린다
      const n = lot.price + 1;
      if (n > s.cap || n > t.tokens) continue;     // 배짱 밖이면 손을 뗀다
      if (bid.bid(t.pid, n, now).ok){
        moved = true;
        s.when = now + 1200 + rnd(2600);           // 다시 부르기까지 뜸을 들인다
      }
    }
  }
  return moved;
}

module.exports = {isBot, tick};
