"""2판 수정: 정보가 약한 Q22(전체 합)·Q24(답 개수)와 1판과 같은 9번=5(Q07)를
'□번 답은 □' 명제로 교체해, 'N번+M번 합' 명제마다 짝이 되는 직접 답 명제를 둔다."""
import sys
import round2 as R

sys.stdout.reconfigure(encoding="utf-8")
_, key, params, _, _ = R.generate(2)  # 2판 정답·숫자 그대로

ans = lambda n: (lambda v, p: v[0] == p["a"], lambda k, n=n: {"a": k[n]})
REPLACE = {  # id: (텍스트, 범위)  — 짝: 괄호 안 합 명제
    "Q07": ("19번 문제 답은 {a}이다.", (19,)),   # ↔ Q21 14번+19번
    "Q22": ("15번 문제 답은 {a}이다.", (15,)),   # ↔ Q12 15번+16번, Q17 11번+15번
    "Q24": ("2번 문제 답은 {a}이다.", (2,)),     # ↔ Q01 1번+2번
}
props = []
for pid, text, idx, f, pf in R.PROPS:
    if pid in REPLACE:
        text, idx = REPLACE[pid]
        f, pf = ans(idx[0])
        params[pid] = pf(key)
    props.append((pid, text, idx, f, pf))
R.PROPS = props

allc = R.bind(params)
print("24개 해:", R.count_solutions(allc, limit=3))
# ☆ 7개: 짝 명제를 빼지 않고는 6개가 최대(star7.py, variants.py로 확인).
# 7번째는 15번=5(Q22) — 15번은 Q17·Q12·Q10으로도 나와 빼도 유일. 17명일 때만 빠진다.
opt = ["Q19", "Q08", "Q23", "Q18", "Q10", "Q14", "Q22"]  # 빼는 순서
assert len(R.count_solutions([c for c in allc if c[0] not in opt])) == 1
core = [c for c in allc if c[0] not in opt]
log = []
dom = {i: set(R.DOM) for i in range(1, 21)}
R.propagate(dom, core, log)
print("☆:", opt, "핵심 17개 전파 확정:", sum(len(d) == 1 for d in dom.values()))
print("\n".join(R.render(key, params, opt)))
print("정답:", key[1:])
for i, x, cid in log:
    print(f"  {i}번={x} ← {cid}")
