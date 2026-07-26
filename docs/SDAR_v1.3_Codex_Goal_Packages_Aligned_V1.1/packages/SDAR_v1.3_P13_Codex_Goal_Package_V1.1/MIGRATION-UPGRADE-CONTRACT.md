# P13 Migration / Upgrade Contract

## Fresh Install

从空 PostgreSQL：

- Apply all migrations；
- Seed only approved reference data；
- Verify indexes / constraints / extensions；
- Run full integration / E2E。

## Upgrade

必须从：

```text
v1.2.3-final exact supported baseline
```

升级至 v1.3 Candidate。

验证：

- Existing Goal / Plan / Attempt / Outcome；
- Existing Experience / Knowledge；
- User / Tenant；
- Provider / Credential；
- A2A；
- Console；
- no data loss；
- no authority drift。

## Idempotency

Migration 重跑：

- 不重复数据；
- 不重复 Constraint；
- 不破坏 Active Pointer；
- 不重复 Outbox。

## Rollback / Reapply

按仓库策略验证：

- 每个新增 Migration；
- 整体路径；
- rollback；
- reapply；
- forward fix；
- interrupted migration。

## Rogue Migration

检测：

- 未登记；
- 顺序错误；
- checksum 变化；
- 历史文件修改；
- 与 source lock 不一致。

## Reset

开发 Reset：

- 明确版本；
- 不误连生产；
- 不删除未授权数据库；
- 恢复完整 Schema。

## 失败标准

Fresh / Upgrade / Rollback / Reapply 任一关键路径失败：

```text
RELEASE_CANDIDATE_BLOCKED
```
