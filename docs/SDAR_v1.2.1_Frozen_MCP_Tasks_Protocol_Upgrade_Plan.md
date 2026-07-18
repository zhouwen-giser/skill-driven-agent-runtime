# SDAR v1.2.1 Frozen MCP Tasks 协议升级实施计划

> **类型：** v1.2.0 完成并合并后的独立升级计划
> **目标版本：** `1.2.1`
> **仓库：** `zhouwen-giser/skill-driven-agent-runtime`
> **基线：** `main@922f4288880e0fe3dee6ce402aa9788f4caa80eb`
> **开发分支：** `feature/v1.2.1-frozen-mcp-tasks-protocol`
> **协议：** `SDAR MCP Tasks 统一协议字段规范 V1.0 — Contract Frozen`
> **MCP Source Commit：** `26897cc322f356487da89113451bd16b520b9288`
> **MCP Schema Blob：** `cc44564e33305dbc07e820cdd0a97648f3852019`
> **执行：** Codex Goal 模式；每个小阶段独立 commit 并立即 push
> **边界：** 保留 Legacy v1.1 Provider Handler；新增 Frozen V1 Handler；禁止协议自动翻译

---

# 1. 重新审查结论

远程仓库的 v1.2 已完成 Phase 0～15，并已合并到 `main`。以下能力均已有实现和验收证据：

- `embodied.move_to`；
- `embodied.area_patrol`；
- 动态 capability slot；
- exact-version child Skill；
- parallel external waits；
- child output mapping；
- optional/recoverable/degraded/fail_fast；
- parent-child Skill Execution Tree；
- Phase 14 对抗审查；
- Phase 15 最终验收；
- 版本 `1.2.0`。

因此，之前补充计划中的以下内容全部删除：

```text
不再开发动态 capability slot
不再开发 Invocation Instance
不再开发 parallel/join
不再开发 child output mapping
不再开发 degraded/failure policy
不再开发 parent-child execution tree
不再把原 Phase 13～15 当作待实现阶段
```

本次升级只处理：

```text
v1.2.0 已完成业务能力
+ 当前 Legacy/旧实验 MCP Tasks Client Boundary
→ Frozen MCP Tasks Contract V1.0
→ SDAR Component Conformant
→ Provider Runtime Interop Certified
```

现有 v1.2 报告继续保留，含义为：

```text
v1.2.0 business/runtime acceptance
against legacy v1.1 MCP Tasks client contract
```

新增报告统一放入：

```text
reports/v1.2.1-frozen-mcp-tasks/
```

---

# 2. 当前代码实际差异

## 2.1 可复用能力

当前代码已经具备：

- Flat `CreateTaskResult`；
- `resultType: "task"`；
- Task 顶层 `ttlMs`、`pollIntervalMs`；
- `tasks/get` 五态；
- `tasks/update.inputResponses`；
- `tasks/cancel` Ack；
- RemoteTaskBinding；
- PostgreSQL Observation；
- BullMQ Polling/Rebuild；
- input_required continuation；
- cooperative cancel；
- restart continuation；
- `completed + result.isError=true`；
- Tool Result `_meta` 透传；
- Skill Evidence Hard Gate；
- move_to/area_patrol 完整链路。

这些能力应迁移复用，不应推倒重写。

## 2.2 需要升级的代码

### `packages/mcp-adapter/src/mcp-tasks-contract.ts`

仍绑定：

```text
ext-tasks commit 8966bea...
旧 Schema Blob 2634c47...
private aliases
bridge nonce
revision / remoteRevision
CallToolResult 未强制 resultType=complete
MRTR Map Value 仅按 unknown
无 Notification Schema
```

### `packages/mcp-adapter/src/streamable-http-adapter.ts`

仍使用：

```text
Client.connect()
初始化式 capability
SDK version negotiation
temporary transport bridge
execution.taskSupport
require_task 调用级模式
无 per-request Request Meta
无 server/discover 持久权威
无 subscriptions/listen
```

### `packages/mcp-adapter/src/mcp-tasks-transport-bridge.ts`

这是临时兼容层：

```text
private aliases
method rewrite
nonce envelope
旧 SDK Task result 绕行
```

