# P03 Implementation Plan

## G05：Experience Trace Normalization

### 1. Source Inventory

建立 v1.2.3 正式来源表：

- Episode；
- Goal Contract；
- Planning Session；
- Correction；
- Skill Goal；
- Skill Attempt；
- Workflow；
- Remote Task；
- Outcome；
- Recovery；
- Business Event；
- Knowledge Usage；
- User Deletion。

### 2. Trace Builder

要求：

- 同一 Source Snapshot 产生相同 Trace Hash；
- 明确排序策略；
- 同时间事件使用权威序列或稳定 Tie-break；
- 并行关系不被压成串行；
- Branch / Parent Event 保留；
- 缺失字段不由模型补造；
- 不完整 Trace 保存 completeness 和 missing reason。

### 3. Redaction / Abstraction

实现可测试的：

- Identifier Abstraction；
- Location Class；
- Device Class；
- Time Bucket；
- PII Removal；
- Credential Rejection；
- Tool Result Summary；
- Private Reasoning Exclusion。

### 4. Fingerprint

至少实现：

- Goal Fingerprint；
- Capability Fingerprint；
- Environment Fingerprint；
- Cohort Hash。

算法必须：

- Canonical；
- Order-stable；
- Versioned；
- Tenant-aware。

### 5. Persistence

新增 Trace Authority：

- 不可变 Trace；
- Source Link；
- Normalizer Version；
- Source Hash；
- Unique Constraint；
- Deletion Propagation；
- Retention；
- Index。

### 6. Worker

- BullMQ / 现有队列；
- at-least-once；
- PostgreSQL 幂等；
- bounded retry；
- Dead Letter；
- Lease / fencing；
- Redis 清空后重建；
- 在线任务不等待。

## G06：Process Variant 与 Workflow Pattern Mining

### 7. Cohort Builder

按：

```text
tenant
task type
goal fingerprint
capability fingerprint
environment
device class
completeness
time range
```

建立 Cohort。

### 8. Variant Miner

实现：

- Activity Canonicalization；
- Sequence Variant；
- Direct-Follows Matrix；
- Precedence Matrix；
- Frequency；
- Success / Failure Count；
- Branch；
- Recovery；
- Human Intervention。

### 9. Mandatory / Optional

禁止仅按一次出现判断。

要求可配置阈值，并保存阈值版本。

### 10. Parallel Candidate

从：

- Trace concurrencyGroup；
- Partial Order；
- Overlap；
- Existing Plan Dependency；

识别候选。

不能用相同时间戳直接证明并行。

### 11. Recovery Pattern

分离：

```text
main path
failure trigger
recovery path
resume point
outcome
```

### 12. Quality

首版至少计算：

- support；
- success rate；
- variant coverage；
- activity fitness；
- precision proxy；
- environment coverage；
- contradiction count；
- generalization proxy。

指标需文档化，不伪装为完整学术 Conformance。

### 13. Workflow Pattern Projection

从 Process Pattern 生成结构化 WorkflowPattern：

- 保留活动与依赖；
- 不绑定 Skill；
- 不生成参数 Schema；
- 不生成 Completion Contract；
- 不生成 Artifact Candidate。

### 14. Offline Baseline

可选 PM4Py 对照：

- 固定 Dataset；
- 固定版本；
- 输出差异报告；
- 只作为测试证据。

### 15. Docs / Evidence

更新：

- Architecture；
- Storage；
- Worker；
- Traceability；
- Goal Completion；
- Handoff。
