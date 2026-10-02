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

const isBot = pid => typeof pid === "string" && pid.slice(0, 5) === "mock-";

const MEM = new WeakMap();              // lot → Map(teamId → 머릿속)
const rnd = n => (Math.random() * n) | 0;

function memo(lot){
  let m = MEM.get(lot);
  if (!m){ m = new Map(); MEM.set(lot, m); }
  return m;
}

/* 좋은 룰렛에 얼마까지 낼 배짱인가. 기댓값의 1/6 언저리 */
const nerve = ev => Math.max(1, Math.round(ev / 6) + rnd(3) - 1);
/* 받기 싫은 룰렛을 피하려고 얼마를 적을까. 깊을수록 많이 적는다 */
const fear  = ev => Math.max(1, Math.round(Math.abs(ev) / 9) + rnd(3));

/* 바뀐 것이 있으면 true. 부르는 쪽에서 다시 그린다 */
function tick(bid, now){
  if (!bid || bid.state !== "running") return false;
  const lot = bid.lot;
  if (!lot || lot.done) return false;
  const m = memo(lot);
  let moved = false;

  for (const t of bid.teams){
    if (!isBot(t.pid)) continue;
    let s = m.get(t.id);
    if (!s){
      /* 품목이 뜨자마자 다 같이 달려들면 사람이 따라 볼 수가 없다 */
      s = lot.bad
        ? {when: lot.at + 2000 + rnd(13000), sent: false}
        : {when: lot.at + 1000 + rnd(4000), cap: nerve(lot.wheel.ev)};
      m.set(t.id, s);
    }
    if (now < s.when) continue;

    if (lot.bad){
      if (s.sent) continue;
      s.sent = true;                               // 한 번만 적어 낸다
      if (t.tokens < 1) continue;                  // 빈털터리는 못 낸다
      if (bid.seal(t.pid, Math.min(t.tokens, fear(lot.wheel.ev)), now).ok) moved = true;
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
