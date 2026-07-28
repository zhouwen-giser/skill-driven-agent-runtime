# Findings to Close

## P03

- 生命周期 `eventType` 被当作真实 Activity；
- P03 实际输出与 P04 Golden Fixture 语义不一致；
- Self-loop 被 Direct-Follows 丢失；
- Recovery 只保留生命周期事件；
- Pattern `support` / `traceCoverage` 恒定；
- Review、Handoff、Acceptance Summary 未正式闭合。

## P04

- 在 P03 未 COMPLETED 时启动；
- 生命周期事件可能被编译为 `Execute goal_created` 等节点；
- 反过拟合规则未真实执行；
- Worker 只是 Wake Shell；
- Capability Catalog 输入未真实校验；
- Fingerprint Hash 语义错误；
- DAG 静默丢边，Parallel 被降级；
- 参数类型/Range/Enum/Source/Trust 丢失；
- Applicability 不可运行时求值；
- Lineage/Recovery Patch 不完整；
- Static Validator 过浅；
- 无真实 P03→P04 Integration/E2E；
- Completion/Review/Handoff 元数据滞后。

每项必须记录代码位置、测试、Closure Commit、Review 结论。
