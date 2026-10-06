import sys, itertools, random, io, contextlib
sys.stdout.reconfigure(encoding="utf-8")
exec(open("round2b.py", encoding="utf-8").read().split("allc = R.bind")[0].replace("sys.stdout.reconfigure", "(lambda **k: None) or sys.stdout.reconfigure"))
allc = R.bind(params)
PAIR = {"Q01", "Q07", "Q12", "Q17", "Q21", "Q22", "Q24"}
nonpair = [p[0] for p in R.PROPS if p[0] not in PAIR]
uniq = lambda drop: len(R.count_solutions([c for c in allc if c[0] not in drop])) == 1
found = set()
random.seed(0)
for t in range(300):
    order = nonpair[:]; random.shuffle(order)
    opt = []
    for pid in order:
        if uniq(opt + [pid]): opt.append(pid)
    found.add(tuple(sorted(opt)))
best = max(len(f) for f in found)
print("짝 명제 제외 최대 ☆ 수:", best)
for f in sorted(found):
    if len(f) == best: print(" ", f)
# 짝 명제 하나를 포함하면 7개 가능한지
for f in sorted(x for x in found if len(x) == best):
    for p in PAIR:
        if uniq(list(f) + [p]): print("  +", p, "→ 7개:", f)
