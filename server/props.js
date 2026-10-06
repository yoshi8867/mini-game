/* ══════════════════════════════════════════════════════════════════════
   블라인드 1판 — 명제와 정답.

   20문제 5지선다인데 **문제 지문이 없다.** 정답 배열 자체가 퍼즐이고,
   학생은 그 배열에 관한 명제 **한 줄**만 받는다. 만든 과정과 설계 원칙은
   omr-quiz/README.md 에 있다.

   명제는 두 갈래다.

   · **개별 명제 21개** — 한 사람에게 한 줄씩 나눠 준다. ☆ 넷은 덜 중요해서,
     사람이 스물하나보다 적으면 DROP 순서대로 뺀다. ★ 열일곱만 남아도
     공통 힌트와 합치면 해는 하나로 정해진다.
   · **공통 힌트 3개** — 아무에게도 안 나눠 주고 15·20·25분에 모두에게
     띄운다. 누구의 패도 죽이지 않으려고 개별 명제에서 아예 뺀 것들이다.

   순서가 중요하다. **C1(예전 P10) 하나면 답이 못 박힌다.** 나머지 셋은 그
   앞에 있어야 쓸모가 있다 — 순서는 관리자가 판마다 바꿀 수 있다.

   **여기 적힌 것은 연습용이다.** 저장소가 공개라 정답을 둘 수 없다 —
   진짜 판은 `OMR_PROPS` 환경변수에 JSON 한 줄로 넣는다. Render 대시보드와
   로컬 `server/.env` 에만 있고 git 에는 안 들어간다. 넣는 법은 tools/pack-props.js.

   **이 파일은 화면으로 내려가지 않는다.** 내 명제 한 줄만, 그것도 공개하는
   1분 동안만 나간다. 정답은 종료령 뒤에 하나씩 열린다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
require("./env.js");                         // 로컬에서는 .env 가 값을 얹는다

/* 닿는 칸 — 어느 문항을 주무르는 명제인가. 힌트를 고를 때 이걸 본다 */
const R = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
const ODD = R(1, 20).filter(q => q % 2);

const BUILT_KEY = [5,2,5,2,1, 5,3,2,5,5, 1,3,3,2,5, 3,3,2,5,5];

/* 나눠 주는 명제. ☆ 는 사람이 모자랄 때 먼저 빠진다 */
const BUILT_PROPS = [
  {id: "P01", star: false, text: "1번과 2번 답의 합은 7이다.", cells: [1, 2]},
  {id: "P02", star: false, text: "1~5번 문제의 답에는 3번이 없다.", cells: R(1, 5)},
  {id: "P03", star: false, text: "3~5번 문제의 답은 내림차순이다.", cells: [3, 4, 5]},
  {id: "P04", star: false, text: "5의 배수 문제 중 답이 5번인 것이 3개이다.", cells: [5, 10, 15, 20]},
  {id: "P05", star: false, text: "6~8번 문제의 답은 내림차순이다.", cells: [6, 7, 8]},
  {id: "P06", star: false, text: "6~10번 문제 답의 합은 20이다.", cells: R(6, 10)},
  {id: "P07", star: true,  text: "9번 문제 답은 5이다.", cells: [9]},
  {id: "P08", star: true,  text: "11~15번 문제 중 답이 3인 것은 2개이다.", cells: R(11, 15)},
  {id: "P09", star: false, text: "4의 배수 문제는 답이 4가 아니다.", cells: [4, 8, 12, 16, 20]},
  {id: "P11", star: false, text: "16~20번 문제의 답은 소수이다.", cells: R(16, 20)},
  {id: "P12", star: false, text: "15번과 16번 답의 합은 8이다.", cells: [15, 16]},
  {id: "P13", star: false, text: "6의 배수 문제의 답은 내림차순이다.", cells: [6, 12, 18]},
  {id: "P14", star: true,  text: "17번 문제의 답은 3이다.", cells: [17]},
  {id: "P15", star: false, text: "7번, 12번, 17번 문제는 답이 같다.", cells: [7, 12, 17]},
  {id: "P16", star: false, text: "3번, 6번, 9번 문제는 답이 같다.", cells: [3, 6, 9]},
  {id: "P17", star: false, text: "11번 15번 문제의 답의 합은 6이다.", cells: [11, 15]},
  {id: "P18", star: false, text: "12번과 13번 문제는 답이 같다.", cells: [12, 13]},
  {id: "P19", star: true,  text: "13~15번 문제의 답은 모두 서로소이다.", cells: [13, 14, 15]},
  {id: "P20", star: false, text: "13~15번 문제 답의 합은 10이다.", cells: [13, 14, 15]},
  {id: "P21", star: false, text: "14번과 19번 답의 합은 7이다.", cells: [14, 19]},
  /* 빈 번호를 메운다. P10 과 P23 은 공통 힌트로 갔으니 건드리지 않는다 */
  {id: "P22", star: true,  text: "2번과 10번 답의 합은 7이다.", cells: [2, 10]},
  {id: "P24", star: true,  text: "답이 1인 문제는 2개이다.", cells: R(1, 20)},
  /* P13 과 짝이다. 둘을 합치면 6·12·18번이 (5,3,2) 로 못 박힌다 */
  {id: "P25", star: false, text: "6의 배수 문제는 답이 1도 아니고 4도 아니다.", cells: [6, 12, 18]},
];

