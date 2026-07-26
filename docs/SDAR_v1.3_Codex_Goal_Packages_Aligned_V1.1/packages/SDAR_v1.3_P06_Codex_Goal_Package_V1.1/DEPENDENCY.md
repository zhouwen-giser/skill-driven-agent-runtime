# P06 Dependency Contract

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
