# 安全边界与风险登记

## 已接受的首版风险

- A2A 和管理 API 不认证，只能用于可信内网。
- `anonymous` 调用方共享用户历史。
- 长期记忆全局共享。
- 有副作用工具无统一幂等/去重机制。
- Tool Schema 变化只告警，不自动禁用 Skill。
- 模型失败直接导致任务失败，无备用模型。
- 普通执行中任务故障后不恢复、不自动重试。V1.1 仅对持久化且可验证的 `waiting_external` remote Task wait 重建观察队列和 continuation frontier；它不恢复丢失的运行中节点。

这些风险必须在 README、部署文档、控制台首页和相关配置页面显示，不得隐藏。

## 即使首版不做权限，也必须具备的安全控制

- 网络绑定默认 localhost 或明确配置的可信网卡；
- 非 loopback A2A/管理绑定默认拒绝启动；仅在已验证防火墙/可信网段后显式设置 `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE=true`。该确认不提供认证，也不允许公网暴露；
- CORS 默认关闭或限定管理端来源；
- 数据库和 Redis 不暴露公网；
- 凭据加密与日志脱敏；
- JSON Schema/大小/深度限制；
- Workflow 节点白名单、循环预算、Tool 参数校验；
- 禁止动态代码执行和路径穿越；
- HTTP 超时、响应体大小限制；
- MCP Task Headers、IDs、payload、availability、snapshot、continuation、input 和 result 的 Schema/大小/深度限制；
- `task_required` Tool 即使 DSL 省略 `taskExecution` 也必须隐式执行 planning 与 pre-call readiness Guard；
- Prompt 注入不能绕过 Skill 工具边界；
- 前端安全渲染，禁止直接执行模型输出 HTML/JS；
- 依赖扫描和许可证扫描。

## 副作用操作

按需求不增加强制幂等，但必须：

- 在 Tool 元数据中支持 `read_only` / `side_effecting` 标记；
- 在计划和确认 UI 中醒目标识；
- 记录调用事实；
- 发生 Goal Patch 时按 Skill 补偿描述生成新待确认计划；
- 文档明确重复执行风险。

## Execution control risk notice

- A pause is cooperative at the LangGraph node boundary. An already-running external call may finish before the pause becomes effective; no downstream node starts afterward.
- `try_interrupt` propagates `AbortSignal`, but a remote Tool may ignore cancellation or may already have committed a side effect.
- Cancellation never automatically compensates or retries external effects. The selected immutable Skill policy and canceled invocation evidence remain auditable.
- Short resume requires the original in-process checkpoint. Process loss fails the execution instead of replaying it.
- V1.1 remote waiting is not short resume: only a PostgreSQL-authoritative active continuation snapshot plus matching waiting Binding may be reconstructed after restart, and the fresh LangGraph invocation starts at the persisted frontier rather than `START`.
- A missing, malformed, invalidated, terminal, or identity-mismatched remote-wait snapshot is not recoverable. Ordinary running/evaluating work still fails with `PROCESS_EXECUTION_LOST`.
- Provider Task status, admission, business timer and final result remain Provider-authoritative. Refresh, cancellation ack, transport uncertainty, local timeout, Redis loss, or Console action cannot fabricate a remote terminal state.
- The lifecycle API/Console is still unauthenticated trusted-intranet management. It redacts credentials and unclean errors, but refresh, input and cancel can cause external effects and must not be exposed publicly.
