/* ══════════════════════════════════════════════════════════════════════
   관리자 열쇠.

   비밀번호는 **환경변수 ADMIN_PW 에만** 있다. 저장소에는 해시조차 두지
   않는다.

   전에는 scrypt 해시를 박아 두고 ADMIN_PW 가 없으면 그것을 쓰게 했다.
   해시는 되돌릴 수 없으니 괜찮다고 보았는데, 그 비밀번호가 검사 파일에
   평문으로 같이 올라가 있었다(cup.test.js). 해시를 깨고 말고 할 것도
   없이 읽으면 그만이었다. 비밀을 저장소에 두면 어디로든 샌다 —
   한 군데를 막아도 다른 데로 나온다. 그래서 아예 두지 않기로 한다.

   ADMIN_PW 가 없으면 **아무도 못 들어온다.** 반만 열린 문보다 잠긴
   문이 낫다. 로컬에서는 server/.env 에, Render 에서는 대시보드에 넣는다.

   검사는 반드시 서버에서 한다. 페이지에서 하면 소스를 열어 건너뛴다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const crypto = require("crypto");

/* 값이 다를 때 빨리 돌아가면 그 차이로 비밀번호를 더듬을 수 있다.
   timingSafeEqual 은 언제나 같은 시간을 쓴다. */
function ok(pw){
  if (typeof pw !== "string" || !pw || pw.length > 128) return false;
  const want = process.env.ADMIN_PW;
  if (!want) return false;               // 안 걸어 뒀으면 잠긴 것으로 친다
  const a = Buffer.from(pw), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* 비밀번호를 안 걸어 두면 관리자 화면이 통째로 막힌다. 수업 직전에
   알아차리면 늦으니 뜰 때 한 번 일러 준다. */
if (!process.env.ADMIN_PW)
  console.warn("관리자  ADMIN_PW 가 없다 — 관리자 창구가 잠긴다. " +
               "server/.env 나 Render 대시보드에 넣어라.");

/* 한 번 맞히면 표를 준다.

   표는 서버가 기억하지 않는다. 만료 시각에 서명을 붙여 내주고, 들고 오면
   서명만 다시 맞춰 본다. 전에는 표를 메모리에 두어서 서버가 다시 뜰 때마다
   관리자가 튕겼다 — 판은 살아 있는데 관리자만 들어가지 못하는 꼴이 된다.

   서명 열쇠는 ADMIN_PW 에서 뽑는다. 비밀번호를 바꾸면 그 전에 내준 표는
   모두 죽는다. 그래야 한다. */
const TTL = 6 * 3600 * 1000;               // 수업 한나절

function key(){
  const pw = process.env.ADMIN_PW;
  return pw ? crypto.createHash("sha256").update("ticket:" + pw).digest() : null;
}
function sign(until, k){
  return crypto.createHmac("sha256", k).update(String(until)).digest("hex");
}

function grant(){
  const k = key();
  if (!k) return null;
  const until = Date.now() + TTL;
  return until.toString(36) + "." + sign(until, k);
}
function holds(token){
  if (typeof token !== "string" || token.length > 200) return false;
  const k = key();
  if (!k) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const until = parseInt(token.slice(0, dot), 36);
  if (!Number.isFinite(until) || Date.now() > until) return false;
  const a = Buffer.from(token.slice(dot + 1)), b = Buffer.from(sign(until, k));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {ok, grant, holds};
