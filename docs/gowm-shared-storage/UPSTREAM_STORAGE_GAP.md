# 固定 GOWM 合同缺口

## 2026-10-11 本地修复进展

用户已明确授权在本地 GOWM owner 仓库修复并重新摄取合同。当前合同固定到 `dca0fcdbbe35f94ddaf968b6489decdbf228755a`，新增 owner 前向 overlay `terminal_link_ownership_v1.sql`，未修改旧迁移校验和；SDAR 启动仍只读校验，不执行 DDL。

带已有链接的升级、旧校验和保留、重复安装以及 43 个 owner PostgreSQL 场景通过。SDAR 受限角色 32 个仓储场景通过，包括两个设备的 12 个临时 Skill 终态/缺证据变体、跨设备相同原始 handle 的两个链接，以及越权、幂等、不可变性和伪造身份反例。运行 `sdar-smpp-gowm-6ae4b1b4-189b-4b25-ab37-390cf5e6e617`，schema 未被 consumer 改动，清理 0。完整当前源码门禁和浏览器验证尚待最终收口；现场/部署 NOT_RUN。

## 历史缺口与复现（保留原结论，不作当前验收）


状态：INCOMPLETE。以下来自固定摄取合同及隔离已安装数据库，不代表已修复。SDAR 不修改上游 DDL、触发器或约束，不增加影子表。

## 临时 Skill 终态经验缺少设备归属

固定合同 `sdar-derived-ownership.sql` 为 `temporary_skill` 和 `temporary_skill_experience` 增加 `device_id`，`gowm_device.validate_optional_task_provenance()` 比较真实父 Task 并拒绝不一致的写入。

实际安装的 `ugv_sdar.finalize_task_temporary_skills()` 在 Task 终态事务内执行：

```sql
WITH expired AS (
  UPDATE temporary_skill SET status='expired',expired_at=NEW.updated_at
  WHERE task_id=NEW.task_id AND status='active' RETURNING *
)
INSERT INTO temporary_skill_experience
  (experience_id,temporary_skill_id,task_id,context_id,
   capability_fingerprint,successful,outcome_summary,created_at)
SELECT /* terminal experience values, without device_id */ ... FROM expired
ON CONFLICT(temporary_skill_id) DO NOTHING;
```

设备 Task 的 `device_id` 非 NULL，而触发器生成经验的 `device_id` 默认为 NULL，因此 `TASK_PROVENANCE_DEVICE_MISMATCH` 导致整个 Task 终态事务回滚。这不是 SDAR 直接经验 writer 的参数遗漏：经验 INSERT 在上游拥有的 Task 触发器内执行。SDAR 显式创建/经验写入已带真实 Task 设备，但不能修改这个触发器。

本次最小复现：

1. 在已安装 GOWM 的隔离 `sdar_gowm_runtime_test` 中，经正式 Task Repository 创建带 deviceOwnership 的 queued Task。
2. 经 scoped TemporarySkill Repository 创建 active 临时 Skill，验证实际 `temporary_skill.device_id` 正确；不调用任何工具。
3. 经 Task Repository 保存 `phase='failed', errorCode='PROCESS_LOST'`。
4. Task 终态保存失败；回读 Task 仍 queued、Skill 仍 active、没有 experience，证明事务回滚。

运行 `gowm-temporary-77a39e98-d9e1-4549-a752-f73e0c14efec` 在两个设备均复现。参数结构为 `{taskId, contextId, deviceOwnership:{deviceId,bindingId,sdarServiceKey}}`；具体合成 ID 与回读结果保留于 `reports/sdar-gowm-shared-storage-integration-v0.1/gowm-temporary-77a39e98-d9e1-4549-a752-f73e0c14efec.json`。复现函数为 `apps/server/test/gowm-temporary-skill-scope.ts` 的 `verifyGowmTemporarySkillScope(pool, sourceTaskIds)`，仅用于明确隔离库。

缺少能力：原生终态经验 INSERT 必须在同一事务内继承 expired Skill / NEW Task 的真实 device_id，并保持原成功判定、幂等和回滚约束。此需求交由 GOWM 合同所有者处理；本任务没有执行该变更。当前不能宣称共享设备临时 Skill 全终态可用。

## 辅助 Provider execution link 全局 server/handle 唯一键

既有 `auxiliary-link-contract-gap.json` 已复现两设备可拥有相同原始 Remote ID，但辅助 Provider link 的全局 server/handle 唯一键不能同时保存两条关联。具体 SQL/约束与参数见该报告及固定合同。

缺少能力：辅助关联的唯一性必须与真实设备/服务身份兼容。SDAR 保留协议原始 ID，不命名空间化 handle、不放宽约束、不伪造 Provider 根记录。此项也保持 INCOMPLETE。