Frozen Handler 不得依赖它。

### `packages/mcp-adapter/src/mcp-task-availability-contract.ts`

仍使用：

```text
io.sdar/tasks/checkAvailability
revision
requests[]
nodeId
arguments.unresolved
knownArguments
JSONPath $
execution
cancellation
```

### Domain

`packages/domain/src/mcp-task-availability.ts` 仍包含：

```text
allow_task
require_task
execution=synchronous/task_capable/task_required
cancellation=task_cancel
nodeId
unresolved boolean
```

`packages/domain/src/mcp-task.ts` 仍只有：

```text
revision
remoteRevision
eventId
```

`packages/domain/src/remote-task.ts` 和 Migration 0100 仍主要以：

```text
remoteRevision
Polling source
```

表达 Task Observation。

### Evidence

`packages/langgraph-runtime/src/bound-value-resolver.ts` 会直接把：

```text
metadata["io.sdar/evidence"]
```

扁平合并成 `evidence.<key>`，适用于旧 boolean Evidence，不适用于 Frozen Evidence Items。

### Skill Package

当前：

```text
skills/embodied.move_to/normative.json
skills/embodied.area_patrol/normative.json
```

都要求：

```text
cancellation:task_cancel
```

Frozen Profile 不再提供该属性。

### Mock Provider

仍使用：

```text
旧 taskExecution Profile
旧 Availability Method/Envelope
revision / remoteRevision
boolean evidence
polling-only
```

### 状态文件

当前 `PROJECT_STATUS.md` 和 `sync-state.json` 仍写 PR #5 未合并，需先修复为真实 GitHub 状态。

---

# 3. 升级架构

## 3.1 显式双 Handler

```text
Legacy Provider
→ LegacyV11McpClient
→ 当前 SDK/Bridge/旧 Wire

Frozen Provider
→ FrozenV1McpClient
→ Stateless Base + SEP-2663 + SDAR Profiles
```

禁止：

- 自动把旧字段改成新字段；
- Frozen Provider 自动降级 Legacy；
- 一个响应同时返回两套字段；
- Frozen Handler 接受 bridge alias；
- PMS/Client 充当协议翻译器。

## 3.2 Provider 协议模式

新增：

```ts
type McpProviderProtocolMode = 'legacy_v11' | 'frozen_v1';
```

规则：

1. 现有 Server 数据回填为 `legacy_v11`；
2. 新注册 Provider 必须显式选择；
3. `frozen_v1` 必须通过 `server/discover`；
4. 失败不得自动降级；
5. 有 active RemoteTaskBinding 时禁止切换模式；
6. 模式切换必须重新 discover、刷新 Tools、生成 dependency warnings。

## 3.3 Frozen Client 独立于旧 Bridge

推荐新增：

```text
packages/mcp-adapter/src/frozen/
├── frozen-http-client.ts
├── frozen-sse-parser.ts
├── frozen-discovery.ts
├── frozen-request-meta.ts
├── frozen-routing-headers.ts
├── frozen-task-contract.ts
├── frozen-availability-contract.ts
├── frozen-notification-contract.ts
└── frozen-evidence-contract.ts
```

Frozen 路径可以使用 `fetch`、Zod/Ajv、AbortSignal 和现有 Ports，但不能使用：

- Bridge aliases；
- nonce envelope；
- initialize/connect 会话；
- SDK 的旧 Tasks 类型。

## 3.4 Observation 单入口

```text
tasks/get
          ┐
          ├→ RemoteTaskObservationAdmissionService
notification
          ┘    ├→ schema validation
               ├→ taskId + runtimeRevision dedupe
               ├→ persistence
               ├→ control event
               └→ continuation queue
```

Polling 和 Notification 不得各有一套终态处理。

## 3.5 Evidence 方案 A

Provider Wire：

```text
evidenceId
evidenceType
observedAt
payloadRef
```

不返回 Skill 内部 `requirementId`。

SDAR 本地执行：

```text
Skill requirement
→ evidenceType
→ Provider Evidence Item
→ Pointer/Hash 校验
→ local requirement satisfaction
```

---

# 4. 版本和分支

