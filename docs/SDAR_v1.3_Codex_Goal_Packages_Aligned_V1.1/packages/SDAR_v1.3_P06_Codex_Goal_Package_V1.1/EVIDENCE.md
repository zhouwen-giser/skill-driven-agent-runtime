# P06 Evidence Contract

## G11

Shadow Hook、安全边界、Run/Result、Stale、Comparison、Capacity、Backpressure、Degraded、零副作用、性能、失败尝试、Commit。

## G12

Promotion Policy/Package、Eligibility、Human Approval、Activation Transaction、Active Pointer、Audit/Outbox、Revalidation、Deprecation、Rollback/Kill Switch、安全/并发、Commit。

## 必需机器证据

```text
reports/goal/v1.3-p06-shadow-schema.json
reports/goal/v1.3-p06-shadow-safety-report.json
reports/goal/v1.3-p06-shadow-capacity-report.json
reports/goal/v1.3-p06-promotion-policy.json
reports/goal/v1.3-p06-promotion-package-schema.json
reports/goal/v1.3-p06-activation-transaction-report.json
reports/goal/v1.3-p06-revalidation-report.json
reports/goal/v1.3-p06-security-report.json
reports/goal/v1.3-p06-completion.md
reports/goal/v1.3-p06-review.md
```

只读 Review 重点检查：任何正式副作用、共享正式幂等键、物理 Outcome 推断、Worker/LLM 审批、Approval/Activation 分离、Hash、CAS、Revalidating 排除、Rollback 失效版本、Fast Gateway 越界、跨 Tenant。
