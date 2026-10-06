"""총 20문제·5지선다 정답 조건 → Python 명제.

a[1] ~ a[20] 은 각 문제의 정답(1~5). a[0] 은 쓰지 않는다.
각 명제는 bool(True/False)을 돌려준다.
'내림차순/오름차순'은 엄격한 순서(같은 값 불허)로 해석했다. STRICT=False 로 바꾸면 같은 값 허용.
"""
import math
from itertools import combinations

STRICT = True
PRIMES = {2, 3, 5}  # 1~5 중 소수


def desc(xs):
    return all((x > y) if STRICT else (x >= y) for x, y in zip(xs, xs[1:]))


def asc(xs):
    return all((x < y) if STRICT else (x <= y) for x, y in zip(xs, xs[1:]))


PROPS = [
    ("P01", "1번과 2번 답의 합은 7이다.",
     lambda a: a[1] + a[2] == 7),
    ("P02", "1~5번 문제의 답에는 3번이 없다.",
     lambda a: all(a[i] != 3 for i in range(1, 6))),
    ("P03", "3~5번 문제의 답은 내림차순이다.",
     lambda a: desc([a[3], a[4], a[5]])),
    ("P04", "5의 배수 문제 중 답이 5번인 것이 3개이다.",
     lambda a: sum(a[i] == 5 for i in (5, 10, 15, 20)) == 3),
    ("P05", "6~8번 문제의 답은 내림차순이다.",
     lambda a: desc([a[6], a[7], a[8]])),
    ("P06", "6~10번 문제 중 답이 3인 것이 2개이다.",
     lambda a: sum(a[i] == 3 for i in range(6, 11)) == 2),
    ("P07", "9번 문제 답은 5이다.",
     lambda a: a[9] == 5),
    ("P08", "11~15번 문제 중에는 중복되는 답이 없다.",
     lambda a: len({a[i] for i in range(11, 16)}) == 5),
    ("P09", "4의 배수 문제는 답이 4가 아니다.",
     lambda a: all(a[i] != 4 for i in (4, 8, 12, 16, 20))),
    ("P10", "홀수 번호 문제의 답은 홀수이다.",
     lambda a: all(a[i] % 2 == 1 for i in range(1, 21, 2))),
    ("P11", "16~20번 문제의 답은 소수이다.",
     lambda a: all(a[i] in PRIMES for i in range(16, 21))),
    ("P12", "15번과 16번 답의 합은 6이다.",
     lambda a: a[15] + a[16] == 6),
    ("P13", "6의 배수 문제의 답은 오름차순이다.",
     lambda a: asc([a[6], a[12], a[18]])),
    ("P14", "17번 문제의 답은 3이다.",
     lambda a: a[17] == 3),
    ("P15", "7번, 12번, 17번 문제는 답이 같다.",
     lambda a: a[7] == a[12] == a[17]),
    ("P16", "3번, 6번, 9번 문제는 답이 같다.",
     lambda a: a[3] == a[6] == a[9]),
    ("P17", "11번 15번 문제의 답의 합은 6이다.",
     lambda a: a[11] + a[15] == 6),
    ("P18", "12~14번 문제의 답은 오름차순이다.",
     lambda a: asc([a[12], a[13], a[14]])),
    ("P19", "13~15번 문제의 답은 모두 서로소이다.",
     lambda a: all(math.gcd(x, y) == 1 for x, y in combinations([a[13], a[14], a[15]], 2))),
    ("P20", "13~15번 문제 답의 합은 10이다.",
     lambda a: a[13] + a[14] + a[15] == 10),
    ("P21", "14번 문제의 답은 2이다.",
     lambda a: a[14] == 2),
]


def check(answers):
    """answers: 길이 20 리스트(1번~20번 정답). 명제별 True/False 출력."""
    a = [None] + list(answers)
    ok = True
    for pid, text, f in PROPS:
        r = f(a)
        ok &= r
        print(f"{pid} {str(r):5} {text}")
    print("모두 참" if ok else "거짓인 명제 있음")
    return ok


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) == 21:
        check([int(x) for x in sys.argv[1:]])
    else:
        print("사용법: python props.py 정답1 정답2 ... 정답20")