/* 사람이 모자라면 앞에서부터 뺀다. 모두 ☆ 다 */
const BUILT_DROP = ["P24", "P19", "P08", "P14", "P07", "P22"];

/* 모두에게 띄우는 힌트. 15 · 20 · 25분 순서고, 번호를 따로 매겼다.
   was 는 나눠 주던 시절의 번호다 — omr-quiz/README.md 를 읽을 때 필요하다 */
const BUILT_COMMON = [
  {id: "C1", was: "P10", text: "홀수 번호 문제의 답은 홀수이다.", cells: ODD},
  {id: "C2", was: null,  text: "답이 5인 문제는 8개이다.", cells: R(1, 20)},
  {id: "C3", was: "P23", text: "답이 4인 문제는 하나도 없다.", cells: R(1, 20)},
];

/* 사람 수에 맞춰 나눠 줄 명제를 고른다. 적을수록 ☆ 부터 빠진다 */
/* ─── 진짜 판은 밖에서 들어온다 ──────────────────────────────────────
   OMR_PROPS 에 {KEY, PROPS, DROP, COMMON} 을 JSON 으로 넣는다. 없거나
   깨졌으면 위에 적힌 연습판으로 간다 — 교실이 멎는 것보다는 낫다 */
function brought(){
  const raw = process.env.OMR_PROPS;
  if (!raw || !raw.trim()) return null;
  let j;
  try { j = JSON.parse(raw); }
  catch (e){ console.error("OMR_PROPS 가 JSON 이 아니다 — 연습판으로 간다"); return null; }
  const ok = j && Array.isArray(j.KEY) && Array.isArray(j.PROPS) &&
             Array.isArray(j.COMMON) && Array.isArray(j.DROP) &&
             j.KEY.length && j.PROPS.length >= 2 &&
             j.KEY.every(n => n >= 1 && n <= 5) &&
             j.PROPS.every(p => p && p.id && p.text) &&
             j.COMMON.every(c => c && c.id && c.text);
  if (!ok){ console.error("OMR_PROPS 모양이 틀렸다 — 연습판으로 간다"); return null; }
  j.PROPS.forEach(p => { p.star = !!p.star; p.cells = p.cells || []; });
  j.COMMON.forEach(c => { c.cells = c.cells || []; });
  return j;
}
const LIVE = brought();
const CUSTOM = !!LIVE;                       // 진짜 판으로 돌고 있는가
const KEY    = CUSTOM ? LIVE.KEY    : BUILT_KEY;
const PROPS  = CUSTOM ? LIVE.PROPS  : BUILT_PROPS;
const DROP   = CUSTOM ? LIVE.DROP   : BUILT_DROP;
const COMMON = CUSTOM ? LIVE.COMMON : BUILT_COMMON;
const HINTS  = COMMON.map(c => c.text);

function deal(n){
  const cut = Math.max(0, PROPS.length - n);
  const gone = new Set(DROP.slice(0, cut));
  return PROPS.filter(p => !gone.has(p.id));
}

module.exports = {KEY, PROPS, DROP, COMMON, HINTS, deal, CUSTOM};
