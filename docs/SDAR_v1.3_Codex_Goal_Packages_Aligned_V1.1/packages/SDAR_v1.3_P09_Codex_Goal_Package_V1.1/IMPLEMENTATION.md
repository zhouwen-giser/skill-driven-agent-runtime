# P09 Implementation Plan

## G16：Decision Rule 与 Policy Runtime

### 1. Handoff Validator

校验 P07：

- Artifact Type = decision_rule；
- Status = active；
- Artifact Hash / Pointer；
- Applicability；
- Parameter Binding；
- Dependency；
- Capability / Readiness；
- Policy；
- Snapshot Hash。

校验 P08 Formal Handoff Port。

### 2. Runtime Port

建立：

```text
evaluateDecisionRules()
resolveRuleConflicts()
submitRulePlanPatchToFormalAuthority()
```

P10 后续编排这些 Port，P09 不改正式 Request 入口。

### 3. Evaluation Context

构建不可变：

- Request；
- Goal / Plan Version；
- Rule；
- World；
- Business Event；
- Authorization；
- Binding；
- Capability / Readiness；
- Policy；
- Dependency；
- Runtime Snapshot Hash。

### 4. First Recheck

检查 Active / Hash / Pointer / Tenant / Goal / Plan / Policy / Catalog / Readiness / Kill Switch。

### 5. Rule DSL

实现严格 Parser / Schema / Static Validator / Bounds。

禁止动态 eval。

### 6. Deterministic Evaluator

实现三值逻辑、Typed Operator、Reason Code、Stable Hash。

### 7. Conflict Resolver

实现：

- Deny Override；
- Confirm Override；
- Specificity；
- Explicit Priority；
- Compatible Combination；
- Ambiguous Fallback；
- Stable Tie-break。

### 8. Policy / Authorization

调用现有 Policy / Authorization Port。

### 9. Decision

产生：

```text
advice
require_confirmation
deny
fallback
plan_patch_candidate
no_match
```

### 10. Parameter Suggestion

只允许低风险候选，交还 P07/P08 正式 Binding / Confirmation 流程。

### 11. Plan Patch Candidate

限制：

- 不改 Goal；
- 不改 Required Criterion；
- 不扩大 Scope；
- 不增加未授权副作用；
- 不删除 Human Gate；
- 有 Patch Bounds；
- 有 Source Rule；
- 有 Required Confirmation。

### 12. P08 Handoff

Rule Patch 必须通过：

- Existing Validator；
- Existing Planning Session；
- Goal Version Lock；
- Existing UserGoalPlan Authority。

### 13. Second Recheck

正式 Handoff 前重新检查 Rule / Goal / Plan / Policy / Catalog / Readiness / Kill Switch。

### 14. Idempotency / CAS

防止：

- 重复 Evaluation；
- 重复 Patch；
- 重复 Handoff；
- Stale Result；
- Out-of-order Event。

### 15. Usage / Outcome

保存 Rule Usage，关联正式 Outcome。

### 16. Drift / Revalidation

发送 False Positive、Unsafe、Correction、Fallback、Policy / Readiness Drift Trigger。

### 17. API / Console / A2A Evidence

展示：

- Rule 来源；
- Condition；
- Conflict；
- Policy；
- Decision；
- Confirmation；
- Formal Handoff；
- Outcome Link。

不泄露敏感 Operand 或内部 Rule 全量。

### 18. Tests / Evidence

完成 Unit、Contract、Integration、E2E、Concurrency、Security、Performance、Migration 和只读 Review。
