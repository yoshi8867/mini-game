/* node cup.test.js — 대회를 서버에 띄워 놓고 끝까지 돌린다.
   관리자 창구로 열고, 학생 소켓으로 참가하고, 실제로 판을 둬서 우승자까지
   나오는지 본다. DB 는 끄고 돈다. */
"use strict";
const assert = require("assert");
const {spawn} = require("child_process");
const path = require("path");
const WebSocket = require("ws");
const EG = require("../shared/engine.js")();

const PW   = "cup-test-pw";               // 검사용. 서버에 넣어 주고 쓴다
const PORT = 3988;
const BASE = `http://127.0.0.1:${PORT}`;
const WSU  = `ws://127.0.0.1:${PORT}/ws`;
const wait = ms => new Promise(r => setTimeout(r, ms));

function client(){
  const ws = new WebSocket(WSU);
  const box = [], waiters = [];
  ws.on("message", raw => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex(w => w.t === m.t && (!w.pred || w.pred(m)));
    if (i >= 0) waiters.splice(i, 1)[0].go(m); else box.push(m);
  });
  return {
    ws,
    open: () => new Promise(r => ws.on("open", r)),
    send: (t, o) => ws.send(JSON.stringify(Object.assign({t}, o || {}))),
    next(t, ms = 6000, pred = null){
      const i = box.findIndex(m => m.t === t && (!pred || pred(m)));
      if (i >= 0) return Promise.resolve(box.splice(i, 1)[0]);
      return new Promise((go, fail) => {
        const w = {t, pred, go};
        waiters.push(w);
        setTimeout(() => {
          const j = waiters.indexOf(w);
          if (j >= 0){ waiters.splice(j, 1); fail(new Error(`${t} 를 못 받았다`)); }
        }, ms);
      });
    },
    drain(){ box.length = 0; },
    close: () => ws.close(),
  };
}
async function hello(pid){
  const c = client(); await c.open();
  c.send("hello", {pid});
  c.me = await c.next("me");
  await c.next("rooms");
  c.pid = pid;
  return c;
}
async function admin(what, body){
  const r = await fetch(`${BASE}/admin/${what}`, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify(body || {}),
  });
  return {status: r.status, body: await r.json()};
}

