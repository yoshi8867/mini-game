"""props.py 의 명제를 z3 로 풀어 정답 배열을 찾는다. 해가 없으면 충돌 명제를 찾는다.
찾은 해는 props.py 의 순수 Python 명제로 다시 검증한다."""
import sys
from itertools import combinations

from z3 import And, Distinct, If, Int, Or, Solver, Sum, sat

import props

sys.stdout.reconfigure(encoding="utf-8")
A = [None] + [Int(f"a{i}") for i in range(1, 21)]
cnt = lambda idx, v: Sum([If(A[i] == v, 1, 0) for i in idx])


def z3_props(strict):
    gt = (lambda x, y: x > y) if strict else (lambda x, y: x >= y)
    coprime_pairs = [(x, y) for x in range(1, 6) for y in range(1, 6)
                     if __import__("math").gcd(x, y) == 1]
    cop = lambda p, q: Or([And(A[p] == x, A[q] == y) for x, y in coprime_pairs])
    return {
        "P01": A[1] + A[2] == 7,
        "P02": And([A[i] != 3 for i in range(1, 6)]),
        "P03": And(gt(A[3], A[4]), gt(A[4], A[5])),
        "P04": cnt((5, 10, 15, 20), 5) == 3,
        "P05": And(gt(A[6], A[7]), gt(A[7], A[8])),
        "P06": cnt(range(6, 11), 3) == 2,
        "P07": A[9] == 5,
        "P08": Distinct([A[i] for i in range(11, 16)]),
        "P09": And([A[i] != 4 for i in (4, 8, 12, 16, 20)]),
        "P10": And([Or(A[i] == 1, A[i] == 3, A[i] == 5) for i in range(1, 21, 2)]),
        "P11": And([Or(A[i] == 2, A[i] == 3, A[i] == 5) for i in range(16, 21)]),
        "P12": A[15] + A[16] == 6,
        "P13": And(gt(A[12], A[6]), gt(A[18], A[12])),
        "P14": A[17] == 3,
        "P15": And(A[7] == A[12], A[12] == A[17]),
        "P16": And(A[3] == A[6], A[6] == A[9]),
        "P17": A[11] + A[15] == 6,
        "P18": And(gt(A[13], A[12]), gt(A[14], A[13])),
        "P19": And(cop(13, 14), cop(13, 15), cop(14, 15)),
        "P20": A[13] + A[14] + A[15] == 10,
        "P21": A[14] == 2,
    }


def solutions(cons, limit=50):
    s = Solver()
    s.add([And(A[i] >= 1, A[i] <= 5) for i in range(1, 21)])
    s.add(list(cons))
    out = []
    while len(out) < limit and s.check() == sat:
        m = s.model()
        sol = [m[A[i]].as_long() for i in range(1, 21)]
        out.append(sol)
        s.add(Or([A[i] != sol[i - 1] for i in range(1, 21)]))
    return out


def run(strict):
    props.STRICT = strict
    P = z3_props(strict)
    print(f"\n=== 순서 해석: {'엄격(같은 값 불허)' if strict else '같은 값 허용'} ===")
    sols = solutions(P.values())
    if sols:
        print(f"해 {len(sols)}개(최대 50개까지 셈). 첫 해 검증:")
        print(sols[0])
        props.check(sols[0])
        return
    print("모든 명제를 동시에 만족하는 정답 배열 없음.")
    names = {k: v for k, v in [(p[0], p[1]) for p in props.PROPS]}
    for k in (1, 2):
        fixes = []
        for drop in combinations(P, k):
            rest = [v for n, v in P.items() if n not in drop]
            if solutions(rest, limit=1):
                fixes.append(drop)
        if fixes:
            print(f"명제 {k}개만 빼면 해가 생기는 경우 {len(fixes)}가지:")
            for d in fixes:
                n = len(solutions([v for nn, v in P.items() if nn not in d], limit=50))
                print("  빼기:", " + ".join(f"{x}({names[x]})" for x in d), f"→ 해 {n}개{'+' if n == 50 else ''}")
            break


if __name__ == "__main__":
    run(True)
    run(False)
