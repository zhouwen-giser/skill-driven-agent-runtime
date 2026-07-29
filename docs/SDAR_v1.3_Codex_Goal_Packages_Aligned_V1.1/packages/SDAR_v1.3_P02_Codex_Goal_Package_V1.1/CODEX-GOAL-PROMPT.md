# Codex Goal Prompt

执行 SDAR v1.3 P02。

输入：
- P00 Handoff Contract
- P01 Artifact Domain Contract
- 最新 origin/main

目标：

实现 Artifact Persistence Authority。

必须：

1. 阅读现有 PostgreSQL Migration 规范。
2. 阅读 Repository 模式。
3. 遵循现有事务和审计模式。
4. 实现 Artifact 持久化和生命周期治理。

实现：

- Migration
- Repository
- Active Pointer
- Approval
- Lineage
- Validation Storage
- Outbox Events

禁止：

- 实现 Artifact Runtime
- 实现 Fast Gateway
- 直接调用 Skill/MCP
- 创建第二套 Workflow Authority

完成：

- Migration Test
- Repository Test
- CAS Test
- Audit Test
- Commit
- Handoff

