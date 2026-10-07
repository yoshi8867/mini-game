/* ══════════════════════════════════════════════════════════════════════
   블라인드 — 40분짜리 OMR 명제 퀴즈의 심판.

   20문제 5지선다인데 문제 지문이 없다. 정답 배열 자체가 퍼즐이고, 학생은
   그 배열에 관한 명제 **한 줄**만 받는다. 서로 거래하고 속이며 스무 칸을
   채운다. 명제와 정답은 props.js 에 있다.

   여기서 정한 것들:

   · **시계가 전부다.** 관리자가 시작을 누른 순간부터 40분이 흐르고, 모든
     단계는 거기서 계산된다. 멈춤도 되감기도 없다 — 교실의 종과 같다.
   · **내 명제는 나에게만, 그것도 1분만 나간다.** 공개 참이 지나면 서버가
     더 보내지 않는다. 소스를 열어도 남의 명제는 없다.
   · **정답은 종료령까지 내려가지 않는다.** 그 뒤 1번부터 5초에 하나씩,
     열린 것만 나간다. 채점도 여기서 한다.
   · **마킹은 착석 안내부터 종료령까지만** 받는다. 제출 버튼은 없다.
     종료령이 곧 제출이다.
   · 늦게 온 사람은 못 들어온다. 명제를 시작할 때 나눠 주기 때문이다 —
     판을 늦게 시작하는 쪽이 맞다.
   · 등급은 **내신 5등급제**다. 10·24·32·24·10%, 누적 10·34·66·90%.

   이 파일은 소켓도 DB 도 모른다. 넣는 것은 참가와 마킹, 나오는 것은 지금
   띄울 안내 한 토막과 내 답안뿐이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const {okPin} = require("./room.js");        // 비번 모양은 대국과 같은 규칙이다
const {KEY, PROPS, HINTS, deal} = require("./props.js");

const MIN = 60 * 1000;
const MAX_ENTRANTS = 48;
const QUESTIONS = KEY.length;                // 쓰는 문제는 20번까지
const PRINTED = 40;                          // 종이에 찍혀 있는 칸은 40번까지
const CHOICES = 5;
const PER = 5;                               // 한 문제 5점
const STEP = 5000;                           // 정답 하나가 열리는 참
const GONE = MIN;                            // 힌트가 남아 있는 참
const CUT = [10, 34, 66, 90];                // 내신 5등급제 누적 비율

/* 40분. 굵은 것만 게이지에 세모가 선다 */
const PLAN = [
  {m: 0,  mark: 1, t: "준비령",
   say: "준비령이 울렸습니다.\n자리에 앉아 기다립니다."},
  {m: 4,  mark: 0, t: "개별 힌트 공개", gone: 1, solo: 1,
   head: "나에게만 보이는 힌트"},
  {m: 5,  mark: 1, t: "본령",
   say: "본령이 울렸습니다.\n이제부터 자유롭게 이동하거나 대화해도 좋습니다."},
  {m: 15, mark: 1, t: "1차 공통 힌트 공개", gone: 1, hint: 0,
   head: "1차 공통 힌트"},
  {m: 20, mark: 1, t: "2차 공통 힌트 공개", gone: 1, hint: 1,
   head: "2차 공통 힌트"},
  {m: 25, mark: 1, t: "3차 공통 힌트 공개", gone: 1, hint: 2,
   head: "3차 공통 힌트"},
  {m: 32, mark: 1, t: "착석 안내", note: "종료까지 3분 남음",
   say: "착석하기 바랍니다.\n이제부터 서로 대화할 수 없습니다.\n3분 간 OMR 카드에 답안 마킹이 가능합니다."},
  {m: 35, mark: 1, t: "종료령",
   say: "종료령이 울렸습니다.\n답안은 자동으로 제출되었습니다."},
  {m: 36, mark: 0, t: "정답 공개", note: "1번부터 5초마다 1개씩",
   say: "정답을 공개합니다."},
  {m: 38, mark: 0, t: "점수 공개", note: "등수 · 등급 · 평균",
   say: "채점이 끝났습니다."},
];
const SIT = 32 * MIN, END = 35 * MIN, OPEN = 36 * MIN, SCORE = 38 * MIN;
const LEN = 40 * MIN;

