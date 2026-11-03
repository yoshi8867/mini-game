/* ══════════════════════════════════════════════════════════════════════
   타자 올림픽 — 여섯 팀이 네 종목을 겨룬다.

   1. 단어 개인전     조(어휘)를 골라 조 안에서 겨룬다. 두 게임, 게임마다 조별 금은동
   2. 문장 팀전       팀 대 팀. 인용문을 먼저 친 사람이 갖는다
   3. 문장 편집 팀전  팀 대 팀. 문장을 정답대로 고쳐 Enter
   4. 표 편집 팀전    팀 대 팀. 각자 자기 표를 정답 표처럼 고친다

   여기서 정한 것들:

   · **모두 시간제다.** 끝난 문제 자리에는 새 문제가 들어와 바닥나지 않는다.
     후반(제한 시간의 절반 뒤)에 새로 나오는 문제는 10·20·30 이 아니라
     30·40·50 점이다.
   · **팀전 대진은 판마다 그때 짠다.** 먼저 같은 종목에서 만난 팀과 바로 앞
     판에서 만난 팀은 피하고(1번), 그 안에서 실력이 비슷한 팀끼리 붙인다(2번).
     실력은 그 종목에서 지금까지 낸 팀 점수, 종목 첫 판이면 앞 종목 순위다.
   · 지고 있는 팀의 가장 약한 학생(1종목 타수)에게만 가끔 ×2 문제가 간다.
   · 인원이 적은 팀은 비례 가점을 받는다 (3명 대 4명이면 ×4/3).
   · 판정은 서버가 한다 — 학생이 보낸 글자가 그 문제와 똑같아야 갖는다.
     먼저 온 쪽이 갖는다. 4종목만은 표를 각자 화면에서 고치므로 다 고쳤다는
     알림을 믿는다.
   · 네 종목이 끝난 뒤 교사가 종목을 골라 **한 게임 더** 할 수 있다. 몇 번이고.
     한 게임(1종목은 한 게임, 팀전은 한 판)만 하고 종합 발표로 돌아온다.
     메달·종합 순위·MVP 에는 넣지 않는다 — 판 결과만 보여 준다.
   · 교사가 넘긴다. 미리 보기(15초)·경기·종목 결과(1분)만 시계로 넘어가고,
     나머지는 교사가 「다음」을 누른다.

   이 파일은 소켓도 DB 도 모른다. 넣는 것은 참가와 고른 것과 친 글자,
   나오는 것은 사람마다 보여 줄 모습이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const {okPin} = require("./room.js");
const {E1_THEMES, QUOTES, QUOTE_TIER, E3_BANK} = require("./typing-data.js");

const MAX_ENTRANTS = 40;
const TEAMS = 6;
const EVENTS = ["단어 개인전", "문장 팀전", "문장 편집 팀전", "표 편집 팀전"];
const PTS = [[10, 20, 30], [30, 40, 50]];       // 짧음·중간·긺, [앞 절반, 뒤 절반]
const LIMIT = [60, 120, 120, 120];              // 한 판 (초)
const PREVIEW = 15, RESULT = 60;                // 맞대결 미리 보기 · 종목 결과 (초)
const E1_GAMES = 2, E1_MIN = 4, E1_SLOTS = 10;  // 게임 수, 조 최소 인원(밑이면 해체), 카드 수
const E2_SLOTS = 6;                             // 긴 인용문이 섞여도 한 화면에 들어가는 수
const LEAGUE_GAMES = 2;                         // 2·3·4종목 판 수
const TIER_E3 = [2, 3];                         // 3종목은 고칠 곳 수 2·3·4
const GOT = [null, "친 문장", "고친 문장", "완성한 표"];

/* ─── 순수 계산 ─────────────────────────────────────────────────────── */
const CHO  = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["","ㄱ","ㄲ","ㄳ","ㄴ","ㄵ","ㄶ","ㄷ","ㄹ","ㄺ","ㄻ","ㄼ","ㄽ","ㄾ","ㄿ","ㅀ","ㅁ","ㅂ","ㅄ","ㅅ","ㅆ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const SPLIT = {"ㅘ":"ㅗㅏ","ㅙ":"ㅗㅐ","ㅚ":"ㅗㅣ","ㅝ":"ㅜㅓ","ㅞ":"ㅜㅔ","ㅟ":"ㅜㅣ","ㅢ":"ㅡㅣ",
  "ㄳ":"ㄱㅅ","ㄵ":"ㄴㅈ","ㄶ":"ㄴㅎ","ㄺ":"ㄹㄱ","ㄻ":"ㄹㅁ","ㄼ":"ㄹㅂ","ㄽ":"ㄹㅅ","ㄾ":"ㄹㅌ","ㄿ":"ㄹㅍ","ㅀ":"ㄹㅎ","ㅄ":"ㅂㅅ"};
