/* ══════════════════════════════════════════════════════════════════════
   진짜 판을 환경변수 한 줄로 찍어 낸다.

   저장소는 공개라 정답을 둘 수 없다. 진짜 판은 `server/props.local.js` 에
   적어 두고 — 이 파일은 git 이 안 본다 — 여기서 한 줄로 말아 Render
   대시보드의 OMR_PROPS 에 붙여 넣는다. 로컬에서는 server/.env 에 넣는다.

       node tools/pack-props.js              한 줄로 찍는다
       node tools/pack-props.js --env        .env 에 붙일 모양으로 찍는다
       node tools/pack-props.js --check      넣은 판이 성한지만 본다

   props.local.js 는 server/props.js 와 같은 모양이면 된다:

       module.exports = {
         KEY: [5,2,...],                     // 20개, 1~5
         PROPS:  [{id:"P01", star:false, text:"…", cells:[1,2]}, …],
         DROP:   ["P24", "P19", …],          // ☆ 를 빼는 순서
         COMMON: [{id:"C1", text:"…"}, …],   // 공통 힌트
       };
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "server", "props.local.js");
if (!fs.existsSync(src)){
  console.error("server/props.local.js 가 없다. 거기에 진짜 판을 적어 둔다.");
  console.error("모양은 이 파일 맨 위 주석에 있다.");
  process.exit(1);
}
const j = require(src);

/* 넣기 전에 성한지 본다 — 교실에서 터지면 늦다 */
const bad = [];
const push = (t, c) => { if (!c) bad.push(t); };
push("KEY 가 배열이 아니다", Array.isArray(j.KEY));
push("KEY 에 1~5 아닌 것이 있다", (j.KEY || []).every(n => n >= 1 && n <= 5));
push("PROPS 가 둘도 안 된다", (j.PROPS || []).length >= 2);
push("PROPS 에 id 나 text 가 빈 것이 있다", (j.PROPS || []).every(p => p.id && p.text));
push("COMMON 에 id 나 text 가 빈 것이 있다", (j.COMMON || []).every(c => c.id && c.text));
push("DROP 이 배열이 아니다", Array.isArray(j.DROP));

const ids = (j.PROPS || []).map(p => p.id);
push("PROPS 에 같은 번호가 둘 있다", new Set(ids).size === ids.length);
push("DROP 에 PROPS 에 없는 번호가 있다", (j.DROP || []).every(d => ids.includes(d)));
const stars = (j.PROPS || []).filter(p => p.star).map(p => p.id).sort();
push("☆ 와 DROP 이 다르다", JSON.stringify(stars) === JSON.stringify((j.DROP || []).slice().sort()));
const cids = (j.COMMON || []).map(c => c.id);
push("공통 힌트가 개별 명제에도 있다", cids.every(c => !ids.includes(c)));
const texts = (j.PROPS || []).map(p => p.text).concat((j.COMMON || []).map(c => c.text));
push("같은 문장이 둘 있다", new Set(texts).size === texts.length);

if (bad.length){
  bad.forEach(t => console.error("  ✕ " + t));
  process.exit(1);
}

const line = JSON.stringify({KEY: j.KEY, PROPS: j.PROPS, DROP: j.DROP, COMMON: j.COMMON});
const how = process.argv[2];
if (how === "--check"){
  console.log("성하다 — 문제 " + j.KEY.length + "개 · 개별 명제 " + j.PROPS.length +
              "개 (☆ " + stars.length + ") · 공통 힌트 " + j.COMMON.length + "개");
  console.log("한 줄로 " + line.length + "자");
  process.exit(0);
}
if (how === "--env") console.log("OMR_PROPS=" + line);
else console.log(line);
