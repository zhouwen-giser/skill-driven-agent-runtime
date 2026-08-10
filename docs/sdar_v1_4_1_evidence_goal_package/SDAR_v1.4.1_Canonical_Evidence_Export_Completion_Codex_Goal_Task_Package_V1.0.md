# SDAR v1.4.1 Canonical Evidence Export Completion
## Codex Goal 模式 Clean-Slate 完整实施、阶段提交与主线集成任务包 V1.0

> **文档状态：** Codex 可执行任务包  
> **目标版本：** SDAR v1.4.1  
> **仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
> **建议分支：** `feature/v1.4.1-canonical-evidence-export`  
> **建议 PR：** `feat(v1.4.1): complete canonical evidence export`  
> **执行方式：** Codex Goal 模式  
> **生成日期：** 2026-08-03  
> **生成时观察：** `main` 已包含 SDAR v1.4 Node Control Backend，`package.json` 为 `1.4.0`；执行时必须重新获取最新 `origin/main` 和实际迁移高水位。  
> **核心原则：** 当前尚未进入生产阶段，不保留旧 Telemetry Export 的数据格式、双写、历史 Outbox、旧 ACK 或数据库升级兼容；直接建立唯一、强类型、可评价的 `sdar.evidence/v1` Canonical Evidence 输出链。  
> **后续边界：** 本任务只补齐 Runtime/Node Control 的 Evidence 输出，不实施 ClickHouse；ClickHouse 必须在本任务完成并冻结输出合同后另行升级。

---

# 0. 交给 Codex 的总目标

你正在 `zhouwen-giser/skill-driven-agent-runtime` 仓库中，以 Goal 模式完成 **SDAR v1.4.1：Canonical Evidence Export Completion**。

当前 Runtime 已持久化大量结构化事实，包括 Goal、Plan、Skill Execution、MCP Tasks、Task Capability、ExperienceTrace、Replay、Artifact、Node Control 配置和治理事件；但现有 Telemetry Export 主要从 `runtime_event` 捕获摘要，不能形成完整评价输入。

本任务必须把：

```text
Runtime PostgreSQL 权威事实
Control PostgreSQL 权威事实
        ↓
基础设施语义自动采集 / Durable Source Projection
        ↓
Canonical Evidence Envelope
        ↓
统一 Evidence Outbox
        ↓
Evidence Export Service
        ↓
外部 Evidence Sink
```

建设为唯一正式输出链。

最终必须能够从导出记录重建：

```text
Request
→ Goal / Goal Contract
→ Skill Discovery / Applicability / Selection / Mode / Composition
→ Plan / Plan Compliance
→ Action / Receipt
→ MCP Tool / Remote Task / Continuation
→ Capability Binding / Execution Attempt
→ Verification
→ Outcome
```

并能够独立重建：

```text
Experience Episode
→ ExperienceTrace / Activity
→ Pattern / Replay / Artifact Usage
```

以及：

```text
Node Profile / Configuration Revision
→ Apply / Ack / LKG
→ Capability Readiness
→ A2A Exposure / Agent Card
→ Management Operation / Audit / Node Event
```

必须交付：

1. 当前 `main` 的权威数据源清单和 Source-to-Evidence 矩阵；
2. `sdar.evidence/v1` Canonical Evidence Envelope；
3. 强类型 Record Family / Record Type Catalog；
4. JSON Schema、Schema Hash、ID、版本、Payload Hash 和脱敏规则；
5. clean-slate Evidence 持久化、Outbox、Checkpoint、DLQ、Projection Issue 和 Export State；
6. Runtime Core、Skill、MCP Tasks、Capability、Experience、Replay、Artifact、Node Control 的完整 Evidence Mapper；
7. `EpisodeEvidenceManifest`、来源覆盖率和质量检查；
8. 新 Evidence HTTP Batch/ACK 协议；
9. Source Projector 的重启恢复、幂等、对账和补发；
10. 管理查询、运维状态和手工重放能力；
11. 单元、契约、真实 PostgreSQL/Redis 集成、E2E、恢复、并发、安全和性能证据；
12. 每个 Phase 独立 commit 并立即 push；
13. Draft PR 持续更新，最终标记 Ready for Review；
14. 不自动 merge、tag、GitHub Release 或部署；
15. 为后续 ClickHouse 设计输出冻结的 Contract、Catalog、Schema 和 Source Mapping Bundle。

---

# 1. 当前基线观察与执行时重新确认

生成任务包时观察到：

- `package.json` 版本为 `1.4.0`；
- v1.4 Node Control Backend 已合入 `main`；
- Runtime PostgreSQL 和 Control PostgreSQL 是两个独立权威库；
- Redis/BullMQ 只承担唤醒、调度或临时执行职责；
- Skill Execution 已有独立 Record/Event/Reference；
- ExperienceTrace 已有事件、Activity、并发、父子关系、缺失事实和完整度；
- Task Capability Binding 已冻结输入、成功条件、证据要求、约束、实现引用和 Provider Policy；
- Node Control 已有 20 类冻结 Node Event；
- 当前 Telemetry Export 已有配置、Outbox、重试、ACK、高水位和 HTTP 投递；
- 当前 Capture 主要扫描 `runtime_event`，不能覆盖完整评价事实；
- 当前标准 Compose 未建设 ClickHouse，本任务也不得增加 ClickHouse。

Codex Phase 0 必须重新确认并记录：

```text
origin/main SHA
package version
migration high-water mark
Runtime PostgreSQL baseline
Control PostgreSQL migration high-water mark
当前 Telemetry Export API / Schema / Header
当前 runtime_event、cognitive_runtime_outbox、领域 Outbox 和专用事实表
现有 AGENTS.md / CONTRIBUTING.md / repository instructions
当前测试数量和 clean pnpm verify 结果
当前开放 PR、分支和工作区状态
```

本任务包中的路径和对象名是基于生成时观察的实施锚点。实际实现必须以 Phase 0 的仓库勘察结果为准，不得机械创建平行模块。

---

# 2. Clean-Slate 决策

当前尚未进入生产阶段，因此本任务明确取消以下兼容负担：

```text
旧 runtime_event-only Telemetry 输出
旧 x-sdar-telemetry-contract: 1.0.0
旧 Telemetry Batch Payload
旧 Telemetry Outbox Pending Records
旧连续 ACK Cursor
旧 recordFamilies 任意字符串语义
新旧双写
历史生产数据迁移
旧 Collector / Sink 兼容
```

最终只能存在一个正式外部输出合同：

```text
sdar.evidence/v1
```

旧 `runtime_event` 可以继续作为 Runtime 内部领域事件或兼容内部逻辑使用，但：

- 不再是正式评价事实源；
- 不再是 Evidence Export 的唯一 Capture Source；
- 不允许外部数据仓库依赖其摘要重建业务事实。

开发和测试数据库允许：

```text
drop
→ recreate
→ apply clean baseline/migrations
→ seed
```

不要求迁移旧开发数据。

## 2.1 Migration 历史处理门禁

“不保留数据兼容”不等于可以无视仓库的 Migration Checksum、Source Lock 和 Git 历史规则。

Phase 0 必须作出并记录以下二选一决策：

### Strategy A：重写未发布的 0142/0143

仅当仓库验证证明：

- 0142/0143 未被仓库规则视为已发布不可变 Migration；
- 不会破坏已冻结 Source Lock、Checksum 或测试基线；
- clean baseline 可以安全重建。

