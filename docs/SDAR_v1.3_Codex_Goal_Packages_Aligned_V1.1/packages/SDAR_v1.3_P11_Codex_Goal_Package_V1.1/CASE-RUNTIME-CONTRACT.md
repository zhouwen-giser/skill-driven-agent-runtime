# P11 Case Runtime Contract

## 1. Case 定位

Case Template 是经过验证和激活的历史解决结构，不是历史实例重放。

Case 必须抽象：

- Entity；
- Location；
- Device；
- Time；
- Parameter；
- Environment；
- Capability；
- Failure Boundary。

## 2. 输入

只接受：

```text
artifactType=case_template
status=active
P07 disposition=eligible | requires_adaptation
confirmed Goal Context
```

## 3. Case 内容

Case 至少包含：

- Problem Signature；
- Goal Pattern；
- Context Pattern；
- Constraints；
- Plan Skeleton；
- Required Capability；
- Outcome Evidence；
- Failure Boundary；
- Recovery Boundary；
- Adaptation Rules；
- Counterexample Summary。

## 4. Similarity

Similarity 只用于排序，不能覆盖：

- Goal / Criterion；
- Policy；
- Authorization；
- Capability；
- Readiness；
- Failure Boundary；
- OOD。

## 5. Adaptation

允许：

- 参数映射；
- Entity Class 替换；
- 同 Capability 替换；
- Optional Step；
- 已定义 Recovery；
- Low-risk Order Adjustment。

禁止：

- 复制历史实例 ID；
- 复制 Credential；
- 扩大 Scope；
- 删除 Required Criterion；
- 删除 Human Gate；
- 增加未授权副作用；
- 重放已完成副作用；
- 将历史 Outcome 当当前成功证明。

## 6. Plan Candidate

Case 只能生成 `CasePlanCandidate`，必须进入 P08：

```text
Existing Plan Validator
→ Existing Planning Session / Confirmation
→ Goal Version Lock
→ Formal UserGoalPlan Authority
```

## 7. Failure Boundary

命中历史失败条件、未知高风险环境或 OOD：

```text
fallback / require_confirmation
```

不得强行适配。

## 8. Feedback

记录：

- Case Match；
- Adaptation；
- Validator；
- Confirmation；
- Formal Handoff；
- Outcome；
- Correction；
- Failure Boundary；
- Drift。

不修改 Formal Outcome。
