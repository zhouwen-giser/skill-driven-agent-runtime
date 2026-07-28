# P06 Dependency Contract

## P05 completion boundary

P06 starts only after `reports/goal/v1.3-p05-handoff.json` is `COMPLETED`. It consumes
`ArtifactValidationResult V1.1` (`0a9b4fe3...14fd64b`) and `ArtifactCounterexample V1.1`
(`ef317932...d46f3`) from Shared Interface Registry V1.2
(`8aa828fa...7d60dee`). P06 may reference immutable P05 result, failure, counterexample, metric,
artifact-hash and dataset-hash evidence; it must not recompute or mutate P05 validation results.
This dependency alignment does not implement Shadow, Promotion, Approval, Activation, or
Revalidation.

## 必需前置

- P00 = READY_FULL；
- P01：Artifact Lifecycle / Dependency Snapshot / Validation Contract；
- P02：Version/Approval/Active Pointer/Audit/Outbox/Auth/CAS；
- P03：Trace/Pattern/Environment Coverage；
- P04：Candidate Definition/Hash/Lineage/Static Validation；
- P05：Dataset/ValidationResult/Failure/Counterexample/Unsafe/Metric/Result Hash。

## 正式 Runtime 提供

Request Correlation、Goal/Plan Version、Formal Outcome、Read-only Hook。

## 输出给 P07

Active Artifact Query Contract、Active Pointer Version、Status Semantics、Dependency Snapshot、Promotion Summary、Revalidating/Deprecated Exclusion、Cache Invalidation、Rollback/Kill Switch、Tenant Scope、Feature Flag。
