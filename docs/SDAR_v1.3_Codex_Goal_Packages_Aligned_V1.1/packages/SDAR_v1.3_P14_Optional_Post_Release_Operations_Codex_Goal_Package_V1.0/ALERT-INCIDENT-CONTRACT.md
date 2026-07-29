# P14 Alert / Incident Contract

## Severity

```text
SEV-0: safety / cross-tenant / repeated physical side effect
SEV-1: formal runtime unavailable / active corruption / credential exposure
SEV-2: major degradation / high fallback / deadline regression
SEV-3: limited degradation / queue lag / cost drift
SEV-4: informational / improvement opportunity
```

实际等级服从组织规范。

## Alert

每个 Alert 必须：

- Signal；
- Threshold；
- Window；
- Severity；
- Owner；
- Dedup Key；
- Runbook；
- Recovery Condition；
- Escalation。

## Incident

记录：

- Start / Detect / Acknowledge / Mitigate / Resolve；
- Scope；
- Tenant；
- Artifact；
- Gateway；
- Provider；
- Formal Outcome；
- User Impact；
- Data Impact；
- Actions；
- Evidence；
- Root Cause；
- Follow-up。

## 禁止自动动作

默认不允许 Alert 自动：

- Rollback；
- Delete；
- Rotate Credential；
- Activate；
- Disable Provider；
- Restart Database。

自动化必须单独审核和授权。
