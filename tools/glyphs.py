# -*- coding: utf-8 -*-
"""
글자를 점판으로 굳히는 곳 — **한 번 돌리고 마는 것**이다.

    python tools/glyphs.py

docs/문제.txt 의 글자를 돋움 14px 로 찍어 14x14 점판으로 만들고,
server/glyphs.js 에 박아 둔다. 그 뒤로는 서버도 화면도 **폰트를 모른다.**

왜 굳히는가.
  * 글꼴이 깔려 있는지에 문제가 걸리지 않는다. 학생 폰마다 돋움이 있을
    까닭이 없고, 없으면 딴 글씨가 떠서 문제 자체가 달라진다
  * 점판이면 칸을 네모로 그리든 동그라미로 그리든 마음대로다.
    글씨가 아니라 **켜진 칸 목록**이라 낱장으로 가르기도 쉽다
  * 글자 하나가 16진수 56글자다. 문제 목록까지 합쳐도 4KB 가 안 된다

돌리는 데만 Pillow 와 돋움(gulim.ttc)이 든다 — 개발하는 자리에서만이다.
찍혀 나온 glyphs.js 는 아무것도 안 든다.

도토리 게임(treasure-hunter)의 server/glyphs.py 를 옮겨 온 것이다.
"""
import json
import re
import sys
from pathlib import Path

PX = 14                       # 글꼴 크기 — 돋움의 내장 비트맵 눈금이 있는 값
N = 14                        # 점판 한 변
PAD = 8                       # 넉넉히 찍어 두고 잘라 낸다
FONT = r"C:\Windows\Fonts\gulim.ttc"
FACE = 2                      # 굴림 0 · 굴림체 1 · **돋움 2** · 돋움체 3

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "docs" / "문제.txt"
OUT = ROOT / "server" / "glyphs.js"

HANGUL = re.compile(r"^[\uAC00-\uD7A3]+$")


def words():
    """문제 목록 — 적힌 순서 그대로."""
    out = []
    for line in SRC.read_text(encoding="utf-8").splitlines():
        w = line.strip()
        if not w or w.startswith("#") or not HANGUL.match(w):
            continue
        out.append(w)
    return out


def main():
    from PIL import Image, ImageDraw, ImageFont     # 찍을 때만 든다

    font = ImageFont.truetype(FONT, PX, index=FACE)

    def dots(ch):
        im = Image.new("L", (PX + PAD * 2, PX + PAD * 2), 0)
        ImageDraw.Draw(im).text((PAD, PAD), ch, font=font, fill=255)
        p = im.load()
        return {(x, y) for y in range(im.height) for x in range(im.width)
                if p[x, y] > 127}

    order = words()
    if not order:
        sys.exit("%s 에서 낱말을 못 찾았다" % SRC)
    assert len(set(order)) == len(order), "같은 낱말이 두 번 있다"
    assert all(1 <= len(w) <= 4 for w in order), "1~4글자만 낼 수 있다"

    chars = sorted({c for w in order for c in w})
    seen = {c: dots(c) for c in chars}

    # 글자마다 따로 가운데를 맞추면 받침 있는 글자와 없는 글자의 밑줄이
    # 어긋난다. 모두를 **한 틀**에 넣고 그 틀째로 가운데를 맞춘다
    xs = [x for s in seen.values() for x, _ in s]
    ys = [y for s in seen.values() for _, y in s]
    bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    print("글자 %d자 · 통짜 테두리 %d x %d" % (len(chars), bw, bh))
    if bw > N or bh > N:
        sys.exit("%dx%d 에 안 들어간다 — 틀을 키워야 한다" % (N, N))
    ox = min(xs) - (N - bw) // 2
    oy = min(ys) - (N - bh) // 2

    grid = {}
    for c in chars:
        rows = []
        for y in range(N):
            bit = 0
            for x in range(N):
                if (x + ox, y + oy) in seen[c]:
                    bit |= 1 << (N - 1 - x)
            rows.append("%04x" % bit)
        grid[c] = "".join(rows)

    ink = {c: sum(bin(int(grid[c][i:i + 4], 16)).count("1")
                  for i in range(0, N * 4, 4)) for c in chars}
    lo, hi = min(ink, key=ink.get), max(ink, key=ink.get)
    print("켜진 칸 — 가장 적은 %s %d개 · 가장 많은 %s %d개 · 평균 %.1f개"
          % (lo, ink[lo], hi, ink[hi], sum(ink.values()) / len(ink)))

    body = (
        '/* 돋움 %dpx 를 %dx%d 점판으로 굳힌 것. **손으로 고치지 않는다** —\n'
        '   docs/문제.txt 를 고치고 `python tools/glyphs.py` 를 다시 돌린다.\n'
        '\n'
        '   GRID   글자 하나 = %d줄 x 16진수 네 자리.\n'
        '          줄의 아래 %d비트를 쓰고, 맨 왼쪽 칸이 비트 %d 이다\n'
        '   WORDS  낼 순서 그대로의 문제 목록 */\n'
        '"use strict";\n'
        '\n'
        'const GLYPHS = {\n'
        '  N: %d,\n'
        '  GRID: %s,\n'
        '  WORDS: %s,\n'
        '};\n'
        'if (typeof module !== "undefined") module.exports = GLYPHS;\n'
        % (PX, N, N, N, N, N - 1, N,
           json.dumps(grid, ensure_ascii=False, indent=0).replace("\n", ""),
           json.dumps(order, ensure_ascii=False)))
    OUT.write_text(body, encoding="utf-8")

    print("%s — %.1fKB · 문제 %d개" % (OUT.name, OUT.stat().st_size / 1024, len(order)))
    for n in sorted({len(w) for w in order}):
        same = [w for w in order if len(w) == n]
        print("  %d글자 %2d개  %s" % (n, len(same), " ".join(same)))


if __name__ == "__main__":
    main()
