/* ══════════════════════════════════════════════════════════════════════
   단축키 편집기 — 단축키 올림픽(typing.html, mode "keys")이 쓴다.

   VS Code 를 흉내 낸 작은 편집기와, 그 단축키로만 풀리는 문제 만들기.
   글자 입력은 막혀 있다. 되는 것은 커서·선택과 아래 단축키뿐이다.

     Alt+↑/↓ 줄 옮기기 · Tab / Shift+Tab 들여쓰기 · Ctrl+/ 주석
     F2 이름 바꾸기 · Ctrl+S 저장 · Ctrl+Z / Ctrl+Y 되돌리기

   종목은 누적이다: 1 줄 옮기기 → 2 + 주석·들여쓰기 → 3 + 이름 바꾸기·저장.

   문제는 목표 코드를 단축키의 **반대 동작**으로 흐트러뜨려 만든다. 흐트러뜨릴
   때마다 되돌리는 조작을 sol 에 적어 두므로 모든 문제는 반드시 풀린다
   (server/keys.test.js 가 실제로 풀어 본다).

   위쪽(편집 계산·문제 만들기)은 화면을 모른다 — node 에서도 돈다.
   ══════════════════════════════════════════════════════════════════════ */
(function(root){
"use strict";

/* ─── 편집 계산 ─── 상태는 {v: 글, s: 선택 시작, e: 선택 끝} */
const lineOf = (v, p) => v.slice(0, p).split("\n").length - 1;
/* 선택이 걸친 줄 범위. 선택 끝이 줄 맨 앞이면 그 줄은 뺀다 (VS Code 방식) */
function range(v, s, e){
  let a = lineOf(v, s), b = lineOf(v, e);
  if (e > s && v[e - 1] === "\n") b--;
  return [a, b];
}
const OPS = {
  up(L, a, b){ if (!a) return; L.splice(b, 0, L.splice(a - 1, 1)[0]); return [a - 1, b - 1]; },
  down(L, a, b){ if (b >= L.length - 1) return; L.splice(a, 0, L.splice(b + 1, 1)[0]); return [a + 1, b + 1]; },
  /* 한 줄 안의 일부만 고르고 Tab 을 누르면 VS Code 는 고른 글자를 지우지만, 여기서는 그 줄을 들여쓴다 */
  indent(L, a, b, col, sel){
    if (!sel) L[a] = L[a].slice(0, col) + " ".repeat(4 - col % 4) + L[a].slice(col);
    else for (let k = a; k <= b; k++) if (L[k].trim()) L[k] = "    " + L[k];
    return [a, b];
  },
  outdent(L, a, b){ for (let k = a; k <= b; k++) L[k] = L[k].replace(/^ {1,4}/, ""); return [a, b]; },
  comment(L, a, b){
    const R = []; for (let k = a; k <= b; k++) if (L[k].trim()) R.push(k);
    if (!R.length) return;
    if (R.every(k => /^\s*#/.test(L[k]))) R.forEach(k => L[k] = L[k].replace(/^(\s*)# ?/, "$1"));
    else { const m = Math.min(...R.map(k => L[k].search(/\S/))); R.forEach(k => L[k] = L[k].slice(0, m) + "# " + L[k].slice(m)); }
    return [a, b];
  }
};
function edit(st, cmd){
  const {v, s, e} = st, L = v.split("\n"), [a, b] = range(v, s, e);
  const col = s - (v.slice(0, s).lastIndexOf("\n") + 1), len = L[a].length;
  const r = OPS[cmd](L, a, b, col, s !== e);
  if (!r) return null;
  const off = (n, c) => L.slice(0, n).join("\n").length + (n ? 1 : 0) + c;
  const ns = s !== e ? off(r[0], 0) : off(r[0], Math.max(0, Math.min(L[r[0]].length, col + L[r[0]].length - len)));
  return {v: L.join("\n"), s: ns, e: s !== e ? off(r[1], L[r[1]].length) : ns};
}
const WORD = /[\w가-힣]/;
function wordAt(v, p){
  let a = p, b = p;
  while (a && WORD.test(v[a - 1])) a--;
  while (b < v.length && WORD.test(v[b])) b++;
  return a === b ? null : {word: v.slice(a, b), a};
}
const okName = s => /^[A-Za-z_]\w*$/.test(s);
/* 글자가 같은 낱말을 전부 바꾼다(문자열·주석 안 포함). 진짜 VS Code 는 같은 변수만 바꾼다 */
function rename(st, name){
  const w = wordAt(st.v, st.s);
  if (!w || !okName(name) || name === w.word) return null;
  const re = new RegExp(`(?<![\\w가-힣])${w.word}(?![\\w가-힣])`, "g"), c = st.v.slice(0, w.a).replace(re, name).length;
  return {v: st.v.replace(re, name), s: c, e: c};
}
const norm = t => t.split("\n").map(l => l.trimEnd()).join("\n").trimEnd();
const same = (a, b) => norm(a) === norm(b);

/* ─── 문제 ─── */
const EVENTS = [
  {name: "줄 옮기기", how: "줄 순서를 바로잡아 목표와 똑같이 만든다. 여러 줄을 골라 한꺼번에 옮겨도 된다."},
  {name: "주석과 들여쓰기", how: "줄 순서, 주석, 들여쓰기를 목표와 똑같이 만든다."},
  {name: "이름 바꾸기와 저장", how: "긴 변수 이름을 목표처럼 짧게 바꾸고, 다 고친 뒤 저장까지 해야 끝난다."}
];
/* 문제 재료 — 함수 없이 if · else · while · for range 만. ren = [목표의 짧은 이름, 3종목 시작 화면의 긴 이름] */
const POOL = [
{ren: ["s", "sum_of_numbers"], code: `s = 0
for i in range(1, 6):
    s = s + i
    print("더하는 중", i)
print("합계:", s)
print("계산 끝")`},
{ren: ["a", "age_of_user"], code: `a = 15
if a >= 14:
    print("가입할 수 있습니다")
    print("환영합니다")
else:
    print("가입할 수 없습니다")
print("나이:", a)`},
{ren: ["c", "countdown_number"], code: `c = 5
while c > 0:
    print(c)
    c = c - 1
print("발사!")
print("임무 완료")`},
{ren: ["p", "price_of_item"], code: `p = 1200
k = 3
print("가격:", p)
print("개수:", k)
if p * k > 3000:
    print("배송비 무료")
else:
    print("배송비 2500원")`},
{ren: ["h", "hour_of_day"], code: `h = 14
if h < 12:
    print("오전입니다")
else:
    print("오후입니다")
    print("점심은 드셨나요?")
print("현재", h, "시")`},
{ren: ["e", "even_count"], code: `e = 0
for i in range(1, 11):
    if i % 2 == 0:
        e = e + 1
        print(i, "짝수 발견")
print("짝수 개수:", e)`},
{ren: ["w", "password_try"], code: `w = 0
while w < 3:
    w = w + 1
    print(w, "번째 시도")
print("시도 횟수 초과")
print("잠시 후 다시 하세요")`},
{ren: ["t", "temperature"], code: `t = 31
if t >= 30:
    print("덥습니다")
    print("물을 자주 마시세요")
else:
    print("괜찮습니다")
print("기온:", t)`},
{ren: ["m", "money_left"], code: `m = 10000
m = m - 3500
print("빵을 샀습니다")
m = m - 1800
print("우유를 샀습니다")
print("남은 돈:", m)`},
{ren: ["g", "grade_score"], code: `g = 82
if g >= 90:
    print("A")
else:
    if g >= 80:
        print("B")
    else:
        print("C")
print("점수:", g)`},
{ren: ["n", "number_of_apples"], code: `n = 12
print("사과", n, "개")
if n > 10:
    print("상자에 담는다")
    print("창고로 보낸다")
else:
    print("봉지에 담는다")
print("포장 끝")`},
{ren: ["b", "battery_level"], code: `b = 100
while b > 20:
    b = b - 20
    print("남은 배터리", b)
print("충전이 필요합니다")
print("충전기를 연결하세요")`},
{ren: ["d", "distance_km"], code: `d = 0
for i in range(1, 5):
    d = d + 3
    print(i, "바퀴째")
    print("달린 거리", d)
print("운동 끝")`},
{ren: ["q", "question_count"], code: `q = 20
r = 17
print("문제 수:", q)
print("맞힌 수:", r)
if r >= 16:
    print("통과")
else:
    print("재시험")`},
{ren: ["v", "volume_level"], code: `v = 3
while v < 9:
    v = v + 2
    print("볼륨", v)
if v > 8:
    print("너무 큽니다")
print("조절 끝")`},
{ren: ["f", "floor_number"], code: `f = 1
while f <= 5:
    if f == 4:
        print("4층은 서지 않습니다")
    else:
        print(f, "층")
    f = f + 1
print("도착했습니다")`},
{ren: ["y", "year_of_birth"], code: `y = 2010
print("태어난 해:", y)
if y % 4 == 0:
    print("윤년일 수도 있다")
else:
    print("윤년이 아니다")
print("확인 끝")
print("다음 사람")`},
{ren: ["u", "user_point"], code: `u = 450
print("현재 포인트", u)
if u >= 500:
    print("골드 등급")
else:
    print("실버 등급")
    print("조금만 더 모으세요")
u = u + 100
print("적립 후", u)`},
{ren: ["z", "zero_count"], code: `z = 0
for i in range(1, 31):
    if i % 10 == 0:
        z = z + 1
        print(i, "은 0으로 끝난다")
print("모두", z, "개")
print("세기 끝")`},
{ren: ["x", "max_value"], code: `x = 0
for i in range(1, 8):
    if i * 3 > x:
        x = i * 3
print("가장 큰 값", x)
print("찾기 끝")
print("프로그램 종료")`},
{ren: ["j", "jump_count"], code: `j = 0
while j < 4:
    j = j + 1
    print("점프", j)
    print("착지")
print("줄넘기 끝")
print("물 마시기")`},
{ren: ["r", "remaining_seats"], code: `r = 30
print("남은 자리", r)
r = r - 12
print("12명 입장")
if r < 20:
    print("자리가 얼마 없습니다")
print("지금 남은 자리", r)`},
{ren: ["k", "kilometer_speed"], code: `k = 60
if k > 50:
    print("속도를 줄이세요")
    print("어린이 보호구역입니다")
else:
    print("안전 속도입니다")
print("현재 속도", k)
print("안내 끝")`},
{ren: ["s", "step_count"], code: `s = 0
while s < 1000:
    s = s + 250
    print("걸음 수", s)
print("목표 달성")
print("오늘도 수고했어요")
print("기록 저장")`},
{ren: ["a", "answer_number"], code: `a = 7
g = 5
if g == a:
    print("정답입니다")
else:
    if g < a:
        print("더 큰 수입니다")
    else:
        print("더 작은 수입니다")
print("다시 도전")`},
{ren: ["c", "coin_count"], code: `c = 0
for i in range(1, 4):
    c = c + 500
    print("동전을 넣었다")
    print("지금까지", c, "원")
if c >= 1500:
    print("음료수가 나온다")
print("자판기 끝")`},
{ren: ["w", "water_ml"], code: `w = 0
while w < 2000:
    w = w + 500
    print("물 한 컵")
    print("마신 양", w)
print("하루 권장량 달성")`},
{ren: ["p", "page_number"], code: `p = 1
while p <= 3:
    print(p, "쪽을 읽는다")
    p = p + 1
print("책을 덮는다")
print("독서 기록을 쓴다")
print("불을 끈다")`},
{ren: ["h", "height_cm"], code: `h = 148
print("키:", h)
if h >= 140:
    print("탑승할 수 있습니다")
    print("안전띠를 매세요")
else:
    print("보호자와 함께 타세요")
print("즐거운 시간 되세요")`},
{ren: ["m", "minute_left"], code: `m = 3
while m > 0:
    print(m, "분 남았습니다")
    m = m - 1
print("시간 종료")
print("연필을 내려놓으세요")
print("답안지를 걷습니다")`}
];
/* ev = 0·1·2 (종목). tier = 고칠 곳 수 − 1 (0·1·2) — 점수 등급으로 쓴다 */
function gen(ev){
  const rnd = n => Math.floor(Math.random() * n), any = a => a[rnd(a.length)];
  for (;;){
    const sn = any(POOL), T = sn.code.split("\n"), L = [...T], sol = [], und = g => sol.unshift(...g);
    const cm = l => l.replace(/^(\s*)/, "$1# "), prints = A => A.map((l, i) => /^\s*print\(/.test(l) ? i : -1).filter(i => i >= 0);
    const K = ["indent", "comment", "move"];
    let kinds = ev === 0 ? (rnd(2) ? ["move"] : ["move", "move"])
      : ev === 1 ? [["indent"], ["comment"], ["indent", "comment"]][rnd(3)].concat(rnd(2) ? ["move"] : [])
      : [any(K)].concat(rnd(2) ? [any(K)] : []);
    kinds = [...new Set(kinds.filter(x => x !== "move"))].concat(kinds.filter(x => x === "move"));
    let n = 0;
    if (kinds.includes("comment") && rnd(2)){      // 목표 쪽에 주석이 있는 꼴 — 학생이 주석을 건다
      const i = any(prints(T)); T[i] = cm(T[i]); und([`L${i + 1}`, "comment"]); kinds = kinds.filter(x => x !== "comment"); n++;
    }
    for (const kd of kinds){
      if (kd === "move"){
        /* 묶음 길이 1~4줄. 세 줄 이상 묶음은 두 칸 이상 옮긴다 — 한 줄씩 돌려 푸는 것보다 묶어 옮기는 쪽이 빠르게 */
        const len = [1, 1, 1, 1, 2, 2, 3, 3, 3, 4][rnd(10)], a = rnd(L.length - len + 1), b = a + len - 1;
        let d = (len >= 3 ? rnd(2) + 2 : rnd(3) + 1) * (rnd(2) ? 1 : -1);
        if (a + d < 0 || b + d > L.length - 1) d = -d;
        if (a + d < 0 || b + d > L.length - 1) continue;
        L.splice(a + d, 0, ...L.splice(a, len));
        und([len > 1 ? `L${a + d + 1}-${b + d + 1}` : `L${a + d + 1}`, ...Array(Math.abs(d)).fill(d > 0 ? "up" : "down")]);
      } else if (kd === "indent"){
        const i = rnd(L.length);
        if (/^ {4}/.test(L[i]) && rnd(2)){ L[i] = L[i].slice(4); und([`L${i + 1}`, "indent"]); }
        else { L[i] = "    " + L[i]; und([`L${i + 1}`, "outdent"]); }
      } else {
        const i = any(prints(L)); L[i] = cm(L[i]); und([`L${i + 1}`, "comment"]);
      }
      n++;
    }
    let code = L.join("\n"); const target = T.join("\n");
    if (code === target) continue;
    if (ev === 2){ const [sh, lg] = sn.ren; code = code.replace(new RegExp(`(?<!\\w)${sh}(?!\\w)`, "g"), lg); sol.push(`N:${lg}>${sh}`, "save"); n++; }
    return {ev, code, target, save: ev === 2, sol, tier: Math.max(0, Math.min(2, n - 1))};
  }
}
/* sol 대로 풀어 본다 — 시험용 */
function solve(p){
  let st = {v: p.code, s: 0, e: 0}, dirty = true;
  const at = (a, b, sel) => { const L = st.v.split("\n"), o = k => L.slice(0, k).join("\n").length + (k ? 1 : 0);
    st = {v: st.v, s: o(a), e: sel ? o(b) + L[b].length : o(a)}; };
  for (const x of p.sol){
    let m;
    if ((m = x.match(/^L(\d+)(?:-(\d+))?$/))) at(m[1] - 1, (m[2] || m[1]) - 1, !!m[2]);
    else if ((m = x.match(/^N:(\w+)>(\w+)$/))){ const i = st.v.search(new RegExp(`(?<!\\w)${m[1]}(?!\\w)`)); st = rename({v: st.v, s: i, e: i}, m[2]) || st; dirty = true; }
    else if (x === "save") dirty = false;
    else { st = edit(st, x) || st; dirty = true; }
  }
  return {v: st.v, dirty};
}

/* ─── 화면 ─── */
const esc = s => s.replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
function hl(src){
  return src.replace(/(#.*)|("[^"\n]*"|'[^'\n]*')|\b(def|for|in|return|if|else|elif|while|import)\b|\b([A-Za-z_]\w*)(?=\()|\b(\d+)\b|([&<>])/g,
    (m, c, s, k, b, n) => c ? `<i class="c">${esc(c)}</i>` : s ? `<i class="s">${esc(s)}</i>` : k ? `<i class="k">${k}</i>` : b ? `<i class="b">${b}</i>` : n ? `<i class="n">${n}</i>` : esc(m));
}
const LH = 26;
const CSS = `
.ked{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:16px;align-items:start;text-align:left}
.ked i{font-style:normal}.ked .c{color:#6a9955}.ked .s{color:#ce9178}.ked .k{color:#c586c0}.ked .b{color:#dcdcaa}.ked .n{color:#b5cea8}
.ked-goal{background:#1e1e1e;border-radius:10px;padding:10px 14px 12px}
.ked-goal h4{margin:0 0 4px;font-size:13px;color:#7fd18b;font-weight:700}
.ked-goal pre{margin:0;font:15px/24px Consolas,"D2Coding",monospace;color:#d4d4d4;white-space:pre;overflow:hidden}
.ked-ed{background:#1e1e1e;border-radius:10px;overflow:hidden;outline:4px solid transparent;transition:outline-color .15s}
.ked-ed.ok{outline-color:#2ea043}
.ked-tabs{background:#252526;height:34px;display:flex}
.ked-tab{background:#1e1e1e;color:#fff;padding:0 14px;display:flex;align-items:center;gap:8px;font-size:13px;border-top:2px solid #007acc}
.ked-body{display:flex;font:16px/${LH}px Consolas,"D2Coding",monospace;color:#d4d4d4;padding:8px 0}
.ked-gut{flex:0 0 46px;color:#858585;text-align:right;padding-right:12px;user-select:none}
.ked-code{flex:1;position:relative;min-height:${LH * 9}px;overflow:hidden}
.ked-cur{position:absolute;left:0;right:0;height:${LH}px;background:#ffffff0d;pointer-events:none}
.ked-code textarea,.ked-hl{position:absolute;inset:0;margin:0;padding:0;border:0;font:inherit;white-space:pre;overflow:hidden;tab-size:4}
.ked-hl{pointer-events:none}
.ked-code textarea{width:100%;height:100%;background:none;color:transparent;caret-color:#fff;resize:none;outline:0;border-radius:0;box-shadow:none}
.ked-code textarea::selection{background:#264f78;color:transparent}
.ked-rn{position:absolute;display:none;z-index:5;background:#252526;border:1px solid #007acc;padding:4px;box-shadow:0 4px 12px #0008}
.ked-rn input{font:inherit;background:#3c3c3c;color:#fff;border:1px solid #007acc;padding:0 6px;width:12em;outline:0;border-radius:0}
.ked-rn small{display:block;color:#999;font:12px sans-serif;margin-top:3px}
.ked-status{background:#007acc;color:#fff;font-size:12px;padding:2px 12px;text-align:right}
.ked-toast{grid-column:1/-1;min-height:22px;text-align:center;color:#8a3b12;font-size:14px}
@media(max-width:820px){.ked{grid-template-columns:1fr}}`;
const NOTYPE = "글자 입력은 막혀 있다. 단축키로 푼다!";

/* box 안에 목표와 편집기를 짓는다. o.next() 가 문제를 주고, 풀면 o.onSolve(문제) 뒤 다음 문제로.
   box 가 화면에서 사라지면 저절로 손을 뗀다 */
function mount(box, o){
  if (!document.getElementById("ked-css")){ const s = document.createElement("style"); s.id = "ked-css"; s.textContent = CSS; document.head.append(s); }
  box.innerHTML = `<div class="ked"><div class="ked-goal"><h4>목표 — 이렇게 만든다</h4><pre></pre></div>
    <div class="ked-ed"><div class="ked-tabs"><span class="ked-tab">main.py <b class="ked-dot">●</b></span></div>
      <div class="ked-body"><div class="ked-gut"></div><div class="ked-code"><div class="ked-cur"></div>
        <textarea spellcheck="false" wrap="off" autocomplete="off"></textarea><pre class="ked-hl"></pre>
        <div class="ked-rn"><input spellcheck="false" autocomplete="off"><small>Enter: 이름 바꾸기 · Esc: 취소</small></div></div></div>
      <div class="ked-status"></div></div>
    <div class="ked-toast"></div></div>`;
  const q = s => box.querySelector(s), ta = q("textarea"), rni = q(".ked-rn input");
  let p = null, st = null, rn = false, tt;
  const toast = m => { q(".ked-toast").textContent = m; clearTimeout(tt); tt = setTimeout(() => { const t = q(".ked-toast"); if (t) t.textContent = ""; }, 2500); };
  const set = x => { ta.value = x.v; ta.setSelectionRange(x.s, x.e); st.text = x.v; };
  const cur = () => ({v: ta.value, s: ta.selectionStart, e: ta.selectionEnd});
  const commit = x => { st.undo.push(cur()); st.redo = []; st.dirty = true; set(x); };
  const paint = () => {
    const v = ta.value;
    q(".ked-hl").innerHTML = hl(v) + "\n";
    q(".ked-gut").innerHTML = v.split("\n").map((_, n) => `<div>${n + 1}</div>`).join("");
    q(".ked-cur").style.top = lineOf(v, ta.selectionStart) * LH + "px";
    q(".ked-dot").hidden = !st.dirty;
    q(".ked-ed").classList.toggle("ok", st.done);
    q(".ked-status").textContent = `줄 ${lineOf(v, ta.selectionStart) + 1} · Python`;
  };
  const closeRn = () => { rn = false; q(".ked-rn").style.display = "none"; };
  const load = np => {
    p = np; st = {undo: [], redo: [], dirty: !!p.save, done: false};
    closeRn(); q(".ked-goal pre").innerHTML = hl(p.target);
    set({v: p.code, s: 0, e: 0}); paint(); ta.focus();
    if (o.onLoad) o.onLoad(p);
  };
  const check = () => {
    if (st.done || !same(ta.value, p.target) || (p.save && st.dirty)) return;
    st.done = true; paint();
    if (o.onSolve) o.onSolve(p);
    setTimeout(() => { if (document.contains(box)) load(o.next()); }, 400);
  };
  const openRn = () => {
    const v = ta.value, w = wordAt(v, ta.selectionStart);
    if (!w) return toast("바꿀 이름 위에 커서를 두고 F2 를 누른다.");
    rn = true;
    const pre = v.slice(0, w.a).split("\n"), b = q(".ked-rn");
    b.style.display = "block"; b.style.top = pre.length * LH + "px"; b.style.left = Math.min(pre[pre.length - 1].length, 20) + "ch";
    rni.value = w.word; rni.focus(); rni.select();
  };
  const applyRn = () => {
    const name = rni.value.trim(); closeRn(); ta.focus();
    if (!okName(name)) return toast("이름에 쓸 수 없는 글자가 있다. 한/영 키를 확인한다.");
    const x = rename(cur(), name);
    if (x){ commit(x); paint(); check(); }
  };
  const run = cmd => {
    if (st.done) return;
    if (cmd === "save"){ st.dirty = false; toast("저장했습니다."); }
    else if (cmd === "rename") return openRn();
    else if (cmd === "undo" || cmd === "redo"){
      const from = cmd === "undo" ? st.undo : st.redo, to = cmd === "undo" ? st.redo : st.undo;
      if (!from.length) return;
      to.push(cur()); set(from.pop()); st.dirty = true;
    } else { const x = edit(cur(), cmd); if (x) commit(x); }
    paint(); check();
  };
  const keyCmd = e => {
    const k = e.key, c = e.ctrlKey || e.metaKey, sh = e.shiftKey, a = e.altKey;
    if (k === "F2") return "rename";
    if (k === "Tab" && !c && !a) return sh ? "outdent" : "indent";
    if (a && !c && k === "ArrowUp") return "up";
    if (a && !c && k === "ArrowDown") return "down";
    /* 한글 입력 상태에서도 잡히도록 글자 키는 e.code 로 본다 */
    if (c && e.code === "Slash") return "comment";
    if (c && e.code === "KeyS") return "save";
    if (c && e.code === "KeyZ") return sh ? "redo" : "undo";
    if (c && e.code === "KeyY") return "redo";
  };
  const onKey = e => {
    if (!document.contains(box)) return document.removeEventListener("keydown", onKey, true);
    if (e.key === "Alt") return e.preventDefault();          // Alt 만 눌렀다 떼면 브라우저 메뉴로 포커스가 간다
    const cmd = keyCmd(e);
    if (rn){ if (cmd && cmd !== "undo" && cmd !== "redo") e.preventDefault(); return; }
    if (!cmd) return;
    e.preventDefault(); run(cmd);
  };
  document.addEventListener("keydown", onKey, true);
  rni.addEventListener("keydown", e => {
    if (e.isComposing) return;
    if (e.key === "Enter"){ e.preventDefault(); applyRn(); }
    else if (e.key === "Escape"){ closeRn(); ta.focus(); }
  });
  rni.addEventListener("blur", () => { if (rn) closeRn(); });
  /* 글자 입력 차단 — 한글 조합은 beforeinput 으로 못 막아서 input 에서 되돌린다 */
  const revert = () => { if (ta.value !== st.text){ const at = Math.min(ta.selectionStart, st.text.length); ta.value = st.text; ta.setSelectionRange(at, at); } toast(NOTYPE); };
  ta.addEventListener("beforeinput", e => { e.preventDefault(); if (!e.isComposing) toast(NOTYPE); });
  ta.addEventListener("input", revert);
  ta.addEventListener("compositionend", revert);
  const onSel = () => { if (!document.contains(box)) return document.removeEventListener("selectionchange", onSel); if (document.activeElement === ta) paint(); };
  document.addEventListener("selectionchange", onSel);
  box.addEventListener("mouseup", e => { if (!rn && e.target !== rni) ta.focus(); });
  load(o.next());
}

const KeyEd = {EVENTS, POOL, gen, solve, same, edit, rename, wordAt, hl, mount};
if (typeof module !== "undefined" && module.exports) module.exports = KeyEd;
else root.KeyEd = KeyEd;
})(typeof window !== "undefined" ? window : globalThis);
