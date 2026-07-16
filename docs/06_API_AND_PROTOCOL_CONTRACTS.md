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

## 最终结果

A2A 返回自然语言结果，并在有主 Skill 时返回符合 `output_schema` 的结构化数据。过程可观察信息不包含私有思维链。
