/* ══════════════════════════════════════════════════════════════════════
   한글 퀴즈 — 팀으로 나눠 찢긴 글자를 맞힌다.

   화면에 뜨는 것은 **성한 글씨가 아니다** — 점판을 셋으로 찢어 한 장씩만
   보여 준다. 4초마다 다음 장으로 넘어가고, 셋을 다 돌면 처음 장으로
   되돌아온다. 머릿속에서 세 장을 겹쳐야 글자가 선다.

   한 명이라도 맞히면 그 팀이 득점하고, 정답을 공개한 뒤 다음 문제로 간다.

   여기서 정한 것들:

   · **점수는 시간이다.** 문제가 뜬 뒤 흐른 초를 그대로 받는다. 늦게 맞히면
     많이 받는다 — 빨리 맞히는 경쟁이 아니라, 아무도 못 맞히는 문제가
     비싸지는 판이다. 다만 **글자 수 × 1분**까지만이다.
   · **오답은 20초.** 곱도 없고 깎이는 폭도 늘 같다. 같은 오답을 두 번
     내도 한 번만 깎는다 — 손이 미끄러진 것으로 두 번 벌하지 않는다.
   · **4인팀은 3/4 만 받는다.** 머리가 하나 더 있으니 그만큼 뗀다. 다만
     그 문제의 최고점을 받는 경우에는 떼지 않는다 — 아무도 못 맞혀 꽉
     찬 문제에서까지 벌할 까닭이 없다.
   · 곱은 **배정될 때 4인이었는지**로 굳는다. 도중에 사람이 빠졌다고 곱이
     풀리지는 않는다. 그러지 않으면 한 명이 나가는 것이 이득이 된다.
   · 음수로 내려간다. 0 에서 멈추면 오답이 공짜가 된다.
   · 아무도 못 맞히는 문제는 관리자가 넘긴다. 최고점에 닿으면 더 기다릴
     까닭이 없는데, 그 판단은 교실에 선 사람이 한다.

   이 파일은 소켓도 DB 도 모른다. 넣는 것은 참가와 답, 나오는 것은 순위와
   「지금 보여 줄 낱장 한 장」뿐이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const DOTS = require("./dots.js");
const GLYPHS = require("./glyphs.js");
const {okPin} = require("./room.js");        // 비번 모양은 대국과 같은 규칙이다
const {TAIL} = require("./players.js");      // 팀 이름은 여기서 꾼다

const D = DOTS(GLYPHS);

const MAX_ENTRANTS = 48;
const TEAM = 3;                    // 한 팀은 셋. 남으면 넷이 되는 팀이 생긴다
const MINUTE = 60;                 // 글자 하나당 최고점 (초)
const MISS = 20;                   // 오답 (초)
const CUT = 3 / 4;                 // 4인팀이 받는 몫
const FLIP = 4000;                 // 문제를 푸는 동안 낱장이 바뀌는 참
const WHOLE = 2000;               // 정답 공개 — 성한 글씨를 붉게 세우는 참
const SHOW = 5000;                 // 그 뒤 세 낱장을 0.5초마다 돌리는 참
const QUICK = 500;                 // 공개할 때 낱장이 바뀌는 참
const SAYGAP = 800;                // 한 사람이 답을 낼 수 있는 간격

const shuffle = a => {             // Fisher-Yates
  for (let i = a.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* 19명이면 넷 하나와 셋 다섯, 24명이면 셋 여덟. 셋은 반드시 채운다 */
function split(n){
  const t = Math.floor(n / TEAM);
  if (t < 2) return null;                    // 두 팀은 돼야 겨룬다
  const over = n % TEAM;                     // 그만큼의 팀이 한 명 더 받는다
  const out = [];
  for (let i = 0; i < t; i++) out.push(TEAM + (i < over ? 1 : 0));
  return out;
}

/* 답을 맞춰 보기 전에 다듬는다. 띄어쓰기와 자잘한 것은 눈감아 준다 */
const tidy = s => String(s == null ? "" : s).replace(/\s+/g, "");

