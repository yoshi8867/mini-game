/* ══════════════════════════════════════════════════════════════════════
   HTTP 창구.

   이 파일은 대회도 대국도 모른다. 문을 열어 주고, 들어온 말이 말이 되는지
   보고, 안쪽에 넘길 뿐이다. 안쪽 일은 index.js 가 준 손잡이(hooks)로 부른다.

   GET  /healthz  깨우기용. 무료 인스턴스는 15분이면 잠든다
   GET  /stats    얼마나 뒀는지 집계
   POST /local    브라우저가 혼자 둔 판의 결과
   POST /admin/*  관리자
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const http = require("http");

/* 오프라인 판은 브라우저가 보내온다. 페이지는 github.io, 서버는 onrender.com
   이라 남남이다 — 문을 열어 둔다. 남기는 것은 결과 숫자뿐이라 숨길 것이 없다. */
function cors(res){
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-max-age", "86400");
}

/* 본문은 바이트로 모았다가 한 번에 읽는다. 글자로 이어 붙이면 한글 한 자가
   덩이 두 개에 걸칠 때 깨진다. */
function readBody(req, limit, then){
  const bits = [];
  let n = 0;
  req.on("data", c => {
    n += c.length;
    if (n > limit){ bits.length = 0; return req.destroy(); }
    bits.push(c);
  });
  req.on("end", () => {
    let o = null;
    try { o = JSON.parse(Buffer.concat(bits).toString("utf8") || "{}"); }
    catch (e) {}
    then(o);
  });
}

/* 아무나 부를 수 있는 창구다. 한 곳에서 쏟아붓지 못하게 막아 둔다 */
const RATE = new Map();                  // key → {n, until}
const RATE_MAX = 60, RATE_WINDOW = 10 * 60 * 1000;
function tooMany(key, max){
  const now = Date.now();
  let r = RATE.get(key);
  if (!r || now > r.until){ r = {n: 0, until: now + RATE_WINDOW}; RATE.set(key, r); }
  if (RATE.size > 5000) RATE.clear();    // 무료 인스턴스다. 무한정 쌓지 않는다
  return ++r.n > (max || RATE_MAX);
}
const clientIP = req =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  (req.socket.remoteAddress || "?");

const WHYS = ["catch", "try", "repeat", "stuck", "time", "resign"];
/* 브라우저 말은 그대로 믿지 않는다. 모양이 맞는 것만 통과시킨다 */
function cleanLocal(o){
  if (!o || typeof o !== "object") return null;
  const mode = o.mode === "ai" ? "ai" : o.mode === "duo" ? "duo" : null;
  if (!mode) return null;
  if (WHYS.indexOf(o.why) < 0) return null;
  const plies = o.plies | 0;
  if (plies < 0 || plies > 500) return null;
  const winner = o.winner === 0 || o.winner === 1 ? o.winner : null;
  const first  = o.first === 1 ? 1 : 0;
  /* 3수 이하의 시간초과는 대국이 아니다. 열어만 두고 자리를 뜬 화면이다 */
  if (o.why === "time" && plies <= 3) return null;
  const now = Date.now();
  let started = +o.startedAt;
  if (!Number.isFinite(started) || started > now || now - started > 24 * 3600 * 1000)
    started = now;
  return {code: "LOCAL", mode, first, winner, why: o.why, plies, startedAt: started,
          aiSide: mode === "ai" ? 1 : null};
}

/* hooks: {db, snapshot(), admin(what, msg, done, ip)} */
function create(hooks){
  const STARTED = Date.now();

  return http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    cors(res);
    if (req.method === "OPTIONS"){ res.writeHead(204); return res.end(); }

    const done = (code, body) => {
      res.writeHead(code, {"content-type": "application/json; charset=utf-8",
                           "cache-control": "no-store"});
      res.end(JSON.stringify(body));
    };
    const db = hooks.db;

    if (url === "/healthz"){
      const base = Object.assign(
        {ok: true, uptime: Math.round((Date.now() - STARTED) / 1000)},
        hooks.snapshot(),
        {db: db.enabled() ? "on" : "off", node: process.version});
      /* DB 가 잠들어 있으면 응답이 늦다. healthz 는 깨우는 용도라 안 기다린다 */
      if (!db.enabled()) return done(200, base);
      let sent = false;
      const once = extra => { if (!sent){ sent = true; done(200, Object.assign(base, extra)); } };
      const t = setTimeout(() => once({games: null}), 1500);
      db.count().then(n => { clearTimeout(t); once({games: n}); })
                .catch(() => { clearTimeout(t); once({games: null}); });
      return;
    }

    if (url === "/stats"){
      if (!db.enabled()) return done(503, {ok: false, why: "db off"});
      return db.stats().then(s =>
        done(s ? 200 : 503, s ? Object.assign({ok: true}, s)
                              : {ok: false, why: "db error"}));
    }

    if (url === "/local"){
      if (req.method !== "POST") return done(405, {ok: false, why: "post only"});
      if (tooMany("local:" + clientIP(req))) return done(429, {ok: false, why: "too many"});
      /* 결과 한 줄이 그리 클 리 없다 */
      return readBody(req, 2000, o => {
        const g = cleanLocal(o);
        if (!g) return done(400, {ok: false, why: "bad"});
        /* 기다리게 하지 않는다. 브라우저는 이미 다음 판을 놓고 있다 */
        done(202, {ok: true});
        db.saveGame(g).catch(() => {});
      });
    }

    /* 검사는 서버에서 한다. 페이지에서 하면 소스를 열어 건너뛴다 */
    if (url.slice(0, 7) === "/admin/"){
      if (req.method !== "POST") return done(405, {ok: false, why: "post only"});
      return readBody(req, 4000, m => {
        if (!m || typeof m !== "object") return done(400, {ok: false, why: "bad"});
        hooks.admin(url.slice(7), m, done, clientIP(req));
      });
    }

    if (url === "/"){
      res.writeHead(200, {"content-type": "text/plain; charset=utf-8"});
      return res.end("미니쇼기 온라인 서버입니다. 대국은 웹 페이지에서 엽니다.\n");
    }
    res.writeHead(404, {"content-type": "text/plain; charset=utf-8"});
    res.end("없는 주소입니다\n");
  });
}

module.exports = {create, tooMany, cleanLocal};
