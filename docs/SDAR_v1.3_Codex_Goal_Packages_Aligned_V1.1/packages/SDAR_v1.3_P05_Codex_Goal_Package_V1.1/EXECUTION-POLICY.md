# P05 Execution Policy

## 1. 模型

```text
GPT-5.6 Sol Medium
```

一个主执行 Agent。独立只读 Review 必须使用新会话。

## 2. 验证权威

```text
Goal Contract / Criterion / Policy / Outcome
> Accepted Plan
> Artifact Candidate
> Model Evaluation
```

Accepted Plan 不一定是最优，也不允许模型将历史成功直接判为 Candidate 成功。

## 3. Replay 安全

Replay 必须：

- 使用 No-Physical Provider；
- 拒绝真实 Credential；
- 拒绝真实 Network / Device / MCP Side Effect；
- 不创建正式 Attempt；
- 不修改正式 Plan；
- 不发布正式 A2A / SSE；
- 不写 Goal Terminal；
- 不写 Active Pointer；
- 保留 Replay / Simulation Context Header；
- 使用独立 Correlation / Idempotency Namespace。

## 4. 数据集隔离

至少分为：

```text
discovery
candidate_development
promotion_holdout
counterexample
```

禁止同一 Goal Lineage、Episode Revision 或近重复样本跨 Discovery 与 Holdout。

## 5. 当前状态与历史快照

Replay 必须使用历史：

- Capability Catalog；
- Policy；
- World State；
- Readiness；
- Goal / Plan；
- Outcome。

禁止用当前生产状态替代历史快照后声称“当时会成功”。

## 6. 模型边界

模型可以：

- 生成解释；
- 对比 Plan 文本；
- 辅助标记未知；
- 提议 Counterexample 分类。

模型不能：

- 直接给 passed；
- 覆盖 Criterion Coverage；
- 覆盖 Policy Violation；
- 覆盖 Unsafe Allow；
- 伪造历史 Outcome；
- 修改 Dataset Split。

## 7. 不可变性

以下不可原地修改：

- Dataset Manifest；
- ReplayCase；
- ReplayRun Result；
- ValidationResult；
- Counterexample；
- Metric Definition Version。

修正必须生成新 Version。

## 8. Git

建议至少：

```text
feat(v1.3): build replay datasets
feat(v1.3): validate artifact candidates by replay
docs(v1.3): record P05 evidence
```

不 Merge，不 Tag。