才允许重写为新的 Canonical Evidence Migration。

### Strategy B：追加 clean cutover migration

如果仓库将 0142/0143 视为不可变历史，则：

- 保留旧 Migration 文件；
- 新增实际 next migration；
- 在新 Migration 中删除/退役旧 Telemetry 表与约束；
- 创建新的 Evidence 表；
- 更新 clean baseline 和 seed；
- 不实现旧数据转换或双写。

该策略仍然是 clean-slate 产品语义，不是向后兼容。

未经 Phase 0 证据，不得擅自选择或修改 Migration 历史。

---

# 3. 冻结架构决策

| ID | 决策 |
|---|---|
| D-01 | v1.4.1 采用 clean-slate Evidence 输出，不保留旧 Telemetry 数据兼容。 |
| D-02 | 正式外部合同唯一为 `sdar.evidence/v1`。 |
| D-03 | Domain/Application 业务流程不得调用通用 `telemetry.emit/record*` API。 |
| D-04 | Evidence 由 Repository、Authority Service、Runtime Hook 和 Source Projector 自动产生。 |
| D-05 | Runtime PostgreSQL 继续拥有 Task、Goal、Plan、Workflow、Skill、MCP Task、Experience、Artifact 和 Runtime Evidence 权威。 |
| D-06 | Control PostgreSQL 继续拥有 Node Control 配置、Desired/Observed、Management Operation、Audit 和 Node Event 权威。 |
| D-07 | Runtime 拥有统一 Evidence 投递状态、Outbox、ACK、DLQ、Manifest 和 Export Service。 |
| D-08 | Control 事实通过持久化 Node Event/Audit/受控读取接口投影，不建立跨数据库事务。 |
| D-09 | Redis/BullMQ 不成为 Evidence 权威。 |
| D-10 | 外部 Evidence Sink 不得反向修改 Runtime 或 Control 状态。 |
| D-11 | 不新增 Workflow Runtime，不改变 LangGraph 单 Runtime 边界。 |
| D-12 | 本任务不实施 ClickHouse、OTel Collector、数据集市或正式评分器。 |
| D-13 | `deliveryGuarantee` 与 `evaluationRole` 是两个独立维度。 |
| D-14 | `transactional` Evidence 与权威业务提交处于同一 PostgreSQL 事务。 |
| D-15 | `durable_projection` Evidence 通过持久化 Source Cursor 和幂等 Mapper 生成。 |
| D-16 | `buffered` Evidence 不得作为硬门槛的唯一证据。 |
| D-17 | 所有正式记录必须具有稳定 `recordId`、`payloadHash` 和独立 `schemaVersion`。 |
| D-18 | 相同 `recordId + payloadHash` 为幂等重复；相同 `recordId` 不同 Hash 为 Critical Conflict。 |
| D-19 | Export 使用至少一次投递和连续 Sequence ACK。 |
| D-20 | `required` Evidence 不允许被配置排除或采样。 |
| D-21 | 大 Payload 使用 ArtifactRef，不无限内联。 |
| D-22 | 不采集模型隐藏思维过程，不允许 Credential、Token、Secret 和 Authorization 进入 Payload。 |
| D-23 | ToolCall 与 Remote Task 生命周期必须分离。 |
| D-24 | Remote Task Observation 与 Control Event 必须分离。 |
| D-25 | Cancel Request 不等于 Provider 已取消。 |
| D-26 | Remote Task completed 不等于 Goal achieved，必须保留 Receipt 和 Verification。 |
| D-27 | Skill degraded 不等于完整 completed，必须输出 Missing Effects/Reason。 |
| D-28 | v1.4 Node Control 是配置与治理控制平面，不虚构 Physical Command/Feedback 事实。 |
| D-29 | Episode 终态必须生成 Evidence Manifest，并明确 complete/degraded/incomplete。 |
| D-30 | ClickHouse 设计只有在 Required Source Coverage 达到 100% 且 E2E 通过后才能开始。 |
| D-31 | Schema 版本与应用版本独立演进。 |
| D-32 | 任何无法从权威来源获得的字段不得由 Mapper 猜测或由 LLM 补齐。 |

---

# 4. 权威边界

## 4.1 Runtime PostgreSQL

至少包括：

- Request / A2A Task；
- Goal / Goal Contract / Goal Patch；
- User Goal Plan / Workflow Plan / Workflow Instance；
- Skill Usage / Skill Execution；
- Action / ToolCall / Receipt / Verification / Outcome；
- MCP Invocation / RemoteTaskBinding / Observation / Control Event；
- Workflow Continuation；
- Task Capability Binding / Attempt；
- Experience Episode / ExperienceTrace / Process Pattern；
- Replay / Counterexample；
- Artifact / Retrieval / Usage / Feedback / Promotion；
- Runtime Evidence Outbox、Export State、Manifest、DLQ 和 Quality Issue。

## 4.2 Control PostgreSQL

至少包括：

- Node Profile / Health；
- Configuration Revision / Desired / Observed / Ack / LKG；
- LLM Provider / Model Route；
- SMPP Source；
- MCP Provider Binding；
- Skill / Plan Template Governance；
- Node Capability / Implementation Binding / Readiness；
- A2A Exposure / Agent Card；
- Management Operation / Audit；
- Node Event。

## 4.3 外部 Provider

Provider 继续对以下事实权威：

- 真实 Availability；
- Reservation 和执行窗口；
- 外部 Task 状态；
- Resource 状态；
- Cancel 是否生效；
- 最终业务结果。

SDAR 只输出自己的本地观测和协议处理事实。

---

# 5. Canonical Evidence Contract

Phase 2 必须冻结等价于以下语义的类型，精确字段可按仓库类型系统调整，但不得改变边界：

```ts
export type EvidenceDeliveryGuarantee =
  | "transactional"
  | "durable_projection"
  | "buffered";

export type EvidenceEvaluationRole =
  | "required"
  | "supporting"
  | "diagnostic";

export interface CanonicalEvidenceEnvelope<TPayload> {
  readonly contractVersion: "sdar.evidence/v1";

  readonly schemaName: string;
  readonly schemaVersion: number;
  readonly recordFamily: EvidenceRecordFamily;
  readonly recordType: string;

  readonly recordId: string;

  readonly sourceSystem: "runtime" | "node_control";
  readonly sourceTable: string;
  readonly sourceRecordId: string;
  readonly sourceRevision?: string;

  readonly tenantId?: string;
  readonly userScopeId?: string;
  readonly projectId?: string;
  readonly environment: string;

  readonly taskId?: string;
  readonly contextId?: string;
  readonly episodeId?: string;
  readonly runId?: string;

  readonly goalId?: string;
  readonly goalVersion?: number;
  readonly planId?: string;
  readonly planVersion?: number;

  readonly skillExecutionId?: string;
  readonly capabilityBindingId?: string;
  readonly remoteTaskBindingId?: string;
  readonly nodeId?: string;

  readonly correlationId: string;
  readonly causationId?: string;

  readonly occurredAt: string;
  readonly recordedAt: string;

  readonly deliveryGuarantee: EvidenceDeliveryGuarantee;
  readonly evaluationRole: EvidenceEvaluationRole;

  readonly evidenceSequence?: string;
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];

  readonly payloadHash: string;
  readonly payload: TPayload;
}
```

