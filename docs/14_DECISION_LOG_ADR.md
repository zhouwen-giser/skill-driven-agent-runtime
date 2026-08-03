# 架构决策索引

| ADR         | 决策                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| ADR-001     | LangGraph.js 是唯一 Workflow Runtime                                                   |
| ADR-002     | A2A/MCP 使用官方 SDK，业务层通过 Adapter 解耦                                          |
| ADR-003     | Skill 是能力契约，Workflow 是一次执行实例                                              |
| ADR-004     | LLM 只能生成结构化 DSL，禁止动态代码执行                                               |
| ADR-005     | PostgreSQL/pgvector + Redis/BullMQ 存储分工                                            |
| ADR-006     | 八个项目选择性复用，不合并 Runtime                                                     |
| ADR-007     | 单进程模块化单体和 Express/React 基线（待 EP-00 最终确认）                             |
| ADR-008–075 | 已接受的 V1.0 架构、运行、持久化、协议和 hardening 决策；以 `adr/` 对应文件为准        |
| ADR-076–084 | v1.0.5–v1.0.13 hardening 决策；以 `adr/` 对应文件为准                                  |
| ADR-085     | MCP Tasks 使用锁定官方扩展的 Adapter 边界                                              |
| ADR-086     | Provider 对远程 Task 权威，SDAR 以显式本地 Binding 关联                                |
| ADR-087     | Task availability、预测/预约和 Provider 时间合同严格分离                               |
| ADR-088     | 远程等待使用持久 continuation，不使用 LangGraph interrupt/resume                       |
| ADR-089     | v1.1 使用 0100+，受支持升级必须基于完整 v1.0.13 迁移链                                 |
| ADR-090     | MCP extension era 使用精确官方 v2 beta Client，v1 仅保留 legacy Server fixture         |
| ADR-091     | 远程 Task 使用 PostgreSQL 版本租约、共享 context 串行和 0100 migration profile         |
| ADR-092     | MCP Task readiness 由领域模型与确定性 Guard 控制，并叠加通用 Tool semantics 与传递确认 |
| ADR-093     | 远程 Task 使用 PostgreSQL 持久 frontier，并通过 fresh LangGraph invocation 继续        |
| ADR-094     | 远程输入复用 Task input，update/cancel ack 不越权，取消后继续 Provider 权威轮询        |
| ADR-095     | 远程 Task 管理面只投影 PostgreSQL 权威状态，并以 CAS/幂等键约束刷新、输入和协作取消    |
| ADR-097–105 | v1.2 Skill Usage 的版本、策略、组合、导入、Provider、执行记录边界与计划合规决策        |
| ADR-106     | v1.1 合并后 released migration 单调推进到 0106；isolated profile 与 ledger-gap 保护保留 |
| ADR-107     | 子 Skill 输出映射由现有 LangGraph 以受限 DSL 数据执行；映射证据使用受限存在性门，顶层选择遵守精确版本 visibility |
| ADR-108     | Frozen MCP Tasks 使用显式 Legacy/Frozen 双协议边界、单一观察入口和 Evidence A 本地匹配                  |
| ADR-126     | v1.4.1 通过追加迁移进行 Canonical Evidence clean cutover，不改写已发布的 0142/0143                    |
| ADR-127     | `sdar.evidence/v1` 使用稳定来源身份、规范 JSON 哈希及 100 个封闭目录 Schema                            |
| ADR-128     | Runtime PostgreSQL 独占 Evidence outbox/checkpoint/lease/ACK/DLQ/manifest 权威，Redis 仅可唤醒          |
| ADR-129     | `sdar.evidence/v1` 是唯一 Batch/ACK 协议；精确发送归属、显式连续 ACK、受限安全传输和 PostgreSQL 权威 |

所有重大变更必须新增 ADR，不得直接修改历史 ADR 来掩盖决策变化。
