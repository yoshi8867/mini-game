/* ══════════════════════════════════════════════════════════════════════
   낱말을 **낱장 셋**으로 가르는 곳.

   낱말 하나를 14x14 점판으로 펼친 다음, 켜진 칸을 셋으로 나눠 갖는다.
   셋을 겹치면 원본이고, 한 장만 봐서는 잘 모른다.

   점을 **하나씩** 흩뿌리지 않는다. 돋움 14px 의 획은 한두 칸 두께라
   낱낱이 흩으면 글자가 아니라 먼지가 된다. 붙어 있는 점 셋을 한
   **덩어리**로 묶고 덩어리째 나눠 줘야 낱장에 획 토막이 남는다.

   가르기는 낱말 **통째로** 한다. 글자마다 따로 가르면 글자마다 꼭 1/3 씩
   떨어져 고르고 심심해진다. 통째로 가르면 어느 장에서는 첫 글자가 텅 비고
   넷째 글자가 꽉 찬다 — 세 장을 다 봐야 한다.

   이 파일은 서버에만 있다. 화면으로 내려가는 것은 **지금 보여 줄 한 장**의
   16진수 줄뿐이다. 셋을 한꺼번에 주면 소스를 열어 겹치면 그만이다.

   도토리 게임(treasure-hunter)의 server/words.py 를 옮겨 온 것이다.
   ══════════════════════════════════════════════════════════════════════ */
"use strict";

const SHEETS = 3;                  // 낱장 수
const LUMP = 3;                    // 한 덩어리에 묶는 점 수
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/* 씨앗 하나에서 늘 같은 수열이 나온다. 같은 문제는 어느 기기에서나
   같은 낱장으로 갈려야 한다 — 서버가 다시 뜨어도 그 판은 이어진다. */
function rand(seed){
  let a = (seed >>> 0) || 1;
  return function (){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function DOTS(G){
  const N = G.N, GRID = G.GRID, WORDS = G.WORDS;

  /* 점 하나를 정수 하나로. y 는 아래 4비트 (N 이 14 라 들어간다) */
  const key = (x, y) => x * 16 + y;
  const kx = p => p >> 4, ky = p => p & 15;

  /* ── 점판 ─────────────────────────────────────────────────────── */
  /* 글자 하나의 켜진 칸. dx 만큼 오른쪽으로 옮겨 준다 */
  function dots(ch, dx){
    const hexed = GRID[ch];
    const out = [];
    if (!hexed) return out;
    for (let y = 0; y < N; y++){
      const row = parseInt(hexed.substr(y * 4, 4), 16);
      for (let x = 0; x < N; x++)
        if (row & (1 << (N - 1 - x))) out.push(key(x + dx, y));
    }
    return out;
  }
  /* 낱말 한 벌을 옆으로 이어 붙인 점판 */
  function spell(word){
    let out = [];
    for (let i = 0; i < word.length; i++) out = out.concat(dots(word[i], i * N));
    return out;
  }
  /* 점 목록을 화면이 읽을 꼴로 — 글자마다 14줄 x 16진수 네 자리 */
  function pack(points, wide){
    const rows = [];
    for (let i = 0; i < wide; i++) rows.push(new Array(N).fill(0));
    for (const p of points){
      const x = kx(p), y = ky(p);
      rows[(x / N) | 0][y] |= 1 << (N - 1 - (x % N));
    }
    return rows.map(one => one.map(v => ("000" + v.toString(16)).slice(-4)).join(""));
  }

  /* ── 가르기 ───────────────────────────────────────────────────── */
  /* 붙어 있는 점을 size 개씩 묶는다. 낱낱이 흩지 않으려는 것이다 */
  function lumps(points, size, rnd){
    const left = new Set(points);
    const out = [];
    while (left.size){
      const all = [...left].sort((a, b) => a - b);
      const seed = all[(rnd() * all.length) | 0];
      left.delete(seed);
      const one = [seed];
      while (one.length < size){
        const near = new Set();
        for (const p of one){
          const x = kx(p), y = ky(p);
          for (const [dx, dy] of NB){
            const ny = y + dy;
            if (ny < 0 || ny >= N) continue;
            const q = key(x + dx, ny);
            if (left.has(q)) near.add(q);
          }
        }
        if (!near.size) break;
        const cand = [...near].sort((a, b) => a - b);
        const take = cand[(rnd() * cand.length) | 0];
        left.delete(take); one.push(take);
      }
      out.push(one);
    }
    return out;
  }
  /* 덩어리를 낱장에 돌린다. 늘 **제일 적은 장부터** 줘야 셋이 고르다 */
  function share(groups, rnd){
    const lay = [];
    for (let i = 0; i < SHEETS; i++) lay.push([]);
    for (const g of groups){
      let pick = 0, best = null;
      for (let i = 0; i < SHEETS; i++){
        const w = lay[i].length * 2 + rnd();     // 같은 수면 제비뽑기
        if (best === null || w < best){ best = w; pick = i; }
      }
      for (const p of g) lay[pick].push(p);
    }
    return lay;
  }

  /* 찢지 않은 성한 글자 — 맞혔을 때 보여 주는 것 */
  const whole = word => pack(spell(word), word.length);

  /* 낱말을 낱장 셋으로. 같은 씨앗이면 언제나 같은 낱장이 나온다 */
  function cut(word, seed){
    const rnd = rand(seed);
    const lay = share(lumps(spell(word), LUMP, rnd), rnd);
    for (let i = lay.length - 1; i > 0; i--){   // 첫 장이 늘 제일 많으면 눈치챈다
      const j = (rnd() * (i + 1)) | 0;
      [lay[i], lay[j]] = [lay[j], lay[i]];
    }
    return lay.map(one => pack(one, word.length));
  }

  return {N, SHEETS, LUMP, WORDS, GRID, spell, pack, cut, whole, lumps, share, rand};
}

if (typeof module !== "undefined") module.exports = DOTS;
