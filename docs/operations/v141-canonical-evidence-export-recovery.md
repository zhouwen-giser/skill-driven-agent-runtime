# SDAR v1.4.1 Canonical Evidence Export Recovery Runbook

本手册只处理 `sdar.evidence/v1` 的投影、投递与覆盖率恢复。PostgreSQL 是
Evidence Outbox、Checkpoint、Manifest、DLQ 和恢复运行的唯一权威；Redis 只能唤醒工作，
外部 Sink 不能修改 Runtime 或 Control 业务状态。

## 安全边界

- 所有查询默认只返回 ID、状态、时间、序列、计数和 Hash，不返回 Evidence Payload。
- `organization_service` 不得访问任何 Evidence 运维接口。
- 读取操作仅开放给已授权的 Node 角色；Replay、DLQ Retry 和 Reconcile 仅允许
  `node_admin` 或 `security_admin`。
- 每个写操作都必须携带非空 `reason` 和稳定 `Idempotency-Key`，并生成持久化
  `ManagementOperation` 与不可变 Audit；禁止直接执行任意 SQL。
- 本版本不提供 ClickHouse Proxy、查询代理或跨数据库事务。

## 诊断入口

先读取配置与总体状态，再按问题类型缩小范围：

```text
GET /api/v1/evidence-export
GET /api/v1/evidence-export/status
GET /api/v1/evidence-export/outbox
GET /api/v1/evidence-export/source-checkpoints
GET /api/v1/evidence-export/projection-issues
GET /api/v1/evidence-export/quality-issues
GET /api/v1/evidence-export/episode-manifests/{episodeId}
GET /api/v1/evidence-export/dead-letters
```

记录 `exportId`、配置 revision、source partition、record/episode ID、最新 ACK 序列、
Manifest revision、issue code、batch ID/hash 和时间范围。不得把响应中的受限值复制到工单、
聊天或代码仓库。

## Endpoint outage

1. 确认 Runtime Task 仍由 Runtime PostgreSQL 正常执行；不要因 Sink 故障回滚 Task。
2. 检查状态中的 pending 数、oldest pending 时间、每 partition 的 ACK frontier 和最近错误。
3. 修复 DNS、TLS、证书或 Sink 可用性后，保持同一 active configuration revision。
4. 让正常 Export Worker 从 PostgreSQL 未 ACK 记录继续投递；不要手工推进 ACK。
5. 确认新 batch 使用新的 `batchId`，重复 Evidence 仍保持相同 `recordId/payloadHash`。

## High Watermark

1. 确认是未 ACK backlog，而不是把被排除的 Diagnostic 或已 DLQ 记录计入高水位。
2. 先恢复 Sink/ACK，再观察每 partition 的安全 frontier；禁止使用各 partition 最大值伪造
   全局 ACK。
3. backlog 下降到配置阈值内后执行一次 Coverage Reconcile；实现会清除已解除的持久化
   high-water 状态。
4. 若阈值仍不下降，检查 DLQ、invalid ACK 和 lease/fencing 问题，禁止删除 Outbox。

## DLQ retry

读取目标 dead-letter 的 metadata，确认对应 source fact 仍存在且根因已修复，然后执行：

```text
POST /api/v1/evidence-export/dead-letters/{deadLetterId}/retry
Idempotency-Key: <stable-operator-key>
Content-Type: application/json

{"reason":"<approved operational reason>"}
```

Retry 必须保留原 DLQ 审计行，重置该记录的可投递状态并递增 requeue 计数；不得删除或改写
原 Evidence。若再次耗尽重试预算，同一记录会重新进入 dead-letter 状态。

## Payload conflict

`payload_hash_conflict` 或 source identity conflict 表示同一稳定身份出现不同内容，不能靠重试
消除。停止该 partition 的手工 Replay，保留双方 Hash、source revision 和 projector version，
修复权威 mapper 或源数据后再执行精确 Replay。禁止变更已有 `recordId`、覆盖 Outbox Payload
或编辑 immutable source fact。

## Source unavailable / projector recovery