推荐目标版本：

```text
1.2.1
```

前提是 Legacy Handler 保留，现有 Skill/A2A/Management API 保持兼容。

创建分支：

```bash
git fetch origin --prune
git checkout main
git pull --ff-only origin main
git switch -c feature/v1.2.1-frozen-mcp-tasks-protocol
```

记录：

```text
BASE_MAIN_SHA=922f4288880e0fe3dee6ce402aa9788f4caa80eb
V12_RELEASE_SHA=b3b6e67d1e84ee462a57f209417521c6008be989
```

立即创建 Draft PR：

```text
feature/v1.2.1-frozen-mcp-tasks-protocol → main
```

最终 Interop Gate 通过前保持 Draft。

---

# 5. Phase 0：基线与协议 Intake

**Commit：**

```text
docs(v1.2.1): start frozen mcp tasks protocol upgrade
```

工作：

1. 修复 `PROJECT_STATUS.md`；
2. 修复 `reports/v1.2-skill-usage/sync-state.json`；
3. 新增：
   ```text
   execplans/EP-11-v1.2.1-frozen-mcp-tasks-protocol.md
   docs/protocol/SDAR_MCP_TASKS_UNIFIED_PROTOCOL_V1_0_FROZEN.md
   docs/protocol/SDAR_MCP_TASKS_V1_0_ERRATA_001.md
   reports/v1.2.1-frozen-mcp-tasks/00-baseline.md
   reports/v1.2.1-frozen-mcp-tasks/00-baseline.json
   ```
4. 新增 ADR：
   ```text
   ADR-108-frozen-mcp-tasks-dual-protocol-boundary.md
   ```
5. ADR 冻结：
   - 双 Handler；
   - protocolMode；
   - Frozen 路径不使用 Bridge；
   - Poll/Notification 单入口；
   - Evidence A；
   - Contract/Component/Interop 三层状态；
   - 不重开 v1.2 Phase 13～15；
   - PostgreSQL 和 LangGraph 权威不变。

验收：

- 状态文件与 Merge SHA 一致；
- 历史 v1.2 报告不改写；
- Draft PR 创建；
- 升级前完整 `pnpm verify` 通过；
- 记录 0106 和 ADR-107 高水位。

---

# 6. Phase 1：共享协议包和 Lock

**Commits：**

```text
build(protocol): pin frozen mcp tasks contract
test(protocol): verify frozen schemas and legacy rejection
```

目录：

```text
protocol/
├── protocol-baseline.json
├── protocol-baseline.lock.json
├── source/mcp-2026-07-28.schema.json
├── schemas/
│   ├── mcp-stateless-request.schema.json
│   ├── mcp-server-discover.schema.json
│   ├── mcp-streamable-http-routing.schema.json
│   ├── mcp-tasks-sep2663.schema.json
│   ├── mcp-task-notifications.schema.json
│   ├── sdar-task-execution-profile-v1.schema.json
│   ├── sdar-availability-v1.schema.json
│   ├── sdar-evidence-v1.schema.json
│   └── protocol-mismatch.schema.json
├── fixtures/valid/
├── fixtures/invalid/
└── scripts/
```

Baseline：

```json
{
  "protocolVersion": "2026-07-28",
  "sourceCommit": "26897cc322f356487da89113451bd16b520b9288",
  "sourceSchemaGitBlob": "cc44564e33305dbc07e820cdd0a97648f3852019",
  "sourceSchemaSha256": "<generated>",
  "taskExtension": "io.modelcontextprotocol/tasks",
  "taskExecutionProfileVersion": "1.0",
  "evidenceProfileVersion": "1.0"
}
```

更新 `third_party/sources.lock.yaml`：

- 旧 ext-tasks pin 保留为 Legacy source；
- 新增 Frozen MCP Source pin；
- 旧 v2 beta SDK 仅允许用于 Legacy Handler；
- Frozen Handler 以共享 Schema 为权威。

Frozen Schema 必须拒绝：

```text
execution.taskSupport
allow_task/require_task wire mode
nested task
ttl/pollInterval
inputs
io.sdar/tasks/checkAvailability
requests[]/nodeId
remoteRevision-only metadata
boolean evidence
tasks/result/list/observations
```

