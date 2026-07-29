# P02 Persistence / Registry / Governance Contract V1.1

## 唯一核心表

必须使用以下名称，不得创建别名或竞争权威：

`compiled_artifact`, `artifact_active_pointer`, `artifact_lineage`, `artifact_validation_run`, `artifact_approval`, `artifact_execution`, `artifact_feedback`, `artifact_match_log`, `experience_trace`, `pattern_candidate`。

禁止建立额外的版本表或验证表别名；版本保存在 `compiled_artifact.version`，验证统一写 `artifact_validation_run`。

## G02

负责 PostgreSQL 表、Repository、不可变版本、CAS、Active Pointer、一致性约束和 Redis 重建查询。

## G03

负责 `ArtifactRegistryService`、Active Index 投影、事务 Outbox、缓存失效、统一 Feature Flag。Feature Flag 使用：

- `SDAR_V13_ARTIFACT_MODE=off|shadow|advisory|active`
- `SDAR_V13_TEMPLATE_ENABLED`
- `SDAR_V13_RULE_ENABLED`
- `SDAR_V13_FAST_GATEWAY_ENABLED`
- `SDAR_V13_CASE_ENABLED`
- `SDAR_V13_MODEL_CASCADE_ENABLED`
- `SDAR_V13_TENANT_ALLOWLIST`

## G04

只建立 Operator Identity、RBAC、Audit、Idempotency、Expected Version 和 Approval/Activation 分离的安全基线。P06 才负责完整 Promotion/Revalidation 流程。

激活事务固定：

```text
validate artifact/status/hash
validate validation evidence
validate approval identity/evidence hash
lock artifact_key
CAS active pointer
transition previous/new status
write audit
write outbox artifact.activated
commit
```

PostgreSQL 是唯一权威；Redis/BullMQ 是可重建投影。
