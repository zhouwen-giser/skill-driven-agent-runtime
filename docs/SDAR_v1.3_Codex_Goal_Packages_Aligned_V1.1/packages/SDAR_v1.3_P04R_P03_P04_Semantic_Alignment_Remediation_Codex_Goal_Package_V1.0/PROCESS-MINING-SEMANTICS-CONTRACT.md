# Process Mining Semantics V1.2

- Variant 使用 Activity Key，保留重复和 `A→A` self-loop；
- Direct-Follows/Precedence 使用真实 Activity；
- 相同时间不推断并行；
- Parallel 只接受明确 concurrency/dependency/partial-order 证据；
- Recovery 保存 triggerActivityKey、resumeActivityKey、恢复序列和所需 Capability；
- 质量指标使用真实分母，禁止 `support=1`、`traceCoverage=1` 常量；
- P03 必须生成可被 P04 真实消费的 Golden WorkflowPattern V1.2。