验收：

- Hash 可重复；
- Lock 漂移 CI 失败；
- valid fixtures 通过；
- invalid fixtures 失败；
- Legacy fixtures 仍能由 Legacy Schema 验证；
- Domain 不导入 MCP SDK Wire 类型。

---

# 7. Phase 2：Domain 和 Workflow Contract

**Commits：**

```text
refactor(domain): add frozen mcp protocol contracts
refactor(workflow): separate task behavior from invocation timing
```

新增：

```ts
type McpTaskBehavior = 'synchronous_only' | 'server_directed' | 'task_required';

interface McpTaskExecutionProfile {
  profileVersion: '1.0';
  taskBehavior: McpTaskBehavior;
  availability: 'not_supported' | 'dynamic';
  supportsScheduling: boolean;
  supportsMaxElapsed: boolean;
  supportsObservations: boolean;
  supportsInputRequired: boolean;
  idempotency: 'none' | 'client_request_key' | 'server_managed' | 'unknown';
}

interface McpProtocolContractSnapshot {
  mode: 'legacy_v11' | 'frozen_v1';
  protocolVersion: string;
  baselineSha256: string;
  tasksSchemaSha256?: string;
  taskExecutionProfileVersion?: '1.0';
  evidenceProfileVersion?: '1.0';
  serverDiscoverySnapshotId?: string;
}
```

`McpTool` 增加：

```text
outputSchema?
taskExecutionProfile?
protocolMode
```

旧 `taskExecution` 只作为 Legacy 投影。

Frozen Workflow 新计划不再生成：

```text
mode: allow_task
mode: require_task
```

Frozen `taskExecution` 只保留：

```text
availabilityCheck
timing
reservationRef
```

历史计划兼容：

- 旧 `mode` 可反序列化；
- 仅 `legacy_v11` 可执行；
- Frozen 新计划出现 `mode` 时拒绝；
- Frozen 返回 Shape 由 Tool `taskBehavior` 校验。

运行时规则：

```text
synchronous_only + task → mismatch
server_directed + sync/task → allowed
task_required + accepted sync success → mismatch
task_required + pre-admission isError → allowed
task_required + task → allowed
```

Availability Domain：

```text
nodeId → requestId
unresolved → state
knownArguments → knownValue
"$" → ""
```

Observation Domain：

```ts
interface FrozenTaskObservationMeta {
  profileVersion: '1.0';
  runtimeRevision: string;
  providerRevision?: string;
  eventId?: string;
  observedAt?: string;
  substate?: string;
  progress?: { percent: number };
}
```

`runtimeRevision` 是十进制无符号数字字符串；去重键为：

```text
taskId + runtimeRevision
```

Evidence Domain 新增 `ProviderEvidenceItem`，并禁止 Provider Wire `requirementId`。

---

# 8. Phase 3：Migration 0107

**Commits：**

```text
feat(persistence): add frozen mcp protocol authority
test(persistence): verify frozen protocol upgrade and rollback
```

Migration：

```text
0107_frozen_mcp_tasks_protocol
```

## 8.1 Provider Protocol Snapshot

新增 append-only：

```text
mcp_protocol_snapshot
```

字段：

```text
snapshot_id
server_id
protocol_mode
protocol_version
baseline_sha256
supported_versions_json
capabilities_json
server_info_json
task_notifications
discovered_at
valid_until
tool_revision
```

`mcp_server` 增加：

```text
protocol_mode
current_protocol_snapshot_id
```

现有 Server 回填 `legacy_v11`。

## 8.2 Tool

`mcp_tool` 增加：

```text
output_schema_json
```

现有 `task_execution_json` 继续作为唯一当前 Profile 列，按 protocolMode 解析。

## 8.3 Workflow

`workflow_plan_attempt` 和 `workflow_plan` 增加：

```text
mcp_protocol_contract_json
```

历史记录回填 `legacy_v11`。

## 8.4 Binding

`remote_task_binding` 增加：

```text
protocol_contract_json
task_behavior
runtime_revision
provider_revision
task_ttl_ms
task_expires_at
```

