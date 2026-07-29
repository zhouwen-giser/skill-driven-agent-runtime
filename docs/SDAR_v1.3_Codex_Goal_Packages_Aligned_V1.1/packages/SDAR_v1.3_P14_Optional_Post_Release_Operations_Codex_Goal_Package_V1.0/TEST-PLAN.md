# P14 Test Plan

## Package / Boundary

- 非正式扩展标记；
- 无 G23；
- formalPackageCount = 14；
- P13 Final Handoff。

## Monitoring

- Dashboard Query；
- Missing Metric；
- Stale Metric；
- Tenant Filter；
- Secret Redaction；
- Alert Trigger / Recover；
- Dedup；
- Silence；
- Escalation。

## Incident

- SEV 分类；
- Owner；
- Evidence；
- Communication；
- Mitigation；
- Recovery；
- Postmortem。

## Drill

在授权环境：

- Gateway Disable；
- Artifact Kill Switch；
- Model Route Disable；
- Cognitive Fallback；
- Redis；
- Worker；
- PostgreSQL；
- Queue；
- Outbox；
- SSE。

## Drift / Feedback

- Fast / Fallback Attribution；
- Missing Outcome；
- Duplicate Outcome；
- Stale Usage；
- Correction；
- Model Cost Drift；
- Artifact Drift；
- Revalidation Recommendation。

## Security

- Cross Tenant；
- Credential in Dashboard；
- PII in Log；
- Unauthorized Operations；
- Actor Spoofing；
- Alert Data Exposure；
- Export。

## Cost / Capacity

- Token / Provider；
- Concurrent Request；
- Queue Lag；
- DB / Redis；
- Storage Growth；
- Forecast。

## No Automatic Production Action

测试所有脚本默认：

```text
dry-run / plan-only
```

生产写动作必须需要显式参数和人工确认。
