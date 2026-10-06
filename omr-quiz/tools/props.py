"""총 20문제·5지선다 정답 조건 → Python 명제 (수정본, 원본은 props_original.py).

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


# 덜 중요(빼도 정답이 하나로 유지): P07 P08 P14 P19 P22 P23 P24
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
    ("P06", "6~10번 문제 답의 합은 20이다.",  # 수정(원래: 6~10번 중 답이 3인 것이 2개)
     lambda a: sum(a[i] for i in range(6, 11)) == 20),
    ("P07", "9번 문제 답은 5이다.",
     lambda a: a[9] == 5),
    ("P08", "11~15번 문제 중 답이 3인 것은 2개이다.",  # 수정(원래: 11~15번 중복 없음)
     lambda a: sum(a[i] == 3 for i in range(11, 16)) == 2),
    ("P09", "4의 배수 문제는 답이 4가 아니다.",
     lambda a: all(a[i] != 4 for i in (4, 8, 12, 16, 20))),
    ("P10", "홀수 번호 문제의 답은 홀수이다.",
     lambda a: all(a[i] % 2 == 1 for i in range(1, 21, 2))),
    ("P11", "16~20번 문제의 답은 소수이다.",
     lambda a: all(a[i] in PRIMES for i in range(16, 21))),
    ("P12", "15번과 16번 답의 합은 8이다.",  # 수정(원래: 합 6)
     lambda a: a[15] + a[16] == 8),
    ("P13", "6의 배수 문제의 답은 내림차순이다.",  # 수정(원래: 오름차순)
     lambda a: desc([a[6], a[12], a[18]])),
    ("P14", "17번 문제의 답은 3이다.",
     lambda a: a[17] == 3),
    ("P15", "7번, 12번, 17번 문제는 답이 같다.",
     lambda a: a[7] == a[12] == a[17]),
    ("P16", "3번, 6번, 9번 문제는 답이 같다.",
     lambda a: a[3] == a[6] == a[9]),
    ("P17", "11번 15번 문제의 답의 합은 6이다.",
     lambda a: a[11] + a[15] == 6),
    ("P18", "12번과 13번 문제는 답이 같다.",  # 수정(원래: 12~14번 오름차순)
     lambda a: a[12] == a[13]),
    ("P19", "13~15번 문제의 답은 모두 서로소이다.",
     lambda a: all(math.gcd(x, y) == 1 for x, y in combinations([a[13], a[14], a[15]], 2))),
    ("P20", "13~15번 문제 답의 합은 10이다.",
     lambda a: a[13] + a[14] + a[15] == 10),
    ("P21", "14번과 19번 답의 합은 7이다.",  # 수정(원래: 14번 답은 2)
     lambda a: a[14] + a[19] == 7),
    ("P22", "1~20번 문제 답을 모두 더하면 67이다.",  # 추가
     lambda a: sum(a[1:21]) == 67),
    ("P23", "답이 4인 문제는 하나도 없다.",  # 추가
     lambda a: all(a[i] != 4 for i in range(1, 21))),
    ("P24", "답이 1인 문제는 2개이다.",  # 추가
     lambda a: sum(a[i] == 1 for i in range(1, 21)) == 2),
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