保留 `remote_revision` 供 Legacy 使用。

## 8.5 Observation

`remote_task_observation` 增加：

```text
observation_source
runtime_revision
provider_revision
subscription_id
```

Frozen 唯一性：

```text
binding_id + runtime_revision
```

## 8.6 Control Event

增加：

```text
runtime_revision
```

Frozen 唯一键：

```text
binding_id + event_type + runtime_revision + result_hash
```

不新增持久 Subscription 表；恢复从 active Binding 重建。

验收：

- empty；
- 0106→0107；
- idempotent；
- rollback/reapply；
- Legacy 回填；
- Legacy active Binding 可继续 Poll；
- Frozen 行满足新约束；
- 不安全 rollback fail closed。

---

# 9. Phase 4：Frozen Stateless HTTP Client

**Commits：**

```text
feat(mcp): add frozen stateless http client
test(mcp): verify frozen discovery metadata and routing headers
```

新增 `FrozenV1McpClient`，职责：

- 每请求 POST；
- Request Meta；
- `server/discover`；
- `tools/list/call`；
- `tasks/get/update/cancel`；
- Availability；
- `subscriptions/listen`；
- SSE；
- Headers；
- Frozen Schema；
- 错误归一化。

Request Meta：

```json
{
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    "name": "sdar",
    "version": "1.2.1"
  },
  "io.modelcontextprotocol/clientCapabilities": {
    "extensions": {
      "io.modelcontextprotocol/tasks": {}
    }
  }
}
```

Headers：

```text
Accept: application/json, text/event-stream
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: <method>
Mcp-Name: <toolName/taskId>（适用）
```

`server/discover` 在 Frozen Provider 注册和 refresh 时强制执行并保存 Snapshot。

错误：

```text
-32001 HeaderMismatch
-32003 Missing Capability
-32004 Unsupported Version
-32601 Method Not Found
-32602 Invalid Params
```

现有 Adapter 重构为 Router：

```text
McpTransportRouter
├── LegacyV11McpClient
└── FrozenV1McpClient
```

Frozen 路径不得实例化 Bridge。

验收：

- Frozen 不 initialize；
- 每请求 Meta；
- Header/Body 一致；
- missing fields；
- unsupported version；
- explicit no fallback；
- concurrent stateless calls；
- serverInfo 不作为认证。

---

# 10. Phase 5：Task、TTL、MRTR、Cancel

**Commits：**

```text
refactor(mcp): migrate frozen task lifecycle contracts
test(mcp): verify frozen task ttl mrtr and cancellation
```

Frozen Parser 强制：

```text
CallToolResult.resultType=complete
CreateTaskResult.resultType=task
GetTaskResult.resultType=complete
UpdateTaskResult.resultType=complete
CancelTaskResult.resultType=complete
```

Frozen 不接受 Bridge Shape。

CreateTaskResult：

- Flat；
- taskId；
- runtimeRevision；
- ttlMs；
- pollIntervalMs；
- Admission 后立即 `tasks/get` reconciliation。

TTL：

```text
expiresAt = createdAt + ttlMs
```

支持 `ttlMs=null`、动态变化；超过 expiresAt 不推导成功，进入 unusable/quarantine 证据路径。

MRTR：

- `inputRequests` 完整 Map；
- `inputResponses` 完整 Map；
- V1 支持 `elicitation/create`；
- Key 生命周期唯一；
- 部分回答；
- unknown/answered/superseded Key 忽略；
- Ack eventually consistent；
- 重复 A2A input 不重复 update。

Cancel：

- Ack 只表示 intent；
- 不保证 cancelled；
- Adapter 无停止能力也不能删除标准方法；
- 后续有限观察是 SDAR policy；
- completed/failed/cancelled 都可为最终结果。

验收覆盖同步、Task、MRTR、Cancel、TTL、业务错误、JSON-RPC 错误、restart 和 no duplicate call。

---

# 11. Phase 6：Availability、Readiness 和 Skill Attributes

**Commits：**

```text
refactor(mcp): migrate frozen availability profile
refactor(v1.2): update provider readiness attributes
```

迁移：