## 5.1 Record ID

Codex 必须通过 ADR 冻结稳定算法。最低要求：

```text
recordId = deterministic(
  sourceSystem,
  sourceTable,
  sourceRecordId,
  sourceRevision-or-immutable-hash,
  schemaName,
  schemaVersion
)
```

- 不得使用每次投影随机 UUID；
- 可变来源必须提供 Revision、Version 或不可变 Snapshot Hash；
- 无法稳定标识的来源不得进入 Required Catalog，必须先补齐来源身份。

## 5.2 Payload Hash

- 使用 Canonical JSON；
- SHA-256 小写十六进制；
- Hash 计算必须排除传输层 Sequence、CapturedAt、Retry Count；
- 相同来源快照必须生成相同 Hash。

## 5.3 Schema

每种 Record Type 必须具有：

```text
schema_name
schema_version
JSON Schema Draft 2020-12
schema SHA-256
compatibility classification
maximum inline bytes
redaction policy
```

不允许 Schema Registry 使用空 `{}` 占位作为正式完成结果。

---

# 6. Record Family Catalog

只允许以下一级族：

```text
runtime
skill
mcp_task
capability
experience
replay
artifact
node_control
evidence
```

## 6.1 Runtime Core

至少：

```text
runtime.episode
runtime.request
runtime.a2a_task
runtime.goal
runtime.goal_contract
runtime.goal_patch
runtime.plan
runtime.plan_step
runtime.state_transition
runtime.decision
runtime.policy_decision
runtime.execution_gate
runtime.human_confirmation
runtime.action
runtime.receipt
runtime.verification
runtime.outcome
runtime.run_seal
```

## 6.2 Skill

至少：

```text
skill.usage_snapshot
skill.candidate
skill.applicability
skill.context_resolution
skill.selection
skill.mode_selection
skill.composition
skill.composition_edge
skill.capability_slot_resolution
skill.procedure_compilation
skill.plan_compliance
skill.execution
skill.execution_event
skill.execution_reference
skill.failure_propagation
skill.evidence_requirement
```

## 6.3 MCP Tasks

至少：

```text
mcp_task.tool_call
mcp_task.availability
mcp_task.remote_binding
mcp_task.observation
mcp_task.control_event
mcp_task.poll_attempt
mcp_task.input_link
mcp_task.cancel
mcp_task.reconciliation
mcp_task.continuation_snapshot
mcp_task.continuation_attempt
```

## 6.4 Capability

至少：

```text
capability.definition
capability.implementation_binding
capability.readiness
capability.task_binding
capability.execution_attempt
capability.a2a_exposure
capability.agent_card_revision
```

## 6.5 Experience

至少：

```text
experience.episode
experience.trace
experience.trace_event
experience.activity
experience.process_variant
experience.workflow_pattern
experience.workflow_pattern_dependency
experience.recovery_pattern
experience.planning_correction
experience.interaction_episode
```

## 6.6 Replay

至少：

```text
replay.dataset
replay.case
replay.run
replay.case_result
replay.metric_result
replay.counterexample
```

## 6.7 Artifact

至少：

```text
artifact.lifecycle
artifact.validation
artifact.retrieval
artifact.usage
artifact.feedback
artifact.promotion
```

## 6.8 Node Control

至少：

```text
node_control.profile_revision
node_control.health_observation
node_control.configuration_revision
node_control.configuration_apply_ack
node_control.configuration_lkg_transition
node_control.llm_provider_revision
node_control.model_route_revision
node_control.smpp_source_revision
node_control.mcp_provider_binding_revision
node_control.skill_governance
node_control.plan_template_governance
node_control.capability_revision
node_control.capability_readiness
node_control.a2a_exposure
node_control.agent_card_revision
node_control.management_operation
node_control.audit_event
node_control.node_event
node_control.telemetry_configuration
node_control.telemetry_delivery
node_control.telemetry_ack
```

## 6.9 Evidence Infrastructure

```text
evidence.episode_manifest
evidence.quality_issue
evidence.projection_issue
evidence.source_checkpoint
evidence.export_status
```

Catalog 中每个 Record Type 必须指定：

- Authority；
- Source；
- Mapper；
- Delivery Guarantee；
- Evaluation Role；
- Required/Conditional/Optional；
- Episode Applicability 条件；
- Artifact Policy；
- Redaction Policy；
- Expected References；
- Target Schema。

---

# 7. Evidence 持久化

最终 Runtime PostgreSQL 至少建设：

```text
evidence_export_configuration
evidence_outbox
evidence_source_checkpoint
evidence_export_state
evidence_dead_letter
evidence_projection_issue
evidence_quality_issue
episode_evidence_manifest
```

## 7.1 `evidence_outbox`

至少包含：

```text
sequence
record_id
record_family
record_type
schema_name
schema_version
source_system
source_table
source_record_id
source_revision
tenant_id
task_id
context_id
episode_id
goal_id
goal_version
plan_id
plan_version
skill_execution_id
capability_binding_id
remote_task_binding_id
node_id
correlation_id
causation_id
delivery_guarantee
evaluation_role
occurred_at
recorded_at
payload
payload_hash
captured_at
delivery_attempts
next_attempt_at
acknowledged_at
last_error_code
```

最低约束：

```text
UNIQUE(record_id)
UNIQUE(source_system, source_table, source_record_id, source_revision, schema_name, schema_version)
```

若 PostgreSQL `NULL` 唯一语义导致不可变来源冲突规则不成立，必须通过生成列、非空 Sentinel 或表达式索引解决，不得留下逻辑漏洞。

## 7.2 Source Checkpoint

每个 Source Family 独立 Cursor：

```text
source_family
source_partition
last_occurred_at
last_source_record_id
last_source_revision
last_payload_hash
last_projected_at
projector_version
```

禁止多个完全不同的来源共享单个全局 Cursor。

## 7.3 DLQ 与 Projection Issue

必须区分：

```text
schema_invalid
source_identity_missing
source_revision_missing
payload_hash_conflict
reference_unresolved
redaction_rejected
artifact_write_failed
export_rejected
ack_invalid
source_unavailable
projection_bug
```

Required Evidence 的 Projection Issue 不得静默跳过。

---

# 8. Evidence 生成方式

## 8.1 Transactional Evidence

以下关键事实优先在原权威事务中同时写入 `evidence_outbox`：

```text
Goal / Goal Contract
Plan authority commit
Skill Execution status/event
Task Capability Binding / Attempt
Action / Receipt
Verification
Terminal Outcome
Remote Task Binding
Remote Task Control Event
Workflow Continuation authority commit
Node Control Management Operation / Node Event（在 Control DB 本地事务中）
```

原则：

```text
权威业务事实存在
→ 对应 Required Evidence 必须已进入本地持久化交付链
```

不得采用：

```ts
await saveBusinessState();
await telemetry.record(...); // 事务外补写
```

## 8.2 Durable Projection

以下聚合或历史事实可以由 Source Projector 生成：

```text
ExperienceTrace
Activity
Process Pattern
Replay Dataset / Results
Artifact Usage / Retrieval / Feedback
Capability Readiness Snapshot
Node Control 跨库投影
```

Projector 必须：

- 使用持久化 Cursor；
- 可重入；
- 可重放；
- 同一来源产生相同 Record ID；
- 进程崩溃后不会跳过来源；
- 不重复产生不同 Payload；
- 不修改来源权威状态。

