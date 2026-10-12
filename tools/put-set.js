/* ══════════════════════════════════════════════════════════════════════
   블라인드 문제 세트를 서버에 올린다 — 관리 화면의 「올리기」와 같은 길이다.

       node tools/put-set.js server/sets/2판.json "2판"
       node tools/put-set.js server/sets/2판.json "2판" --server http://127.0.0.1:3000
       node tools/put-set.js --list                   올라간 세트 목록만 본다

   세트 파일은 server/sets/ 에 둔다. git 이 안 보는 곳이다 — 정답이 들어 있다.
   모양은 server/props.js 의 checkSet 이 정한다:

       {KEY: [20개, 1~5],
        PROPS:  [{id:"P01", star:false, text:"…", cells:[1,2]}, …],
        DROP:   ["P24", …],                 // 사람이 모자랄 때 빼는 순서 (☆)
        COMMON: [{id:"C1", text:"…"}, 3개]} // 공통 힌트 1·2·3차

   관리자 비번은 server/.env 의 ADMIN_PW 를 쓴다. 화면에 찍지 않는다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, "server", ".env"), "utf8");
const PW = ((env.match(/^ADMIN_PW=(.*)$/m) || [])[1] || "").trim();
if (!PW){ console.error("server/.env 에 ADMIN_PW 가 없다"); process.exit(1); }

const argv = process.argv.slice(2);
const at = argv.indexOf("--server");
let SERVER = "https://class-live-62tz.onrender.com";
if (at >= 0){ SERVER = argv[at + 1]; argv.splice(at, 2); }
SERVER = SERVER.replace(/\/+$/, "");

const post = async (what, body) => (await fetch(SERVER + "/admin/" + what, {
  method: "POST", headers: {"content-type": "application/json"},
  body: JSON.stringify(body)})).json();

(async () => {
  const login = await post("login", {pw: PW});
  if (!login.ok){ console.error("관리자 로그인 실패:", login.why); process.exit(1); }
  const token = login.token;

  if (argv[0] === "--list" || !argv.length){
    const j = await post("omrsets", {token});
    for (const s of j.sets || [])
      console.log((s.base ? "  (기본) " : "  ") + s.name + "  — 개별 " + s.props + " · 공통 " + s.common +
                  (s.usedAt ? " · 마지막 " + s.usedAt + " " + (s.usedTitle || "") : " · 아직 안 냄"));
    if (!j.db) console.log("  DB 에 닿지 않는다 — 기본 세트만 있다");
    return;
  }
  const [file, name] = argv;
  if (!name){ console.error("세트 이름을 붙여 달라: node tools/put-set.js 파일.json \"2판\""); process.exit(1); }
  const set = JSON.parse(fs.readFileSync(file, "utf8"));
  const j = await post("omrsetput", {token, name, set});
  if (!j.ok){ console.error("올리기 실패:", j.why, j.detail || ""); process.exit(1); }
  console.log("올렸다 — 「" + name + "」 개별 명제 " + j.props + "줄 (" + SERVER + ")");
})().catch(e => { console.error(e.message); process.exit(1); });