```text
io.sdar/tasks/checkAvailability
→ io.sdar/taskExecution/checkAvailability

revision → profileVersion
requests[] → checks[]
nodeId → requestId
unresolved=false → state=complete
unresolved=true → state=partial
knownArguments → knownValue
"$" → ""
```

Frozen attributes：

```text
task_behavior:synchronous_only
task_behavior:server_directed
task_behavior:task_required
availability:dynamic
scheduling
max_elapsed
observations
input_required
idempotency:client_request_key
idempotency:server_managed
task_notifications
```

删除：

```text
cancellation:task_cancel
execution:task_capable
execution:task_required
```

更新 move_to、area_patrol normative、golden snapshot 和 checksums。

推荐最低属性：

```json
{
  "requiredAttributes": ["observations", "task_notifications"]
}
```

是否要求 `task_behavior:task_required` 应由具体 Provider Policy 决定，不能一刀切。

新 deterministic plan 不再输出 `mode=require_task`；历史 Legacy Plan 保留。

---

# 12. Phase 7：Task Notification

**Commits：**

```text
feat(mcp): add frozen task notification subscriptions
test(mcp): verify notification polling convergence
```

新增：

```text
FrozenRemoteTaskSubscriptionManager
RemoteTaskObservationAdmissionService
```

规则：

- 每次最多 256 Task IDs；
- Ack 第一条；
- Ack 只含授权 Task；
- 所有消息带 subscriptionId；
- HTTP POST SSE；
- 无 Last-Event-ID；
- 断线重新 listen；
- 重连后 tasks/get；
- 有界队列；
- 慢消费者关闭流；
- 不阻塞 Task commit；
- terminal 后停止 interest。

统一 Observation 输入：

```text
create
poll
notification
reconciliation
```

Frozen 去重：

```text
taskId + runtimeRevision
```

Legacy 继续使用旧 revision/event/sequence。

Notification 可降低 Poll 频率，但 Polling 不得被删除。

验收：

- Ack first；
- unauthorized hidden；
- initial snapshot；
- all statuses；
- duplicate/regression/content mismatch；
- terminal rollback；
- reconnect；
- overflow；
- concurrent subscriptions；
- Poll/Notification race；
- one event/continuation；
- restart。

---

# 13. Phase 8：Evidence A 与 Output Schema

**Commits：**

```text
refactor(mcp): parse frozen provider evidence items
refactor(v1.2): match skill evidence by objective type
test(v1.2): verify frozen evidence hard gates
```

Tool Discovery 保存：

```text
outputSchema
```

`InternalToolResult` 增加：

```text
evidence: ProviderEvidenceItem[]
```

Adapter 校验：

- profileVersion；
- evidenceId；
- evidenceType；
- observedAt；
- no requirementId；
- JSON Pointer；
- URI scheme；
- Hard Gate URI SHA-256；
- Pointer 实际存在；
- duplicate ID；
- size/depth。

新增：

```text
SkillEvidenceMatcher
```

流程：

```text
Skill requirementId/evidenceType
+ Provider Evidence Item
+ structuredContent
→ local requirement satisfaction map
```

`bound-value-resolver` 不再直接 merge 任意 `_meta`，只读取验证后的：

```text
validatedEvidence
```

最终仍输出：

```text
evidence.<requirementId>
```

因此当前 Workflow Hard Gate 可复用。

Child Skill outputMappings 保持不变。

Skill Execution Record 增加 Evidence Item、本地 requirement、match、pointer/hash、runtimeRevision 引用。

---

# 14. Phase 9：Management 和 Operations

**Commits：**

```text
feat(v1.2.1): expose frozen mcp protocol execution evidence
docs(ops): add frozen provider protocol operations
```

Management API 至少展示：

Provider：

```text
protocolMode
current discovery
supportedVersions
baselineHash
taskNotifications
taskBehavior
outputSchemaHash
```

Remote Task：

```text
ttlMs/expiresAt
runtimeRevision/providerRevision
latest observation source
poll/notification health
evidence summary
```

操作能力：

- Frozen register/refresh；
- protocol diagnosis；
- reconnect；
- force reconciliation；
- mode switch guard；
- protocol baseline audit；
- notification fallback warning。