## 8.3 Node Control 跨库

Control PostgreSQL 和 Runtime PostgreSQL 不建立分布式事务。

推荐链路：

```text
Control Authority Transaction
→ durable Node Event / Audit / Revision
→ existing authenticated Control read/event interface
→ Runtime Node Control Evidence Projector
→ Runtime evidence_outbox
```

必须保存：

```text
source node event ID
aggregate type/id/revision
Control recordedAt
Runtime capturedAt
source payload hash
projector version
```

Node Event 是变更提示；需要完整状态时，Projector 必须通过权威 GET 恢复，并记录读取的 Revision/ETag，不得仅依赖不完整事件 Payload。

---

# 9. Evidence Export 协议

旧：

```text
x-sdar-telemetry-contract: 1.0.0
```

必须被替换为：

```text
x-sdar-evidence-contract: sdar.evidence/v1
```

## 9.1 Batch Request

```json
{
  "contractVersion": "sdar.evidence/v1",
  "exportId": "primary-evidence-export",
  "sourceId": "sdar-runtime",
  "nodeId": "node-001",
  "revision": 1,
  "firstSequence": 1001,
  "lastSequence": 1100,
  "batchHash": "sha256:...",
  "records": []
}
```

## 9.2 ACK

```json
{
  "lastAcknowledgedSequence": 1100
}
```

要求：

- 至少一次投递；
- 连续 ACK；
- ACK 不得超过发送 Batch；
- ACK 不得倒退；
- Partial ACK 合法；
- 不允许通过 ACK 跳过未发送 Sequence；
- Batch Hash 可验证；
- Endpoint 不可用不得阻塞 Task Runtime；
- Redirect 禁止；
- 非 Loopback HTTP 禁止；
- CredentialRef-only；
- Body 和 Batch 有明确上限；
- Sink 返回内容不得成为 Runtime 业务权威。

## 9.3 Export Configuration

必须使用强类型 Catalog，不允许任意字符串：

```ts
interface EvidenceExportConfiguration {
  exportId: string;
  revision: number;
  endpointRef: string;
  sourceId: string;
  nodeId?: string;
  credentialRef: string;

  includedFamilies: EvidenceRecordFamily[];
  excludedDiagnosticTypes?: string[];

  batchPolicy: {
    maxRecords: number;
    maxBytes: number;
    flushIntervalMs: number;
  };

  retryPolicy: {
    baseDelayMs: number;
    maxDelayMs: number;
    maxAttempts?: number;
  };

  outboxPolicy: {
    maxPendingRecords: number;
    retentionDays: number;
  };

  redactionProfile: string;
  artifactMode: "inline" | "reference";
}
```

规则：

- `required` Evidence 无论 includedFamilies 如何配置都必须输出；
- 只能排除 Diagnostic 类型；
- 配置形成不可变 Revision；
- Inline Secret 拒绝；
- 未知 Family fail-closed。

---

# 10. Episode Evidence Manifest

每个适用 Episode 进入权威终态后必须生成：

```ts
interface EpisodeEvidenceManifest {
  manifestId: string;
  episodeId: string;
  taskId: string;
  terminalOutcomeId: string;

  expectedRequiredRecords: number;
  projectedRequiredRecords: number;
  pendingRequiredRecords: number;
  failedRequiredRecords: number;

  expectedFamilies: EvidenceRecordFamily[];
  completedFamilies: EvidenceRecordFamily[];
  missingFamilies: EvidenceRecordFamily[];

  sourceCoverage: Record<string, {
    expected: number;
    projected: number;
    pending: number;
    failed: number;
    lastSourceRevision?: string;
  }>;

  lastEvidenceSequence: string;

  status:
    | "projecting"
    | "complete"
    | "degraded"
    | "incomplete";

  qualityIssueIds: string[];
  createdAt: string;
  sealedAt?: string;
}
```

Manifest 规则：

- `complete`：所有 Required Evidence 完整；
- `degraded`：Required 完整，只缺 Supporting/Diagnostic；
- `incomplete`：任一 Required 缺失、冲突或无法投影；
- Manifest 不得通过统计现有 Outbox 猜测适用性，必须由 Record Policy 和 Episode 实际特征计算；
- Manifest 可以在终态时先为 `projecting`，待异步 Source Projector 收口后封存。

---

# 11. Source-to-Evidence Matrix

Phase 1 必须创建：

```text
reports/v1.4.1-evidence/source-to-evidence-matrix.csv
reports/v1.4.1-evidence/source-to-evidence-matrix.json
```

每一行至少包含：

```text
source_system
source_database
source_table_or_aggregate
source_authority
source_identity_fields
source_revision_rule
source_timestamp_field
record_family
record_type
schema_name
schema_version
delivery_guarantee
evaluation_role
applicability
mapper
projection_mode
cursor_rule
redaction_profile
artifact_policy
required_references
status
```

所有 Required Record Type 在进入 Phase 12 前必须为：

```text
IMPLEMENTED_AND_VERIFIED
```

不允许 `TODO`、`ASSUMED` 或空 Mapper。

---

# 12. Goal 模式执行规则

## 12.1 自主执行

Codex 应自行完成：

- 仓库勘察；
- 设计和 ADR；
- 代码实现；
- Migration；
- 测试；
- 文档；
- 阶段报告；
- Git commit/push；
- Draft PR 创建和更新；
- Review 反馈修复；
- 最终 Ready for Review。

不要为普通实现细节逐项询问用户。只有第 24 节硬阻塞条件允许停止。

## 12.2 持久化 ExecPlan

创建并持续更新：

```text
execplans/EP-SDAR-V1.4.1-CANONICAL-EVIDENCE.md
reports/v1.4.1-evidence/goal-state.json
reports/v1.4.1-evidence/00-baseline.md
reports/v1.4.1-evidence/00-baseline.json
```

ExecPlan 至少包含：

- Goal；
- 当前 Main/Base SHA；
- 分支和 PR；
- Phase 状态；
- 决策；
- Source Matrix 状态；
- 测试证据；
- 失败尝试；
- Blocker；
- 恢复入口；
- 最终结果。

## 12.3 每 Phase 独立提交和推送

每个 Phase 必须：

1. `git fetch --tags origin`；
2. 确认工作区和远程分支；
3. 完成本阶段最小闭环；
4. 执行要求测试；
5. 更新 ExecPlan、Goal State 和 Phase Report；
6. 创建语义明确的 commit；
7. 立即 push；
8. 记录 SHA、测试、推送证据。

禁止：

- 多个 Phase 合并成一个大 commit；
- 已推送后 amend；
- rebase 已推送历史；
- force push；
- reset 丢弃已有成果；
- 未运行测试却写 passed；
- 自动 merge 到 main；
- 自动 tag、Release 或部署。

## 12.4 Dirty Worktree

若存在用户未提交修改：

- 不删除、不覆盖；
- 优先使用独立 worktree；
- 无法安全隔离时创建 blocker。

## 12.5 Main 同步

已推送分支只允许：

```bash
git fetch --tags origin
git merge --no-ff origin/main
```

不得 rebase 或 force push。

每次大规模共享文件修改前，以及最终验收前，必须同步最新 `origin/main` 并运行回归。

---

# 13. 分支与 PR

## 13.1 分支