/* 두벌식 자모 키 수 — ㄲ 은 1타, ㅘ 는 ㅗ+ㅏ 2타. 분당 타수가 이것으로 선다 */
function keys(str){
  let n = 0;
  for (const ch of String(str)){
    const c = ch.charCodeAt(0) - 0xAC00;
    if (c >= 0 && c < 11172){
      const j = [CHO[Math.floor(c / 588)], JUNG[Math.floor(c % 588 / 28)], JONG[c % 28]];
      for (const x of j) n += (SPLIT[x] || x).length;
    } else n += (SPLIT[ch] || ch).length;
  }
  return n;
}
const tierOf = (n, [a, b]) => n <= a ? 0 : n <= b ? 1 : 2;
const segText = (segs, side) => segs.map(s => typeof s === "string" ? s : s[side]).join("");
const bare = s => s.replace(/\s/g, "").length;
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = a => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
/* 종합 MVP — 종목마다 득점을 그 종목 평균으로 나눠(평균 = 100) 더하고, 팀마다 한 명만 셋 */
function mvp(rec, teamOf){
  const seen = new Set(), rows = Object.values(rec);
  const avg = [0, 1, 2, 3].map(e => { const xs = rows.map(v => v[e]).filter(x => x !== undefined && x !== null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; });
  return Object.entries(rec).map(([pid, v]) => ({pid, team: teamOf(pid), ev: v,
      sum: Math.round(v.reduce((n, x, e) => n + (x && avg[e] ? x / avg[e] * 100 : 0), 0))}))
    .sort((a, b) => b.sum - a.sum)
    .filter(x => x.team != null && !seen.has(x.team) && seen.add(x.team)).slice(0, 3);
}
/* 대진: 막힌 쌍(ban, "a-b")은 빼고, 붙는 두 팀의 실력(power) 차이 합이 가장 작은 짝 맞추기.
   여섯 팀이면 짝 맞추기가 15가지뿐이라 다 본다. 같은 값이면 먼저 섞은 순서로 고른다.
   막힌 쌍을 다 피할 수 없으면(여섯 팀에서는 일어나지 않는다) 가장 적게 어기는 것 */
const pairKey = (a, b) => a < b ? a + "-" + b : b + "-" + a;
function matchUp(teams, power, ban){
  let best = null, bestCost = null;
  const walk = (left, acc, broke, diff) => {
    if (!left.length){
      if (!best || broke < bestCost[0] || (broke === bestCost[0] && diff < bestCost[1] - 1e-9)){ best = acc; bestCost = [broke, diff]; }
      return;
    }
    const [a, ...rest] = left;
    rest.forEach((b, i) => walk(rest.filter((_, j) => j !== i), [...acc, [a, b]],
      broke + (ban.has(pairKey(a, b)) ? 1 : 0), diff + Math.abs((power[a] || 0) - (power[b] || 0))));
  };
  walk(teams.slice(), [], 0, 0);
  return best;
}
/* 리그 순위: 승 2 · 무 1, 같으면 득점 */
function standings(results, teams){
  const s = Object.fromEntries(teams.map(t => [t, {team: t, w: 0, d: 0, l: 0, pts: 0, score: 0}]));
  for (const m of results){
    const A = s[m.a], B = s[m.b];
    A.score += m.sa; B.score += m.sb;
    if (Math.abs(m.sa - m.sb) < 1e-9){ A.d++; B.d++; A.pts++; B.pts++; }
    else if (m.sa > m.sb){ A.w++; B.l++; A.pts += 2; } else { B.w++; A.l++; B.pts += 2; }
  }
  return Object.values(s).sort((a, b) => b.pts - a.pts || b.score - a.score);
}
/* 조 짜기: 고른 대로 넣되 E1_MIN 밑인 조는 작은 것부터 하나씩 없애고 흩는다 —
   흩어진 사람이 들어가 다른 조가 커질 수 있으니 한 번에 하나씩 */
function formGroups(pick, pids){
  const size = i => pids.filter(p => pick[p] === i).length;
  let alive = E1_THEMES.map((_, i) => i).filter(size);
  const gone = E1_THEMES.map((_, i) => i).filter(i => !size(i));
  for (;;){
    const small = alive.filter(i => size(i) < E1_MIN).sort((a, b) => size(a) - size(b))[0];
    if (small === undefined || alive.length < 2) break;
    alive = alive.filter(i => i !== small); gone.push(small);
    pids.filter(p => pick[p] === small).forEach(p => pick[p] = alive[(Math.random() * alive.length) | 0]);
  }
  return {groups: alive.map(th => ({th, ps: pids.filter(p => pick[p] === th)})), gone};
}

class Typing {
  constructor(code, opt){
    opt = opt || {};
    this.code  = code;
    this.pin   = okPin(opt.pin) ? opt.pin : null;
    this.title = String(opt.title || "타자 올림픽").slice(0, 40);
    this.state = "open";                     // open(팀 고르기) | running | done
    this.made  = Date.now();
    this.people = new Map();                 // pid → {pid, name, team, bot, cpm, edit}
    this.lobby = true;                       // 학생이 팀을 고를 수 있나 (마감하면 교사가 옮긴다)
    this.teams = [];
    this.prev = [];                          // 바로 앞 판의 대진 [[a, b] × 3] — 다음 판에서 다시 붙이지 않는다
    this.ev = 0;
    this.ph = {k: "lobby"};                  // 지금 단계 — until 이 있으면 그때 저절로 넘어간다
    this.medals = [];                        // {ev, place, team, who?, game?}
    this.ranks = [];                         // ranks[종목] = 그 종목 팀 순서
    this.x = null;                           // 한 게임 더 — {n: 몇 번째, ev} . 끝나면 null
    this.bonus = 0;                          // 한 게임 더를 몇 번 했나
    this.res = null;                         // 종목 결과
    this.rec = {};                           // pid → 종목마다 개인 득점 — 종합 MVP
    this.picks = {};                         // 1종목 조 고르기 pid → 어휘 번호
    this.e1 = null;                          // {g, groups, gone, acc}
    this.lg = null;                          // {k, results, stat}
    this.races = [];
  }

  /* ─── 맡기기 · 되살리기 ─── 통째로 적는다. Map 만 배열로 푼다 */
  snapshot(){
    const o = {v: 1};
    for (const k of ["code", "pin", "title", "state", "made", "lobby", "teams", "prev", "ev", "ph",
                     "medals", "ranks", "res", "rec", "picks", "e1", "lg", "races", "x", "bonus"]) o[k] = this[k];
    o.people = [...this.people.values()];
    return o;
  }
  static revive(d){
    const g = new Typing(d.code, {pin: d.pin, title: d.title});
    for (const k of ["state", "made", "lobby", "teams", "prev", "ev", "ph", "medals", "ranks",
                     "res", "rec", "picks", "e1", "lg", "races", "x", "bonus"]) if (d[k] !== undefined) g[k] = d[k];
    (d.people || []).forEach(p => g.people.set(p.pid, p));
    return g;
  }

  /* ─── 팀 고르기 ─── */
  join(person, bot){
    if (this.people.has(person.pid)) return {ok: true, again: true};
    if (this.state !== "open") return {err: "started"};
    if (this.people.size >= MAX_ENTRANTS) return {err: "full"};
    const p = {pid: person.pid, name: person.name, team: null, cpm: null};
    if (bot) Object.assign(p, {bot: true, team: (Math.random() * TEAMS) | 0,
                               speed: rand(150, 450), edit: rand(2, 6)});
    this.people.set(person.pid, p);
    return {ok: true};
  }
  quit(pid){
    if (this.state !== "open") return false;
    return this.people.delete(pid);
  }
  members(t){ return [...this.people.values()].filter(p => p.team === t); }
  setTeam(pid, t){
    const p = this.people.get(pid);
    if (!p) return {err: "noone"};
    if (this.state !== "open" || !this.lobby) return {err: "closed"};
    if (!(t >= 0 && t < TEAMS)) return {err: "bad"};
    p.team = t | 0;
    return {ok: true};
  }
  /* 마감 — 안 고른 사람은 가장 적은 팀으로 (빈 팀부터 채운다) */
  close(){
    if (this.state !== "open") return {err: "started"};
    for (const p of this.people.values()) if (p.team === null){
      const t = [...Array(TEAMS).keys()].sort((a, b) => this.members(a).length - this.members(b).length)[0];
      p.team = t;
    }
    this.lobby = false;
    return {ok: true};
  }
  reopen(){
    if (this.state !== "open") return {err: "started"};
    this.lobby = true;
    return {ok: true};
  }
  move(pid, t){                              // 마감 뒤 교사가 끌어다 옮긴다
    const p = this.people.get(pid);
    if (!p) return {err: "noone"};
    if (this.state !== "open") return {err: "started"};
    if (!(t >= 0 && t < TEAMS)) return {err: "bad"};
    p.team = t | 0;
    return {ok: true};
  }
  start(){
    if (this.state !== "open") return {err: "started"};
    if (this.lobby) return {err: "lobby"};
    const teams = [...Array(TEAMS).keys()].filter(t => this.members(t).length);
    if (teams.length < TEAMS) return {err: "teams"};
    this.teams = teams;
    this.state = "running";
    this.ev = 0;
    this.ph = {k: "intro", ev: 0};
    return {ok: true};
  }

  /* ─── 교사의 「다음」 ─── 단계마다 하는 일이 다르다 */
  go(now){
    const k = this.ph.k;
    if (this.state !== "running") return {err: "notrunning"};
    if (k === "intro"){
      if (this.ev === 0){ this.e1 = {g: 0, acc: {}}; return this.pick(); }
      this.lg = {k: 0, results: [], stat: {}};
      return this.round(now);
    }
    if (k === "pick") return this.form();
    if (k === "formed") return this.e1Game(now);
    if (k === "preview") return this.play(now);
    if (k === "play") return this.endPlay(now);
    if (k === "after"){
      if (this.x){ this.x = null; this.state = "done"; this.races = []; this.ph = {k: "finale"}; return {ok: true}; }   // 한 게임 더 — 끝
      if (this.ev === 0){
        if (this.e1.g + 1 < E1_GAMES){ this.e1.g++; return this.pick(); }
        return this.finishE1(now);
      }
      if (this.lg.k + 1 < LEAGUE_GAMES){ this.lg.k++; return this.round(now); }
      return this.finishLeague(now);
    }
    if (k === "ceremony"){
      this.ev++; this.races = []; this.res = null;
      if (this.ev >= EVENTS.length){ this.state = "done"; this.ph = {k: "finale"}; }
      else this.ph = {k: "intro", ev: this.ev};
      return {ok: true};
    }
    return {err: "nothing"};
  }
  /* 한 게임 더 — 종합 발표에서 교사가 종목을 고른다. 1종목은 조 고르기부터, 팀전은 대진 공개부터 */
  extra(ev, now){
    ev = ev | 0;
    if (this.state !== "done" || this.ph.k !== "finale") return {err: "notdone"};
    if (!(ev >= 0 && ev < EVENTS.length)) return {err: "bad"};
    this.state = "running"; this.ev = ev; this.res = null;
    this.x = {n: ++this.bonus, ev};
    if (ev === 0){ this.e1 = {g: 0, acc: {}}; return this.pick(); }
    this.lg = {k: 0, results: [], stat: {}};
    return this.round(now);
  }
  /* 시계로 넘어가는 단계와 연습 참가자. 바뀐 것이 있으면 true */
  tick(now){
    let moved = false;
    if (this.ph.until && now >= this.ph.until && ["preview", "play", "ceremony"].includes(this.ph.k)){
      this.go(now); moved = true;
    }
    if (this.ph.k === "play") for (const r of this.races) if (this.botsAct(r, now)) moved = true;
    return moved;
  }

  /* ─── 1종목 ─── */
  pick(){
    this.picks = {};
    for (const p of this.people.values()) if (p.bot) this.picks[p.pid] = (Math.random() * E1_THEMES.length) | 0;
    this.ph = {k: "pick", ev: 0, g: this.e1.g};
    return {ok: true};
  }
  setTheme(pid, i){
    if (this.ph.k !== "pick" || !this.people.has(pid)) return {err: "closed"};
    if (!(i >= 0 && i < E1_THEMES.length)) return {err: "bad"};
    this.picks[pid] = i | 0;
    return {ok: true};
  }
  form(){
    const pids = [...this.people.keys()];
    pids.forEach(p => { if (this.picks[p] === undefined) this.picks[p] = (Math.random() * E1_THEMES.length) | 0; });
    const f = formGroups(this.picks, pids);
    Object.assign(this.e1, {groups: f.groups, gone: f.gone});
    this.ph = {k: "formed", ev: 0, g: this.e1.g};
    return {ok: true};
  }
  e1Game(now){
    this.races = this.e1.groups.map(gr => this.race("word", gr.ps, {th: gr.th, deck: shuffle(E1_THEMES[gr.th].words), slots: E1_SLOTS}));
    return this.play(now);
  }
  finishE1(now){
    const acc = this.e1.acc, cpmOf = s => Math.round(s.k / Math.max(s.t, 1) * 60);
    Object.entries(acc).forEach(([pid, s]) => { const p = this.people.get(pid); if (p && s.got) p.cpm = cpmOf(s); });
    const mine = this.medals.filter(m => m.ev === 0);
    const med = t => mine.reduce((n, m) => n + (m.team === t ? [100, 10, 1][m.place] : 0), 0);
    const total = s => s.s.reduce((a, b) => a + (b || 0), 0);
    const sum = t => Object.entries(acc).reduce((n, [pid, s]) => n + ((this.people.get(pid) || {}).team === t ? total(s) : 0), 0);
    const teams = this.teams.slice().sort((a, b) => med(b) - med(a) || sum(b) - sum(a));
    this.res = {ev: 0, teams: teams.map(t => ({team: t, val: "팀원 점수 합 " + sum(t)})),
      cols: [...Array(E1_GAMES)].map((_, g) => (g + 1) + "게임").concat(["맞힌 단어", "타/분"]),
      rows: Object.entries(acc).map(([pid, s]) => ({pid, v: [...Array(E1_GAMES)].map((_, g) => s.s[g] ?? "—").concat([s.got, cpmOf(s)]), key: total(s)}))};
    return this.ceremony(now, teams);
  }

  /* ─── 2·3·4종목 — 팀 대 팀 리그 ─── */
  round(now){
    const pairs = this.pairs();
    this.prev = pairs;
    this.races = pairs.map(([a, b]) => {
      const ps = [...this.members(a), ...this.members(b)].map(p => p.pid);
      const kind = ["", "quote", "edit", "table"][this.ev];
      const deck = kind === "quote" ? shuffle(QUOTES) : kind === "edit" ? shuffle(E3_BANK) : [];
      const slots = kind === "quote" ? E2_SLOTS : kind === "edit" ? Math.round(ps.length * 1.5) : 0;
      return this.race(kind, ps, {a, b, deck, slots});
    });
    this.ph = {k: "preview", ev: this.ev, rd: this.lg.k, until: now + PREVIEW * 1000};
    return {ok: true};
  }
  /* 1번: 이 종목에서 만난 팀, 바로 앞 판에서 만난 팀과는 다시 붙지 않는다 (앞 종목은 그 한 판만 본다)
     2번: 그 안에서 실력이 비슷한 팀끼리. 실력 = 이 종목 팀 점수 합, 종목 첫 판이면 앞 종목 순위
          (한 게임 더는 그 종목 최종 순위) */
  pairs(){
    const ban = new Set([...(this.prev || []), ...this.lg.results.map(m => [m.a, m.b])].map(([a, b]) => pairKey(a, b)));
    const power = {};
    if (this.lg.results.length) this.lg.results.forEach(m => { power[m.a] = (power[m.a] || 0) + m.sa; power[m.b] = (power[m.b] || 0) + m.sb; });
    else (this.ranks[this.x ? this.ev : this.ev - 1] || []).forEach((t, i) => power[t] = -i);
    return matchUp(shuffle(this.teams), power, ban);
  }
  finishLeague(now){
    const st = standings(this.lg.results, this.teams);
    st.slice(0, 3).forEach((x, place) => this.medals.push({ev: this.ev, place, team: x.team}));
    const fmt = x => +x.toFixed(1);
    this.res = {ev: this.ev,
      teams: st.map(x => ({team: x.team, val: `승점 ${x.pts} · ${x.w}승 ${x.d}무 ${x.l}패 · 득점 ${fmt(x.score)}`})),
      cols: ["득점", GOT[this.ev], "경기"],
      rows: Object.entries(this.lg.stat).map(([pid, s]) => ({pid, v: [s.score, s.got, s.n], key: s.score}))};
    return this.ceremony(now, st.map(x => x.team));
  }
  ceremony(now, order){
    this.ranks[this.ev] = order;
    this.res.rows.forEach(r => { (this.rec[r.pid] = this.rec[r.pid] || [])[this.ev] = +r.key.toFixed(1); });
    this.ph = {k: "ceremony", ev: this.ev, until: now + RESULT * 1000};
    return {ok: true};
  }

  /* ─── 경기 ─── */
  race(kind, ps, o){
    const r = {kind, ps, items: [], slots: [], deck: o.deck || [], dn: 0, n: o.slots || 0,
               t0: null, until: null, sc: {}, bot: {}, goals: {}};
    if (o.th !== undefined) r.th = o.th;
    if (o.a !== undefined){ r.a = o.a; r.b = o.b; }
    ps.forEach(pid => r.sc[pid] = {score: 0, got: 0, k: 0});
    return r;
  }
  play(now){
    const limit = LIMIT[this.ev] * 1000;
    for (const r of this.races){
      r.t0 = now; r.until = now + limit;
      while (r.items.length < r.n) r.items.push(this.gen(r, now));
      r.slots = r.items.map((_, i) => i);
      if (r.kind === "table") r.ps.forEach(pid => r.goals[pid] = this.goal(r, pid, now));
    }
    this.ph = {k: "play", ev: this.ev, g: this.e1 && this.ev === 0 ? this.e1.g : undefined,
               rd: this.lg && this.ev > 0 ? this.lg.k : undefined, until: now + limit};
    return {ok: true};
  }
  late(r, now){ return now - r.t0 >= (r.until - r.t0) / 2; }
  mul(r, t){
    const big = Math.max(this.members(r.a).length, this.members(r.b).length);
    return big / Math.max(this.members(t).length, 1);
  }
  teamScore(r, t){
    return r.ps.reduce((n, pid) => n + ((this.people.get(pid) || {}).team === t ? r.sc[pid].score : 0), 0) * this.mul(r, t);
  }
  /* 지고 있는 팀의 가장 약한 학생에게만, 새 문제 셋 중 하나꼴로 ×2 */
  chance(r, now){
    if (r.a === undefined || now === r.t0 || Math.random() > 1 / 3) return null;
    const sa = this.teamScore(r, r.a), sb = this.teamScore(r, r.b);
    if (Math.abs(sa - sb) < 1e-9) return null;
    const lose = this.members(sa < sb ? r.a : r.b);
    return lose.length ? lose.reduce((w, p) => (p.cpm || 0) < (w.cpm || 0) ? p : w).pid : null;
  }
  gen(r, now){
    const late = r.t0 !== null && this.late(r, now), P = PTS[late ? 1 : 0];
    const pick = () => { if (!r.deck.length) return null; const x = r.deck[r.dn % r.deck.length]; r.dn++; return x; };
    if (r.kind === "word"){
      const w = pick(), tier = tierOf([...w].length, E1_THEMES[r.th].tier);
      return {text: w, tier, pts: P[tier], late};
    }
    if (r.kind === "quote"){
      const q = pick(), tier = tierOf(bare(q.text), QUOTE_TIER);
      return {text: q.text, tier, pts: P[tier], late, x2: this.chance(r, now), src: q.author ? q.author + ", " + q.work : ""};
    }
    const segs = pick(), ch = segs.filter(s => typeof s !== "string").length, tier = tierOf(ch, TIER_E3);
    return {text: segText(segs, 1), segs, ch, tier, pts: P[tier], late, x2: this.chance(r, now)};
  }
  goal(r, pid, now){ return {late: this.late(r, now), x2: this.chance(r, now) === pid}; }
  raceOf(pid){ return this.races.find(r => r.ps.includes(pid)); }
  /* 먼저 온 쪽이 갖는다. 글자가 문제와 똑같아야 한다 */
  claim(pid, i, text, now){
    const r = this.raceOf(pid);
    if (this.ph.k !== "play" || !r || now >= r.until) return {err: "notplaying"};
    if (r.kind === "table") return {err: "bad"};
    const pos = r.slots.indexOf(i | 0);
    if (pos < 0) return {err: "gone"};
    const it = r.items[i | 0];
    if (it.owner) return {err: "taken"};
    if (String(text) !== it.text) return {err: "wrong"};
    it.owner = pid; it.at = now;
    const val = it.pts * (it.x2 === pid ? 2 : 1);
    const s = r.sc[pid]; s.score += val; s.got++; s.k += keys(it.text);
    r.slots[pos] = r.items.length;
    r.items.push(this.gen(r, now));
    return {ok: true, val};
  }
  /* 4종목 — 표 하나를 다 고쳤다. tier 는 그 과제의 등급(0·1·2) */
  tableDone(pid, tier, now){
    const r = this.raceOf(pid);
    if (this.ph.k !== "play" || !r || now >= r.until || r.kind !== "table") return {err: "notplaying"};
    tier = Math.max(0, Math.min(2, tier | 0));
    const g = r.goals[pid] || {late: false, x2: false};
    const val = PTS[g.late ? 1 : 0][tier] * (g.x2 ? 2 : 1);
    const s = r.sc[pid]; s.score += val; s.got++;
    r.goals[pid] = this.goal(r, pid, now);
    return {ok: true, val};
  }
  endPlay(now){
    for (const r of this.races) if (r.until > now) r.until = now;
    if (this.ev === 0){
      const g = this.e1.g, acc = this.e1.acc;
      this.races.forEach(r => {
        const secs = (r.until - r.t0) / 1000;
        r.ps.forEach(pid => { const a = acc[pid] ??= {s: [], got: 0, k: 0, t: 0}, s = r.sc[pid];
          a.s[g] = s.score; a.got += s.got; a.k += s.k; a.t += secs; });
        const cpmOf = pid => r.sc[pid].k / Math.max(secs, 1);
        r.table = r.ps.slice().sort((x, y) => r.sc[y].score - r.sc[x].score || r.sc[y].got - r.sc[x].got || cpmOf(y) - cpmOf(x));
        if (!this.x) r.table.filter(pid => r.sc[pid].score > 0).slice(0, 3).forEach((pid, place) =>   // 0점은 메달이 없다, 한 게임 더도
          this.medals.push({ev: 0, place, team: this.people.get(pid).team, who: pid, game: g}));
      });
    } else {
      this.races.forEach(r => {
        this.lg.results.push({a: r.a, b: r.b, sa: this.teamScore(r, r.a), sb: this.teamScore(r, r.b)});
        r.ps.forEach(pid => { const s = this.lg.stat[pid] ??= {score: 0, got: 0, n: 0};
          s.score += r.sc[pid].score; s.got += r.sc[pid].got; s.n++; });
      });
    }
    this.ph = Object.assign({}, this.ph, {k: "after", until: undefined});
    return {ok: true};
  }

  /* ─── 연습 참가자 (리허설용) ─── 사람처럼 시간을 들여 친다 */
  botsAct(r, now){
    let moved = false;
    for (const pid of r.ps){
      const p = this.people.get(pid);
      if (!p || !p.bot || now >= r.until) continue;
      const b = r.bot[pid] ??= {cur: null, at: 0};
      if (r.kind === "table"){
        if (!b.at) b.at = now + (p.edit + 1) * 4000 * rand(0.8, 1.2);
        else if (now >= b.at){ this.tableDone(pid, (Math.random() * 3) | 0, now); b.at = 0; moved = true; }
        continue;
      }
      if (b.cur === null || r.items[b.cur].owner || !r.slots.includes(b.cur)){
        const open = r.slots.filter(i => !r.items[i].owner);
        if (!open.length) continue;
        b.cur = open[(Math.random() * open.length) | 0];
        const it = r.items[b.cur];
        b.at = now + 1000 * (r.kind === "edit" ? (6 + p.edit * 1.5 * it.ch) * rand(0.8, 1.3)
                                              : keys(it.text) / p.speed * 60 * rand(1, 1.4) + 0.6);
      } else if (now >= b.at){
        this.claim(pid, b.cur, r.items[b.cur].text, now); b.cur = null; moved = true;
      }
    }
    return moved;
  }

  /* ─── 보여 줄 모습 ─── 사람마다(pid), 교실 앞 화면은 pid 없이 */
  view(pid, now){
    const name = id => (this.people.get(id) || {}).name || "?";
    const out = {code: this.code, title: this.title, state: this.state, now, ph: this.ph, ev: this.ev, extra: this.x || undefined,
      lobby: this.lobby, n: this.people.size, events: EVENTS,
      teams: [...Array(TEAMS).keys()].map(t => ({t, ps: this.members(t).map(p => ({pid: p.pid, name: p.name, cpm: p.cpm}))})),
      medals: this.medals.map(m => m.who ? Object.assign({}, m, {name: name(m.who)}) : m),
      ranks: this.ranks};
    const me = pid && this.people.get(pid);
    if (me) out.me = {pid, name: me.name, team: me.team};
    const k = this.ph.k;
    if (k === "pick") out.pick = {themes: E1_THEMES.map((t, i) => ({name: t.name, sample: t.words.slice(0, 4),
      ps: Object.keys(this.picks).filter(p => this.picks[p] === i).map(name)})), mine: pid ? this.picks[pid] : undefined};
    if (k === "formed") out.formed = {groups: this.e1.groups.map(g => ({name: E1_THEMES[g.th].name, ps: g.ps.map(name)})),
      gone: this.e1.gone.map(i => E1_THEMES[i].name)};
    if (["preview", "play", "after"].includes(k)){
      const brief = r => ({a: r.a, b: r.b, th: r.th !== undefined ? E1_THEMES[r.th].name : undefined,
        sa: r.a !== undefined ? this.teamScore(r, r.a) : undefined, sb: r.a !== undefined ? this.teamScore(r, r.b) : undefined,
        ps: r.ps.map(id => Object.assign({pid: id, name: name(id), team: (this.people.get(id) || {}).team,
          cpm: (this.people.get(id) || {}).cpm}, r.sc[id])), table: r.table, until: r.until});
      out.races = this.races.map(brief);
      const r = (me && this.raceOf(pid)) || this.races[0];
      if (r){
        out.mine = Object.assign(brief(r), {kind: r.kind, i: this.races.indexOf(r),
          mul: r.a !== undefined ? {a: this.mul(r, r.a), b: this.mul(r, r.b)} : undefined});
        if (k === "play") out.mine.items = r.slots.map(i => { const it = r.items[i];
          return {i, text: it.text, segs: it.segs, tier: it.tier, pts: it.pts, late: it.late, src: it.src,
                  x2: !!(me && it.x2 === pid)}; });
        if (r.kind === "table" && me) out.mine.goal = r.goals[pid];
      }
    }
    if (k === "finale") out.mvp = mvp(this.rec, id => (this.people.get(id) || {}).team).map(x => Object.assign(x, {name: name(x.pid)}));
    if (k === "ceremony" && this.res) out.res = Object.assign({}, this.res, {
      rows: this.res.rows.map(x => Object.assign({}, x, {name: name(x.pid), team: (this.people.get(x.pid) || {}).team}))});
    return out;
  }

  /* 관리 화면에 내려 줄 것 */
  full(){
    return {code: this.code, title: this.title, pin: this.pin, state: this.state, made: this.made,
            people: this.people.size, ph: this.ph, ev: this.ev, lobby: this.lobby};
  }
}

module.exports = {Typing, MAX_ENTRANTS, TEAMS, EVENTS, PTS, LIMIT, PREVIEW, RESULT, E1_GAMES, E1_MIN,
                  matchUp, standings, formGroups, keys, tierOf, segText, LEAGUE_GAMES};