Console 最低增加 Protocol Badge、Notification Status、Task Revision、Observation Source。

---

# 15. Phase 10：本地 Component Conformance 与 v1.2 再认证

**Commits：**

```text
test(v1.2.1): certify frozen mcp client component
docs(v1.2.1): publish frozen protocol requalification
```

Mock Provider 拆为：

```text
startLegacyMcpTasksMockProvider
startFrozenMcpTasksMockProvider
```

不得自动兼容。

Frozen Mock 支持：

- server/discover；
- Request Meta；
- Headers；
- taskBehavior；
- Availability；
- Flat Task；
- MRTR；
- Cancel；
- Notification；
- runtimeRevision；
- Evidence A；
- outputSchema。

重新认证：

## move_to

- guidance/template/procedure；
- server_directed sync/Task；
- restricted；
- input；
- cancel；
- restart；
- notification；
- Evidence A；
- no duplicate Tool call。

## area_patrol

- exact child；
- dynamic slot；
- parent-child tree；
- parallel remote child；
- input；
- cancel；
- restart；
- degraded；
- evidence aggregation；
- Poll/Notification convergence。

全部旧 16 个 v1.1 场景继续通过。

完成后可声明：

```text
SDAR Frozen Client — Component Conformant
SDAR Frozen Mock Provider — Component Conformant
```

---

# 16. Phase 11：真实 Provider Runtime Interop

**外部 Gate：** Provider Runtime Component Conformant
**Commits：**

```text
test(v1.2.1): certify provider runtime interoperability
docs(v1.2.1): publish frozen mcp interop evidence
```

真实链路：

```text
SDAR
→ Streamable HTTP
→ sdar-mcp-tasks-provider-runtime
→ PostgreSQL
→ reference Adapter
```

覆盖：

- discovery；
- dot Tool Name；
- profile/outputSchema；
- Availability；
- admission rejection；
- CreateTaskResult；
- immediate get；
- working/input/cancel；
- notification；
- Poll race；
- restarts；
- TTL；
- success/business error/failed；
- Evidence A；
- duplicate revision；
- no duplicate side effect。

Provider Runtime 未就绪时：

1. 完成 Phase 0～10；
2. commit/push；
3. 写 blocker；
4. Draft PR 保持 Draft；
5. 不忙等待；
6. 不降低 Schema；
7. 不用 Mock 冒充 Interop。

---

# 17. Phase 12：对抗审查与 Release

**Commits：**

```text
test(v1.2.1): harden frozen mcp protocol boundaries
chore(v1.2.1): prepare frozen mcp tasks release
docs(v1.2.1): publish final protocol acceptance
```

对抗项至少包括：

```text
legacy/frozen confusion
missing request meta
spoofed discover
baseline hash mismatch
header/body mismatch
bridge alias on Frozen path
nested task
missing resultType
taskBehavior mismatch
TTL mismatch
revision regression
same revision different content
terminal rollback
notification before Ack
unauthorized task
subscription spoof
MRTR key reuse
cancel Ack treated terminal
poll/notification split brain
requirementId injection
boolean evidence
pointer abuse
URI abuse/no hash
outputSchema mismatch
hard gate bypass
protocol switch with active task
```

最终命令：

```text
format
lint
typecheck
unit
contract
integration
e2e
build
smoke
migrations
architecture
OpenAPI
baseline acceptance
v1.1 acceptance
protocol verification
full verify
```

版本升级：

```text
1.2.0 → 1.2.1
```

更新 CHANGELOG、状态、架构、Domain、DSL、API、数据、运维、ADR、Traceability、Known Gaps、Checklist、SBOM。

PR 通过全部 Gate 后改为 Ready，不自动合并。

---

# 18. Commit/Push 规则

每个阶段：

```bash
git status --short
git add <explicit-files>
git commit -m "<conventional commit>"
git push origin HEAD
git rev-parse HEAD
git ls-remote origin "$(git branch --show-current)"
```

要求：

- 本地远程 SHA 一致；
- 工作区干净；
- 报告记录 SHA；
- 不 squash 多阶段；
- 不提交凭据；
- 不重写 v1.2 历史；
- 不 force push。

