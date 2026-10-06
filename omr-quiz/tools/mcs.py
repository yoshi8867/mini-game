import sys
from z3 import *
import props, solve
sys.stdout.reconfigure(encoding="utf-8")
names={p[0]:p[1] for p in props.PROPS}
for strict in (True, False):
    P=solve.z3_props(strict); props.STRICT=strict
    print(f"\n=== {'엄격' if strict else '같은 값 허용'} ===")
    blocks=[]; found=0
    while found<20:
        o=Optimize()
        o.add([And(solve.A[i]>=1,solve.A[i]<=5) for i in range(1,21)])
        b={n:Bool(n) for n in P}
        for n,c in P.items():
            o.add(Implies(b[n],c)); o.add_soft(b[n])
        for blk in blocks: o.add(Or([b[n] for n in blk]))  # 이미 찾은 제거 조합 배제
        if o.check()!=sat: break
        m=o.model(); drop=[n for n in P if not is_true(m.eval(b[n]))]
        if blocks and len(drop)>len(blocks[0]): break
        sol=[m.eval(solve.A[i]).as_long() for i in range(1,21)]
        blocks.append(drop); found+=1
        print(f"빼기 {len(drop)}개: {', '.join(drop)}  예시 정답: {sol}")
    print("빼는 명제 내용:")
    for n in sorted({n for d in blocks for n in d}): print(" ",n,names[n])
