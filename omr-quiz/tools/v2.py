import sys
from z3 import *
import solve
sys.stdout.reconfigure(encoding="utf-8")
A=solve.A
for strict in (True,False):
    P=solve.z3_props(strict)
    gt=(lambda x,y:x>y) if strict else (lambda x,y:x>=y)
    P["P06"]=Sum([A[i] for i in range(6,11)])==20
    P["P08"]=solve.cnt(range(11,16),3)==2
    P["P12"]=A[15]+A[16]==8
    P["P13"]=And(gt(A[6],A[12]),gt(A[12],A[18]))
    P["P18"]=A[12]==A[13]
    P["P21"]=A[14]+A[19]==7
    s=solve.solutions(P.values(),limit=5)
    print("strict" if strict else "nonstrict", len(s), s)
    # redundancy: which props can be removed keeping uniqueness
    red=[n for n in P if len(solve.solutions([v for k,v in P.items() if k!=n],limit=2))==1]
    print(" 빼도 해가 유일한 명제:", red)
