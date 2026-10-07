# -*- coding: utf-8 -*-
"""서버 주소를 한 번에 갈아 끼운다.

    python tools/set-server.py mini-shogi-7k2x.onrender.com

클라이언트 네 쪽(쇼기·관리자·퀴즈·비딩)에 기본 주소가 박혀 있다. 주소가
바뀔 때마다 네 군데를 손으로 고치면 반드시 하나를 빠뜨린다. 여기서 한 번에
고치고 바로 다시 빌드한다.

Render 무료 서비스의 주소는 계정마다 다르다 — 같은 이름을 다른 계정에서
다시 쓸 수 없기 때문이다. 계정을 옮기면 주소도 반드시 바뀐다.

    python tools/set-server.py --show      # 지금 박힌 주소만 본다
"""
import glob, io, os, re, subprocess, sys

try:                       # 윈도우 콘솔에서도 한글이 깨지지 않게
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESIGN = os.path.join(ROOT, "docs", "design")

# 템플릿은 세지 않고 훑는다. 쪽이 하나 늘 때마다 여기를 고치게 해 두면
# 반드시 그 한 쪽을 빠뜨린다 — 실제로 omr 을 그렇게 빠뜨렸다.
# motion 만 저장소 루트의 index.html 로 나가고, 나머지는 제 이름을 쓴다.
def templates():
    for f in sorted(glob.glob(os.path.join(DESIGN, "*.template.html"))):
        yield os.path.basename(f)[:-len(".template.html")], f


def pages():
    """저장소 루트로 나가는 쪽만 다시 빌드한다. docs/design 안에서만 쓰는
       시험 쪽(wood, koma-test …)까지 루트에 찍어 내면 안 된다 — 이미
       루트에 산출물이 있는 것만 고른다."""
    out = []
    for name, _ in templates():
        dst = "index.html" if name == "motion" else name + ".html"
        if os.path.exists(os.path.join(ROOT, dst)):
            out.append((name, dst))
    return out


PAGES = pages()
# 주소는 템플릿 전부에서 찾는다. 빌드를 안 하는 쪽도 고쳐는 둬야 한다
FILES = [f for _, f in templates()] + [os.path.join(ROOT, "README.md")]

HOST = re.compile(r"(?<=://)([a-z0-9][a-z0-9\-]*\.onrender\.com)")


def found():
    """지금 박혀 있는 주소들을 모은다"""
    out = {}
    for p in FILES:
        if not os.path.exists(p):
            continue
        for h in set(HOST.findall(io.open(p, encoding="utf-8").read())):
            out.setdefault(h, []).append(os.path.relpath(p, ROOT))
    return out


def main():
    args = [a for a in sys.argv[1:] if a != "--show"]
    now = found()
    if not now:
        print("박힌 주소가 없다. 바꿀 것도 없다.")
        return 0
    for h, where in sorted(now.items()):
        print("지금  " + h + "  (" + ", ".join(where) + ")")
    if "--show" in sys.argv or not args:
        if not args:
            print("\n바꾸려면 새 주소를 준다:  python tools/set-server.py <새주소>")
        return 0

    new = args[0].strip().rstrip("/")
    new = re.sub(r"^\w+://", "", new)          # wss:// 를 붙여 줘도 받는다
    new = new.split("/")[0]
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]*\.onrender\.com", new):
        print("주소 모양이 아니다: " + new)
        print("  보기)  mini-shogi-7k2x.onrender.com")
        return 1
    if len(now) > 1:
        print("\n주소가 여러 개 박혀 있다. 전부 " + new + " 로 모은다.")

    hit = 0
    for p in FILES:
        if not os.path.exists(p):
            continue
        s = io.open(p, encoding="utf-8").read()
        s2 = HOST.sub(new, s)
        if s2 != s:
            io.open(p, "w", encoding="utf-8").write(s2)
            hit += 1
            print("고침  " + os.path.relpath(p, ROOT))
    if not hit:
        print("이미 " + new + " 다.")
        return 0

    print("\n다시 빌드한다")
    for name, dst in PAGES:
        r = subprocess.run([sys.executable, os.path.join(DESIGN, "build.py"),
                            name, os.path.join(ROOT, dst)],
                           capture_output=True, text=True)
        if r.returncode:
            print("  실패 " + dst + " — " + (r.stderr or "").strip()[:200])
            return 1
        print("  " + dst)
    print("\n끝. tools/page-check.py 로 한 번 확인해라.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
