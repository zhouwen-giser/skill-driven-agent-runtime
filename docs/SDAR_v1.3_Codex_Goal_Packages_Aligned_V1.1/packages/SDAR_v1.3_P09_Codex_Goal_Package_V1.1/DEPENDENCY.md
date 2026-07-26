# P09 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01～P06

提供：

- Decision Rule Artifact Domain；
- Artifact Repository / Audit / Usage；
- Rule Candidate Lineage；
- Rule Replay / FP / FN / Unsafe；
- Active / Revalidating / Kill Switch。

## P07

提供：

- Artifact Type = decision_rule；
- Status = active；
- Artifact Ref / Version / Hash；
- Applicability；
- Parameter Binding；
- Dependency Validation；
- Capability / Skill / Readiness；
- Policy；
- Reason Codes；
- Snapshot Hash。

## P08

提供：

- GoalContextSnapshot；
- Existing Plan Validator Adapter；
- Existing Planning Session Adapter；
- Formal Planner Handoff Port；
- Goal Version / CAS；
- Fallback / Confirmation；
- Usage / Outcome Correlation。

## v1.2.2 / v1.2.3

提供：

- Confirmed Goal Contract；
- Current Plan；
- Policy Guard；
- Authorization；
- Trusted World State；
- Business Event；
- Capability / Readiness；
- Formal Outcome；
- Correction / Recovery；
- Existing Interaction / Planning Session。

## 输出给 P10

- RuleRuntime Port；
- RuleDecisionContext；
- RuleEvaluationResult；
- RuleConflictResolution；
- RuleDecision；
- RulePlanPatchCandidate；
- Existing Formal Handoff Adapter；
- Reason Codes；
- Runtime Snapshot Hash；
- Fallback / Confirm / Deny；
- Rule Usage / Outcome；
- Drift / Revalidation Signal。
