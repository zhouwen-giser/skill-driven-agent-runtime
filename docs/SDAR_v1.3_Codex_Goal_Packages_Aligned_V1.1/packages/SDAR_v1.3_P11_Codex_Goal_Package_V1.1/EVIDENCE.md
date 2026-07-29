# P11 Evidence Contract

## G19 Completion Report

必须包含：

- Adapter Registration；
- Case Runtime Contract；
- Active / Stale Recheck；
- Case Structure；
- Similarity / Applicability；
- Adaptation；
- Failure Boundary；
- Case Plan Candidate；
- P08 Formal Handoff；
- Usage / Outcome；
- Drift；
- Security；
- Performance；
- Failed Attempts；
- Commit。

## G20 Completion Report

必须包含：

- Model Profile；
- Credential Boundary；
- Route Artifact；
- Hard Gates；
- Route Decision；
- Cascade；
- Budget / Deadline；
- Provider Adapter；
- Output Validation；
- Formal Authority；
- Usage / Token / Cost；
- Outcome / Drift；
- Security；
- Performance / Economics；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p11-case-runtime-schema.json
reports/goal/v1.3-p11-case-adaptation-report.json
reports/goal/v1.3-p11-case-handoff-report.json
reports/goal/v1.3-p11-model-profile-schema.json
reports/goal/v1.3-p11-model-route-schema.json
reports/goal/v1.3-p11-cascade-report.json
reports/goal/v1.3-p11-budget-cost-report.json
reports/goal/v1.3-p11-provider-readiness-report.json
reports/goal/v1.3-p11-usage-drift-report.json
reports/goal/v1.3-p11-security-report.json
reports/goal/v1.3-p11-performance-report.json
reports/goal/v1.3-p11-completion.md
reports/goal/v1.3-p11-review.md
```

## Review

重点检查：

- P10 Gateway Core 是否被类型算法污染；
- Case 是否复制历史实例 / PII；
- Similarity 是否覆盖 Goal / Policy；
- Case 是否绕过 P08；
- Artifact 是否保存 Credential；
- Model Route 是否绕过 Provider Registry；
- Historical Success 是否替代 Readiness；
- 是否无限级联 / 重试；
- Budget / Deadline 是否真实；
- 模型自评是否成为 Authority；
- 模型是否直接创建 Formal Plan；
- 是否直接调用 Skill / MCP；
- Cost / Outcome Attribution 是否正确；
- 是否跨 Tenant / Residency；
- 是否自动批准 / 激活。

## Git

建议：

```text
feat(v1.3): adapt active case templates
feat(v1.3): route and cascade model invocations
docs(v1.3): record P11 evidence
```
