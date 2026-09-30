/* ══════════════════════════════════════════════════════════════════════
   관리자 열쇠.

   레포가 공개라 비밀번호를 그대로 둘 수 없다. scrypt 로 한 번 굳혀서 박아
   둔다 — 이 값에서 원래 비밀번호를 되돌릴 수는 없다.

   다만 솔직히 적어 둔다. 짧고 흔한 말이면, 이 해시를 들고 단어 목록을
   하나씩 넣어 보는 식으로는 언젠가 맞힐 수 있다. scrypt 는 그 한 번을
   0.2초로 늘려 놓았을 뿐이다(초당 다섯 번). 교실에서 학생이 대회를
   닫아 버리는 것을 막는 데는 충분하고, 그 이상을 막는 물건은 아니다.

   검사는 반드시 서버에서 한다. 페이지에서 하면 소스를 열어 건너뛴다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const crypto = require("crypto");

const SALT = "567c8b72ff9e06af58121ceeb9cb940c";
const KEY  = "201b7e8bea65e0201e73cc13f72fc12725b182b0e1f9ae4752613e8221b7dee9";
const N = 1 << 15, R = 8, P = 1;

/* 값이 다를 때 빨리 돌아가면 그 차이로 비밀번호를 더듬을 수 있다.
   timingSafeEqual 은 언제나 같은 시간을 쓴다. */
function ok(pw){
  if (typeof pw !== "string" || !pw || pw.length > 128) return false;
  let got;
  try {
    got = crypto.scryptSync(pw, SALT, 32, {N, r: R, p: P, maxmem: 128 * N * R * 2});
  } catch (e){ return false; }
  const want = Buffer.from(KEY, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* 한 번 맞히면 표를 준다. 매 요청마다 scrypt 를 돌리면 0.2초씩 걸린다.
   서버가 다시 뜨면 표도 사라진다 — 그래도 되는 물건이다. */
const tickets = new Map();                 // token → 만료 시각
const TTL = 6 * 3600 * 1000;               // 수업 한나절

function grant(){
  sweep();
  const t = crypto.randomBytes(24).toString("hex");
  tickets.set(t, Date.now() + TTL);
  return t;
}
function holds(token){
  if (typeof token !== "string" || !token) return false;
  const until = tickets.get(token);
  if (!until) return false;
  if (Date.now() > until){ tickets.delete(token); return false; }
  return true;
}
function sweep(){
  const now = Date.now();
  for (const [t, until] of tickets) if (now > until) tickets.delete(t);
  if (tickets.size > 200) tickets.clear();
}

module.exports = {ok, grant, holds};
