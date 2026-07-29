# P05 Evidence Contract

## G09 Completion Report

必须包含：

- Source Inventory；
- ReplayCase Schema；
- Snapshot Completeness；
- Dataset Split；
- Leakage Guard；
- Dataset Manifest；
- No-Physical Provider；
- Deletion / Retention；
- Tests；
- Performance；
- Failed Attempts；
- Commit。

## G10 Completion Report

必须包含：

- Plan Replay；
- Rule Replay；
- Counterfactual Replay；
- Metric Catalog；
- Validation Result；
- Failure；
- Counterexample；
- Reproducibility；
- Worker；
- Tests；
- Performance；
- Commit。

## 必需机器证据

```text
reports/goal/v1.3-p05-replay-case-schema.json
reports/goal/v1.3-p05-dataset-manifest.json
reports/goal/v1.3-p05-leakage-report.json
reports/goal/v1.3-p05-metric-catalog.json
reports/goal/v1.3-p05-validation-report.json
reports/goal/v1.3-p05-counterexamples.json
reports/goal/v1.3-p05-safety-report.json
reports/goal/v1.3-p05-completion.md
reports/goal/v1.3-p05-review.md
```

## Review

独立只读 Review 重点检查：

- 是否存在数据泄漏；
- 是否使用当前状态替代历史快照；
- 是否真实隔离副作用；
- 是否把 Accepted Plan 当 Gold；
- 是否使用模型自评；
- 是否修改 Candidate；
- 是否生成 Approval / Active；
- Unsafe Allow 是否硬阻断；
- Counterfactual 是否夸大物理 Outcome；
- Result 是否可重放；
- 删除传播是否完整。

## Git

建议：

```text
feat(v1.3): build artifact replay datasets
feat(v1.3): validate artifact candidates by replay
docs(v1.3): record P05 evidence
```
