# 项目章程

## 项目名称

Skill-Driven Agent Runtime（SDAR）

## 产品定位

一个单 Agent、单机、单进程的通用 Agent Server：北向通过 A2A 对外提供标准任务服务，南向通过 MCP 注册和调用工具，中间以可版本化 Skill 表达业务能力，并由 LLM 根据 Goal 与 Skill 生成受约束的动态 Workflow DSL，编译为 LangGraph.js 执行。执行完成后进行结果处理和目标达成评估，必要时通过外层重新规划继续推进。

## 核心价值

- 将业务能力从 Agent 主代码中解耦为 Skill 资产。
- 将 LLM 自由工具调用转化为可校验、可确认、可追踪的执行计划。
- 建立 A2A、Skill、MCP、Workflow 四层能力边界。
- 为多个业务 Agent 提供统一模板和运行时。
- 让执行经验能够沉淀为 Workflow Template、Skill 版本和评估数据。

## 首版成功标准

需求基线中的全部 P0 功能、非功能需求和验收场景均完成；系统能够本地一键启动并通过完整验证门禁。

## 不属于首版

- A2A Client/远程 Agent 调用；
- 多 Agent 实例和多租户隔离；
- 生产级认证授权；
- 多进程、水平扩展、分布式执行；
- stdio MCP、MCP Resources/Prompts；
- 执行中任务故障恢复；
- 运行时直接修改正在执行的 Workflow；
- 动态执行 LLM 生成代码。
