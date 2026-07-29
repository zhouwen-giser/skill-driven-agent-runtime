# P06 Test Plan

## Baseline / Full Gate

确认 P00～P05 Commit 为祖先；运行 frozen install 与 pnpm verify。

## Shadow

Run State、Stable Hash、Artifact/Goal/Plan/Policy/Catalog Stale、Unknown Outcome、Comparison、Policy Violation、Unsafe Attempt。

## Shadow Integration / Chaos

正式路径不受影响；Queue unavailable；Worker Crash；Redis Flush；PostgreSQL Restart；Duplicate/Out-of-order/Stale/Cancel/TTL/Sampling/Degraded/Backpressure。

## Zero Side Effect

主动尝试 Skill、MCP、Provider Task、External Write、Formal Goal/Plan/Attempt/Workflow/Outcome/A2A/Active Pointer，全部必须拒绝。

## Promotion / Activation

Eligibility、Unsafe、Needs More Data、Coverage、Counterexample、Risk、Hash、Identity、Reason、Old Evidence、Dependency、Status、Double Activation、CAS Race、Audit、Outbox、Cache Rebuild。

## Revalidation / Rollback

所有触发类型、重复触发、normal/urgent/critical、Safe Prior Version、Invalid Prior、No Safe Version、Kill Switch、幂等。

## Security

Anonymous Approval、Actor Spoofing、Role Escalation、Idempotency Reuse、Stale ExpectedVersion、Wrong Hash、Cross-Tenant、Forged Shadow Result、Model Approval。

## Performance

Shadow enqueue/evaluate、正式请求同步开销、Queue Lag、Promotion Build、Activation Transaction、Cache Invalidation、Revalidation Throughput。