```bash
git fetch --tags origin
git switch main
git pull --ff-only origin main
git switch -c feature/v1.4.1-canonical-evidence-export
git push -u origin feature/v1.4.1-canonical-evidence-export
```

若分支已存在：

- checkout 远程分支；
- 读取 ExecPlan 和 Goal State；
- 验证最后完成 Phase；
- 从第一个未完成 Phase 继续；
- 不重写历史。

## 13.2 Draft PR

Phase 0 push 后创建：

```text
head: feature/v1.4.1-canonical-evidence-export
base: main
title: feat(v1.4.1): complete canonical evidence export
```

PR Body 持续更新：

- Current Phase；
- Main/Base SHA；
- Latest Commit；
- Source Coverage；
- Record Catalog Coverage；
- Tests；
- Known Limitations；
- Blockers；
- Remaining Work。

最终所有 Gate 通过后标记 Ready for Review，但不得自动 merge。

---

# 14. Phase 0：Baseline、设计冻结与分支

**建议 commit：**

```text
docs(v1.4.1): freeze canonical evidence goal baseline
```

## 工作

1. 读取所有仓库指令；
2. 确认最新 `origin/main`；
3. 记录 package version、Migration high-water、Source Lock；
4. 读取并映射当前：
   - Telemetry Export Domain/Application/Store/Transport；
   - `runtime_event`；
   - Skill Execution；
   - MCP Tasks；
   - Capability；
   - Experience/Replay/Artifact；
   - Node Control Event/Audit/Configuration；
5. 运行未修改基线：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

6. 创建 ExecPlan、Goal State、Baseline Report、Repository Map、Symbol Map、Migration Map；
7. 复制本任务包到仓库稳定文档路径；
8. 冻结 D-01～D-32；
9. 选择并记录 Migration Strategy A 或 B；
10. 创建分支、push、Draft PR。

## 验收

- clean baseline 有真实证据；
- 当前旧输出缺口有明确报告；
- Migration Strategy 有 ADR；
- Draft PR 存在；
- 本阶段不修改产品运行逻辑。

---

# 15. Phase 1：Authority Source Inventory

**建议 commit：**

```text
docs(v1.4.1): map authoritative evidence sources
```

## 工作

建立完整 Source-to-Evidence Matrix。

必须逐一核对：

- 来源表/聚合是否真实存在；
- 主键和版本字段；
- 可变还是不可变；
- Authority；
- 是否和业务事务一致；
- 是否已有领域 Outbox；
- 是否需要 Source Projector；
- 敏感字段；
- Artifact 边界；
- Required/Supporting/Diagnostic；
- Episode Applicability；
- Cross-reference。

必须主动查找并关闭：

- 只有摘要没有结构化事实；
- 无稳定 ID；
- 无版本的可变行；
- 多个权威冲突；
- 事务外补写；
- 只在测试报告存在而 Runtime 不持久化；
- 只能从 Prompt/隐藏推理推断；
- Node Event Payload 不足以恢复完整状态。

## 输出

```text
source-to-evidence-matrix.csv/json
authority-map.md
source-identity-report.md
source-coverage-baseline.json
missing-source-blockers.md
```

## 验收

所有 Catalog Record Type 必须为：

```text
source_confirmed
source_missing_blocker
conditional_not_applicable
```

不得保留“推测来源”。

---

# 16. Phase 2：Canonical Evidence Domain、Schema 和 Catalog

**建议 commit：**

```text
feat(v1.4.1): define canonical evidence contracts
```

## 交付

- `CanonicalEvidenceEnvelope`；
- Record Family/Type Catalog；
- Delivery/Evaluation Policy；
- Stable ID；
- Canonical JSON/Hash；
- ArtifactRef；
- Redaction；
- Schema Registry；
- Batch/ACK Schema；
- Manifest Schema；
- Quality Issue Schema。

建议扩展现有 Domain 和 Schema 包，不创建第二套 Runtime。

候选路径，实际按仓库结构调整：

```text
packages/domain/src/evidence/
packages/application/src/evidence/
schemas/evidence/
protocol/evidence/v1/
```

## 安全要求

- JSON 深度/大小有界；
- 循环对象拒绝；
- 非有限数字拒绝；
- Credential/Token/Secret/Authorization 字段拒绝；
- Chain-of-Thought/Private Reasoning 字段拒绝；
- Unknown Enum fail-closed；
- Required references 有界且唯一；
- Schema Hash 可验证。

## 测试

- Domain Unit；
- JSON Schema Contract；
- ID determinism；
- Hash determinism；
- Conflict；
- Redaction adversarial；
- Schema size/depth；
- Typecheck/Lint/Architecture。

---

# 17. Phase 3：Clean-Slate Evidence Persistence

**建议 commit：**

```text
feat(v1.4.1): replace telemetry persistence with evidence outbox
```

## 工作

按 Phase 0 Migration Strategy：

- 删除/退役旧 `runtime_telemetry_export_*` 产品结构；
- 创建新的 Evidence 表；
- 创建索引、唯一约束、状态约束；
- 添加 Source Checkpoint 和 DLQ；
- 创建 Manifest；
- 更新 clean baseline、seed、reset 和 Migration Verifier；
- 删除旧 pending-data migration 逻辑；
- 不迁移旧开发数据。

## 要求

- `record_id + payload_hash` 幂等；
- 同 ID 不同 Hash 冲突；
- Sequence 单调；
- Pending 索引；
- High Watermark；
- Lease/Fencing；
- ACK 连续；
- Process restart 恢复；
- Outbox Endpoint failure 不影响 Runtime；
- 数据库 rollback 不产生虚假 Evidence。

## 测试

- Fresh DB；
- Reset；
- Rollback/Reapply；
- Concurrent insert；
- Duplicate；
- Hash conflict；
- Crash before/after commit；
- Cursor recovery；
- Pending/ACK；
- Migration gate。

---

# 18. Phase 4：Evidence Export Configuration、Service 和 HTTP Transport

**建议 commit：**

```text
feat(v1.4.1): implement evidence batch export protocol
```

## 工作

直接替换旧 Telemetry API/Domain/Transport：

```text
TelemetryExportConfiguration → EvidenceExportConfiguration
TelemetryExportRecord        → CanonicalEvidenceEnvelope
x-sdar-telemetry-contract     → x-sdar-evidence-contract
```

删除：

- 旧 Batch Payload；
- 任意 `recordFamilies: string[]`；
- 旧 Capture-from-runtime_event 实现；
- 旧 Telemetry 名义下的外部合同。

保留并加强：

- Endpoint probe；
- HTTPS/Loopback HTTP；
- CredentialRef；
- Redirect denial；
- Batch；
- Retry；
- Backoff；
- ACK；
- High Watermark；
- Drain 非阻塞；
- Status；
- Configuration Revision / Apply / Ack / LKG。

## 测试

- Protocol Contract；
- Partial ACK；
- Invalid ACK；
- ACK rollback；
- Endpoint unavailable；
- Timeout；
- Redirect；
- TLS；
- Credential missing；
- Batch size/bytes；
- Required Family exclusion denied。

---

# 19. Phase 5：Runtime Core Evidence

**建议 commit：**

```text
feat(v1.4.1): project runtime core evidence
```

## 必须覆盖

