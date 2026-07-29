# P09 Evidence Contract

## G16 Completion Report

必须包含：

- Runtime Port；
- Evaluation Context；
- Rule DSL；
- Deterministic Evaluator；
- Conflict Resolution；
- Policy / Authorization；
- Rule Decision；
- Parameter Suggestion；
- Plan Patch Candidate；
- P08 Formal Handoff；
- Idempotency / CAS；
- Usage / Outcome；
- Drift / Revalidation；
- API / Console / A2A Evidence；
- Security；
- Performance；
- Failed Attempts；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p09-rule-dsl-schema.json
reports/goal/v1.3-p09-operator-catalog.json
reports/goal/v1.3-p09-evaluation-report.json
reports/goal/v1.3-p09-conflict-resolution-report.json
reports/goal/v1.3-p09-policy-authority-report.json
reports/goal/v1.3-p09-plan-patch-report.json
reports/goal/v1.3-p09-usage-drift-report.json
reports/goal/v1.3-p09-security-report.json
reports/goal/v1.3-p09-performance-report.json
reports/goal/v1.3-p09-completion.md
reports/goal/v1.3-p09-review.md
```

## Review

重点检查：

- Rule 是否成为第二 Policy Engine；
- Unknown 是否被当 True；
- 是否有动态 eval；
- Conflict 是否让 Allow 覆盖 Deny；
- 是否修改 Goal / Criterion / Scope；
- 是否绕过 Existing Validator；
- 是否绕过 Existing Planning Authority；
- 是否直接执行 Skill / MCP；
- 是否授予 Authorization；
- 是否跳过 Stale / Policy / Readiness Recheck；
- 是否提前实现 Fast Gateway；
- Usage 是否复制 Outcome；
- 是否跨 Tenant；
- 是否泄露敏感 Operand。

## Git

建议：

```text
feat(v1.3): evaluate active decision rules
feat(v1.3): hand rule decisions to formal authority
docs(v1.3): record P09 evidence
```
