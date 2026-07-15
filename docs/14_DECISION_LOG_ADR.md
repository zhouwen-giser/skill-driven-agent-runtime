# 架构决策索引

| ADR     | 决策                                                       |
| ------- | ---------------------------------------------------------- |
| ADR-001 | LangGraph.js 是唯一 Workflow Runtime                       |
| ADR-002 | A2A/MCP 使用官方 SDK，业务层通过 Adapter 解耦              |
| ADR-003 | Skill 是能力契约，Workflow 是一次执行实例                  |
| ADR-004 | LLM 只能生成结构化 DSL，禁止动态代码执行                   |
| ADR-005 | PostgreSQL/pgvector + Redis/BullMQ 存储分工                |
| ADR-006 | 八个项目选择性复用，不合并 Runtime                         |
| ADR-007 | 单进程模块化单体和 Express/React 基线（待 EP-00 最终确认） |
| ADR-008–075 | 已接受的 V1.0 架构、运行、持久化、协议和 hardening 决策；以 `adr/` 对应文件为准 |
| ADR-076 | MCP Tasks 使用 SDK 1.29.0 低层请求与锁定官方扩展的 Adapter 边界 |
| ADR-077 | Provider 对远程 Task 权威，SDAR 以显式本地 Binding 关联 |
| ADR-078 | Task availability、预测/预约和 Provider 时间合同严格分离 |
| ADR-079 | 远程等待使用持久 continuation，不使用 LangGraph interrupt/resume |
| ADR-080 | v1.1 使用 0100+，受支持升级必须等待完整 v1.0.13 迁移链 |

所有重大变更必须新增 ADR，不得直接修改历史 ADR 来掩盖决策变化。