---

# 19. 工作量

| 工作                     | 人日 |
| ------------------------ | ---: |
| 基线/ADR                 | 1～2 |
| Protocol Schema/Lock     | 2～4 |
| Domain/Workflow          | 2～4 |
| Migration 0107           | 3～5 |
| Frozen HTTP Client       | 5～8 |
| Task/TTL/MRTR/Cancel     | 3～5 |
| Availability/Readiness   | 2～4 |
| Notification             | 4～7 |
| Evidence A/Output Schema | 3～5 |
| Management/Record        | 2～3 |
| Component Conformance    | 3～5 |
| Real Interop SDAR 侧     | 2～4 |
| Hardening/Release        | 3～5 |

综合重叠后：

```text
SDAR：约 26～38 人日
Provider Runtime：约 12～22 人日
```

三条并行线：

```text
A Frozen HTTP/Task/Notification
B Schema/Persistence/Availability
C Evidence/Requalification/Conformance
```

3 人并行约 3～4 周。

---

# 20. Gate

```text
G0 V1.2 Baseline Merged
  main=922f428
  version=1.2.0

G1 Contract Package Locked
  Source/Schema/Lock/Fixtures

G2 SDAR Component Conformant
  Frozen Mock + move_to + area_patrol + legacy regression

G3 Provider Runtime Component Conformant
  external

G4 Interop Certified
  real HTTP + restart + notification/poll + evidence

G5 Release Ready
  adversarial + full verify + migrations + docs/SBOM
```

---

# 21. Codex Goal 约束

Codex 必须：

1. 从最新 main 开始；
2. 不重新开发已完成 v1.2 功能；
3. 保留 Legacy Handler；
4. 新建 Frozen Handler；
5. 不自动翻译协议；
6. 每阶段 commit+push；
7. 使用固定 MCP Source；
8. 不等待外部协议；
9. Provider Runtime 未就绪时完成本地 Phase 0～10；
10. 只在真实 Interop 写 blocker；
11. 不用 Mock 冒充 Interop；
12. 不删除历史报告；
13. 新报告写入 `reports/v1.2.1-frozen-mcp-tasks/`；
14. 不自动合并；
15. 新歧义必须用 ADR/Errata，不能静默猜测。

---

# 22. Definition of Done

```text
Contract
✓ Frozen Source/Schema Lock
✓ Explicit protocolMode
✓ no mixed handler
✓ Request Meta/discover/headers
✓ Flat Task/TTL/MRTR/Cancel
✓ Notification/runtimeRevision
✓ Evidence A

Compatibility
✓ v1.2 business unchanged
✓ Legacy Provider supported
✓ Historical plans readable
✓ Active Legacy tasks observable
✓ no duplicate side effect

Component
✓ SDAR Client Conformant
✓ Frozen Mock Conformant
✓ Legacy regression

Interop
✓ Provider Runtime Conformant
✓ real HTTP/restart
✓ notification/poll convergence
✓ Evidence Hard Gate

Release
✓ move_to requalified
✓ area_patrol requalified
✓ adversarial/full verify
✓ migration/SBOM
✓ no required deferred
```

---

# 23. 最终执行顺序

```text
0 Baseline
↓
1 Protocol Package
↓
2 Domain/Workflow
↓
3 Persistence 0107
↓
4 Frozen Stateless Client
↓
5 Task/TTL/MRTR/Cancel
↓
6 Availability/Readiness
↓
7 Notification
↓
8 Evidence A
↓
9 Management/Record
↓
10 SDAR Component Conformance
├── external Provider Runtime migration
↓
11 Real Interop
↓
12 Hardening/Release
```

---

# 24. 最终判断

当前仓库不再缺少 v1.2 Skill 功能。

本次真实升级范围是：

```text
Legacy MCP Tasks client boundary
→ explicit dual protocol boundary
→ Frozen stateless client
→ notification + polling
→ structured Evidence A
→ v1.2 business requalification
```

工程风险应集中在 MCP Adapter、Remote Task Observation、协议快照、Notification 和 Evidence 接入，不应再投入到已经通过 Phase 13～15 的 Skill 组合功能。
