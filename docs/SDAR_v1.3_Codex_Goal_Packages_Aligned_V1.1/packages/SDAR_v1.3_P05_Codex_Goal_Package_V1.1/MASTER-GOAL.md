# MASTER GOAL：SDAR v1.3 P05

## Goal ID

```text
SDAR-V1.3-P05
```

## 原子 Goal

```text
G09：Replay Dataset 与 Fixture Builder
G10：Replay 与流程一致性验证引擎
```

## 目标

建立：

```text
P04 Candidate
+
v1.2.3 Historical Facts
+
Frozen Snapshots
        |
        v
Replay Dataset
        |
        v
Validation Engine
        |
        v
Immutable Validation Result
```

## 输入权威

P05 只读取：

- P04 Candidate Definition；
- P04 Static Validation；
- P04 Candidate Lineage；
- v1.2.3 Request / Goal Contract；
- Accepted Plan；
- Planning Corrections；
- Capability Catalog Snapshot；
- World State Snapshot；
- Policy Snapshot；
- Skill / Provider Readiness Snapshot；
- Execution Trace；
- Final Outcome；
- Recovery；
- User Feedback；
- Counterexample；
- P02 Validation Repository。

## 输出权威

P05 输出：

```text
ReplayDataset
ReplayRun
ValidationResult
ValidationFailure
Counterexample
MetricDefinition
```

它们：

- 不批准 Artifact；
- 不激活 Artifact；
- 不切换 Active Pointer；
- 不执行真实物理动作；
- 不修改 Candidate Definition。

## 完成合同

P05 完成必须同时满足：

- 数据集来源和版本可追溯；
- Discovery 与 Holdout 隔离；
- 租户、Goal、Episode 和时间泄漏被检测；
- Replay 使用历史快照而非当前状态；
- Replay 无物理副作用；
- 同一输入结果可重放；
- Plan / Rule / Counterfactual 指标完整；
- Unsafe Allow 强制标记 unsafe；
- Validation Result 不可变；
- Counterexample 可追溯；
- 不进入 Shadow / Promotion；
- P06 Handoff 完整。
