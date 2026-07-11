# Codex ExecPlan 规范

ExecPlan 是可独立执行、持续更新的实现规格。阅读者应当只依赖当前工作树和该计划，就能理解目标、修改范围、验证方法和恢复方式。

## 何时必须使用

以下工作必须维护 ExecPlan：

- 新增一个跨模块功能；
- 协议/SDK 兼容性验证；
- 数据模型或迁移；
- Workflow DSL、编译器、状态机等核心重构；
- 管理控制台完整功能；
- 端到端验收和发布准备。

## 必备章节

每个计划必须包含以下章节并持续更新：

1. **Purpose / Outcome**：完成后用户可观察到什么。
2. **Requirements Covered**：对应需求编号和验收场景。
3. **Context and Orientation**：当前仓库结构、关键术语、已有实现。
4. **Architecture and Interfaces**：要新增/修改的接口、数据和约束。
5. **Progress**：带时间戳的勾选清单，反映真实状态。
6. **Discoveries and Surprises**：实际源码、SDK、测试中发现的事实。
7. **Decision Log**：计划内决策；重大决策另写 ADR。
8. **Implementation Steps**：按可运行增量排序的具体步骤。
9. **Validation**：命令、测试、预期结果和人工检查点。
10. **Idempotence and Recovery**：重复运行是否安全；失败如何恢复。
11. **Artifacts and Evidence**：日志、报告、截图、示例请求、迁移等。
12. **Outcomes and Retrospective**：完成内容、缺口和后续影响。

## 编写规则

- 使用仓库相对路径和符号名，不使用“改一下相关代码”等模糊语言。
- 每个阶段都必须产生可运行、可测试的增量。
- 计划中不能把关键设计决策留给未来执行者猜测。
- 允许在执行中修订计划，但必须记录原因和影响。
- 验证必须可复现；“看起来正常”不是证据。
- 无法真实验证时，明确标注 Mock、模拟或未验证。

## Progress 格式

```markdown
- [x] 2026-07-11 10:30 完成 A2A SDK 兼容性 Spike，报告见 `reports/a2a-compatibility.md`。
- [ ] 实现内部 Task 到 A2A Task 的双向映射。
- [ ] 运行 `pnpm test:contract:a2a` 并保存报告。
```

## 完成判定

ExecPlan 只有在以下条件同时满足时结束：

- Requirements Covered 中每项都有实现和测试；
- Validation 中所有必须命令通过；
- Traceability Matrix 已更新；
- 相关 ADR、迁移、API 文档和运维说明已更新；
- Outcomes 明确记录已知限制，不能把未完成项伪装成后续优化。
