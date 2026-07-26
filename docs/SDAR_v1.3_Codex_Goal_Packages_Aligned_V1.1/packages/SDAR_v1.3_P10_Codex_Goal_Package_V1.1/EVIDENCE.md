# P10 Evidence Contract

## G17 Completion Report

必须包含：

- Request Entry Adapter；
- Gateway Context；
- Precheck；
- P07 / P09 / P08 Adapters；
- Intent Route；
- Route State Machine；
- Cognitive Fallback；
- Confirmation / Deny；
- Deadline / Cancellation；
- Idempotency；
- Circuit / Bulkhead / Load Shedding；
- API / A2A / SSE；
- Security；
- Performance；
- Failed Attempts；
- Commit。

## G18 Completion Report

必须包含：

- Feedback Envelope；
- Formal Correlation；
- Attribution；
- Outcome / Correction / Recovery；
- Runtime Metrics；
- Drift；
- Revalidation Signal；
- Compiler Feedback；
- Outbox / Worker；
- Deletion / Retention；
- Console / Management；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p10-gateway-schema.json
reports/goal/v1.3-p10-orchestration-report.json
reports/goal/v1.3-p10-deadline-report.json
reports/goal/v1.3-p10-fallback-report.json
reports/goal/v1.3-p10-resilience-report.json
reports/goal/v1.3-p10-feedback-schema.json
reports/goal/v1.3-p10-attribution-report.json
reports/goal/v1.3-p10-drift-report.json
reports/goal/v1.3-p10-protocol-report.json
reports/goal/v1.3-p10-security-report.json
reports/goal/v1.3-p10-performance-report.json
reports/goal/v1.3-p10-completion.md
reports/goal/v1.3-p10-review.md
```

## Review

重点检查：

- Gateway 是否重实现 P07/P09/P08；
- 是否成为第二 Planner / Policy；
- Deny 是否被 Fallback 绕过；
- Confirmation 是否被跳过；
- Deadline 后是否继续提交；
- Fallback 成功是否错误归功 Fast Path；
- Idempotency 是否防止双 Formal Handoff；
- Redis Cache 是否成为 Active Authority；
- Circuit 是否绕过 Policy；
- Feedback 是否复制 Outcome；
- Revalidation 是否直接改 Status；
- 是否自动批准 / 激活；
- 是否提前实现 Case / Model Route；
- 是否跨 Tenant；
- 是否泄露敏感 Evidence。

## Git

建议：

```text
feat(v1.3): orchestrate compiled artifact fast paths
feat(v1.3): capture artifact runtime feedback
docs(v1.3): record P10 evidence
```
