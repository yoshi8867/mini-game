/* ══════════════════════════════════════════════════════════════════════
   대회 — 단판 토너먼트.

   여기서 정한 것들:
   · 끊기면 몰수패다. 단판제라 승자가 안 나오면 대회가 멈춘다.
   · 무승부는 선공 승이다. 이 게임은 후수 필승이 증명돼 있어서, 무승부를
     선공에게 주면 그 불리함이 조금이나마 상쇄된다.
   · 나가기는 기권패다.
   · 인원이 2의 거듭제곱이 아니면 부전승으로 채운다. 부전승은 한 대국에
     몰지 않고 고르게 흩는다.
   · 관리자가 시작을 누르는 순간 참가가 마감된다. 지각생은 관전만 한다.

   이 파일은 소켓도 DB 도 모른다. 넣는 것은 참가와 결과, 나오는 것은
   대진표와 "이제 둘 수 있는 대국" 목록뿐이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

const MAX_ENTRANTS = 128;
const {okPin} = require("./room.js");    // 비번 모양은 대국과 같은 규칙이다

/* 그 라운드에 대국이 n 개면 사람은 2n 명이다 */
const roundName = n => n === 1 ? "결승" : n === 2 ? "준결승" : (n * 2) + "강";

function shuffle(a){                       // Fisher-Yates
  for (let i = a.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Tourney {
  constructor(code, opt){
    opt = opt || {};
    this.code  = code;
    this.pin   = okPin(opt.pin) ? opt.pin : null;
    this.title = String(opt.title || "미니쇼기 대회").slice(0, 40);
    this.state = "open";                   // open(접수) | running | done
    this.made  = Date.now();
    this.began = null;
    this.ended = null;
    this.people = new Map();               // pid → {pid, name, out, place}
    this.rounds = [];                      // [[match,...], ...] 0 이 첫 라운드
    this.champion = null;
    this.seq = 0;
  }

  /* ─── 접수 ───────────────────────────────────────────────────────── */
  join(person){
    if (this.state !== "open") return {err: "closed"};
    if (this.people.has(person.pid)) return {ok: true, again: true};
    if (this.people.size >= MAX_ENTRANTS) return {err: "full"};
    this.people.set(person.pid, {pid: person.pid, name: person.name,
                                 out: false, place: null});
    return {ok: true};
  }
  quit(pid){                               // 시작 전에만 뺄 수 있다
    if (this.state !== "open") return false;
    return this.people.delete(pid);
  }

  /* ─── 대진 짜기 ──────────────────────────────────────────────────── */
  start(){
    if (this.state !== "open") return {err: "started"};
    const list = shuffle([...this.people.values()]);
    if (list.length < 2) return {err: "few"};

    const size  = 1 << Math.ceil(Math.log2(list.length));
    const first = size / 2;                // 첫 라운드 대국 수
    const byes  = size - list.length;      // 빈 자리 = 부전승

    /* 부전승을 한 대국에 몰지 않는다. 고르게 흩어야 대진이 한쪽으로 안 쏠린다 */
    const bye = new Array(first).fill(false);
    for (let i = 0; i < byes; i++) bye[Math.floor(i * first / byes)] = true;

    this.rounds = [];
    let n = first;
    while (n >= 1){ this.rounds.push([]); n /= 2; }

    let k = 0;
    for (let s = 0; s < first; s++){
      const a = list[k++] || null;
      const b = bye[s] ? null : (list[k++] || null);
      this.rounds[0].push(this.newMatch(0, s, a && a.pid, b && b.pid));
    }
    for (let r = 1; r < this.rounds.length; r++)
      for (let s = 0; s < first / (1 << r); s++)
        this.rounds[r].push(this.newMatch(r, s, null, null));

    this.state = "running";
    this.began = Date.now();
    this.settleByes();
    return {ok: true, size, byes, rounds: this.rounds.length};
  }

  newMatch(round, slot, a, b){
    return {id: "m" + (++this.seq), round, slot, a: a || null, b: b || null,
            winner: null, why: null, room: null, state: "pending",
            began: null, ended: null};
  }

  /* 부전승은 그 자리에서 올려 보낸다. 사람이 없는 대국을 기다릴 이유가 없다 */
  settleByes(){
    for (const m of this.rounds[0]){
      if (m.state !== "pending") continue;
      if (m.a && !m.b) this.decide(m, m.a, "bye");
      else if (!m.a && m.b) this.decide(m, m.b, "bye");
    }
  }

  /* ─── 결과 ───────────────────────────────────────────────────────── */
  /* why: catch try time repeat stuck gone leave bye */
  report(id, winner, why){
    const m = this.find(id);
    if (!m) return {err: "nomatch"};
    if (m.state === "done") return {err: "done"};
    if (winner !== m.a && winner !== m.b) return {err: "stranger"};
    this.decide(m, winner, why || "?");
    return {ok: true};
  }
  decide(m, winner, why){
    m.winner = winner; m.why = why; m.state = "done"; m.ended = Date.now();
    const loser = winner === m.a ? m.b : m.a;
    if (loser){
      const p = this.people.get(loser);
      if (p){ p.out = true; p.place = this.placeOf(m.round); p.beatenBy = winner; }
    }
    const up = this.rounds[m.round + 1];
    if (!up){                              // 결승이었다
      this.champion = winner;
      const c = this.people.get(winner);
      if (c) c.place = 1;
      this.state = "done"; this.ended = Date.now();
      return;
    }
    const parent = up[m.slot >> 1];
    if (m.slot % 2 === 0) parent.a = winner; else parent.b = winner;
  }
  /* 그 라운드에서 진 사람의 등수 — 8강 탈락이면 공동 5위다 */
  placeOf(round){
    const left = this.rounds.length - round - 1;   // 그 위로 남은 라운드 수
    return (1 << left) + 1;
  }

  /* 이제 둘 수 있는 대국 — 둘 다 정해졌고 아직 안 시작한 것 */
  ready(){
    const out = [];
    for (const rd of this.rounds) for (const m of rd)
      if (m.state === "pending" && m.a && m.b) out.push(m);
    return out;
  }
  find(id){
    for (const rd of this.rounds) for (const m of rd) if (m.id === id) return m;
    return null;
  }
  /* 그 사람이 지금 걸려 있는 대국 */
  matchOf(pid){
    for (const rd of this.rounds) for (const m of rd)
      if (m.state !== "done" && (m.a === pid || m.b === pid)) return m;
    return null;
  }
  /* 관전 기본값 — 진 사람은 자기를 꺾은 사람의 대국, 이긴 사람은 다음 상대를
     가릴 대국. 둘 다 없으면 null 이고, 그때는 대진표를 띄운다. */
  watchFor(pid){
    const me = this.people.get(pid);
    if (!me) return null;
    if (me.out){
      let who = me.beatenBy;
      for (let i = 0; i < 8 && who; i++){       // 나를 꺾은 사람도 이미 졌으면 그 위로
        const m = this.matchOf(who);
        if (m && m.state === "playing") return m;
        const p = this.people.get(who);
        if (!p || !p.out) return null;
        who = p.beatenBy;
      }
      return null;
    }
    const mine = this.matchOf(pid);
    if (!mine) return null;
    const need = mine.a === pid ? "b" : "a";
    if (mine[need]) return null;                // 상대가 이미 정해졌다
    const down = this.rounds[mine.round - 1];
    if (!down) return null;
    const feeder = down[mine.slot * 2 + (need === "a" ? 0 : 1)];
    return feeder && feeder.state === "playing" ? feeder : null;
  }

  /* ─── 밖으로 내보내는 모습 ───────────────────────────────────────── */
  nameOf(pid){ const p = this.people.get(pid); return p ? p.name : null; }
  board(){
    return this.rounds.map((rd, r) => ({
      round: r, name: roundName(rd.length),
      matches: rd.map(m => ({
        id: m.id, slot: m.slot, state: m.state, why: m.why, room: m.room,
        a: m.a && {pid: m.a, name: this.nameOf(m.a)},
        b: m.b && {pid: m.b, name: this.nameOf(m.b)},
        winner: m.winner,
      })),
    }));
  }
  info(){
    const counts = {pending: 0, playing: 0, done: 0};
    for (const rd of this.rounds) for (const m of rd) counts[m.state]++;
    return {code: this.code, title: this.title, state: this.state,
            open: !this.pin, people: this.people.size,
            rounds: this.rounds.length, counts,
            champion: this.champion && this.nameOf(this.champion),
            made: this.made, began: this.began, ended: this.ended};
  }
  /* 관리자만 본다 — 참가자 이름까지 */
  full(){
    return Object.assign(this.info(), {
      pin: this.pin,
      entrants: [...this.people.values()].map(p => ({
        name: p.name, out: p.out, place: p.place})),
      board: this.board(),
    });
  }
}

module.exports = {Tourney, okPin, roundName, shuffle, MAX_ENTRANTS};