```text
Request / A2A Task
Goal / Goal Contract / Goal Patch
Plan / Plan Step
State Transition
Decision / Policy / Gate / Confirmation
Action / Receipt
Verification
Terminal Outcome / Run Seal
```

## 要求

- Goal/Plan 版本明确；
- Action 带 Execution Basis；
- Receipt 区分 transport/executor/business；
- Workflow completed 不等于 User Goal achieved；
- Goal Patch 后旧 Plan Authority 可追踪；
- Terminal Outcome 与 Task/Goal/Workflow 一致；
- Required Evidence 尽可能事务内写入；
- 无来源事实时写 Quality Issue，不得推断。

## 垂直测试

```text
request
→ goal contract
→ confirmed plan
→ action
→ receipt
→ verification
→ achieved outcome
→ manifest draft
```

必须断言每个 Required Record 的 ID、Hash、Reference 和 Sequence。

---

# 20. Phase 6：Skill Evidence

**建议 commit：**

```text
feat(v1.4.1): project complete skill usage evidence
```

## 必须覆盖

- exact Skill Version；
- Usage Specification Snapshot/Hash；
- Discovery Candidates；
- Applicability；
- Context Resolution Source；
- Selection；
- Mode；
- Composition；
- Parent/Child Relation；
- Capability Slot Resolution；
- Procedure Compilation；
- Plan Compliance；
- Execution Events；
- Provider/Resource/RemoteTask/Evidence/HardGate/Human/Outcome References；
- Failure Propagation；
- degraded Missing Effects。

## 约束

- Legacy/Native 的真实来源属性可以保留，但不为旧 Telemetry 格式提供兼容；
- 不能仅输出 `skill.execution_completed` 摘要；
- Skill Execution Tree 必须可重建；
- Unsupported Mode、递归超限、Cycle 和 Plan Compliance Failure 必须可见；
- 不输出隐藏推理。

## 测试

- `embodied.move_to`；
- `embodied.area_patrol`；
- fixed child；
- capability slot；
- fail_fast/recoverable/optional/degraded；
- parent/child external wait；
- plan compliance pass/fail；
- evidence missing。

---

# 21. Phase 7：MCP Tasks 与 Capability Evidence

**建议 commit：**

```text
feat(v1.4.1): project mcp task and capability evidence
```

## MCP Tasks

覆盖：

- ToolCall；
- Availability/Timing/Reservation；
- RemoteTaskBinding；
- Observation；
- Control Event；
- Poll Attempt；
- Input Link；
- Cancel；
- Reconciliation；
- Continuation Snapshot/Attempt；
- Receipt；
- Verification。

## Capability

覆盖：

- Definition；
- Implementation Binding；
- Readiness；
- Task Capability Binding；
- Attempt History；
- A2A Exposure；
- Agent Card Revision。

Task Capability Binding Payload 必须包括真实存在的：

- Input Snapshot；
- Success Criteria Snapshot；
- Evidence Requirement Snapshot；
- Constraint Snapshot；
- Initial Implementation Refs；
- Provider Policy Snapshot；
- Binding Hash。

## 不变量

- ToolCall 返回 Task Handle 后 ToolCall 生命周期结束；
- Observation 不触发 Workflow；
- Control Event 先落库再 Continue；
- Continuation 不从 START；
- completed side effect 不重放；
- Cancel 未确认时保持 uncertain/requested；
- Provider completed 只形成 Receipt，Goal 仍需 Verification。

---

# 22. Phase 8：Experience、Replay 和 Artifact Evidence

**建议 commit：**

```text
feat(v1.4.1): project experience replay and artifact evidence
```

## Experience

覆盖：

- GoalExperienceEpisode；
- ExperienceTrace；
- Trace Event；
- Activity；
- Parent Event；
- Concurrency Group；
- Branch；
- Missing Fact Codes；
- Completeness；
- Process Variant；
- Workflow Pattern；
- Dependency；
- Recovery Pattern；
- Planning Correction；
- Interaction Episode。

不能只输出 `experience.trace_created`。

## Replay

覆盖：

- Dataset Version；
- Case；
- Run；
- Case Result；
- Metric Result；
- Counterexample；
- No-physical-side-effect 证明；
- Source Snapshot Hash。

## Artifact

覆盖：

- Lifecycle；
- Validation；
- Retrieval；
- Usage；
- Feedback；
- Promotion；
- exact version；
- policy/authority refs；
- usage correlation。

大 Payload 通过 ArtifactRef，不重复内联完整对象。

---

# 23. Phase 9：Node Control Evidence

**建议 commit：**

```text
feat(v1.4.1): project node control governance evidence
```

## 覆盖

- Node Profile Revision；
- Health Observation；
- Configuration Revision；
- Desired/Observed Apply；
- Ack；
- LKG Transition；
- LLM Provider；
- Model Route；
- SMPP Source；
- MCP Provider Binding；
- Skill Governance；
- Plan Template Governance；
- Node Capability；
- Capability Readiness；
- A2A Exposure；
- Agent Card Revision；
- Management Operation；
- Audit；
- Frozen Node Event；
- Evidence Export Configuration/Delivery/ACK。

## 要求

- 保持 Control PostgreSQL 权威；
- Runtime 不复制 Control 写权限；
- Node Event 丢失/重连后通过 Last-Event-ID 和权威 GET 恢复；
- Aggregate Revision 不倒退；
- 相同 Event ID 不同 Payload Hash 报冲突；
- Organization/Tenant/RBAC 边界保持；
- 不创建 Physical Command/Feedback 事实。

## E2E

```text
Control configuration revision
→ Runtime apply
→ Ack/LKG
→ Node Event
→ Runtime Evidence Projector
→ Evidence Outbox
→ Mock Sink ACK
```

---

# 24. Phase 10：Manifest、Coverage 和 Quality

**建议 commit：**

```text
feat(v1.4.1): seal episode evidence coverage
```

## 实现

- Episode Evidence Policy；
- Manifest Draft/Projecting/Seal；
- Expected Record 计算；
- Conditional Family 判断；
- Source Coverage；
- Sequence Gap；
- Payload Conflict；
- Orphan Reference；
- Version Gap；
- Missing Verification；
- Remote Task 未闭环；
- Skill Tree 不完整；
- Experience Missing Fact；
- Node Revision Regression；
- Export ACK Gap。

## 管理状态

必须能区分：

```text
source fact missing
source fact exists but unprojected
projected but pending export
exported but unacknowledged
acknowledged
projection failed
schema invalid
payload conflict
```

## 验收

- Required Source Coverage = 100%；
- Episode 可生成 `complete/degraded/incomplete`；
- `incomplete` 不被伪装为可评价；
- Manifest 结果可通过权威事实重新计算；
- 重复重算幂等。

---

# 25. Phase 11：Management API、Operations 和 Recovery

**建议 commit：**

```text
feat(v1.4.1): expose evidence export operations
```

## 最小管理能力

实际路径按现有 API 规范调整，至少支持：

```text
GET evidence export configuration/status
GET evidence outbox status
GET source checkpoints
GET projection issues
GET quality issues
GET episode manifest
POST replay one record/source partition/episode
POST retry dead-letter
POST reconcile source coverage
```

## 安全

- 不提供任意 SQL；
- 不提供 ClickHouse Proxy；
- 不向 Organization API 暴露 restricted Payload；
- Payload Query 默认只返回元数据和 Hash；
- 手工 Replay 需要现有管理员/安全角色；
- 操作形成 ManagementOperation/Audit/Evidence。