class Quiz {
  constructor(code, opt){
    opt = opt || {};
    this.code  = code;
    this.pin   = okPin(opt.pin) ? opt.pin : null;
    this.title = String(opt.title || "한글 퀴즈").slice(0, 40);
    this.state = "open";                     // open(접수) | running | done
    this.made  = Date.now();
    this.began = null;
    this.ended = null;
    this.people = new Map();                 // pid → {pid, name, team}
    this.teams = [];                         // [{id, name, pids, score, full}]
    this.order = D.WORDS;
    this.nth   = -1;                         // 지금 몇 번째 문제인가
    this.ask   = null;                        // {word, seed, sheets, at, page}
    this.reveal = null;                       // {at, word, by, got, from, to}
  }

  /* ─── 접수 ───────────────────────────────────────────────────────── */
  join(person){
    if (this.state !== "open") return {err: "closed"};
    if (this.people.has(person.pid)) return {ok: true, again: true};
    if (this.people.size >= MAX_ENTRANTS) return {err: "full"};
    this.people.set(person.pid, {pid: person.pid, name: person.name, team: null});
    return {ok: true};
  }
  quit(pid){                                 // 시작 전에만 뺄 수 있다
    if (this.state !== "open") return false;
    return this.people.delete(pid);
  }

  /* ─── 팀 짜기 ────────────────────────────────────────────────────── */
  start(now){
    if (this.state !== "open") return {err: "started"};
    const list = shuffle([...this.people.values()]);
    const sizes = split(list.length);
    if (!sizes) return {err: "few"};

    const animals = shuffle(TAIL.slice()).slice(0, sizes.length);
    this.teams = [];
    let k = 0;
    sizes.forEach((size, i) => {
      const pids = [];
      for (let j = 0; j < size; j++){
        const p = list[k++];
        p.team = i;
        pids.push(p.pid);
      }
      this.teams.push({id: i, name: animals[i] + "팀", pids, score: 0,
                       full: size > TEAM});
    });

    this.state = "running";
    this.began = now || Date.now();
    this.next(this.began);
    return {ok: true, teams: this.teams.length, sizes};
  }

  /* ─── 문제 ───────────────────────────────────────────────────────── */
  next(now){
    this.reveal = null;
    this.nth++;
    if (this.nth >= this.order.length){
      this.ask = null;
      this.state = "done"; this.ended = now;
      return false;
    }
    const word = this.order[this.nth];
    const seed = ((now & 0x7fffffff) ^ (this.nth * 2654435761)) >>> 0;
    this.ask = {word, seed, sheets: D.cut(word, seed), at: now, page: 0,
                said: new Map()};            // 팀마다 이미 낸 오답
    return true;
  }
  /* 아무도 못 맞혔다 — 관리자가 넘긴다. 공개는 똑같이 한다 */
  give(now){
    if (this.state !== "running" || !this.ask || this.reveal) return {err: "nothing"};
    this.reveal = {at: now, word: this.ask.word, by: null, got: 0,
                   from: null, to: null};
    return {ok: true};
  }

  /* 그 문제의 최고점 (초) */
  cap(){ return this.ask ? this.ask.word.length * MINUTE : 0; }
  /* 문제가 뜬 뒤 흐른 초 */
  spent(now){ return this.ask ? Math.floor((now - this.ask.at) / 1000) : 0; }

  /* ─── 답 ─────────────────────────────────────────────────────────── */
  /* 맞으면 그 팀이 득점하고 공개로 넘어간다. 틀리면 20초 깎인다 */
  say(pid, text, now){
    if (this.state !== "running") return {err: "notrunning"};
    if (!this.ask || this.reveal) return {err: "wait"};
    const me = this.people.get(pid);
    if (!me || me.team === null) return {err: "stranger"};
    if (now - (me.said || 0) < SAYGAP) return {err: "slow"};
    me.said = now;

    const said = tidy(text);
    if (!said) return {err: "empty"};
    const team = this.teams[me.team];
    const was = this.ranks();

    if (said !== this.ask.word){
      /* 같은 오답을 두 번 내도 한 번만 깎는다 */
      const seen = this.ask.said.get(team.id) || new Set();
      if (seen.has(said)) return {ok: true, right: false, again: true};
      seen.add(said); this.ask.said.set(team.id, seen);
      team.score -= MISS;
      return {ok: true, right: false, lost: MISS, team: team.id};
    }

    const cap = this.cap();
    let got = Math.min(this.spent(now), cap);
    const topped = got >= cap;
    if (team.full && !topped) got = Math.floor(got * CUT);
    team.score += got;

    const nowRanks = this.ranks();
    this.reveal = {at: now, word: this.ask.word, by: team.id, who: me.name,
                   got, topped, from: was[team.id], to: nowRanks[team.id]};
    return {ok: true, right: true, got, team: team.id};
  }

