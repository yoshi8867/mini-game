/* ══════════════════════════════════════════════════════════════════════
   돌림판 비딩 — 기댓값이 다른 룰렛을 경매로 사 모은다.

   조마다 대표 한 명만 값을 부른다. 나머지는 관전이다. 실제 상의는 화면
   밖에서 시끄럽게 벌어질 것이고, 그것이 이 수업의 알맹이다. 화면은 값을
   받아 적고 시간을 재는 일만 한다.

   한 판의 모양 — 작전타임 3분, 경매 여섯. 그것을 세 번 돌면 열여덟 품목이
   끝난다. 쉼 없이 열여덟을 내리 부치면 조가 상의할 틈이 없다.

   여기서 정한 것들:

   · **선(先)이 없다.** 모두가 같은 순간에 부른다. 서버에 먼저 닿은 것이
     먼저다. 값은 늘 마지막 값보다 **1 이상** 높아야 한다.
   · **마감은 한 가지 규칙이다 — 10초 동안 조용하면 끝.** 값이 들어올
     때마다 10초가 되살아난다. 마지막 1초를 노리는 것이 이기는 수가 되면
     경매가 아니라 반사신경 겨루기가 된다.
     다만 품목이 뜨자마자 끝나지는 않게 **최소 노출**(기본 20초)을 두고,
     아무리 뜨거워도 **3분**을 넘기지 않는다.
   · **자기 호가에 자기가 또 올리지 못한다.** 실제 경매의 규칙이고,
     버튼을 두 번 눌러 제 값을 제가 올리는 사고도 이것으로 막힌다.
   · **받기 싫은 룰렛은 비밀 입찰이다.** 남이 얼마를 냈는지 모르는 채로
     1 이상을 적어 낸다. **가장 낮게 적은 팀이 그 룰렛을 받는다.** 같은
     값이 여럿이면 **늦게 낸 팀**이 받는다 — 머뭇거린 쪽이 떠안는다.
     받는 팀은 **토큰을 한 개도 쓰지 않고**, 나머지 팀은 적어 낸 만큼
     **그대로 잃는다**. 누구에게도 가지 않고 사라진다.
     높게 적으면 확실히 피하지만 비싸고, 낮게 적으면 싸지만 떠안는다.
   · **안 낸 팀은 1 을 적은 것으로 본다.** 가장 낮은 값이고 가장 늦은 셈이니,
     손을 놓고 있으면 그 룰렛은 그 팀에게 간다.
   · 비밀 입찰에는 되살아나는 10초가 없다. 남의 값을 모르니 되받아칠 것도
     없다. 정해진 시간을 주고, 모든 팀이 내면 그 자리에서 연다.
   · **남은 토큰은 점수가 아니다.** 아껴 봐야 종이다. 끝까지 뜨겁게.
   · 스물넷 중 열여덟만 나온다. 무엇이 안 나올지는 아무도 모른다. 그래서
     「저건 나중에 사면 되지」가 통하지 않는다.
   · 비딩이 끝나면 돌린다. 모든 팀의 1번 룰렛을 **한꺼번에**, 그다음 2번.
     혼자 돌리면 자기 운만 보이고, 같이 돌려야 남의 운이 보인다.

   이 파일은 소켓도 DB 도 모른다. 넣는 것은 참가와 호가, 나오는 것은
   지금 걸린 품목과 순위판뿐이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const {WHEELS, byId, spin} = require("./wheels.js");
const {okPin} = require("./room.js");        // 비번 모양은 대국과 같은 규칙이다
const {TAIL} = require("./players.js");      // 팀 이름은 여기서 꾼다

const MAX_ENTRANTS = 48;
const TOKENS = 30;                 // 팀마다 처음 쥐는 토큰
const LOTS   = 18;                 // 스물넷 중 경매에 나오는 수
const BLOCK  = 6;                  // 작전타임 한 번에 경매 몇 개
const PLAN   = 180000;             // 작전타임 (3분)
const SECS   = 20;                 // 최소 노출 — 아무 일 없어도 이만큼은 보여 준다
const MINSECS = 10, MAXSECS = 120;
const QUIET  = 10000;              // 이만큼 조용하면 마감된다 (올려 부르는 경매)
const SEAL   = 30000;              // 비밀 입찰에 주는 시간. 다 내면 그 자리에서 연다
const CAPMS  = 180000;             // 한 품목의 끝. 연장이 끝없이 늘지 않게
const SHOW   = 3000;               // 낙찰을 보여 주는 참
const OPEN   = 15000;              // 비밀 입찰을 열어 둔 채 두는 참 —
                                   // 누가 얼마를 적었는지 읽을 시간은 줘야 한다
const SPIN   = 5000;               // 룰렛 한 바퀴

const shuffle = a => {             // Fisher-Yates
  for (let i = a.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

class Bid {
  constructor(code, opt){
    opt = opt || {};
    this.code  = code;
    this.pin   = okPin(opt.pin) ? opt.pin : null;
    this.title = String(opt.title || "돌림판 비딩").slice(0, 40);
    this.secs  = Math.min(MAXSECS, Math.max(MINSECS, (opt.secs | 0) || SECS));
    this.plan  = opt.plan === 0 ? 0 : (opt.plan | 0) || PLAN;
    this.state = "open";               // open | plan | running | spin | done
    this.made  = Date.now();
    this.began = null;
    this.ended = null;
    this.people = new Map();           // pid → {pid, name, team}
    this.teams = [];                   // [{id, name, pid, tokens, won, score}]
    this.order = [];                   // 경매에 나올 룰렛 id 18개
    this.sold  = {};                   // 룰렛 id → 가져간 팀 id (유찰이면 null)
    this.paid  = {};                   // 룰렛 id → 얼마에 넘어갔나
    this.nth   = -1;                   // 지금 몇 번째 품목인가
    this.lot   = null;
    this.planAt = 0;
    this.round = -1;                   // 돌리는 차례
    this.spins = [];                   // [[{team, wheel, cells, at, got}]]
    this.spinAt = 0;
  }

  /* ─── 접수 ───────────────────────────────────────────────────────── */
  /* rep 이면 팀을 하나 차지한다. 아니면 구경만 한다 */
  join(person, rep){
    const back = this.people.get(person.pid);
    if (back){
      if (rep && back.team === null){
        if (this.state !== "open") return {err: "closed"};
        this.seat(back);
      }
      return {ok: true, again: true};
    }
    if (this.people.size >= MAX_ENTRANTS) return {err: "full"};
    const me = {pid: person.pid, name: person.name, team: null};
    if (rep){
      if (this.state !== "open") return {err: "closed"};
      this.people.set(person.pid, me);
      this.seat(me);
      return {ok: true};
    }
    this.people.set(person.pid, me);
    return {ok: true};
  }
  seat(me){
    const used = this.teams.map(t => t.name);
    const pool = TAIL.filter(n => used.indexOf(n + "팀") < 0);
    const name = (pool.length ? pool[(Math.random() * pool.length) | 0]
                              : "제" + (this.teams.length + 1)) + "팀";
    me.team = this.teams.length;
    this.teams.push({id: me.team, name, pid: me.pid, tokens: TOKENS,
                     won: [], score: 0, spent: 0, burned: 0});
  }
  quit(pid){                           // 시작 전에만 뺄 수 있다
    if (this.state !== "open") return false;
    const me = this.people.get(pid);
    if (!me) return false;
    this.people.delete(pid);
    if (me.team === null) return true;
    this.teams.splice(me.team, 1);      // 번호를 다시 매긴다
    this.teams.forEach((t, i) => { t.id = i; this.people.get(t.pid).team = i; });
    return true;
  }
  teamOf(pid){
    const me = this.people.get(pid);
    return me && me.team !== null ? this.teams[me.team] : null;
  }

  /* ─── 시작 ───────────────────────────────────────────────────────── */
  start(now){
    if (this.state !== "open") return {err: "started"};
    if (this.teams.length < 2) return {err: "few"};
    now = now || Date.now();
    this.order = shuffle(WHEELS.map(w => w.id)).slice(0, LOTS);
    this.began = now;
    this.rest(now);                    // 첫 묶음 앞에도 작전타임이 있다
    return {ok: true, teams: this.teams.length, lots: this.order.length};
  }
  /* 작전타임. 0분으로 열었으면 건너뛴다 */
  rest(now){
    if (!this.plan) return this.open(now);
    this.state = "plan"; this.planAt = now; this.lot = null;
  }
  /* 작전타임을 끊고 바로 경매로 — 관리자가 누른다 */
  go(now){
    if (this.state !== "plan") return {err: "notplan"};
    this.open(now || Date.now());
    return {ok: true};
  }
  open(now){
    this.state = "running";
    this.nth++;
    const w = byId[this.order[this.nth]];
    const span = w.bad ? Math.max(SEAL, this.secs * 1000) : this.secs * 1000;
    this.lot = {wheel: w, bad: w.bad, at: now, ends: now + span,
                price: 0, who: null, seals: new Map(), done: null};
  }
  /* 한 품목이 끝났다. 묶음이 찼으면 쉬고, 다 돌았으면 돌리기로 */
  advance(now){
    if (this.nth + 1 >= this.order.length){
      this.lot = null; this.state = "spin"; this.round = -1;
      return this.turn(now);
    }
    if ((this.nth + 1) % BLOCK === 0) return this.rest(now);
    this.open(now);
  }

  /* ─── 좋은 룰렛 — 올려 부르기 ────────────────────────────────────── */
  bid(pid, amount, now){
    const lot = this.lot;
    if (this.state !== "running" || !lot || lot.done) return {err: "wait"};
    if (lot.bad) return {err: "notup"};
    const team = this.teamOf(pid);
    if (!team) return {err: "watcher"};
    /* 자기 호가에 자기가 올리지 못한다. 손해일 뿐이고, 두 번 눌러 생기는
       사고이기도 하다. 실제 경매에서도 받아 주지 않는다 */
    if (lot.who === team.id) return {err: "yours"};
    const n = amount | 0;
    if (n < lot.price + 1) return {err: "low"};
    if (n > team.tokens) return {err: "broke"};
    lot.price = n; lot.who = team.id;
    this.stretch(lot, now);
    return {ok: true, price: n, team: team.id};
  }

  /* ─── 받기 싫은 룰렛 — 비밀 입찰 ─────────────────────────────────── */
  /* 한 번 내면 못 바꾼다. 값은 마감 전까지 아무에게도 나가지 않는다 */
  seal(pid, amount, now){
    const lot = this.lot;
    if (this.state !== "running" || !lot || lot.done) return {err: "wait"};
    if (!lot.bad) return {err: "notdown"};
    const team = this.teamOf(pid);
    if (!team) return {err: "watcher"};
    if (lot.seals.has(team.id)) return {err: "already"};
    const n = amount | 0;
    if (n < 1) return {err: "min"};
    if (n > team.tokens) return {err: "broke"};

    lot.seals.set(team.id, {n, at: now});
    /* 다 냈으면 더 기다릴 까닭이 없다 */
    if (lot.seals.size >= this.teams.length) this.settle(now);
    return {ok: true, team: team.id};
  }

  /* 값이 들어올 때마다 10초가 되살아난다. 다만 한 품목 3분을 넘기지 않는다 */
  stretch(lot, now){
    if (lot.ends - now >= QUIET) return;
    lot.ends = Math.min(now + QUIET, lot.at + CAPMS);
  }

  /* ─── 마감 ───────────────────────────────────────────────────────── */
  settle(now){
    const lot = this.lot;
    if (!lot || lot.done) return;
    if (!lot.bad){
      if (lot.who === null){                  // 유찰 — 아무도 안 불렀다
        this.sold[lot.wheel.id] = null; this.paid[lot.wheel.id] = 0;
        lot.done = {at: now, team: null, price: 0, why: "none"};
        return;
      }
      const t = this.teams[lot.who];
      t.tokens -= lot.price; t.spent += lot.price;
      t.won.push(lot.wheel.id);
      this.sold[lot.wheel.id] = t.id; this.paid[lot.wheel.id] = lot.price;
      lot.done = {at: now, team: t.id, price: lot.price, why: "sold"};
      return;
    }
    /* 비밀 입찰을 연다. 가장 낮게 적은 팀이 받고, 같으면 늦게 낸 팀이 받는다.
       안 낸 팀은 **1 을 적은 것으로 본다.** 가장 낮은 값이면서 아무 때도 안
       냈으니 가장 늦은 셈이라, 손을 놓고 있으면 그 룰렛이 그 팀에게 간다. */
    const rows = this.teams.map(t => {
      const sealed = lot.seals.get(t.id);
      return {t, n: sealed ? sealed.n : 1, at: sealed ? sealed.at : Infinity,
              sent: !!sealed};
    });
    const min = Math.min(...rows.map(r => r.n));
    let pool = rows.filter(r => r.n === min);
    const late = Math.max(...pool.map(r => r.at));
    pool = pool.filter(r => r.at === late);
    const take = pool[(Math.random() * pool.length) | 0];

    let burned = 0;
    rows.forEach(r => {
      if (r.t.id === take.t.id) return;           // 받는 팀은 한 개도 안 쓴다
      const pay = Math.min(r.n, r.t.tokens);      // 없는 토큰까지 빼지는 않는다
      if (!pay) return;
      r.t.tokens -= pay; r.t.burned += pay; burned += pay;
    });
    take.t.won.push(lot.wheel.id);
    this.sold[lot.wheel.id] = take.t.id; this.paid[lot.wheel.id] = 0;
    lot.done = {at: now, team: take.t.id, price: 0, why: "sealed", burned,
                bids: rows.map(r => ({team: r.t.id, name: r.t.name, n: r.n,
                                      sent: r.sent, took: r.t.id === take.t.id}))
                          .sort((a, b) => a.n - b.n || a.team - b.team)};
  }

  /* 결과를 보여 주는 참. 비밀 입찰은 읽을 것이 많아 길다 */
  showMs(lot){ return lot && lot.bad ? OPEN : SHOW; }

  /* ─── 돌리기 ─────────────────────────────────────────────────────── */
  rounds(){ return this.teams.reduce((m, t) => Math.max(m, t.won.length), 0); }
  /* 다음 차례의 룰렛을 모든 팀이 한꺼번에 돌린다 */
  turn(now){
    this.round++;
    if (this.round >= this.rounds()){
      this.state = "done"; this.ended = now; return false;
    }
    this.spinAt = now;
    this.spins[this.round] = this.teams.map(t => {
      const id = t.won[this.round];
      if (id === undefined) return null;
      const w = byId[id];
      const r = spin(w);
      return {team: t.id, wheel: w.id, cells: w.cells, ev: w.ev,
              at: r.at, got: r.got};
    }).filter(Boolean);
    return true;
  }

  /* ─── 시계 ───────────────────────────────────────────────────────── */
  /* 바뀐 것이 있으면 true. 부르는 쪽에서 다시 그린다 */
  tick(now){
    if (this.state === "plan"){
      if (now - this.planAt < this.plan) return false;
      this.open(now);
      return true;
    }
    if (this.state === "running"){
      const lot = this.lot;
      if (!lot) return false;
      if (lot.done){
        if (now - lot.done.at < this.showMs(lot)) return false;
        this.advance(now);
        return true;
      }
      if (now < lot.ends) return false;
      this.settle(now);
      return true;
    }
    if (this.state === "spin"){
      if (now - this.spinAt < SPIN) return false;
      /* 돌린 값을 이제야 점수에 더한다. 순위는 바퀴가 멎은 뒤에 움직인다 */
      (this.spins[this.round] || []).forEach(s => this.teams[s.team].score += s.got);
      this.turn(now);
      return true;
    }
    return false;
  }

  /* ─── 순위 ───────────────────────────────────────────────────────── */
  ranks(){
    const sorted = this.teams.slice().sort((a, b) => b.score - a.score);
    const out = {};
    let rank = 0, last = null;
    sorted.forEach((t, i) => {
      if (t.score !== last){ rank = i + 1; last = t.score; }
      out[t.id] = rank;
    });
    return out;
  }
  board(){
    const rank = this.ranks();
    return this.teams.map(t => ({
      id: t.id, name: t.name, tokens: t.tokens, score: t.score, rank: rank[t.id],
      won: t.won.map(id => byId[id]).map(w => ({id: w.id, ev: w.ev, bad: w.bad})),
      spent: t.spent, burned: t.burned,
    })).sort((a, b) => a.rank - b.rank || a.id - b.id);
  }
  /* 「경매 현황」 — 스물넷을 통째로. 나간 것, 지금 걸린 것, 아직인 것 */
  sheet(){
    const live = this.lot && !this.lot.done ? this.lot.wheel.id : 0;
    return WHEELS.map(w => {
      const who = this.sold[w.id];
      const at = w.id === live ? "now"
               : (w.id in this.sold) ? "done" : "left";
      return {id: w.id, cells: w.cells, ev: w.ev, bad: w.bad, at,
              team: who === undefined || who === null ? null : who,
              name: who === undefined || who === null ? null : this.teams[who].name,
              price: at === "done" ? (this.paid[w.id] || 0) : null};
    });
  }

  /* ─── 밖으로 내보내는 모습 ───────────────────────────────────────── */
  lotView(now){
    const lot = this.lot;
    if (!lot) return null;
    const w = lot.wheel;
    return {
      nth: this.nth + 1, total: this.order.length,
      block: Math.floor(this.nth / BLOCK) + 1,
      blocks: Math.ceil(this.order.length / BLOCK),
      wheel: {id: w.id, cells: w.cells, ev: w.ev}, bad: lot.bad,
      price: lot.price, who: lot.who,
      whose: lot.who === null ? null : this.teams[lot.who].name,
      left: Math.max(0, lot.ends - now),
      /* 비밀 입찰은 몇 팀이 냈는지만 나간다. 값은 마감 뒤에야 열린다 */
      sent: lot.seals.size, of: this.teams.length,
      done: lot.done && {
        team: lot.done.team,
        name: lot.done.team === null ? null : this.teams[lot.done.team].name,
        price: lot.done.price, why: lot.done.why,
        burned: lot.done.burned || 0,
        bids: lot.done.bids || null,
        show: this.showMs(lot),
        left: Math.max(0, this.showMs(lot) - (now - lot.done.at)),
      },
    };
  }
  view(pid, now){
    const me = this.people.get(pid);
    if (!me) return null;
    const out = {code: this.code, title: this.title, state: this.state,
                 name: me.name, people: this.people.size,
                 teams: this.teams.length, secs: this.secs,
                 nth: this.nth + 1, total: this.order.length,
                 sheet: this.sheet()};
    if (me.team !== null){
      const t = this.teams[me.team];
      out.me = {team: t.id, name: t.name, tokens: t.tokens, won: t.won};
    }
    if (this.state === "plan")
      out.plan = {left: Math.max(0, this.plan - (now - this.planAt)),
                  ms: this.plan,
                  block: Math.floor((this.nth + 1) / BLOCK) + 1,
                  blocks: Math.ceil(this.order.length / BLOCK)};
    if (this.state === "running"){
      out.lot = this.lotView(now);
      /* 내가 낸 값은 나만 본다 */
      if (out.lot && out.lot.bad && me.team !== null && this.lot.seals.has(me.team))
        out.lot.mine = this.lot.seals.get(me.team).n;
    }
    if (this.state === "spin")
      out.spin = {round: this.round + 1, rounds: this.rounds(), ms: SPIN,
                  left: Math.max(0, SPIN - (now - this.spinAt)),
                  rolls: this.spins[this.round] || []};
    if (this.state !== "open") out.board = this.board();
    return out;
  }
  info(){
    return {code: this.code, title: this.title, state: this.state,
            open: !this.pin, people: this.people.size, teams: this.teams.length,
            secs: this.secs, plan: this.plan,
            nth: this.nth + 1, total: this.order.length || LOTS,
            made: this.made, began: this.began, ended: this.ended};
  }
  full(now){
    now = now || Date.now();
    return Object.assign(this.info(), {
      pin: this.pin,
      lot: this.state === "running" ? this.lotView(now) : null,
      planLeft: this.state === "plan"
                ? Math.max(0, this.plan - (now - this.planAt)) : null,
      entrants: [...this.people.values()].map(p => ({name: p.name, team: p.team})),
      board: this.state === "open" ? [] : this.board(),
    });
  }
}

module.exports = {Bid, MAX_ENTRANTS, TOKENS, LOTS, BLOCK, PLAN, SECS,
                  MINSECS, MAXSECS, QUIET, SEAL, CAPMS, SHOW, OPEN, SPIN};