## 运维

文档：

- Endpoint outage；
- High Watermark；
- DLQ；
- Payload conflict；
- Source unavailable；
- Control projector recovery；
- Backup/Restore；
- Reset；
- Credential rotation；
- Rollback。

---

# 26. Phase 12：全链 E2E 与故障注入

**建议 commit：**

```text
test(v1.4.1): verify canonical evidence verticals
```

必须完成以下垂直场景。

## Runtime / Skill

1. 同步 Tool 成功；
2. Skill guidance；
3. Skill template；
4. Skill procedure；
5. Recursive Skill；
6. degraded Child；
7. Plan Compliance Failure；
8. Human Confirmation；
9. Goal Patch / Replan；
10. Verification Failure。

## MCP Tasks

11. available immediate；
12. restricted scheduled；
13. input_required；
14. cancel confirmed；
15. cancel uncertain；
16. provider unreachable；
17. duplicate Control Event；
18. restart during wait；
19. parallel tasks；
20. no duplicate side effect。

## Capability / Experience

21. Task Capability Binding；
22. Provider failover Attempt；
23. ExperienceTrace 完整；
24. Missing Fact Trace；
25. Replay Dataset/Case/Result；
26. Counterexample；
27. Artifact Retrieval/Usage/Feedback。

## Node Control

28. Configuration Apply/Ack/LKG；
29. Capability Readiness Change；
30. Agent Card Revision；
31. Management Operation/Audit；
32. Node Event reconnect/recovery；
33. Control API outage and recovery。

## Export

34. Sink unavailable；
35. Partial ACK；
36. Invalid ACK；
37. Duplicate delivery；
38. Same ID different Hash；
39. Runtime restart；
40. High Watermark；
41. DLQ/Replay；
42. Manifest complete；
43. Manifest degraded；
44. Manifest incomplete。

每个场景必须验证：

- Source Fact；
- Evidence Outbox；
- Stable ID；
- Hash；
- Sequence；
- References；
- Delivery；
- ACK；
- Manifest；
- 无业务状态污染。

---

# 27. Phase 13：对抗性、安全、性能和架构加固

**建议 commit：**

```text
fix(v1.4.1): harden evidence authority and delivery
```

必须主动寻找并修复：

- Business 层直接 Telemetry 调用；
- Runtime Event 摘要继续作为唯一输出；
- 可变来源无 Revision；
- Random Record ID；
- Hash 非确定；
- `NULL` 唯一约束漏洞；
- Cross-tenant 引用；
- Secret/Credential 泄露；
- Chain-of-Thought 字段；
- Oversized Payload；
- Cyclic JSON；
- Symlink/Artifact Escape；
- ACK 越界/倒退；
- Retry Storm；
- Dead Letter 丢失；
- Cursor 跳跃；
- Restart 重复或漏数；
- Control Revision 倒退；
- Node Event 与 GET 状态冲突；
- Required Family 被配置关闭；
- Supporting 数据被误作硬门槛；
- Manifest 过早 complete；
- Remote Task completed 直接 Goal achieved；
- degraded 被投影为 full success；
- Replay 触发物理副作用。

## 性能门槛

在相同本地测试环境：

- Required Evidence 事务写入不进行网络调用；
- Evidence 开启后关键 Runtime E2E P95 相对基线回归不超过 10%；
- 单次 Evidence append P95 不超过 20 ms；
- Projector 可批量处理，Batch 上限有界；
- Sink 停机时 Task Runtime 吞吐不因同步等待退化；
- High Watermark 时只阻断 Evidence Capture/标记 incomplete，不阻断已授权 Task 执行；
- 性能报告必须说明环境、样本、真实/模拟边界。

若现有仓库性能环境无法稳定满足具体时间阈值，不得静默放宽；必须给出证据并通过 ADR 调整门槛。

---

# 28. Phase 14：最终验收、冻结输出合同和 PR Ready

**建议 commit：**

```text
docs(v1.4.1): publish canonical evidence acceptance
```

## 工作

1. 更新：
   - package version；
   - CHANGELOG；
   - PROJECT_STATUS；
   - Architecture；
   - Domain Model；
   - API/Protocol；
   - Data Storage；
   - ADR Index；
   - Traceability；
   - Known Gaps；
   - Operations；
   - Release Checklist；
2. 冻结：
   - Evidence Contract；
   - Record Catalog；
   - JSON Schemas；
   - Schema Hashes；
   - Source-to-Evidence Matrix；
   - Delivery Policy；
   - Redaction Policy；
   - Manifest Policy；
3. 生成后续 ClickHouse Handoff：

```text
reports/v1.4.1-evidence/clickhouse-handoff/
  contract-manifest.json
  record-catalog.json
  schema-hashes.json
  source-mapping.json
  sample-batches/
  readiness-policy.json
  known-limitations.md
```

4. 运行完整验证。

最低命令：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm smoke
pnpm smoke:node-control
pnpm test:a2a-tck
pnpm verify:migrations
pnpm verify:architecture
pnpm verify:management-openapi
pnpm verify:node-control-contract
pnpm verify:acceptance
pnpm verify:evidence-contract
pnpm verify:evidence-coverage
pnpm demo:evidence-e2e
pnpm verify
```

若新脚本名称按仓库规范调整，必须提供等价、明确的最终 Gate。

5. 生成：

```text
reports/v1.4.1-evidence/14-final-acceptance.md
reports/v1.4.1-evidence/14-final-acceptance.json
```

6. 确认 Required Source Coverage = 100%；
7. 确认没有 Required Deferred Item；
8. Push；
9. 更新 PR Body；
10. 标记 Ready for Review；
11. 不自动 merge/tag/release/deploy。

---

# 29. 建议代码区域

最终路径以 Phase 0 仓库勘察为准。

```text
packages/domain/src/evidence/
  canonical-evidence.ts
  evidence-catalog.ts
  evidence-policy.ts
  evidence-manifest.ts
  evidence-quality.ts

packages/application/src/evidence/
  evidence-writer.ts
  evidence-projector.ts
  evidence-export-service.ts
  evidence-manifest-service.ts
  source-projectors/

packages/persistence-postgres/src/evidence/
  evidence-outbox-repository.ts
  evidence-checkpoint-repository.ts
  evidence-manifest-repository.ts
  evidence-quality-repository.ts

packages/evidence-export-adapter/
  src/http-evidence-export-transport.ts

packages/node-control-application/src/
packages/node-control-persistence-postgres/src/
packages/runtime-control-application/src/
packages/runtime-control-persistence-postgres/src/

protocol/evidence/v1/
  README.md
  contract.yaml
  schemas/
  fixtures/

schemas/evidence/

infra/postgres/migrations/
infra/postgres/baseline/

reports/v1.4.1-evidence/
execplans/EP-SDAR-V1.4.1-CANONICAL-EVIDENCE.md
```

## 必须直接检查的当前实现锚点

```text
packages/node-control-domain/src/telemetry-export.ts
packages/runtime-control-application/src/telemetry-export-service.ts
packages/runtime-control-persistence-postgres/src/telemetry-export-store.ts
packages/telemetry-export-adapter/src/http-telemetry-export-transport.ts
infra/postgres/migrations/0142_v14_telemetry_export.*
infra/postgres/migrations/0143_v14_node_event_projection.*

