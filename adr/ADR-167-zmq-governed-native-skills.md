# ADR 167 — ZMQ 原生 Skill 的隔离治理与任务执行

Status: Accepted for isolated implementation, 2026-10-25. Field qualification remains open.

## Context

ADR-166 的目录候选不能直接作为可执行权限。原生目录还发现两个实际互操作缺陷：
冻结 Runtime 保留根字段 `outcome`，导致内部 DTO 与公开输出 Schema 不一致；
定时启动的 revision 0 回执被重复快照过滤器跳过，未绑定远端执行编号。

## Decision

- 使用独立 `zmq_v1_0_1_12` 目录和 `ugv.zmq.<tool>` / `vehicle.ugv.zmq.<tool>` 身份。
  保留原 1.0.0 目录和旧 MQTT Skill，不静默替换或别名映射。
- 在 Provider Binding 写入前核对全部 12 工具的资源、Provider、本地服务、完整 Schema、
  Task Profile 和执行语义。通过既有 Skill 导入、发布、Capability/Exposure CAS API 装配。
  重复装配复用相同版本；权威变化创建后继版本并撤下旧 Exposure，历史保留。
- 接入既有 Goal、Skill、受限 DSL、LangGraph 和正式 A2A/MCP 任务路径。参数和时间窗
  确定性解析，确认等待消耗原父期限；不使用模型生成控制计划。控制必须明确确认、
  最多一次调用且不自动重放。只读操作仍经过相同目录与身份约束。
- 保留真实 Provider 结果和 `ugv.zmq.retained_report` 证据，检查缺失足迹、任务轨迹、
  源流完整性时始终降级。有效空帧只描述收到的帧，不能证明全区域没有发现。
- 首次定时绑定允许相等的初始 revision 0；此例外只在已有 claim 和未绑定执行时生效。
  后续版本、重复事件与完整执行身份校验继续生效。零重试预算的不可达结果提交终态，
  不继续安排替代任务。

## Canonical Evidence

能力记录及其审计在同一事务中按“权威记录、审计”顺序落账。审计引用按精确 aggregate、
revision、发生时间匹配，允许指向较后的账本序号；歧义拒绝，其余权威引用保持 as-of 约束。
Evidence 仅允许 `authorizationContextHash` 的精确公开 Schema 声明
`{"type":"string","pattern":"^[a-f0-9]{64}$"}`；实际值、default、examples 和扩展字段继续拒绝。

超过 64 KiB 的完整 Agent Card 使用 `artifact://node-control/v1/agent-card/<nodeId>/<revision>/card`。
Evidence 的 `card` 明确标记 `source_artifact_ref` 并携带完整 ArtifactRef；内联上限不变。
原卡片仍在所有者的不可变 revision 中。授权服务可通过受限 PostgreSQL resolver，或新增
认证 `GET /api/v1/a2a-agent-card-revisions/:revision` 的 `card` 字段读取，再校验规范 JSON 的
SHA-256、字节数、nodeId 和 revision。这不是 Runtime task-business Artifact 的地址。

## Verification and limits

实际隔离链使用 PostgreSQL、Redis、ZeroMQ、gRPC、冻结 MCP、正式 CAS 发布及 A2A。
覆盖重复发布、目录漂移先于 Binding 拒绝、只读、确认前零派发、有效空报告、来源缺失、
取消及失败。模型端点拒绝所有请求；控制生成阶段不得调用，辅助记忆/质量增强的拒绝
单独记录。完整门禁和精确证据身份见 `reports/ugv-zmq-phase5/governance-20261025/`。

原生巡逻后继组合、完整 GOWM 所有者部署、G0 来源资格和真实设备执行仍开放。
19100/19101 的切换、现场功能通过和原有服务可回退性均不由本 ADR 的隔离结果证明。

完整卡片使用原版本路径和显式 `Accept: application/vnd.sdar.agent-card-content.v1+json`；
未指定此媒体类型时仍返回冻结的版本元数据。响应包含 `revision`、`card`、`sourceArtifactRef`，
设置 `Vary: Accept` 和私有不缓存策略。冻结的 131 项操作、原认证/RBAC 与 application/json
合同保持原语义；这是有版本标识的可选读取格式，不新增操作路径。
