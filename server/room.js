/* ══════════════════════════════════════════════════════════════════════
   대국 — 한 판의 심판이자, 두 사람이 계속 머무는 자리.

   규칙은 한 벌뿐이다. 클라이언트가 쓰는 그 engine.js 를 그대로 require 해서
   서버가 직접 판을 굴린다. 그래서 "클라이언트가 보낸 수"는 제안일 뿐이고,
   진실은 언제나 이쪽 pos 다.

   한 판이 끝나도 대국은 닫히지 않는다. 둘이 남아 있으면 다시 두면 되고,
   자리를 뜨는 것은 나가기를 눌렀을 때뿐이다.

   이 파일은 소켓을 모른다. 넣는 것은 수와 자리, 나오는 것은 사실뿐이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const EG = require("../shared/engine.js")();
const players = require("./players.js");

/* 한 수 30초 — 로컬 대국과 같은 규칙. 시험할 때만 MOVE_MS 로 늘린다. */
const LIMIT_MS = +(process.env.MOVE_MS || 30000);
/* 끊긴 사람을 이만큼 기다린다. 그 안에 돌아오면 판은 그대로다. */
const GRACE_MS = +(process.env.GRACE_MS || 45000);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // 헷갈리는 I O 0 1 은 뺀다

function newCode(taken){
  for (;;){
    let s = "";
    for (let i = 0; i < 4; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
    if (!taken(s)) return s;
  }
}
const newToken = () =>
  Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

const okPin = p => typeof p === "string" && /^[0-9]{4}$/.test(p);

class Room {
  constructor(code, opt){
    opt = opt || {};
    this.code   = code;
    this.open   = opt.open !== false;         // 기본은 공개
    this.pin    = this.open ? null : (okPin(opt.pin) ? opt.pin : null);
    this.seats  = [null, null];               // 소켓
    this.people = [null, null];               // 그 자리의 사람 (players.js 레코드)
    this.tokens = [null, null];               // 자리표 — 새로고침하면 이걸로 돌아온다
    this.first  = 0;                          // 이번 판 선공. 판마다 넘어간다
    this.touched = Date.now();
    this.timer  = null;
    this.grace  = [null, null];
    this.onEvent = null;                      // 방 밖으로 알릴 일이 생겼을 때
    this.cup = null;                          // 대회 대국이면 {code, match}
    this.only = null;                         // 대회 대국은 정해진 둘만 앉는다
    this.reset();
  }

  /* ─── 맡기기 · 되살리기 ──────────────────────────────────────────── */
  /* 대회 대국만 맡긴다. 판 · 차례 · 같은 국면 횟수 · 자리표를 적어 두고,
     연결(소켓)과 시계는 적지 않는다 — 서버가 다시 뜨면 아무도 앉아 있지 않으니
     시계는 서 있고, 둘이 다시 앉는 순간 그 수의 시간이 새로 흐른다. 서버가 넘어진
     것은 두는 사람 잘못이 아니다. 연습 참가자 자리만 따로 표시해 두었다가
     되살린 쪽에서 다시 앉힌다. */
  snapshot(){
    return {v: 1, code: this.code, open: this.open, pin: this.pin,
            tokens: this.tokens, first: this.first, ply: this.ply,
            /* 판은 Int8Array 다. JSON 에 그대로 넣으면 {"0":..} 객체가 되어
               길이도 없고 Array.from 이 빈 배열을 낸다 — 배열로 풀어 둔다 */
            pos: {b: Array.from(this.pos.b), turn: this.pos.turn,
                  hand: this.pos.hand.map(h => Array.from(h))},
            seen: [...this.seen], over: this.over, rematch: this.rematch,
            startedAt: this.startedAt, saved: this.saved, cup: this.cup, only: this.only,
            people: this.people.map(p => p && {pid: p.pid, name: p.name}),
            bots: this.seats.map(ws => !!(ws && ws.bot))};
  }
  static revive(d){
    const r = new Room(d.code, {open: d.open, pin: d.pin});
    r.tokens = d.tokens || [null, null];
    r.first = d.first; r.ply = d.ply;
    const fresh = EG.fresh();                  // 판과 손패의 형은 엔진이 쓰는 그대로
    r.pos = {b: fresh.b.constructor.from(d.pos.b), turn: d.pos.turn,
             hand: d.pos.hand.map((h, i) => fresh.hand[i].constructor.from(h))};
    r.seen = new Map(d.seen || []);
    r.over = d.over || null; r.rematch = d.rematch || [false, false];
    r.startedAt = d.startedAt; r.saved = !!d.saved;
    r.cup = d.cup || null; r.only = d.only || null;
    /* 이름은 대회에 들어갈 때 굳은 것을 그대로 쓴다 */
    r.people = (d.people || [null, null]).map(p => {
      if (!p) return null;
      const rec = players.get(p.pid);
      if (p.name) rec.name = p.name;
      return rec;
    });
    r.bots = d.bots || [false, false];
    return r;
  }
  /* 사람이 비운 자리를 잠시 붙들어 둔다. 돌아오지 않으면 끝낸다 —
     연결이 끊겼을 때(drop)와 서버가 다시 떴을 때 같은 규칙을 쓴다. */
  hold(s){
    if (this.over || this.grace[s]) return;
    this.grace[s] = setTimeout(() => {
      this.grace[s] = null;
      if (this.seats[s] || this.over) return;
      if (this.cup) this.finish(1 - s, "gone");
      else this.finish(null, "gone", s);
      this.tokens[s] = null; this.people[s] = null;
      if (this.onEvent) this.onEvent(this, "over");
    }, GRACE_MS);
    if (this.grace[s].unref) this.grace[s].unref();
  }

  /* ─── 판 ─── */
  reset(){
    const p = EG.fresh();
    p.turn = this.first;
    this.pos = p;
    this.ply = 0;
    this.seen = new Map([[EG.hash(p), 1]]);
    this.over = null;                         // {winner: 0|1|null, why}
    this.deadline = 0;
    this.rematch = [false, false];
    this.startedAt = Date.now();
    this.saved = false;
    this.syncClock();
  }

  /* ─── 시계 ───────────────────────────────────────────────────────────
     둘이 앉기 전에는 돌지 않는다. 혼자 기다리는 사람의 시간을 깎을 이유가
     없다. 한쪽이 끊겨도 멈춘다 — 네트워크는 사람 잘못이 아니다. */
  syncClock(){
    if (!this.ready || this.over) return this.stopClock();
    if (!this.timer) this.startClock();
  }
  startClock(){
    this.stopClock();
    if (!this.ready || this.over) return;
    this.deadline = Date.now() + LIMIT_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.over || !this.ready) return;
      this.finish(1 - this.pos.turn, "time");
      if (this.onEvent) this.onEvent(this, "over");
    }, LIMIT_MS);
    if (this.timer.unref) this.timer.unref();
  }
  stopClock(){
    if (this.timer){ clearTimeout(this.timer); this.timer = null; }
    this.deadline = 0;
  }
  left(){ return (this.over || !this.timer) ? 0 : Math.max(0, this.deadline - Date.now()); }

  /* ─── 판을 끝낸다 ─── */
  finish(winner, why, who){
    if (this.over) return;
    this.over = {winner, why};
    if (who !== undefined) this.over.who = who;
    this.stopClock();
    this.settleStreaks();
  }
  /* 연승을 정리한다. 끊겨서 끝난 판은 진 것으로 치지 않는다. */
  settleStreaks(){
    const {winner, why} = this.over;
    if (why === "gone")
      return players.settle(this.people[this.over.who], null, true);
    if (winner === null)
      return this.people.forEach(p => players.settle(p, "draw", false));
    players.settle(this.people[winner], "win", false);
    players.settle(this.people[1 - winner], "loss", false);
  }

  /* ─── 자리 ─── */
  seat(ws, person, token){
    this.touched = Date.now();
    if (token){                               // 새로고침 — 쓰던 자리로 돌려보낸다
      const s = this.tokens.indexOf(token);
      if (s >= 0){
        if (this.seats[s] && this.seats[s] !== ws) return {err: "taken"};
        this.clearGrace(s);
        this.seats[s] = ws; this.people[s] = person;
        this.syncClock();
        return {side: s, token: token};
      }
    }
    /* 대회는 자리가 정해져 있다. m.a 가 선공, m.b 가 후공이다 —
       먼저 들어온 순서로 정하면 무승부 보정(선공 승)이 운에 좌우된다. */
    const s = this.only ? this.only.indexOf(person.pid) : this.seats.indexOf(null);
    if (s < 0) return {err: "full"};
    /* 대회 자리는 자리표가 아니라 사람(pid)에 묶여 있다. 끊겼다 돌아온 그 사람이면
       자리표가 없어도 제자리다. 전에는 「끊긴 사람을 기다리는 중」이라며 바로 그
       사람을 돌려보냈고, 기다림이 끝나면 몰수패가 났다. 서버가 옛 연결이 죽은
       것을 아직 모르면(와이파이가 끊겼다 붙은 경우) 새 연결이 자리를 넘겨받는다. */
    if (this.only){
      const old = this.seats[s];
      this.clearGrace(s);
      this.seats[s] = ws; this.people[s] = person;
      if (!this.tokens[s]) this.tokens[s] = newToken();
      this.syncClock();
      return {side: s, token: this.tokens[s], bumped: old && old !== ws ? old : null};
    }
    if (this.seats[s] && this.seats[s] !== ws) return {err: "taken"};
    if (this.grace[s]) return {err: "held"};  // 끊긴 사람을 아직 기다리는 중이다
    this.seats[s]  = ws;
    this.people[s] = person;
    this.tokens[s] = newToken();
    this.syncClock();
    return {side: s, token: this.tokens[s]};
  }

  /* 소켓이 끊겼다. 패로 치지 않고 잠시 기다린다.
     대회는 다르다 — 단판제라 승자가 안 나오면 대진표가 멈춘다. 돌아오지
     않으면 몰수패다. 한 수도 두기 전이어도 그렇다. */
  drop(ws){
    const s = this.seats.indexOf(ws);
    if (s < 0) return -1;
    this.seats[s] = null;
    this.touched = Date.now();
    this.stopClock();
    if (!this.over && (this.ply > 0 || this.cup)){
      this.hold(s);
    } else {
      this.tokens[s] = null; this.people[s] = null;
    }
    return s;
  }
  clearGrace(s){ if (this.grace[s]){ clearTimeout(this.grace[s]); this.grace[s] = null; } }

  /* 나가기 버튼. 두던 중이면 진 것으로 친다.
     대회에서는 첫 수 전에 나가도 기권패다. 빈자리로 둘 수 없다. */
  leave(ws){
    const s = this.seats.indexOf(ws);
    if (s < 0) return -1;
    if (!this.over && (this.ply > 0 || this.cup)) this.finish(1 - s, "leave");
    this.clearGrace(s);
    this.seats[s] = null; this.tokens[s] = null; this.people[s] = null;
    this.stopClock();
    this.touched = Date.now();
    return s;
  }

  get empty(){ return !this.seats[0] && !this.seats[1] && !this.grace[0] && !this.grace[1]; }
  get ready(){ return !!this.seats[0] && !!this.seats[1]; }

  /* ─── 수 ─── */
  play(side, m, ply){
    this.touched = Date.now();
    if (this.over)              return {err: "over"};
    if (!this.ready)            return {err: "waiting"};
    if (this.pos.turn !== side) return {err: "turn"};
    if (ply !== this.ply)       return {err: "stale"};
    if (!Number.isInteger(m))   return {err: "bad"};
    if (!EG.gen(this.pos).includes(m)) return {err: "illegal"};

    const cap = EG.cap(m);
    EG.make(this.pos, m);
    this.ply++;

    if (EG.decisive(this.pos, m, cap)){
      this.finish(side, cap === EG.L ? "catch" : "try");
    } else {
      const k = EG.hash(this.pos), n = (this.seen.get(k) || 0) + 1;
      this.seen.set(k, n);
      if (n >= 3) this.finish(null, "repeat");
      else if (EG.gen(this.pos).length === 0) this.finish(1 - this.pos.turn, "stuck");
      else this.startClock();
    }
    return {ok: true, m: m, ply: this.ply, over: this.over, left: this.left()};
  }

  /* 양쪽이 모두 누르면 다시 시작한다. 선공은 판마다 넘어간다 */
  wantRematch(side){
    if (!this.over) return false;
    this.rematch[side] = true;
    if (!this.rematch[0] || !this.rematch[1]) return false;
    this.first = 1 - this.first;
    this.reset();
    return true;
  }

  /* 대국 안에서 보는 사실 */
  state(){
    return {
      b: Array.from(this.pos.b),
      hand: [this.pos.hand[0].slice(), this.pos.hand[1].slice()],
      turn: this.pos.turn, ply: this.ply, first: this.first,
      left: this.left(), ready: this.ready, over: this.over,
      people: this.people.map(players.view),
      code: this.code, open: this.open,
    };
  }

  /* 대회가 읽는 결과. 무승부는 선공 승이다 — 이 게임은 후수 필승이라
     그 불리함을 조금이나마 갚아 주는 규칙이다. */
  cupResult(){
    if (!this.over) return null;
    const {winner, why} = this.over;
    return {winner: winner === null ? this.first : winner, why,
            drawn: winner === null};
  }

  /* 대국 목록에서 보는 사실 */
  info(){
    return {code: this.code, open: this.open,
            state: this.ready ? "playing" : "waiting",
            people: this.people.filter(Boolean).map(players.view)};
  }
}

module.exports = {Room, newCode, okPin, LIMIT_MS, GRACE_MS, EG};
