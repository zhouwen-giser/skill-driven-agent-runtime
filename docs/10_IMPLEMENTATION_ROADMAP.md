# 实施路线图

虽然需求全部为 P0，Codex 必须按可运行增量完成，不能同时铺开空壳模块。

| 阶段  | 名称                     | 主要结果                                                                |
| ----- | ------------------------ | ----------------------------------------------------------------------- |
| EP-00 | 仓库初始化与兼容性基线   | 建立 monorepo、CI、基础设施和 A2A/MCP/LangGraph/许可证 Spike。          |
| EP-01 | 协议与领域骨架           | A2A Provider、内部 Task/Context/Goal 模型、队列与状态映射。             |
| EP-02 | MCP 与 Skill 基础        | MCP Registry、Tool 元数据、Skill 注册/Schema/版本/检索/Agent Card。     |
| EP-03 | Workflow 规划与运行时    | ModelProvider、Prompt、DSL、Validator、Compiler、LangGraph 节点执行。   |
| EP-04 | 任务生命周期与 Goal 闭环 | 计划确认、暂停恢复取消、Result Processor、Goal Evaluation、外层重规划。 |
| EP-05 | 记忆、评估与演化         | 分阶段记忆、多评估器、经验聚类、Skill 模拟验证和自动发布。              |
| EP-06 | 管理控制台与可观测性     | 完整管理 API、DAG、Trace、回放、版本、指标和建议。                      |
| EP-07 | 加固与完整验收           | 性能、安全告警、迁移、文档、全 AC、发布包。                             |

## 阶段门禁

每个阶段结束必须满足：

- 当前阶段需求有实现和自动测试；
- 可运行演示链路比上一阶段更完整；
- 完整 typecheck 和相关测试通过；
- Traceability Matrix、PROJECT_STATUS、ADR 和 ExecPlan 更新；
- 没有通过临时 hardcode 越过真实接口。

EP-03 结束时必须形成第一个完整垂直闭环；EP-04 扩展为完整任务闭环；EP-05/06 只能建立在前述真实事件和数据之上。
