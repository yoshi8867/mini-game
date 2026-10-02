#!/usr/bin/env python3
"""빌드한 페이지를 진짜 브라우저에 한 번 띄워 보고, 콘솔에 오류가 있으면 실패한다.

문법 검사(node --check)는 통과하는데 페이지가 죽는 일이 있었다. 선언보다 먼저
쓴 const 하나에 스크립트가 통째로 멎었고, 판도 규칙 창도 안 뜬 채로 배포됐다.
문법은 멀쩡했으니 node --check 로는 잡히지 않는다. 띄워 봐야 안다.

    python tools/page-check.py                 # index.html · admin.html · quiz.html · bid.html
    python tools/page-check.py index.html      # 고른 것만
"""
import os, re, subprocess, sys, tempfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHROME = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
]

def browser():
    for p in CHROME:
        if os.path.exists(p):
            return p
    return None

def check(exe, path):
    url = "file:///" + os.path.abspath(path).replace("\\", "/")
    shot = os.path.join(tempfile.gettempdir(), "page-check.png")
    out = subprocess.run(
        [exe, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         "--enable-logging=stderr", "--v=0", "--virtual-time-budget=4000",
         "--window-size=1280,800", "--screenshot=" + shot, url],
        capture_output=True, text=True, errors="replace", timeout=90)

    bad = []
    for line in (out.stderr or "").splitlines():
        if "CONSOLE" not in line:
            continue
        # 데이터 URI 를 쓰는 페이지라 파비콘 404 는 늘 난다. 그것만 눈감아 준다
        if "favicon" in line.lower():
            continue
        m = re.search(r'"(.*)", source', line)
        bad.append(m.group(1) if m else line.strip())

    size = os.path.getsize(shot) if os.path.exists(shot) else 0
    return bad, size

def main():
    exe = browser()
    if not exe:
        print("크롬이나 엣지를 못 찾았다. 검사를 건너뛴다.")
        return 0

    names = sys.argv[1:] or ["index.html", "admin.html", "quiz.html", "bid.html"]
    bad_total = 0
    for name in names:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            print(f"{name:14} 파일이 없다")
            bad_total += 1
            continue
        errs, size = check(exe, path)
        if errs:
            print(f"{name:14} 콘솔 오류 {len(errs)}건")
            for e in errs[:10]:
                print("   " + e)
            bad_total += 1
        elif not size:
            print(f"{name:14} 그림이 안 나왔다. 브라우저가 페이지를 못 띄웠다")
            bad_total += 1
        else:
            print(f"{name:14} 깨끗함 · 화면 {size//1024}KB")
    if bad_total:
        print("\n실패")
        return 1
    print("\n전부 통과")
    return 0

if __name__ == "__main__":
    sys.exit(main())
