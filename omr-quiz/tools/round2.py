"""2판 생성기: 1판과 같은 문제 번호 세트를 쓰되 술어를 바꾸고, 숫자는 새 정답에 맞춰 정한다.

절차
 1) 구조 명제(숫자 없는 술어)를 만족하고 답 분포가 고른 정답을 무작위로 뽑는다.
 2) 숫자 명제(합·개수·특정 답)의 숫자를 그 정답에서 계산한다.
 3) 24개 전체로 해가 유일한지, ☆ 7개를 빼도 유일한지 확인한다.
 4) 국소 명제만으로 몇 단계에 풀리는지(전파 단계)를 세어 난이도를 비교한다.
"""
import itertools
import math
import random
import sys

N = 20
DOM = range(1, 6)


def asc(xs):
    return all(x < y for x, y in zip(xs, xs[1:]))


def desc(xs):
    return all(x > y for x, y in zip(xs, xs[1:]))


# ---------- 2판 명제 ----------
# (id, 텍스트 템플릿, 범위, 판정함수 f(vals, p), 파라미터 결정함수 param(key) or None)
# vals 는 범위 순서대로의 답 리스트, p 는 파라미터 dict
def mostcount(key, idx):
    """idx 위치 답 중 2개 이상 나온 값을 무작위로 골라 (값, 개수)."""
    vals = [key[i] for i in idx]
    cand = [v for v in DOM if vals.count(v) >= 2] or list(set(vals))
    v = random.choice(cand)
    return {"v": v, "k": vals.count(v)}


def absent(key, idx):
    vals = {key[i] for i in idx}
    cand = [v for v in DOM if v not in vals]
    return {"v": random.choice(cand)} if cand else None


