# P09 Usage / Feedback Contract

## 1. Rule Usage

记录：

- Rule Ref / Hash / Version；
- Evaluation Context Ref；
- Evaluation Result；
- Conflict Resolution；
- Decision；
- Formal Handoff Ref；
- Runtime Snapshot Hash；
- Created At。

## 2. Formal Outcome Link

建立：

```text
rule usage
→ decision
→ formal goal / plan
→ attempt / workflow
→ outcome
→ correction / recovery
```

P09 不复制 Formal Outcome。

## 3. 反馈事件

```text
artifact.rule_evaluated
artifact.rule_no_match
artifact.rule_confirmation_requested
artifact.rule_denied
artifact.rule_patch_proposed
artifact.rule_handoff_submitted
artifact.rule_outcome_observed
artifact.rule_drift_detected
```

这些不是正式任务状态事件。

## 4. Drift

至少监测：

- False Positive；
- False Negative；
- Unsafe Allow；
- Missed Confirmation；
- User Correction；
- Plan Patch Rejection；
- Fallback Rate；
- Outcome Regression；
- Environment Novelty；
- Policy Change；
- Readiness Change。

## 5. Revalidation Signal

P09 只发送 Trigger：

```text
normal
urgent
critical
```

不直接修改 Rule Status 或 Active Pointer。

## 6. 删除传播

按 Tenant / User 删除策略处理 Usage / Link，保留允许的匿名聚合，不保留 PII 或跨用户偏好。
