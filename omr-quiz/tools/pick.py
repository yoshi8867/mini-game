import sys, itertools
sys.stdout.reconfigure(encoding="utf-8")
exec(open("core.py",encoding="utf-8").read().split("names=list(P)")[0])
names=list(P)
base={"P08","P19","P22","P23","P24"}
ok=[]
for pair in itertools.combinations([n for n in names if n not in base],2):
    drop=base|set(pair)
    if uniq([n for n in names if n not in drop]): ok.append(pair)
print(ok)
