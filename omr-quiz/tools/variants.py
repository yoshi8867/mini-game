import sys, random, itertools
import round2 as R
sys.stdout.reconfigure(encoding="utf-8")
_, key, params0, _, _ = R.generate(2)
BASE = list(R.PROPS)
ans = lambda n: (lambda v, p: v[0] == p["a"], lambda k, n=n: {"a": k[n]})
PAIR = {"Q01", "Q07", "Q12", "Q17", "Q21", "Q22", "Q24"}
for n7, n22, n24 in itertools.product((19, 14), (15, 16, 11), (2, 1)):
    rep = {"Q07": n7, "Q22": n22, "Q24": n24}
    params = dict(params0); props = []
    for pid, text, idx, f, pf in BASE:
        if pid in rep:
            n = rep[pid]; text, idx = f"{n}번 문제 답은 {{a}}이다.", (n,)
            f, pf = ans(n); params[pid] = pf(key)
        props.append((pid, text, idx, f, pf))
    R.PROPS = props
    allc = R.bind(params)
    if len(R.count_solutions(allc)) != 1: continue
    uniq = lambda drop: len(R.count_solutions([c for c in allc if c[0] not in drop])) == 1
    nonpair = [p[0] for p in props if p[0] not in PAIR]
    best = ()
    random.seed(0)
    for t in range(150):
        order = nonpair[:]; random.shuffle(order); opt = []
        for pid in order:
            if uniq(opt + [pid]): opt.append(pid)
        if len(opt) > len(best): best = tuple(sorted(opt))
    print(f"Q07={n7}번 Q22={n22}번 Q24={n24}번 → ☆최대 {len(best)}: {best}")