/* 한 대국을 끝까지 둔다. 서버가 심판이니 우리는 합법수만 보내면 된다 */
async function playOut(a, b, room){
  const seats = {};
  for (const c of [a, b]){
    c.send("join", {code: room});
    const s = await c.next("seated");
    seats[s.side] = c;
  }
  let st = await seats[0].next("state", 6000, x => x.ready);
  const pos = {b: Int8Array.from(st.b),
               hand: [st.hand[0].slice(), st.hand[1].slice()], turn: st.turn};
  let ply = st.ply, over = null, guard = 0;
  while (!over && guard++ < 300){
    const side = pos.turn, me = seats[side];
    const legal = EG.gen(pos);
    const m = legal[(Math.random() * legal.length) | 0];
    me.send("move", {m, ply});
    await Promise.all([a.next("moved"), b.next("moved")]);
    EG.make(pos, m); ply++;
    const ends = await Promise.all([a.next("over", 120).catch(() => null),
                                    b.next("over", 120).catch(() => null)]);
    over = ends[0];
    if (!over) await Promise.all([a.next("state"), b.next("state")]);
  }
  assert.ok(over, "300수 안에 안 끝났다");
  return over;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "index.js")], {
    env: Object.assign({}, process.env, {PORT: String(PORT), DATABASE_URL: "",
                                         ADMIN_PW: PW,
                                         MOVE_MS: "600000", GRACE_MS: "800",
                                         BOT_MS: "35"}),
    stdio: ["ignore", "pipe", "pipe"],
  });
  srv.stdout.on("data", () => {});
  srv.stderr.on("data", d => process.stderr.write(d));
  const bye = code => { try { srv.kill(); } catch (e) {} process.exit(code); };

  try {
    for (let i = 0; i < 40; i++){
      try { await fetch(`${BASE}/healthz`); break; } catch (e) { await wait(150); }
    }

    /* ── 1. 관리자 ─────────────────────────────────────────────────── */
    assert.strictEqual((await admin("login", {pw: "틀림"})).status, 401);
    const {body: lg} = await admin("login", {pw: PW});
    assert.ok(lg.token, "표를 못 받았다");
    const T = lg.token;
    assert.strictEqual((await admin("state", {token: "가짜"})).status, 401);

    const {body: made} = await admin("open", {token: T, pin: "7391", title: "검사 대회"});
    const CUP = made.cup.code;
    assert.strictEqual(made.cup.state, "open");
    console.log(`open    대회 ${CUP} · 참가 비번 7391`);

    /* ── 2. 참가 ───────────────────────────────────────────────────── */
    const P = [];
    for (let i = 0; i < 4; i++) P.push(await hello("pid-cup-player-" + i));

    P[0].send("cups");
    const seen = await P[0].next("cups");
    assert.ok(seen.cups.some(c => c.code === CUP), "목록에 대회가 안 보인다");

    P[0].send("cupjoin", {code: CUP, pin: "0000"});
    assert.strictEqual((await P[0].next("error")).why, "badpin", "틀린 비번으로 들어갔다");
    P[0].send("cupjoin", {code: "ZZZZ", pin: "7391"});
    assert.strictEqual((await P[0].next("error")).why, "nocup");

    for (const c of P){
      c.send("cupjoin", {code: CUP, pin: "7391"});
      const v = await c.next("cupme");
      assert.strictEqual(v.code, CUP);
      assert.strictEqual(v.state, "open");
      assert.ok(v.name, "닉네임이 안 실렸다");
      c.cupName = v.name;
    }
    /* 다시 들어와도 비번을 또 묻지 않는다 — 새로고침했을 뿐이다 */
    P[0].drain();
    P[0].send("cupjoin", {code: CUP});
    assert.strictEqual((await P[0].next("cupme")).people, 4);
    console.log(`join    4명 참가 · ${P.map(c => c.cupName).join(", ")}`);

    /* ── 3. 시작 ───────────────────────────────────────────────────── */
    P.forEach(c => c.drain());
    const {body: go} = await admin("start", {token: T, code: CUP});
    assert.ok(go.ok);
    assert.strictEqual(go.size, 4, "4명인데 4강 대진이 아니다");
    assert.strictEqual(go.byes, 0);

    const seats = [];
    for (const c of P){
      const v = await c.next("cupme", 6000, x => x.match);
      seats.push({c, m: v.match});
      assert.strictEqual(v.match.round, "준결승", "4강인데 라운드 이름이 틀렸다");
      assert.ok(v.match.room && v.match.foe, "대국 방이나 상대가 안 왔다");
    }
    assert.strictEqual((await admin("start", {token: T, code: CUP})).status, 409,
                       "시작한 대회가 또 시작됐다");
    console.log(`start   준결승 두 대국 · 방 ${[...new Set(seats.map(s => s.m.room))].join(" ")}`);

    /* 남의 대국에는 못 앉는다 */
    const other = seats.find(s => s.m.room !== seats[0].m.room);
    seats[0].c.drain();
    seats[0].c.send("join", {code: other.m.room});
    assert.strictEqual((await seats[0].c.next("error")).why, "notyours",
                       "남의 대국에 앉았다");

    /* ── 4. 준결승 두 판 ───────────────────────────────────────────── */
    const byRoom = {};
    seats.forEach(s => (byRoom[s.m.room] = byRoom[s.m.room] || []).push(s.c));
    const rooms = Object.keys(byRoom);
    const winners = [];
    for (const r of rooms){
      const [x, y] = byRoom[r];
      x.drain(); y.drain();
      const end = await playOut(x, y, r);
      const won = end.winner === null ? "무승부" : end.winner;
      winners.push({room: r, end});
      console.log(`play    ${r} · ${end.why} · 승자 ${won}`);
    }

    /* ── 5. 결승이 저절로 선다 ─────────────────────────────────────── */
    let finalRoom = null, finalists = [];
    for (const {c} of seats){
      const v = await c.next("cupme", 6000,
                             x => (x.match && x.match.round === "결승") || x.out);
      if (v.match && v.match.round === "결승"){
        finalRoom = v.match.room; finalists.push(c);
      } else {
        assert.ok(v.out, "진 사람이 탈락 표시가 안 됐다");
        assert.strictEqual(v.place, 3, "준결승 탈락은 공동 3위다");
      }
    }
    assert.strictEqual(finalists.length, 2, "결승 진출자가 둘이 아니다");
    assert.ok(finalRoom, "결승 방이 안 섰다");
    console.log(`next    결승 ${finalRoom} · 진출 2명 · 탈락 2명 공동 3위`);

    /* ── 6. 결승 ───────────────────────────────────────────────────── */
    finalists.forEach(c => c.drain());
    const last = await playOut(finalists[0], finalists[1], finalRoom);
    let champ = null;
    for (const c of finalists){
      const v = await c.next("cupme", 6000, x => x.state === "done");
      assert.strictEqual(v.state, "done");
      assert.ok(v.champion, "우승자가 안 실렸다");
      champ = v.champion;
      if (v.place === 1) assert.strictEqual(v.name, champ);
    }
    console.log(`final   ${last.why} · 우승 ${champ}`);

    /* ── 7. 관리자가 본 최종 대진표 ────────────────────────────────── */
    const {body: st} = await admin("state", {token: T});
    const cup = st.cups.find(c => c.code === CUP);
    assert.strictEqual(cup.state, "done");
    assert.strictEqual(cup.champion, champ);
    assert.strictEqual(cup.counts.done, 3, "4강이면 대국은 셋이다");
    assert.strictEqual(cup.counts.playing, 0);
    assert.strictEqual(cup.entrants.filter(p => p.place === 1).length, 1);
    assert.strictEqual(cup.entrants.filter(p => p.place === 3).length, 2);

    /* 대회 대국은 공개 목록에 안 뜬다 */
    P[0].drain(); P[0].send("list");
    const pub = await P[0].next("rooms");
    assert.strictEqual(pub.rooms.length, 0, "대회 대국이 공개 목록에 샜다");
    console.log("board   우승 1 · 공동3 둘 · 대국 3판 · 공개 목록에는 안 샘");

    /* ── 7-1. 관전 ─────────────────────────────────────────────────── */
    {
      const {body: c2} = await admin("open", {token: T, pin: "1357", title: "관전 검사"});
      const CUP2 = c2.cup.code;
      const eye = await hello("pid-cup-eye-1");
      eye.send("cupjoin", {code: CUP2, pin: "1357"});
      await eye.next("cupme");
      /* 나까지 여덟이면 부전승 없이 네 대국이 선다. 셋은 연습끼리 둔다 */
      await admin("mock", {token: T, code: CUP2, n: 7});
      await admin("start", {token: T, code: CUP2});

      /* 구경꾼은 대진표를 받아 고른다 */
      eye.send("cupboard");
      const bd = await eye.next("cupboard");
      const playing = bd.rounds[0].matches.filter(m =>
        m.state === "playing" && m.a.pid !== bd.me && m.b.pid !== bd.me);
      assert.strictEqual(bd.rounds[0].matches.length, 4, "8명인데 첫 라운드가 넷이 아니다");
      assert.ok(playing.length >= 2, "연습끼리 두는 대국이 안 섰다");

      eye.send("watch", {code: playing[0].room});
      const w = await eye.next("watching");
      assert.strictEqual(w.code, playing[0].room);
      assert.strictEqual(w.people.length, 2, "관전 화면에 둘이 안 실렸다");

      /* 관전자에게는 판이 오고, 두는 사람에게는 관전자 수가 간다 */
      const st = await eye.next("state", 6000, x => x.spect);
      assert.strictEqual(st.spect, true);
      assert.ok(st.fans >= 1, "관전자 수가 안 실렸다");
      assert.strictEqual(st.side, undefined, "관전자에게 자리가 갔다");

      /* 대회 밖 사람은 못 본다. 코드만 알면 남의 비공개 대국을 들여다볼 수
         있다면, 관전 창구가 엿보기 창구가 된다 */
      const peep = await hello("pid-cup-peep-1");
      peep.send("watch", {code: playing[0].room});
      assert.strictEqual((await peep.next("error")).why, "notyours",
                         "대회 밖 사람이 관전했다");
      peep.close();

      /* 연습 상대가 실제로 둔다 */
      const mv = await eye.next("moved", 8000);
      assert.ok(Number.isInteger(mv.m), "연습 상대가 안 둔다");
      console.log(`watch   관전 ${w.code} · 관전자 ${st.fans}명 · 연습 상대가 스스로 둔다`);

      /* 그 대국이 끝나면 구경꾼에게도 결과가 온다 */
      const done = await eye.next("over", 60000);
      assert.ok(done, "끝났는데 구경꾼이 결과를 못 받았다");
      console.log(`watch   관전하던 대국이 ${done.why} 로 끝나는 것까지 받는다`);

      eye.send("unwatch");
      eye.close();
      await admin("close", {token: T, code: CUP2});
    }

    /* ── 8. 대회 닫기 ──────────────────────────────────────────────── */
    assert.ok((await admin("close", {token: T, code: CUP})).body.ok);
    const {body: gone} = await admin("state", {token: T});
    assert.strictEqual(gone.cups.length, 0, "닫았는데 대회가 남았다");
    console.log("close   대회를 닫으면 대국까지 함께 치운다");

    /* ── 9. 끊겼다 돌아온다 ─────────────────────────────────────────── */
    /* 대국 중 연결이 끊긴 사람이 같은 pid 로 돌아오면 제자리에 앉아야 한다.
       대회 화면은 자리표 없이 cupjoin → join 으로 돌아오는데, 전에는 「끊긴
       사람을 기다리는 중」이라며 바로 그 사람을 돌려보냈고 기다림이 끝나면
       몰수패가 났다. 와이파이가 한 번 끊겨도 생기는 일이다. */
    {
      const {body: m3} = await admin("open", {token: T, pin: "5151", title: "복귀 대회"});
      const CUP3 = m3.cup.code;
      const x = await hello("pid-cup-back-x"), y = await hello("pid-cup-back-y");
      for (const c of [x, y]){ c.send("cupjoin", {code: CUP3, pin: "5151"}); await c.next("cupme"); }
      await admin("start", {token: T, code: CUP3});
      const got = await x.next("cupme", 6000, v => v.match);
      const room = got.match.room;
      x.send("join", {code: room}); y.send("join", {code: room});
      const sx = await x.next("seated");
      await y.next("seated");
      x.close();                                 /* x 의 연결이 끊긴다 */
      await wait(150);
      const x2 = await hello("pid-cup-back-x"); /* 같은 사람이 새 연결로 */
      x2.send("cupjoin", {code: CUP3});
      const back = await x2.next("cupme", 6000, v => v.match);
      assert.strictEqual(back.match.room, room, "돌아온 사람에게 다른 대국을 알려 줬다");
      x2.send("join", {code: back.match.room});  /* 대회 화면이 하는 그대로 — 자리표 없이 */
      const sx2 = await Promise.race([x2.next("seated", 3000), x2.next("error", 3000)]);
      assert.strictEqual(sx2.t, "seated", "돌아온 사람이 제자리에 못 앉았다 (" + (sx2.why || "") + ")");
      assert.strictEqual(sx2.side, sx.side, "돌아온 사람이 다른 자리에 앉았다");
      /* 기다림이 지나도 몰수패가 나지 않는다 — 이미 돌아왔으니까 */
      await wait(1200);
      const {body: st3} = await admin("state", {token: T});
      const c3 = st3.cups.find(c => c.code === CUP3);
      assert.strictEqual(c3.state, "running", "돌아왔는데 몰수패로 끝났다");
      console.log("back    대국 중 끊겼다 돌아온 사람은 자리표 없이도 제자리 · 몰수패 없음");
      [x2, y].forEach(c => c.close());
      await admin("close", {token: T, code: CUP3});
    }

    P.forEach(c => c.close());
    await wait(150);
    console.log("\n전부 통과");
    bye(0);
  } catch (e){
    console.error("\n실패:", e.message);
    bye(1);
  }
})();
