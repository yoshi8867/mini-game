import sys, random
from z3 import *
import solve
sys.stdout.reconfigure(encoding="utf-8")
A=solve.A
key=[5,2,5,2,1,5,3,2,5,5,1,3,3,2,5,3,3,2,5,5]
print("합",sum(key),"1의개수",key.count(1),"4의개수",key.count(4))
P=solve.z3_props(True)
gt=lambda x,y:x>y
P["P06"]=Sum([A[i] for i in range(6,11)])==20
P["P08"]=solve.cnt(range(11,16),3)==2
P["P12"]=A[15]+A[16]==8
P["P13"]=And(gt(A[6],A[12]),gt(A[12],A[18]))
P["P18"]=A[12]==A[13]
P["P21"]=A[14]+A[19]==7
P["P22"]=Sum([A[i] for i in range(1,21)])==67
P["P23"]=solve.cnt(range(1,21),4)==0
P["P24"]=solve.cnt(range(1,21),1)==2
uniq=lambda names: len(solve.solutions([P[n] for n in names],limit=2))==1
names=list(P)
assert uniq(names)
# 각 명제 단독 제거 시 유일성 유지 여부
print("단독으로 빼도 유일:", [n for n in names if uniq([m for m in names if m!=n])])
best=None
random.seed(1)
for t in range(60):
    order=names[:]; random.shuffle(order)
    core=names[:]
    for n in order:
        trial=[m for m in core if m!=n]
        if uniq(trial): core=trial
    if best is None or len(core)<len(best): best=core
    if len(best)<=15: break
print("최소 핵심 크기",len(best), sorted(best))
print("빼도 되는 것", sorted(set(names)-set(best)))
