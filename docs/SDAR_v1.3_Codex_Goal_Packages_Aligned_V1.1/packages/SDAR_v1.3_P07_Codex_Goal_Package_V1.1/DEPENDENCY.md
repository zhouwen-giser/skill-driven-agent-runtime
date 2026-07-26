# P07 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01

提供：

- Artifact Type / Status；
- Applicability；
- Condition；
- Dependency Snapshot；
- Risk；
- Runtime Binding 边界。

## P02

提供：

- Artifact Repository；
- Active Pointer；
- Cache / Outbox；
- Tenant / Audit；
- Match / Execution Log 基础。

## P03 / P04 / P05

提供：

- Task Type / Pattern；
- Candidate Definition；
- Applicability Candidate；
- Validation Summary；
- Counterexample；
- Environment Coverage；
- Required Capability。

## P06

提供：

- Active Artifact Query；
- Active Pointer Version；
- Revalidating / Deprecated Exclusion；
- Promotion Summary；
- Dependency Snapshot；
- Cache Invalidation；
- Kill Switch；
- Feature Flag。

## v1.2.2 / v1.2.3

提供：

- Request / Goal Context；
- User-confirmed Contract；
- Task Type；
- Capability Summary；
- Internal Capability Query；
- Skill Registry；
- Provider Readiness；
- Policy；
- Trusted World State；
- Scoped User Preferences。

## 输出给 P08

- Active Plan Template Candidate Query；
- Selected Artifact Ref / Hash / Version；
- Match Score / Rank；
- Applicability Result；
- Parameter Bindings；
- Missing Parameters；
- Required Confirmation；
- Capability / Skill / Readiness Result；
- Policy Decision；
- Dependency Validation；
- Reason Codes；
- Matcher / Policy Snapshot Hash；
- Ambiguity / Fallback Signal。
