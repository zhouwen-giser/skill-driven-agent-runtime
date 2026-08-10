# API 与协议契约

## A2A

- Provider only，目标协议 A2A 1.0.1。
- 优先官方 JavaScript SDK，通过 `A2AAdapter` 隔离。
- 支持非流式和标准流式响应。
- 流断开任务继续；客户端可重连或轮询。
- A2A 只承载标准任务交互；管理功能使用独立 REST API。
- 使用 SDK 原生状态；内部阶段写入状态消息，不扩展状态枚举。
- `user_id` 可选，放 metadata；缺省 `anonymous`。
- `context_id` 缽省时由系统生成并返回。

建议内部接口：

```ts
interface A2AProtocolAdapter {
  toInternalMessage(input: unknown): Promise<InboundInteraction>;
  publishTaskSnapshot(task: InternalTask): Promise<void>;
  publishEvent(event: RuntimeEvent): Promise<void>;
  buildAgentCard(skills: PublicCapability[]): Promise<unknown>;
}
```

## Management API

Implemented base URL: `http://127.0.0.1:9998/api/v1` (configurable). OpenAPI: `schemas/management-api.openapi.yaml`.

Implemented resources: `/health`, `/mcp/servers`, MCP refresh/remote-health/credential-rotation/tools/enhancement/invocations/warnings, `/skills`, Skill enable/disable, immutable version list/diff, rollback-as-new-version, and `/skill-graph` typed relation CRUD. Every response includes `X-SDAR-Security-Warning: trusted-intranet-only-no-auth`; MCP lists omit credentials and unknown internal errors are redacted.

建议分组：

- `/management/mcp-servers`
- `/management/mcp-tools`
- `/management/skills`
- `/management/workflows`
- `/management/tasks`
- `/management/prompts`
- `/management/models`
- `/management/memory`
- `/management/evaluations`
- `/management/config`

API 必须提供 OpenAPI 文档和契约测试。

## MCP

- 仅远程 Server；首版仅 Streamable HTTP Adapter。
- 仅 Tools，不处理 Resources/Prompts。
- 注册时发现一次，管理员手动刷新。
- 固定 Server 凭据，加密保存 PostgreSQL。
- Tool Schema 变化只告警，不自动禁用 Skill。
- Tool 调用失败由受约束的 LLM 异常决策处理，但系统预算、状态和允许动作先行约束。

### v1.1 availability extension

- Tool 发现可携带经严格验证的 `io.sdar/taskExecution` 元数据；外部类型不越过 Adapter。
- 批量 readiness 使用精确自定义方法 `io.sdar/tasks/checkAvailability`，请求/响应数量、JSON 大小、节点关联、时间窗口顺序与预约引用均受 Schema 和确定性校验。
- Tool 调用的 task execution 信息放在协议 `_meta`，不混入业务参数；`mode=require_task` 返回同步结果是稳定契约错误。
- `GET /api/v1/workflows/plans/{planId}/task-readiness` 返回清洗后的 planning/pre-invocation 证据、窗口、预测有效期、timing 与真实 reservation 引用；不返回完整参数快照。该接口为 trusted-intranet、无认证的只读投影。

### v1.1 remote Task lifecycle

