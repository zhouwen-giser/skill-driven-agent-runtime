# P08 Evidence Contract

## G15 Completion Report

必须包含：

- Runtime Port；
- Input / Recheck；
- Goal Context；
- Parameter Materialization；
- Node / DAG；
- Completion Contract；
- Bounded Adaptation；
- Recovery；
- Existing Validator Adapter；
- Existing Planning Session Adapter；
- Goal-Version Handoff；
- Idempotency / CAS；
- Usage / Outcome；
- API / Console / A2A Evidence；
- Security；
- Performance；
- Failed Attempts；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p08-runtime-schema.json
reports/goal/v1.3-p08-goal-context-schema.json
reports/goal/v1.3-p08-materialized-plan-schema.json
reports/goal/v1.3-p08-adaptation-report.json
reports/goal/v1.3-p08-validator-integration-report.json
reports/goal/v1.3-p08-handoff-transaction-report.json
reports/goal/v1.3-p08-usage-outcome-report.json
reports/goal/v1.3-p08-security-report.json
reports/goal/v1.3-p08-performance-report.json
reports/goal/v1.3-p08-completion.md
reports/goal/v1.3-p08-review.md
```

## Review

重点检查：

- Template 是否成为第二 Planner；
- 是否绕过 Existing Validator；
- 是否绕过 Planning Session / Confirmation；
- 是否固化 exact Skill / Provider / MCP；
- 是否篡改 P07 Binding；
- 是否扩大 Goal / Scope；
- 是否删除 Human Gate；
- 是否跳过 Active / Goal / Policy / Readiness Recheck；
- 是否部分提交 Formal Plan；
- 是否直接执行 Skill / MCP；
- 是否提前实现 Fast Gateway；
- Usage 是否复制 Outcome Authority；
- 是否跨 Tenant。

## Git

建议：

```text
feat(v1.3): instantiate active plan templates
feat(v1.3): hand template plans to formal planner
docs(v1.3): record P08 evidence
```
