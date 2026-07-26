# P14 Feedback Quality Contract

## 目标

确认反馈链没有错误归因：

```text
fast selected
fast committed
fallback
formal plan
formal outcome
correction
recovery
```

## 检查

- Fallback Outcome 是否错误归功 Artifact；
- Duplicate Outcome；
- Missing Formal Ref；
- Stale Artifact Usage；
- Cross-tenant Link；
- Missing Correction；
- Model Self-evaluation 误当 Outcome；
- Feedback Lag；
- Deletion Propagation。

## 结果

输出：

```text
feedback_complete
feedback_partial
feedback_incorrect
feedback_blocked
```

`feedback_incorrect` 必须创建数据修复和 Revalidation 风险项。