  /* ─── 시계 ───────────────────────────────────────────────────────── */
  /* 낱장을 넘기고, 공개가 끝나면 다음 문제로 간다. 바뀐 것이 있으면 true */
  tick(now){
    if (this.state !== "running") return false;
    if (this.reveal){
      if (now - this.reveal.at < WHOLE + SHOW) return false;
      this.next(now);
      return true;
    }
    if (!this.ask) return false;
    const page = Math.floor((now - this.ask.at) / FLIP) % D.SHEETS;
    if (page === this.ask.page) return false;
    this.ask.page = page;
    return true;
  }

  /* ─── 순위 ───────────────────────────────────────────────────────── */
  /* 팀 id → 등수. 같은 점수는 같은 등수다 */
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
  namesOf(id){
    const t = this.teams[id];
    if (!t) return [];
    return t.pids.map(p => (this.people.get(p) || {}).name).filter(Boolean);
  }
  board(){
    const rank = this.ranks();
    return this.teams.map(t => ({id: t.id, name: t.name, score: t.score,
                                 rank: rank[t.id], full: t.full,
                                 mates: this.namesOf(t.id)}))
                     .sort((a, b) => a.rank - b.rank || a.id - b.id);
  }

  /* ─── 밖으로 내보내는 모습 ───────────────────────────────────────── */
  /* 학생 한 사람이 보는 것. **낱장은 지금 것 한 장만** 나간다 */
  view(pid, now){
    const me = this.people.get(pid);
    if (!me) return null;
    const out = {code: this.code, title: this.title, state: this.state,
                 name: me.name, people: this.people.size,
                 nth: this.nth + 1, total: this.order.length,
                 teams: this.teams.length};
    if (me.team !== null){
      const t = this.teams[me.team];
      out.team = {id: t.id, name: t.name, full: t.full, mates: this.namesOf(t.id)};
    }
    if (this.state === "running" && this.ask && !this.reveal)
      out.ask = {page: this.ask.page, sheet: this.ask.sheets[this.ask.page],
                 len: this.ask.word.length, spent: this.spent(now),
                 cap: this.cap(), flip: FLIP};
    if (this.reveal){
      const r = this.reveal;
      out.reveal = {word: r.word, whole: D.whole(r.word),
                    sheets: this.ask.sheets,
                    by: r.by, team: r.by === null ? null : this.teams[r.by].name,
                    mates: r.by === null ? [] : this.namesOf(r.by),
                    who: r.who || null, got: r.got, topped: !!r.topped,
                    from: r.from, to: r.to,
                    whole_ms: WHOLE, show_ms: SHOW, quick: QUICK,
                    left: Math.max(0, WHOLE + SHOW - (now - r.at))};
    }
    if (this.state !== "open") out.board = this.board();
    return out;
  }
  info(){
    return {code: this.code, title: this.title, state: this.state,
            open: !this.pin, people: this.people.size,
            nth: this.nth + 1, total: this.order.length,
            made: this.made, began: this.began, ended: this.ended};
  }
  /* 관리자만 본다 — 지금 낸 낱말과 참가자 이름까지 */
  full(now){
    return Object.assign(this.info(), {
      pin: this.pin,
      word: this.ask && !this.reveal ? this.ask.word : null,
      spent: this.ask && !this.reveal ? this.spent(now || Date.now()) : null,
      cap: this.cap(),
      revealing: !!this.reveal,
      entrants: [...this.people.values()].map(p => ({name: p.name, team: p.team})),
      board: this.state === "open" ? [] : this.board(),
    });
  }
}

module.exports = {Quiz, split, tidy, MAX_ENTRANTS, MINUTE, MISS, CUT,
                  FLIP, WHOLE, SHOW, QUICK, TEAM};
