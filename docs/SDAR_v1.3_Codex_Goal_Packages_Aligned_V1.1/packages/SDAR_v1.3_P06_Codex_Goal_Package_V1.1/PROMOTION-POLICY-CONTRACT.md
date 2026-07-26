# P06 Promotion Policy Contract

## 必需输入

Artifact Hash、Static/Replay/Holdout/Shadow、Counterexample、Risk、Dependency、Policy Version、Rollback Plan。

## 硬拒绝

unsafe、side-effect attempt、policy violation、未解决 critical counterexample、身份无效、Dependency 无效、任何 Hash 不匹配。

## needs_more_data

Holdout/Shadow/Environment/Device Coverage 不足、置信区间过宽、Snapshot 不完整或 Counterexample 未分类。

## eligible_for_review

只表示可提交人工审查，不表示批准或激活。

## Human Approval

必须展示 Artifact Diff、Lineage、Validation、Shadow、Counterexample、Unknown、Applicability、Risk、Dependency、Rollback、Expected Benefit，并要求 Reason。

## 状态

```text
candidate → validating → awaiting_approval → active
```

禁止 candidate/validating 直接 active，禁止 revalidating 无新 Evidence/Approval 自动 active。
