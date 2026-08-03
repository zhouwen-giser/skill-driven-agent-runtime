# 11. v1.3 适配边界

v1.3 已有 Management API 是 Runtime Operational API，包含 Task、Goal、Workflow、MCP、Skill、Experience 和 Artifact 投影。v1.4 不复制这些权威，而是通过 Runtime Adapter 调用正式应用端口。

## 必须保持

- PostgreSQL 唯一运行权威；
- Redis/BullMQ 只作 Wake/Queue；
- LangGraph 唯一 Workflow Runtime；
- Management、A2A、Console 都不能直接写业务表；
- P02/P06 Artifact 权威；
- P08 Plan Template 物化到既有 Planner；
- Provider Remote Task Terminal 属于 Provider。

## 需要新增

- Node Control 独立进程和数据库；
- Runtime Control Client；
- Capability Definition/Binding/Readiness；
- A2A Exposure/Agent Card Revision；
- TaskCapabilityBinding；
- Evidence Export Revision；
- Node Events。
