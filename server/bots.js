/* ══════════════════════════════════════════════════════════════════════
   연습 상대.

   대회 리허설용이다. mock- 으로 시작하는 참가자는 사람이 아니라 서버가
   대신 둔다. 수업 전에 대진표가 어떻게 굴러가는지 눈으로 보려는 것이다.

   서버는 원래 탐색을 하지 않는다 — 그래야 무료 인스턴스가 논다. 이것은
   그 원칙의 예외이므로 생각하는 시간을 아주 짧게 준다. 그리고 한 수마다
   쉬어 간다. 순식간에 끝나면 리허설이 되지 않는다.

   이 파일은 소켓을 모른다. 둔 수를 알리는 일은 손잡이(hooks)가 한다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const EG = require("../shared/engine.js")();

const MS    = +(process.env.BOT_MS || 1100);   // 사람이 따라 볼 수 있는 속도
const THINK = +(process.env.BOT_THINK || 25);  // 서버는 오래 생각하지 않는다

const isBot = pid => typeof pid === "string" && pid.slice(0, 5) === "mock-";

/* hooks: {alive(room), moved(room, r, side), ended(room), state(room)} */
function tick(room, hooks){
  if (!room || room.over || !hooks.alive(room)) return;
  const side = room.pos.turn;
  const seat = room.seats[side];
  if (!seat || !seat.bot) return;
  setTimeout(() => {
    if (room.over || !hooks.alive(room)) return;
    if (room.pos.turn !== side) return;
    const now = room.seats[side];
    if (!now || !now.bot) return;

    const past = [...room.seen].filter(e => e[1] >= 2).map(e => e[0]);
    const res = EG.best({b: room.pos.b, hand: room.pos.hand, turn: side},
                        {ms: THINK, margin: 120, past});
    if (!res || !res.move) return;
    const r = room.play(side, res.move, room.ply);
    if (r.err) return;

    hooks.moved(room, r, side);
    if (r.over) return hooks.ended(room);
    hooks.state(room);
    tick(room, hooks);
  }, MS);
}

module.exports = {isBot, tick, MS};
