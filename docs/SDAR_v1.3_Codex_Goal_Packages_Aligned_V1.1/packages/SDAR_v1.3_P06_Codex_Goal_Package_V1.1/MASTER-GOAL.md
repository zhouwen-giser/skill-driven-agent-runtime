# MASTER GOAL：SDAR v1.3 P06

## Goal ID

`SDAR-V1.3-P06`

## 原子 Goal

- G11：Shadow Engine
- G12：Artifact Approval、Promotion 与 Revalidation

## 目标

```text
P05 Immutable Validation
→ Shadow
→ Promotion Package
→ Human Approval
→ Activation
→ Revalidation / Deprecation
```

## 输入权威

P04 Candidate Definition/Lineage；P05 Dataset/Validation/Failure/Counterexample/Unsafe；正式 Request/Goal/Plan/Outcome；Current Dependency Snapshot；Operator Identity；P02 Approval/Active Pointer/Audit/Outbox。

## 输出权威

ShadowRun、ShadowResult、PromotionPackage、ApprovalRecord、ActivationRecord、RevalidationTrigger、StatusTransition、DeprecationRecord。

## 权威边界

```text
Formal Runtime > Shadow Runtime
Human Approval > Promotion Recommendation
Safety Policy > Business Benefit
P05 Immutable Validation > P06 Promotion Summary
P02 Active Pointer Transaction > Cache / Index Projection
```

## 完成合同

Shadow 零副作用；过期 Candidate/Goal 丢弃；Replay+Shadow Evidence 完整；Unsafe 永不批准；Approval 与 Activation 分离；Activation 使用事务/CAS；同 Key 单 Active；Revalidating 从在线索引排除；Rollback/Kill Switch 可用；不进入 Fast Gateway；P07 Handoff 完整。
