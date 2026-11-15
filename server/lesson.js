/* 단축키 연습 페이지(shortcuts.html)의 구간 문.
   교사가 연 구간까지만 학생이 넘어간다. 1~5 는 구간, 6 은 올림픽 링크까지 연 상태.
   ponytail: 반 구분 없이 하나뿐이고 메모리에만 둔다 — 서버가 다시 뜨면 1로 돌아간다.
   두 반이 같은 시간에 쓰게 되면 방 코드를 붙인다. */
"use strict";
const MAX = 6, ALIVE = 20000;
let open = 1;
const seen = new Map();                  // 학생 id → {at: 끝낸 구간 수, t}

/* 학생이 몇 초마다 부른다. 어디까지 끝냈는지 알리고, 어디까지 열렸는지 듣는다 */
function ping(id, at, now){
  id = String(id || "").slice(0, 40);
  if (id){
    if (seen.size > 2000) seen.clear();  // 무료 인스턴스다. 무한정 쌓지 않는다
    seen.set(id, {at: Math.max(0, Math.min(5, at | 0)), t: now});
  }
  return {open};
}
function set(v){ if (Number.isInteger(v) && v >= 1 && v <= MAX) open = v; }
/* 교사 화면용: 지금 붙어 있는 학생 수와, 구간마다 끝낸 학생 수 */
function state(now){
  const done = [0, 0, 0, 0, 0];
  let n = 0;
  for (const [id, s] of seen){
    if (now - s.t > ALIVE){ seen.delete(id); continue; }
    n++;
    for (let k = 0; k < s.at; k++) done[k]++;
  }
  return {ok: true, open, n, done};
}
module.exports = {ping, set, state};

if (require.main === module){
  const assert = require("assert");
  assert.deepStrictEqual(ping("a", 2, 1000), {open: 1});
  ping("b", 9, 1000); ping("", 3, 1000);
  assert.deepStrictEqual(state(1000), {ok: true, open: 1, n: 2, done: [2, 2, 1, 1, 1]});
  set(3); set(7); set("4"); set(0);
  assert.strictEqual(ping("a", 2, 5000).open, 3);
  assert.deepStrictEqual(state(22000).done, [1, 1, 0, 0, 0], "20초 넘게 조용한 학생은 뺀다");
  console.log("lesson.js 통과");
}
