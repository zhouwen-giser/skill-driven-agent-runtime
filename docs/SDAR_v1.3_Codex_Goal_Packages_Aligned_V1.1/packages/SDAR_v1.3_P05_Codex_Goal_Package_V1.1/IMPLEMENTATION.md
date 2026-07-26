# P05 Implementation Plan

## G09：Replay Dataset 与 Fixture Builder

### 1. Source Inventory

建立 ReplayCase 所需 Source：

- Request；
- Goal Contract；
- Capability Catalog；
- World State；
- Policy；
- Readiness；
- Accepted Plan；
- Execution Trace；
- Outcome；
- Correction；
- Recovery；
- Feedback。

### 2. Snapshot Completeness

每个 Case 计算：

- Required Snapshot；
- Available Snapshot；
- Missing Snapshot；
- Completeness；
- Promotion Eligibility。

Snapshot 不完整的 Case 可用于开发或反例，但默认不能进入 Promotion Holdout。

### 3. Dataset Builder

构建四类：

```text
discovery
candidate_development
promotion_holdout
counterexample
```

### 4. Split Policy

至少按以下 Group 隔离：

- Tenant；
- Goal Lineage；
- Episode；
- Request Fingerprint；
- Near Duplicate；
- Device / Environment；
- Time Window。

禁止随机行级拆分导致同一 Goal Revision 跨 Set。

### 5. Leakage Guard

检测：

- Same Episode；
- Same Goal；
- Same Plan Revision；
- Same Outcome；
- Near Duplicate Request；
- Same Generated Fixture Seed；
- Candidate Source Trace 进入 Holdout。

### 6. Dataset Manifest

不可变保存：

- Case Refs；
- Source Range；
- Split Policy；
- Leakage Result；
- Source Hash；
- Content Hash；
- Deletion State；
- Dataset Version。

### 7. No-Physical Provider

实现 Replay Provider / Adapter，默认 fail closed。

### 8. Deletion / Retention

用户删除、租户删除或 Source Episode 删除时：

- 标记 Dataset 失效；
- 不原地改 Manifest；
- 生成新 Version；
- 触发已完成 Validation 的合规标记；
- 不继续 Promotion。

## G10：Replay 与流程一致性验证引擎

### 9. Static Validation Reuse

复用 P04 Static Validator，不复制另一份规则。

### 10. Plan Replay

流程：

```text
ReplayCase
+ PlanTemplateCandidate
→ Parameter Binding from Snapshot
→ UserGoalPlanCandidate
→ Existing Plan Validator
→ Criterion / Evidence / Artifact / Policy Comparison
```

不执行正式 Skill。

### 11. Rule Replay

为 P04 已定义的 Decision Rule Candidate Framework 提供：

- Context Input；
- Decision Output；
- Authority Decision Comparison；
- FP/FN；
- Unsafe Allow；
- Missed Confirmation。

如果 P04 尚未完整实现 Rule Candidate，仅实现 Contract / Fixture，不扩展 P04 范围。

### 12. Counterfactual Replay

比较：

```text
historical formal path
vs
candidate generated path
```

检查：

- Criterion；
- Risk；
- Plan Size；
- Model Cost；
- Human Interaction；
- Recovery；
- Outcome evidence。

不得声称未实际执行的 Candidate 一定会达到历史物理 Outcome。

### 13. Case Replay Contract

为 P11 Case Runtime 预留最小验证 Contract：

- Retrieval Input；
- Adaptation Candidate；
- Constraint Match；
- Failure Boundary；
- Outcome Comparison。

不实现 Case Runtime。

### 14. Metrics

实现 `VALIDATION-METRIC-CATALOG.md`，所有 Metric Versioned。

### 15. Result

保存不可变：

- ValidationRun；
- CaseResult；
- Metric；
- Failure；
- Counterexample；
- Unsafe；
- Result Hash。

### 16. Recommendation Boundary

P05 不生成 `approve` 或 `activate`。

可以生成：

```text
passed
failed
needs_more_data
unsafe
```

### 17. Worker

- at-least-once；
- PostgreSQL 幂等；
- Lease / fencing；
- bounded retry；
- Dead Letter；
- cancellation；
- stale Candidate discard；
- dataset version pin；
- artifact hash pin；
- Redis flush rebuild。

### 18. Performance

报告：

- Dataset Build Throughput；
- Replay Case P50/P95；
- 1k / 10k Cases；
- DB Read；
- Memory；
- Queue Lag；
- Parallelism；
- Backpressure；
- Cost。