PROPS = [
    ("Q01", "1번과 2번 답의 합은 {s}이다.", (1, 2),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": k[1] + k[2]}),
    ("Q02", "1~5번 문제의 답에는 2번이 없다.", (1, 2, 3, 4, 5),
     lambda v, p: 2 not in v, None),
    ("Q03", "3~5번 문제의 답은 오름차순이다.", (3, 4, 5),
     lambda v, p: asc(v), None),
    ("Q04", "5의 배수 문제 중 답이 {v}번인 것이 {k}개이다.", (5, 10, 15, 20),
     lambda v, p: v.count(p["v"]) == p["k"], lambda k: mostcount(k, (5, 10, 15, 20))),
    ("Q05", "6~8번 문제의 답은 모두 다르다.", (6, 7, 8),
     lambda v, p: len(set(v)) == 3, None),
    ("Q06", "6~10번 문제 답의 합은 {s}이다.", (6, 7, 8, 9, 10),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": sum(k[i] for i in range(6, 11))}),
    ("Q07", "9번 문제 답은 {a}이다.", (9,),
     lambda v, p: v[0] == p["a"], lambda k: {"a": k[9]}),
    ("Q08", "11~15번 문제 중 답이 {v}인 것은 {k}개이다.", (11, 12, 13, 14, 15),
     lambda v, p: v.count(p["v"]) == p["k"], lambda k: mostcount(k, range(11, 16))),
    ("Q09", "4의 배수 문제는 답이 {v}{iga} 아니다.", (4, 8, 12, 16, 20),
     lambda v, p: p["v"] not in v, lambda k: absent(k, (4, 8, 12, 16, 20))),
    ("Q10", "홀수 번호 문제의 답에는 3이 없다.", tuple(range(1, 21, 2)),
     lambda v, p: 3 not in v, None),
    ("Q11", "16~20번 문제의 답은 모두 다르다.", (16, 17, 18, 19, 20),
     lambda v, p: len(set(v)) == 5, None),
    ("Q12", "15번과 16번 답의 합은 {s}이다.", (15, 16),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": k[15] + k[16]}),
    ("Q13", "6의 배수 문제의 답은 모두 같다.", (6, 12, 18),
     lambda v, p: len(set(v)) == 1, None),
    ("Q14", "17번 문제의 답은 {a}이다.", (17,),
     lambda v, p: v[0] == p["a"], lambda k: {"a": k[17]}),
    ("Q15", "7번, 12번, 17번 문제의 답은 내림차순이다.", (7, 12, 17),
     lambda v, p: desc(v), None),
    ("Q16", "3번, 6번, 9번 문제의 답은 오름차순이다.", (3, 6, 9),
     lambda v, p: asc(v), None),
    ("Q17", "11번 15번 문제의 답의 합은 {s}이다.", (11, 15),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": k[11] + k[15]}),
    ("Q18", "13번 답은 12번 답보다 크다.", (12, 13),
     lambda v, p: v[1] > v[0], None),
    ("Q19", "13~15번 문제의 답 중 짝수는 1개뿐이다.", (13, 14, 15),
     lambda v, p: sum(x % 2 == 0 for x in v) == 1, None),
    ("Q20", "13~15번 문제 답의 합은 {s}이다.", (13, 14, 15),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": k[13] + k[14] + k[15]}),
    ("Q21", "14번과 19번 답의 합은 {s}이다.", (14, 19),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": k[14] + k[19]}),
    ("Q22", "1~20번 문제 답을 모두 더하면 {s}이다.", tuple(range(1, 21)),
     lambda v, p: sum(v) == p["s"], lambda k: {"s": sum(k[1:21])}),
    ("Q23", "6~10번 문제의 답에는 {v}{iga} 없다.", (6, 7, 8, 9, 10),
     lambda v, p: p["v"] not in v, lambda k: absent(k, range(6, 11))),
    ("Q24", "답이 {v}인 문제는 {k}개이다.", tuple(range(1, 21)),
     lambda v, p: v.count(p["v"]) == p["k"], lambda k: mostcount(k, range(1, 21))),
]
OPTIONAL_PREF = ["Q24", "Q22", "Q23", "Q19", "Q08", "Q14", "Q07", "Q20", "Q05", "Q09"]


# ---------- 전파 + 탐색 ----------
def propagate(dom, cons, log=None):
    """범위가 작은 명제로 각 문제의 가능한 답을 줄인다(일반화 호 일관성). 모순이면 False."""
    changed = True
    while changed:
        changed = False
        for cid, idx, f in cons:
            if math.prod(len(dom[i]) for i in idx) > 4000:
                continue
            support = {i: set() for i in idx}
            for combo in itertools.product(*(sorted(dom[i]) for i in idx)):
                if f(list(combo)):
                    for i, x in zip(idx, combo):
                        support[i].add(x)
            for i in idx:
                if support[i] != dom[i]:
                    if not support[i]:
                        return False
                    if log is not None and len(support[i]) == 1 and len(dom[i]) > 1:
                        log.append((i, next(iter(support[i])), cid))
                    dom[i] = support[i]
                    changed = True
    return True


def count_solutions(cons, limit=2):
    sols = []

    def rec(dom):
        if not propagate(dom, cons):
            return
        if all(len(dom[i]) == 1 for i in range(1, N + 1)):
            key = [None] + [next(iter(dom[i])) for i in range(1, N + 1)]
            if all(f([key[i] for i in idx]) for _, idx, f in cons):
                sols.append(key[1:])
            return
        i = min((i for i in range(1, N + 1) if len(dom[i]) > 1), key=lambda i: len(dom[i]))
        for x in sorted(dom[i]):
            if len(sols) >= limit:
                return
            d = {j: set(s) for j, s in dom.items()}
            d[i] = {x}
            rec(d)

    rec({i: set(DOM) for i in range(1, N + 1)})
    return sols


def bind(params, ids=None):
    out = []
    for pid, text, idx, f, pf in PROPS:
        if ids is None or pid in ids:
            p = params.get(pid)
            out.append((pid, idx, (lambda f, p: lambda v: f(v, p))(f, p)))
    return out


def random_key():
    """구조 명제만 만족하는 정답을 무작위로 하나."""
    structural = [(pid, idx, (lambda f: lambda v: f(v, None))(f))
                  for pid, _, idx, f, pf in PROPS if pf is None]
    dom = {i: set(DOM) for i in range(1, N + 1)}
    while True:
        d = {i: set(s) for i, s in dom.items()}
        ok = True
        for i in random.sample(range(1, N + 1), N):
            if not propagate(d, structural):
                ok = False
                break
            if len(d[i]) > 1:
                d[i] = {random.choice(sorted(d[i]))}
        if ok and propagate(d, structural) and all(len(d[i]) == 1 for i in d):
            key = [None] + [next(iter(d[i])) for i in range(1, N + 1)]
            counts = [key[1:].count(v) for v in DOM]
            if min(counts) >= 3 and max(counts) <= 5:  # 답 분포를 고르게
                return key


def generate(seed, tries=400):
    random.seed(seed)
    best = None
    for _ in range(tries):
        key = random_key()
        params = {}
        bad = False
        for pid, _, idx, f, pf in PROPS:
            if pf:
                p = pf(key)
                if p is None:
                    bad = True
                    break
                params[pid] = p
        if bad:
            continue
        allc = bind(params)
        if len(count_solutions(allc)) != 1:
            continue
        # ☆ 7개: 선호 순서대로 빼 보며 유일성이 유지되는 것만
        opt = []
        for pid in OPTIONAL_PREF:
            trial = [c for c in allc if c[0] not in opt + [pid]]
            if len(count_solutions(trial)) == 1:
                opt.append(pid)
            if len(opt) == 7:
                break
        if len(opt) < 7:
            continue
        # 난이도: 17개 핵심 명제로 전파만 해서 확정되는 답 수(=추론만으로 풀리는 정도)
        core = [c for c in allc if c[0] not in opt]
        dom = {i: set(DOM) for i in range(1, N + 1)}
        log = []
        propagate(dom, core, log)
        solved = sum(len(dom[i]) == 1 for i in dom)
        cand = (solved, key, params, opt, log)
        if best is None or solved > best[0]:
            best = cand
        if solved == N:
            break
    return best


def render(key, params, opt):
    lines = []
    for pid, text, idx, f, pf in PROPS:
        p = dict(params[pid]) if pf else {}
        if "v" in p:
            p["iga"] = "이" if p["v"] in (1, 3) else "가"  # 일·삼 → 이, 이·사·오 → 가
        t = text.format(**p) if pf else text
        lines.append(f"{pid} {'☆' if pid in opt else ' '} {t}")
    return lines


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    solved, key, params, opt, log = generate(seed)
    print("\n".join(render(key, params, opt)))
    print("정답:", key[1:], "분포:", {v: key[1:].count(v) for v in DOM})
    print("☆:", opt, " 핵심 17개 전파만으로 확정:", solved, "/ 20")
    for i, x, cid in log:
        print(f"  {i}번={x} ← {cid}")