packages/domain/src/skill-execution.ts
packages/persistence-postgres/src/skill-execution-repository.ts
packages/domain/src/task-capability.ts
packages/persistence-postgres/src/task-capability-repository.ts

packages/application/src/compiler/experience-normalizer.ts
packages/persistence-postgres/src/compiler/experience-compilation-repositories.ts

packages/node-control-domain/src/node-event.ts
packages/node-control-application/src/node-event-service.ts
packages/node-control-persistence-postgres/src/node-event-repository.ts
```

路径可能随最新 `main` 变化，Codex 必须重新发现。

---

# 30. 测试节奏

## 每个 Phase

至少运行：

- Changed-area Unit/Contract；
- Typecheck；
- Lint；
- Format Check；
- Architecture Check（涉及边界时）；
- Migration Check（涉及 DB 时）。

## 强制完整 `pnpm verify`

至少在：

- Phase 0；
- Phase 3；
- Phase 7；
- Phase 9；
- Phase 12；
- Phase 13；
- Phase 14。

测试失败时：

- 不得标记 Phase 完成；
- 不得修改报告为 passed；
- 可以提交明确 Blocker 或修复；
- 失败尝试必须保留真实记录。

---

# 31. Definition of Done

## 架构

- 唯一正式外部输出为 `sdar.evidence/v1`；
- 旧 runtime-event-only Telemetry Capture 不再存在；
- 无新旧双写；
- 无第二 Workflow Runtime；
- PostgreSQL 权威边界不变；
- Control/Runtime 无分布式事务；
- Redis 非权威；
- 外部 Sink 非业务权威；
- ClickHouse 未被引入本任务。

## 数据

- 所有 Required Record Type 有真实 Source 和 Mapper；
- Required Source Coverage = 100%；
- Stable ID/Hash/Schema 可复现；
- Skill Tree 可重建；
- MCP Task Lifecycle 可重建；
- Capability Chain 可重建；
- ExperienceTrace/Activity 可重建；
- Node Control Governance Trail 可重建；
- Goal→Skill→Plan→Action→Task→Verification→Outcome 可重建。

## 可靠性

- Transactional Evidence 与业务提交一致；
- Source Projector 可恢复；
- 至少一次投递；
- ACK 正确；
- 重复幂等；
- Hash Conflict 可发现；
- Endpoint 停机不影响 Runtime；
- High Watermark 可观测；
- DLQ 可重放；
- Manifest 可重新计算。

## 安全

- 无 Secret/Credential/Authorization；
- 无隐藏思维链；
- Tenant/User Scope 不串；
- Artifact 有 Hash/大小/路径边界；
- Management Replay 有 RBAC/Audit；
- 非 Loopback 强制 HTTPS。

## 质量

- Required Tests 全部通过；
- Migration 和 Baseline 通过；
- OpenAPI/Protocol/Schema 通过；
- 全链 E2E 通过；
- Source Matrix 无 Required TODO；
- ClickHouse Handoff 完整；
- PR Ready；
- 不存在 Required Blocker。

---

# 32. 不允许实现的内容

本任务不得扩张为：

- ClickHouse 建库或 DDL 升级；
- `sdar_core/sdar_meta/sdar_mart`；
- OTel Collector 平台；
- Langfuse；
- 正式评价指标和总分；
- LLM Judge；
- Dashboard；
- Telemetry Query Proxy；
- 多节点监督平面；
- 物理设备 Command/Feedback Runtime；
- 新 Workflow Runtime；
- 新 Skill Runtime；
- 自动修改/发布 Skill；
- 自动 merge/tag/release/deploy；
- 生产 HA/SLO/RTO/RPO 宣称。

---

# 33. 硬阻塞条件

只有以下情况允许停止：

1. 未修改代码的最新 `main` 基线存在真实失败，且无法归因于已知外部环境；
2. 无法安全隔离用户未提交修改；
3. GitHub 无写权限或分支保护阻止阶段 push；
4. 无法确定 Required Record 的权威来源或稳定身份；
5. 当前 Authority 边界无法在不建立分布式事务的情况下满足；
6. Migration/Source Lock 规则既不允许重写也不允许安全 clean cutover；
7. 必需事实只能通过隐藏推理、猜测或 Secret 获得；
8. 现有架构无法维持单一 Workflow Runtime；
9. 依赖或许可证不满足仓库要求；
10. Required Evidence 的事务一致性无法实现，且 Durable Projection 也无法证明完整性。

停止时必须：

- 保留已完成成果；
- 写 Blocker Report；
- 更新 ExecPlan/Goal State；
- commit；
- push；
- 更新 Draft PR；
- 给出准确恢复条件；
- 不宣称完成。

---

# 34. Goal 恢复协议

每次重启：

```bash
git fetch --tags origin
git switch feature/v1.4.1-canonical-evidence-export
git pull --ff-only
```

然后：

1. 读取 ExecPlan；
2. 读取 Goal State；
3. 读取 Source Matrix；
4. 检查 PR；
5. 校验最后 Phase Commit；
6. 运行必要 Smoke/Target Test；
7. 检查最新 `origin/main`；
8. 必要时显式 merge；
9. 从第一个未完成 Phase 继续；
10. 不重复已完成 commit；
11. 不重写历史。

---

# 35. Phase Commit 清单

| Phase | Commit |
|---|---|
| 0 | `docs(v1.4.1): freeze canonical evidence goal baseline` |
| 1 | `docs(v1.4.1): map authoritative evidence sources` |
| 2 | `feat(v1.4.1): define canonical evidence contracts` |
| 3 | `feat(v1.4.1): replace telemetry persistence with evidence outbox` |
| 4 | `feat(v1.4.1): implement evidence batch export protocol` |
| 5 | `feat(v1.4.1): project runtime core evidence` |
| 6 | `feat(v1.4.1): project complete skill usage evidence` |
| 7 | `feat(v1.4.1): project mcp task and capability evidence` |
| 8 | `feat(v1.4.1): project experience replay and artifact evidence` |
| 9 | `feat(v1.4.1): project node control governance evidence` |
| 10 | `feat(v1.4.1): seal episode evidence coverage` |
| 11 | `feat(v1.4.1): expose evidence export operations` |
| 12 | `test(v1.4.1): verify canonical evidence verticals` |
| 13 | `fix(v1.4.1): harden evidence authority and delivery` |
| 14 | `docs(v1.4.1): publish canonical evidence acceptance` |

Phase 过大时可以拆分，但不得把多个表中 Phase 合并成一个大 commit。

---

# 36. Codex 每次停止或完成的输出格式

## Current state

- Branch；
- HEAD；
- PR；
- Main/Base SHA；
- Package Version；
- Last Completed Phase；
- Source Coverage；
- Record Catalog Coverage；
- Test Summary。

## Commits pushed

列出本次新推送 commit。

## Completed

仅说明真实完成内容。

## Blocked or remaining

- Blocker；
- Required Missing Sources；
- Failed Tests；
- Remaining Phases。

## Resume

给出下一次从哪里继续。

## Final completion

只有 Phase 14 的全部 DoD 满足时才输出：

```text
SDAR_V1_4_1_CANONICAL_EVIDENCE_GOAL_COMPLETE
```

不得在部分完成、Required Coverage 不足、测试未通过、PR 未 Ready 或存在 Required Blocker 时输出该标志。