const shuffle = a => {                       // Fisher-Yates
  for (let i = a.length - 1; i > 0; i--){
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* 몇 번째 단계인가. 아직 시작 전이면 -1 */
function stepAt(t){
  let k = -1;
  PLAN.forEach((p, i) => { if (t >= p.m * MIN) k = i; });
  return k;
}
/* 몇 번까지 열렸나 */
function openedAt(t){
  if (t < OPEN) return 0;
  return Math.min(QUESTIONS, Math.floor((t - OPEN) / STEP) + 1);
}
/* 누적 백분위로 등급을 매긴다 */
function grade(rank, n){
  const pct = rank / n * 100;
  for (let i = 0; i < CUT.length; i++) if (pct <= CUT[i]) return i + 1;
  return CUT.length + 1;
}

class Omr {
  constructor(code, opt){
    opt = opt || {};
    this.code  = code;
    this.pin   = okPin(opt.pin) ? opt.pin : null;
    this.title = String(opt.title || "블라인드").slice(0, 40);
    /* 공통 힌트는 관리자가 바꿔 넣을 수 있다. 빈 칸은 기본값으로 둔다 */
    this.hints = HINTS.map((h, i) => {
      const got = opt.hints && opt.hints[i];
      return got ? String(got).slice(0, 120) : h;
    });
    this.state  = "open";                    // open(접수) | running | done
    this.made   = Date.now();
    this.began  = null;
    this.ended  = null;
    this.people = new Map();                 // pid → {pid, name, prop, marks, guess}
    this.last   = "";                        // 마지막으로 알린 모습
  }

  /* ─── 맡기기 · 되살리기 ──────────────────────────────────────────── */
  /* 서버가 다시 떠도 판이 이어지게 통째로 적어 둘 모습. 시작 시각을 절대
     시각으로 들고 있으니, 되살린 판은 꺼져 있던 동안 흐른 시간까지 그대로
     따라잡는다. 명제는 글까지 통째로 둔다 — 그사이 OMR_PROPS 가 바뀌어도
     이미 나눠 준 패는 그대로여야 한다. */
  snapshot(){
    return {v: 1, code: this.code, pin: this.pin, title: this.title,
            hints: this.hints, state: this.state, made: this.made,
            began: this.began, ended: this.ended,
            people: [...this.people.values()]};
  }
  static revive(d){
    const o = new Omr(d.code, {pin: d.pin, title: d.title, hints: d.hints});
    o.state = d.state; o.made = d.made; o.began = d.began; o.ended = d.ended;
    (d.people || []).forEach(p => o.people.set(p.pid, {
      pid: p.pid, name: p.name, prop: p.prop || null,
      marks: p.marks || {}, guess: p.guess === undefined ? null : p.guess}));
    return o;
  }

  /* ─── 접수 ───────────────────────────────────────────────────────── */
  join(person){
    if (this.state !== "open") return {err: "closed"};
    if (this.people.has(person.pid)) return {ok: true, again: true};
    if (this.people.size >= MAX_ENTRANTS) return {err: "full"};
    this.people.set(person.pid, {pid: person.pid, name: person.name,
                                 prop: null, marks: {}, guess: null});
    return {ok: true};
  }
  quit(pid){                                 // 시작 전에만 뺄 수 있다
    if (this.state !== "open") return false;
    return this.people.delete(pid);
  }

  /* ─── 시작 — 여기서 명제를 나눠 준다 ────────────────────────────── */
  start(now){
    if (this.state !== "open") return {err: "started"};
    const list = [...this.people.values()];
    if (list.length < 2) return {err: "few"};

    /* 사람이 적으면 ☆ 부터 빠진다. 많으면 돌려 가며 겹쳐 준다 */
    const cards = shuffle(deal(list.length).slice());
    shuffle(list).forEach((p, i) => { p.prop = cards[i % cards.length]; });

    this.state = "running";
    /* 시작을 그 분의 0초에 붙인다. 게이지 라벨은 「11:36」처럼 분까지만
       적는데, 11:21:40 에 눌렀으면 바늘이 1차 힌트에 닿는 것은 11:36:40 이다.
       라벨과 40초가 어긋난다. 0초로 당기면 모든 단계가 정각 분에 떨어진다 —
       바늘이 화살표에 닿는 순간 시계가 그 분으로 넘어간다. 대가는 준비령이
       많아야 59초 짧아지는 것뿐이고, 준비령은 앉아서 기다리는 참이다. */
    this.began = Math.floor((now || Date.now()) / MIN) * MIN;
    this.last  = "";
    return {ok: true, people: list.length, props: cards.length,
            short: cards.length < list.length};
  }

  /* 시작부터 흐른 참 */
  spent(now){ return this.began === null ? 0 : now - this.began; }

  /* 시계를 당긴다. 늦게 시작했거나 다들 일찍 끝냈을 때 관리자가 쓴다.
     모두가 같은 시계를 보고 있으니 한 번에 옮겨진다 */
  warp(ms, now){
    if (this.state !== "running") return {err: "notrunning"};
    now = now || Date.now();
    /* 분 단위로만 옮긴다. 2.5분을 당기면 시작이 0초 자리를 벗어나 라벨과
       바늘이 30초 어긋난다. 끝에 걸려 잘린 경우에도 0초 자리로 되붙인다. */
    ms = Math.round((ms | 0) / MIN) * MIN;
    const t = Math.max(0, Math.min(LEN, this.spent(now) + ms));
    this.began = Math.floor((now - t) / MIN) * MIN;
    this.last = "";
    return {ok: true, t};
  }

  /* ─── 마킹 ───────────────────────────────────────────────────────── */
  /* 착석 안내부터 종료령까지만 받는다. 같은 칸을 또 누르면 지운다 */
  mark(pid, q, n, now){
    const me = this.people.get(pid);
    if (!me) return {err: "stranger"};
    if (this.state !== "running") return {err: "notrunning"};
    const t = this.spent(now);
    if (t < SIT) return {err: "early"};
    if (t >= END) return {err: "late"};
    q = q | 0; n = n | 0;
    if (q < 1 || q > QUESTIONS) return {err: "noq"};      // 21번부터는 종이에만 있다
    if (n < 0 || n > CHOICES) return {err: "non"};
    if (!n || me.marks[q] === n) delete me.marks[q];
    else me.marks[q] = n;
    return {ok: true, marks: me.marks};
  }
  /* 예상점수. 종료령까지 고칠 수 있다 */
  bet(pid, v, now){
    const me = this.people.get(pid);
    if (!me) return {err: "stranger"};
    if (this.state !== "running" || this.spent(now) >= END) return {err: "late"};
    v = v === null || v === "" ? null : Math.max(0, Math.min(100, v | 0));
    me.guess = v;
    return {ok: true, guess: v};
  }

  /* ─── 채점 ───────────────────────────────────────────────────────── */
  hits(me){
    let n = 0;
    for (let q = 1; q <= QUESTIONS; q++) if (me.marks[q] === KEY[q - 1]) n++;
    return n;
  }
  points(me){ return this.hits(me) * PER; }
  /* 등수와 평균은 응시자 전체에서 나온다 */
  tally(){
    const all = [...this.people.values()].map(p => ({
      pid: p.pid, name: p.name, score: this.points(p), guess: p.guess}));
    all.sort((a, b) => b.score - a.score);
    const n = all.length || 1;
    const sum = all.reduce((s, p) => s + p.score, 0);
    let rank = 0, last = null;
    all.forEach((p, i) => {
      if (p.score !== last){ rank = i + 1; last = p.score; }
      p.rank = rank;
      p.grade = grade(rank, n);
    });
    return {list: all, avg: sum / n, people: all.length};
  }

  /* ─── 시계 ───────────────────────────────────────────────────────── */
  /* 알릴 거리가 생겼으면 true. 초 단위로 떠들지 않는다 — 단계가 바뀌거나
     정답이 하나 더 열릴 때만이다. 그 사이는 화면이 알아서 센다 */
  tick(now){
    if (this.state !== "running") return false;
    const t = this.spent(now);
    if (t >= LEN){ this.state = "done"; this.ended = now; this.last = "done"; return true; }
    const f = stepAt(t) + ":" + openedAt(t);
    if (f === this.last) return false;
    this.last = f;
    return true;
  }

  /* ─── 밖으로 내보내는 모습 ───────────────────────────────────────── */
  /* 두 화면이 같은 틀을 쓴다. 다른 것은 개별 힌트와 내 답안뿐이다 */
  shell(now){
    const t = this.spent(now);
    return {code: this.code, title: this.title, state: this.state,
            people: this.people.size,
            /* 시작한 시각. 화면은 라벨과 큰 시계를 모두 이것에서 센다 —
               보는 사람 기계의 시계가 몇 초 틀려도 모두가 같은 시각을 보고,
               바늘이 화살표에 닿는 순간 큰 시계가 정확히 그 분을 가리킨다. */
            began: this.began,
            spent: t, len: LEN, sit: SIT, end: END,
            open_at: OPEN, score_at: SCORE,
            printed: PRINTED, questions: QUESTIONS, per: PER,
            plan: PLAN.map(p => ({m: p.m, t: p.t, mark: !!p.mark, note: p.note || null}))};
  }
  /* 지금 안내 창에 띄울 한 토막. me 가 없으면 개별 힌트는 안 펼친다 */
  notice(t, me){
    const step = PLAN[stepAt(t)];
    if (!step) return null;
    const since = t - step.m * MIN;
    if (step.gone && since >= GONE) return null;
    let say = step.say || null;
    if (step.solo)
      say = me ? (me.prop ? me.prop.text : "받은 명제가 없습니다.")
               : "학생마다 다른 명제가 떴습니다.";
    if (step.hint !== undefined) say = this.hints[step.hint];
    return {t: step.t, head: step.head || step.t, say,
            gone: !!step.gone, left: step.gone ? Math.max(0, GONE - since) : null};
  }
  /* 학생 한 사람이 보는 것. 남의 답안도, 아직 안 열린 정답도 없다.
     흐른 참은 spent 다 — t 는 send() 가 메시지 종류로 쓰고 있다 */
  view(pid, now){
    const me = this.people.get(pid);
    if (!me) return null;
    const t = this.spent(now);
    const out = this.shell(now);
    out.name = me.name;
    out.marks = me.marks;
    out.guess = me.guess;
    if (this.state === "open") return out;

    const says = this.notice(t, me);
    if (says) out.now = says;
    const open = openedAt(t);             // 정답은 열린 만큼만 나간다
    if (open) out.key = KEY.slice(0, open);
    if (t >= SCORE || this.state === "done"){
      const tal = this.tally();
      const mine = tal.list.find(p => p.pid === pid);
      out.result = {score: mine.score, rank: mine.rank, grade: mine.grade,
                    avg: tal.avg, people: tal.people};
    }
    return out;
  }
  /* 교실 앞에 띄우는 화면. 답안지도 내 명제도 없고, 끝나면 순위가 통째로
     뜬다 — 어차피 다 같이 보는 자리다. 참가 인원에는 안 들어간다 */
  watch(now){
    const t = this.spent(now);
    const out = this.shell(now);
    out.fan = true;
    if (this.state === "open") return out;
    const says = this.notice(t, null);
    if (says) out.now = says;
    const open = openedAt(t);
    if (open) out.key = KEY.slice(0, open);
    if (t >= SCORE || this.state === "done"){
      const tal = this.tally();
      out.board = tal.list.map(p => ({name: p.name, score: p.score,
                                      rank: p.rank, grade: p.grade}));
      out.avg = tal.avg;
    }
    return out;
  }
  info(){
    return {code: this.code, title: this.title, state: this.state,
            open: !this.pin, people: this.people.size,
            spent: this.spent(Date.now()), len: LEN,
            made: this.made, began: this.began, ended: this.ended};
  }
  /* 관리자만 본다 — 지금 단계와 명단, 끝났으면 점수까지 */
  full(now){
    now = now || Date.now();
    const t = this.spent(now);
    const k = this.state === "open" ? -1 : stepAt(t);
    const tal = this.state === "open" ? null : this.tally();
    return Object.assign(this.info(), {
      pin: this.pin,
      hints: this.hints,
      step: k < 0 ? null : PLAN[k].t,
      opened: openedAt(t),
      entrants: [...this.people.values()].map(p => ({
        name: p.name, prop: p.prop ? p.prop.id : null,
        marked: Object.keys(p.marks).length})),
      board: tal && t >= END
        ? tal.list.map(p => ({name: p.name, score: p.score, rank: p.rank,
                              grade: p.grade, guess: p.guess}))
        : [],
      avg: tal && t >= END ? tal.avg : null,
    });
  }
}

module.exports = {Omr, PLAN, KEY, PROPS, stepAt, openedAt, grade,
                  MAX_ENTRANTS, QUESTIONS, PRINTED, PER, STEP, GONE,
                  SIT, END, OPEN, SCORE, LEN, CUT};
