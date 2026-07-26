# P05 Test Plan

## 1. Baseline / Handoff

确认 P00/P01/P02/P03/P04 Commit 为祖先。

## 2. Full Gate

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

## 3. Dataset Unit

- Stable ReplayCase Hash；
- Snapshot Completeness；
- Dataset Version；
- Split by Goal；
- Split by Episode；
- Time Split；
- Tenant Split；
- Near Duplicate；
- Candidate Source Leakage；
- Synthetic Seed Leakage；
- Deletion；
- Retention。

## 4. Dataset Integration

- PostgreSQL Round Trip；
- Build 1k Cases；
- Duplicate Job；
- Worker Crash；
- Redis Flush；
- PostgreSQL Restart；
- Dataset Rebuild；
- stale Dataset；
- Migration fresh / rollback / reapply。

## 5. No-Physical Safety

尝试：

- MCP Tool；
- Provider Task；
- External Write API；
- Formal Notification；
- Formal Outcome；
- Active Pointer；
- Real Credential。

全部必须被拒绝并记录 unsafe。

## 6. Plan Replay

Golden Fixtures：

- Valid Template；
- Missing Criterion；
- Missing Evidence；
- Missing Artifact；
- Invalid DAG；
- Capability Gap；
- Readiness Gap；
- Policy Deny；
- Require Confirmation；
- Parameter Missing；
- Historical Plan Worse；
- Candidate More Efficient but Outcome Unknown。

## 7. Rule Replay

- True Positive；
- True Negative；
- False Positive；
- False Negative；
- Unsafe Allow；
- Missed Confirmation；
- Unknown Context；
- Conflict；
- Policy Override。

## 8. Counterfactual

验证：

- Plan Diff；
- Criterion Diff；
- Risk Diff；
- Node Count；
- Model Call；
- Token；
- Human Interaction；
- Recovery；
- 不确定 Outcome。

## 9. Reproducibility

相同：

```text
candidate hash
dataset hash
validator version
metric catalog version
```

必须产生相同 Result Hash。

## 10. Performance

至少报告：

- Dataset Build P50/P95；
- Replay P50/P95；
- 1k / 10k Case；
- Parallel Worker；
- DB Throughput；
- Memory；
- Queue Lag；
- Backpressure；
- Cancellation。

## 11. Scope Drift

`git diff` 检查不得出现：

- Shadow Runtime；
- Promotion；
- Approval；
- Active Pointer；
- Fast Gateway；
- Runtime Entry；
- Candidate Definition Mutation。
