# P04 Test Plan

## 1. Baseline / Handoff

确认 P00/P01/P02/P03 Commit 为祖先，并核验 Schema Version。

## 2. Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## 3. Generalization Unit

Golden Cases：

- Device Instance→Device Class；
- Location→Environment Class；
- Time→Time Bucket；
- Range / Enum；
- Invariant；
- Required Condition；
- Forbidden Condition；
- Negative Example；
- Counterexample；
- User Preference Scope；
- Authorization Exclusion。

## 4. Model Stage

验证：

- Valid Output；
- Invalid JSON；
- Schema Error；
- Timeout；
- Provider Error；
- Redaction；
- Duplicate；
- no-op；
- Audit；
- Prompt Injection。

## 5. Candidate Generator

验证：

- Stable Content Hash；
- Stable Fingerprint；
- Duplicate Candidate；
- Lineage；
- Candidate Status；
- executable=false；
- Tenant Isolation；
- Generator Version。

## 6. Plan Template Compiler

Golden Fixtures：

- 标准线性流程；
- Optional Node；
- Parallel Candidate；
- Conditional Edge；
- Recovery；
- Human Gate；
- Multiple Capability；
- Multiple Criterion；
- Evidence / Artifact；
- Missing Criterion；
- Cycle；
- Orphan；
- Unsafe Default；
- Exact Skill Binding Rejection；
- Side-effect Replay Rejection。

## 7. Persistence / Integration

- Candidate Round Trip；
- Duplicate Job；
- Worker Crash；
- Redis Flush；
- PostgreSQL Restart；
- Model Retry；
- Dead Letter；
- Deletion Propagation；
- Migration fresh / rollback / reapply。

## 8. No Runtime Side Effects

P04 不得：

- 创建 Goal；
- 创建 Plan Session；
- 提交 UserGoalPlan；
- 创建 Skill Attempt；
- 调用 MCP；
- 修改 Outcome；
- 激活 Artifact；
- 切换 Active Pointer。

## 9. Performance

报告：

- Generalization P50/P95；
- Candidate Generation P50/P95；
- Static Validation P50/P95；
- 1k Pattern Batch；
- Model Call Rate；
- no-op Rate；
- Worker Throughput；
- Queue Lag。

P04 是离线链，不要求 Fast Gateway 在线指标，但必须有资源上限。
