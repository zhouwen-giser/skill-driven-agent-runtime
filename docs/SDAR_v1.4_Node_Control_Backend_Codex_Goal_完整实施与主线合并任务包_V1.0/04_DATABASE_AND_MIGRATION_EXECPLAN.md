# 04. 数据库与迁移执行计划

## Fresh Baseline

v1.4 Node Control DB 使用全新逻辑基线：

```text
sdar_control
```

不提供旧实验数据库兼容。

## 实施要求

1. 从冻结 `05-data-model.sql` 建立逻辑对象映射。
2. 适配仓库现有迁移命名和 Ledger，不盲目复制 SQL。
3. Node Control DB 与 Runtime DB 使用独立连接、凭据和 Migration Ledger。
4. Migration 必须：
   - Fresh Create；
   - Idempotent Gate；
   - Upgrade Sequence；
   - Rollback/Reapply；
   - Gap/Rogue Ledger Rejection；
   - Constraint/Index Review。
5. JSONB 有界；关键身份、状态、Revision、Checksum 使用规范化列。
6. Published Version 和 Task Binding 不可原地修改。
7. Secret 只保存 `credential_ref`。

## 核心对象

- node_profile
- configuration_revision/application
- llm_provider_definition/model_route
- smpp_registry_source/snapshot
- mcp_provider_binding
- node_capability/version
- capability_implementation_binding
- capability_readiness_snapshot
- a2a_exposure_version
- agent_card_revision
- task_capability_binding/attempt
- telemetry_export_configuration/status
- management_operation
- audit_event

## 不允许

- 复制 Goal/Task/Workflow/Skill/Artifact 业务权威；
- 使用 Redis 作为正式状态；
- 为旧数据库设计兼容读写旁路；
- 删除最新 main 的 Migration 历史。
