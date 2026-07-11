# 架构决策索引

| ADR | 决策 |
|---|---|
| ADR-001 | LangGraph.js 是唯一 Workflow Runtime |
| ADR-002 | A2A/MCP 使用官方 SDK，业务层通过 Adapter 解耦 |
| ADR-003 | Skill 是能力契约，Workflow 是一次执行实例 |
| ADR-004 | LLM 只能生成结构化 DSL，禁止动态代码执行 |
| ADR-005 | PostgreSQL/pgvector + Redis/BullMQ 存储分工 |
| ADR-006 | 八个项目选择性复用，不合并 Runtime |
| ADR-007 | 单进程模块化单体和 Express/React 基线（待 EP-00 最终确认） |

所有重大变更必须新增 ADR，不得直接修改历史 ADR 来掩盖决策变化。
