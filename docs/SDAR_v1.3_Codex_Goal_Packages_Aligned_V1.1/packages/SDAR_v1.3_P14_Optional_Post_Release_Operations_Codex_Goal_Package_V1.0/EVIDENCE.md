# P14 Evidence Contract

## 必需报告

```text
reports/operations/v1.3-post-release-baseline.md
reports/operations/v1.3-monitoring-inventory.json
reports/operations/v1.3-slo-error-budget.md
reports/operations/v1.3-alert-matrix.json
reports/operations/v1.3-incident-runbook.md
reports/operations/v1.3-rollback-runbook.md
reports/operations/v1.3-recovery-drill-report.md
reports/operations/v1.3-drift-review.md
reports/operations/v1.3-feedback-quality-report.json
reports/operations/v1.3-cost-capacity-report.md
reports/operations/v1.3-weekly-review-template.md
reports/operations/v1.3-monthly-governance-template.md
reports/operations/v1.3-improvement-backlog.json
reports/operations/v1.3-next-version-recommendation.md
reports/operations/v1.3-p14-review.md
reports/operations/v1.3-p14-completion.md
```

## 证据边界

不得在报告中包含：

- Secret；
- Credential；
- 未脱敏 PII；
- 私有思维链；
- 未授权 Tenant 数据。

## 生产动作

若未执行生产演练，必须写：

```text
not executed
reason
required authorization
planned procedure
```

不得写成通过。
