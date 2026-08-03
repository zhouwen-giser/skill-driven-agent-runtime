# 10. 未来组织控制平面消费 Profile

二期组织控制平面只能使用 Node Control API 的受限 Profile：

- `/.well-known/sdar-node`
- GET `/api/v1/node`
- GET `/api/v1/node/health`
- GET `/api/v1/node-capabilities`
- GET `/api/v1/capability-readiness`
- GET `/api/v1/a2a-exposures`
- GET `/api/v1/a2a-agent-card-revisions/{revision}`
- GET `/api/v1/tasks` 和 Task Detail/Capability Binding；
- 经授权的 Task Control；
- GET `/api/v1/management-operations/{id}`；
- GET `/api/v1/events`。

默认不开放：

- SecretRef 详细值；
- LLM Credential 管理；
- SMPP/MCP 内部 Endpoint；
- Skill Package 原始内容；
- Artifact Payload；
- 完整 Audit；
- Runtime 内部 API。
