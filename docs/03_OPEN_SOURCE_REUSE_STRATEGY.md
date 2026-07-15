# 八个开源项目的复用策略

## 总原则

目标是提取成熟能力并缩短交付，不是合并八套 Runtime。一个领域只保留一个权威实现；外部项目对象不得穿透本项目 Adapter 或研究边界。

## 复用矩阵

| 项目                      | 定位                                  | 使用方式                         | 重点提取                                                                | 明确不使用                                                |
| ------------------------- | ------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| LangGraph.js              | 唯一工作流执行内核                    | 直接生产依赖                     | StateGraph、条件边、子图、流式、节点状态；按本项目策略封装运行态        | 不让其定义 Skill/Goal 领域模型；不依赖第二个 Runtime      |
| Mastra                    | TypeScript Agent 工程参考             | 源码研究；独立模块需 ADR         | Server 组织、Storage 接口、Workflow suspend/resume、Eval、Observability | 不引入 Mastra Agent/Workflow Runtime；排除所有 `ee/` 代码 |
| VoltAgent                 | AgentOps 和 TS 接口参考               | 源码研究；可能复用纯工具包需 ADR | ModelProvider、Tool hooks、Trace/Event、Prompt/Eval 控制台指标          | 不引入其 Agent/Workflow 状态机替代 LangGraph              |
| OpenHands                 | Skill/Plugin 打包参考                 | 设计移植，TypeScript 自研        | Skill 文件、触发/上下文注入、Plugin 打包 Skill+MCP+Hook                 | 不嵌入 Python Agent Runtime；不使用非 MIT Cloud 代码      |
| Dify                      | 产品交互参考                          | 仅 UX/信息架构参考               | DAG 编辑、节点配置、运行高亮、版本对比、调试输入                        | 不复制源码、样式或组件；不作为后端 Runtime                |
| Google ADK                | Workflow/Session/Eval 对照            | 架构和测试参考                   | Sequential/Parallel/Loop/Custom workflow、MCP、Session、Eval            | 不引入 ADK Runtime；TypeScript A2A 不作为首版依赖         |
| BeeAI                     | 约束 Agent、Event、Serialization 参考 | 架构参考                         | Requirement constraints、事件系统、缓存、序列化、声明式 Workflow        | 不引入 BeeAI Workflow；其 A2A TS 支持不是首版基础         |
| Microsoft Agent Framework | 企业运行时设计参考                    | 架构参考                         | Middleware、Telemetry、Checkpoint/HITL、类型安全路由、DevUI             | 不跨语言嵌入 .NET/Python Runtime                          |

## 直接依赖基线

- `@langchain/langgraph`
- `@a2a-js/sdk` 的经验证 v1.0 beta/后续稳定版本
- `@modelcontextprotocol/client@2.0.0-beta.4`（extension-era 生产 Client）与迁移期 legacy Server fixture `@modelcontextprotocol/sdk@1.29.0`，均只在 MCP Adapter
- BullMQ、Redis client、PostgreSQL driver、pgvector/ORM
- Ajv/Zod、OpenTelemetry API、Web server 与前端基础库

## 开源引入流程

1. 在 `third_party/sources.lock.yaml` 登记项目、URL、license、拟使用路径和精确 commit/tag。
2. 使用 `templates/OSS_INTAKE_TEMPLATE.md` 形成调研记录。
3. 判断：直接依赖、复制/改造、设计参考、禁止使用。
4. 任何源码复制必须记录原文件、commit、license、修改说明和 NOTICE 要求。
5. 新增生产依赖必须有 ADR，说明为什么不能由现有权威实现完成。
6. CI 检查不可存在 `UNPINNED`、`TBD_LICENSE` 或未登记 vendored code。

## 兼容性 Spike 必做项

- A2A JavaScript SDK 的 v1.0 支持、Agent Card、JSON-RPC/REST、流式、Task Store、取消和状态映射。
- MCP Streamable HTTP client 的连接、发现、调用、取消、超时和错误。v1.1 Spike 由 ADR-081 固化：v1 不能启用 extension；v2 beta.4 自动协商可用，但 SEP-2663 的 method/result/Header 缺口必须由 Adapter 内临时 bridge 和精确 wire 合约覆盖。
- LangGraph.js 动态 DSL 编译、并行、循环、子图和运行时事件。
- Redis Checkpoint 需求与本项目“运行中故障不恢复”策略的适配。