- `GET /api/v1/tasks/{taskId}/remote-task-lifecycle` 返回 credential-free 的 PostgreSQL 权威关联：Task/Context/Goal/plan/Skill → capability/availability → Binding → observations/controls/protocol attempts → continuation/input/cancellation → Provider final result。
- `GET /api/v1/mcp/servers` 与 `GET /api/v1/mcp/servers/{serverId}/protocol` 展示显式 `protocolMode`、当前 discovery、`supportedVersions`、冻结 baseline hash、Task Notification 状态、每 Tool `taskBehavior` 与 `outputSchemaHash`。`POST .../protocol-baseline-audit` 只读核验基线；`POST .../mode-switch-guard` 对既有 Provider 的 Legacy/Frozen 切换一律 fail closed。
- Remote Task lifecycle 的 `protocol` 投影展示 TTL/expiry、Runtime/Provider Revision、最新 observation source、poll/notification health 和 Evidence 摘要；`POST /api/v1/remote-task-bindings/{bindingId}/refresh` 是一次带版本 CAS 的强制 reconciliation，不是无限重试或伪造状态。
- `POST /api/v1/remote-task-bindings/{bindingId}/refresh` 必须提供 `expectedVersion`，并通过同一 `context_id` 串行、版本 CAS 的 polling service 执行一次有界 `tasks/get`；它不直接改写 Provider 状态。
- `POST /api/v1/remote-task-bindings/{bindingId}/cancel` 创建 `source=management` 的幂等 cooperative cancellation request。ack/uncertain 与 Provider terminal `cancelled` 保持分离。
- 远程输入继续使用 `POST /api/v1/tasks/{taskId}/actions` 的 `provide_input`，绑定当前 `TaskInputRequest` 后通过 `tasks/update` 返回原 remote Task，不触发 Goal planning。
- Console 读取上述真实 API，显示 capability、timing、availability、状态/substate、轮询、continuation、输入轮次、取消不确定性和最终结果；只暴露受约束 refresh/cancel/provide-input，不拥有执行状态。
- lifecycle 响应和 Console 始终显示 trusted-intranet/no-auth、Provider authority、副作用、取消不确定性和普通运行中任务不可恢复告警。

## 最终结果

A2A 返回自然语言结果，并在有主 Skill 时返回符合 `output_schema` 的结构化数据。过程可观察信息不包含私有思维链。

## v1.2 Skill Usage management contracts

- `POST /api/v1/skill-packages/validate` is read-only. `POST /api/v1/skill-packages/import` rereads,
  revalidates and checksum-binds the package before creating a new immutable Skill version.
- Skill catalog and exact-version reads expose lifecycle, visibility, modes, derived capability
  classification and credential-free Usage summaries. They never mutate an active version in place.
- `GET /api/v1/skill-executions/{executionId}` and
  `GET /api/v1/tasks/{taskId}/skill-executions` return append-only execution projections and ordered
  parent/child trees linked to existing plan, Task, Provider, resource, Remote Task and evidence refs.
- Native Task/Provider bindings fail closed when exact registered operation, live readiness, required
  Provider, valid reservation or deployment-selected capability slot evidence is absent. Management
  responses do not manufacture availability or Provider terminal state.
- Every route retains the trusted-intranet/no-auth warning and redacts credentials, private reasoning,
  package filesystem paths and unknown internal errors.

## v1.2.1 Frozen MCP operations

- `POST /api/v1/mcp/frozen/servers` creates a new explicit `frozen_v1` Provider identity. It performs
  stateless `server/discover` and one bounded complete `tools/list`, requires Tool output schemas and the
  frozen task-execution profile, encrypts configured headers, and atomically stores the Provider, Tools
  and immutable discovery snapshot. It never invokes or translates through the Legacy Bridge.
- `POST /api/v1/mcp/frozen/servers/{serverId}/refresh` uses the same Frozen-only transaction and creates
  a new Tool revision/snapshot. A database-level mode guard prevents overwriting a Legacy identity even
  if registration and refresh race.
- `POST /api/v1/mcp/frozen/servers/{serverId}/notifications/reconnect` is the explicit reconnect boundary.
  The composed runtime subscribes only active Frozen bindings, persists one post-Ack reconciliation and
  then admits validated Notifications through the same Runtime Revision authority as polling. Polling
  remains the explicit fallback; a polling refresh is never represented as a successful reconnect.
- Protocol diagnosis, read-only baseline audit, immutable mode guard and expected-version-CAS remote
  reconciliation remain credential-free Management operations.

## v1.4.1 Evidence protocol

The only export wire contract is `sdar.evidence/v1` with header
`x-sdar-evidence-contract: sdar.evidence/v1`. Batches are bounded, hash-addressed and delivered at
least once; ACK is explicit, contiguous and may be partial. Node Control exposes metadata-only
Evidence reads and audited replay/retry/reconcile operations under its frozen RBAC; Runtime internal
operations are typed and do not expose arbitrary SQL or payload query. Non-loopback receivers require
HTTPS and a CredentialRef. The frozen schemas, catalog and hashes live under `schemas/evidence/v1/`
and `protocol/evidence/v1/`.