1. 从 Projection Issue 取得 `sourceSystem/sourceTable/sourceRecordId/sourcePartition` 和
   retryable 标志。
2. 恢复相应 Runtime 或 Control PostgreSQL 读取能力；Control 数据库不得由 Runtime 直接写入。
3. 对一个 record、source partition 或 episode 执行最小 Replay：

```text
POST /api/v1/evidence-export/replays
Idempotency-Key: <stable-operator-key>
Content-Type: application/json

{"scope":"source_partition","sourceFamily":"<family>","sourcePartition":"<partition>","reason":"<approved reason>"}
```

4. Replay 只重置/重建投影游标和可计算状态，不得重放业务命令或改变 Task terminal state。
5. 确认 Projection Issue 被精确 resolve，Checkpoint 单调推进，并重新计算相关 Manifest。

Control projector 恢复时先验证 Node Event/Audit 的 revision 与 `Last-Event-ID` 连续性，再恢复
Control source projection。禁止用 “latest row” 猜测历史 revision，也禁止把两个数据库的 sequence
横向比较。

## Coverage reconcile

权威 source 修复、ACK 推进或 DLQ retry 完成后执行：

```text
POST /api/v1/evidence-export/reconcile
Idempotency-Key: <stable-operator-key>
Content-Type: application/json

{"episodeId":"<episode-id>","reason":"<approved reason>"}
```

Reconcile 必须从权威 source、Outbox、ACK、Projection Issue 和 Quality Issue 重算；不能通过修改
Manifest 直接把 `incomplete` 改为 `complete`。Required Evidence 未 ACK 时仍为 `incomplete`。

## Backup and restore

Runtime Evidence authority 与 `sdar_control` 必须分别备份、分别恢复：

1. 冻结 release SHA、数据库版本、migration head、Evidence contract/registry hash。
2. 使用部署密钥管理器解析连接信息，执行加密 custom-format `pg_dump`；报告只记录 dump hash、
   大小、时间和操作者。
3. 恢复到新的隔离数据库，不覆盖源库。
4. 运行 migration verifier，核对 Outbox sequence、Checkpoint、Batch/ACK ledger、DLQ、Expectation、
   Manifest revision 和未完成 Recovery Run。
5. 启动单个 Runtime/Control 实例，先执行 metadata-only 状态查询，再执行一次限定范围 Reconcile。
6. 只有人工核对无 identity/hash/revision 漂移后才切换流量。

## Reset

Reset 只允许用于一次性本地验收数据库。生产或共享环境不得 TRUNCATE Evidence 表、删除 DLQ、
回退 ACK frontier 或重置 sequence。需要重新投影时使用 Replay/Retry/Reconcile；需要清除数据时走
批准的环境销毁和新库恢复流程。

## Credential rotation

先安装新的 Node Control 与 Sink 凭据，验证 TLS/allowlist 和一次无 Payload 的状态读取，再切换
active configuration revision。旧凭据必须在新 revision 成功应用后撤销。凭据值、Authorization
header 和 secret reference 的解析值不得进入 Evidence、Audit detail、日志或报告。

## Rollback

- 尚未接受新 Evidence/ACK 时，可停止候选版本并切回经验证的旧实例。
- 已产生新 immutable batch、ACK、Audit 或 Manifest revision 后，不运行破坏性 down migration；
  使用修正版前滚。
- Rollback 期间 Runtime Task 继续由自身 PostgreSQL/LKG 运行，Evidence backlog 保留待恢复。
- 任何 record identity/hash、ACK frontier 或 migration checksum 分歧都是发布阻断，必须保留证据并
  交由人工决定。

## 恢复完成判据

- 目标 Projection Issue/DLQ 已 resolve 或保留为明确的 non-retryable 阻断；
- Checkpoint 未倒退，Outbox 无丢失，重复投递保持稳定 identity/hash；
- 每 partition ACK frontier 合法且 high-water 状态可解除；
- 相关 Manifest 已从权威事实重算，Required 未完成不会显示为 `complete`；
- 写操作均可关联到真实 principal 的 ManagementOperation 与 Audit。
