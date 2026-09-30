/* ══════════════════════════════════════════════════════════════════════
   손으로 만져 보는 검사.

   page-check.py 는 페이지가 뜨는지까지만 본다. 뜨기는 뜨는데 기물이 안
   끌리는 일이 있었다 — 한 번 고른 기물은 다시 눌러도 끌기가 시작되지
   않았다. 눈으로도 콘솔로도 안 보이고, 만져 봐야 안다.

   그래서 진짜 크롬을 띄우고 진짜 마우스 이벤트를 쏜다.

       node tools/drag-check.js
   ══════════════════════════════════════════════════════════════════════ */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const http = require("http"), {spawn} = require("child_process");
const {pathToFileURL} = require("url");
const ROOT = path.dirname(__dirname);
const WebSocket = require(path.join(ROOT, "server", "node_modules", "ws"));

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  "/usr/bin/google-chrome", "/usr/bin/chromium",
].find(p => p && fs.existsSync(p));

/* 검사용 손잡이를 IIFE 안에 끼워 넣은 사본을 만든다. 본 페이지는 건드리지 않는다 */
function probe(){
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const at = html.lastIndexOf("})();");
  if (at < 0) throw new Error("스크립트 끝(`})();`)을 못 찾았다");
  const hook = `
window.__t = {
  rules: v => rulesShow(v),
  give: (t, s) => { const q = {t, s, el: null};
    hand[s].push(q); build(q); place(q.el, handPos(s, hand[s].length - 1), true); updateCounts(); },
  hand: s => hand[s].length,
  full: (r, c) => !!cells[r][c],
  sel:  () => !!document.querySelector(".pc.sel"),
  log:  () => log.textContent,
  handAt: (s, i) => mid(hand[s][i].el),
  pieceAt: (r, c) => mid(cells[r][c].el),
  cellAt: (r, c) => { const t = cellTopLeft(r, c), b = stage.getBoundingClientRect();
                      return {x: b.left + t.x + cw/2, y: b.top + t.y + ch/2}; },
};
function mid(el){ const b = el.getBoundingClientRect();
                  return {x: b.left + b.width/2, y: b.top + b.height/2}; }
`;
  const out = path.join(os.tmpdir(), "drag-check.html");
  fs.writeFileSync(out, html.slice(0, at) + hook + html.slice(at));
  return out;
}

const getJSON = p => new Promise((ok, no) =>
  http.get({host: "127.0.0.1", port: 9222, path: p}, r => {
    let s = ""; r.on("data", d => s += d); r.on("end", () => ok(JSON.parse(s)));
  }).on("error", no));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main(){
  if (!CHROME){ console.log("크롬을 못 찾았다. 검사를 건너뛴다."); return 0; }
  const file = probe();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "drag-"));
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox",
    "--hide-scrollbars", "--remote-debugging-port=9222", "--user-data-dir=" + prof,
    "--window-size=1280,800", pathToFileURL(file).href],
    {stdio: "ignore", detached: false});

  let page = null;
  for (let i = 0; i < 40 && !page; i++){
    await sleep(250);
    try {                       /* 새 프로필은 빈 탭도 하나 띄운다. 그것 말고 우리 것 */
      page = (await getJSON("/json/list"))
        .find(t => t.type === "page" && t.url.indexOf("drag-check.html") >= 0);
    } catch (e) {}
  }
  if (!page){ chrome.kill(); throw new Error("크롬이 안 떴다"); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, {perMessageDeflate: false});
  let id = 0; const waits = new Map();
  ws.on("message", m => { const o = JSON.parse(m);
    if (o.id && waits.has(o.id)){ waits.get(o.id)(o); waits.delete(o.id); } });
  await new Promise(r => ws.on("open", r));
  const cmd = (method, params) => new Promise(r => {
    const i = ++id; waits.set(i, r); ws.send(JSON.stringify({id: i, method, params: params || {}})); });
  const ev = async e => {
    const r = await cmd("Runtime.evaluate", {expression: e, returnByValue: true, awaitPromise: true});
    const bad = r.result && r.result.exceptionDetails;
    if (bad) throw new Error(bad.exception && bad.exception.description || "평가 실패");
    return r.result.result.value;
  };
  const at = async e => JSON.parse(await ev("JSON.stringify(" + e + ")"));
  const mouse = (type, x, y) => cmd("Input.dispatchMouseEvent",
    {type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1,
     clickCount: 1, pointerType: "mouse"});
  const click = async p => { await mouse("mousePressed", p.x, p.y); await sleep(40);
                             await mouse("mouseReleased", p.x, p.y); await sleep(250); };
  const drag = async (f, t) => {
    await mouse("mousePressed", f.x, f.y);
    for (let i = 1; i <= 12; i++){
      await mouse("mouseMoved", f.x + (t.x-f.x)*i/12, f.y + (t.y-f.y)*i/12);
      await sleep(12);
    }
    await mouse("mouseReleased", t.x, t.y); await sleep(500);
  };
  await cmd("Page.enable");
  /* 규칙 팝업을 닫고, 손패에 룩을 한 개 쥐여 준 판에서 시작한다 */
  const fresh = async () => { await cmd("Page.reload", {ignoreCache: true}); await sleep(1600);
                              await ev("__t.rules(false); __t.give('G', 0)"); };

  let bad = 0;
  const ok = (c, m) => { console.log((c ? "  o " : "  X ") + m); if (!c) bad++; };

  await fresh();
  console.log("손패를 바로 끌어 놓기");
  await drag(await at("__t.handAt(0,0)"), await at("__t.cellAt(1,0)"));
  ok(await ev("__t.hand(0)") === 0 && await ev("__t.full(1,0)"), await ev("__t.log()"));

  await fresh();
  console.log("손패를 한 번 탭해 자리를 본 뒤 끌어 놓기");
  await click(await at("__t.handAt(0,0)"));
  await drag(await at("__t.handAt(0,0)"), await at("__t.cellAt(1,0)"));
  ok(await ev("__t.hand(0)") === 0 && await ev("__t.full(1,0)"), await ev("__t.log()"));

  await fresh();
  console.log("판 위 기물을 한 번 탭한 뒤 끌어 옮기기");
  await click(await at("__t.pieceAt(2,1)"));
  await drag(await at("__t.pieceAt(2,1)"), await at("__t.cellAt(1,1)"));
  ok(!(await ev("__t.full(2,1)")), await ev("__t.log()"));

  await fresh();
  console.log("두 번 탭하면 고르기가 풀린다");
  const h = await at("__t.handAt(0,0)");
  await click(h); await click(h);
  ok(!(await ev("__t.sel()")), "풀렸다");

  await fresh();
  console.log("판 밖에 떨어뜨리면 제자리로");
  await drag(await at("__t.handAt(0,0)"), {x: 40, y: 760});
  ok(await ev("__t.hand(0)") === 1, "손패에 그대로 남았다");

  ws.close(); chrome.kill();
  try { fs.rmSync(prof, {recursive: true, force: true}); } catch (e) {}
  console.log(bad ? "\n실패 " + bad + "건" : "\n전부 통과");
  return bad ? 1 : 0;
}

main().then(c => process.exit(c)).catch(e => { console.error("실패:", e.message); process.exit(1); });
