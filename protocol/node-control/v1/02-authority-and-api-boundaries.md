# 02. 权威与 API 边界

| 对象 | 权威 | Node Control API 权限 |
|---|---|---|
| Node Profile、Configuration Revision | Node Control PostgreSQL | 定义、验证、发布、回滚 |
| LLM/SMPP/MCP Binding 配置 | Node Control PostgreSQL | 定义、发布期望状态 |
| Skill Version | SDAR Runtime PostgreSQL | 调用既有治理端口，不复制权威 |
| Plan Template / Artifact | SDAR Artifact PostgreSQL | 调用既有治理端口，不复制权威 |
| Capability Definition、A2A Exposure | Node Control PostgreSQL | 定义、发布、暂停、退役 |
| Capability Readiness | SDAR Runtime PostgreSQL | 只读、请求重新计算 |
| Goal、Task、Plan、Workflow、Skill Attempt | SDAR Runtime PostgreSQL | 查询投影、提交受控命令 |
| TaskCapabilityBinding | SDAR Runtime PostgreSQL | 只读 |
| Agent Card Active Revision | SDAR Runtime 本地已应用快照 | 发布候选、读取 Ack |
| Evidence Export Config | Node Control PostgreSQL + Runtime LKG | 定义、发布、读取投递状态 |
| 遥测历史数据 | 独立 Evidence Sink | SDAR 不提供查询 |

## 外部与内部 API

```text
/api/v1/*
= 稳定 Node Management API

/internal/v1/*
= Node Control Backend ↔ Runtime，浏览器和组织平台不得访问
```
