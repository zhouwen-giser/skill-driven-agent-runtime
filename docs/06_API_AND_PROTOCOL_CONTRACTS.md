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

## 最终结果

A2A 返回自然语言结果，并在有主 Skill 时返回符合 `output_schema` 的结构化数据。过程可观察信息不包含私有思维链。
