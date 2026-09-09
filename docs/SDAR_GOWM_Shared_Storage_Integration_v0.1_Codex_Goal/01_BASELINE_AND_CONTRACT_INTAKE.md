# D01 — 实际基线与合同摄取

## 本轮读取的来源（2026-09-08）

|仓库|分支|观测提交|
|---|---|---|
|SDAR|main|`cb50da8ec8d160a673852be8bcdfc3bb094f5ce5`|
|GOWM|codex/gowm-device-shared-business-storage-v0.2|`48cebb862e992579b801590385b4373b10422d52`|
|GOWM|main|`dd1b038fa0fa3e3893d7f4c7f815bfe9992b0838`|

GOWM共享存储本次位于功能分支，而不是上述旧main。执行时先读各仓库AGENTS.md并fetch；SDAR从最新已知主线或用户明确相关基线建立 `codex/sdar-gowm-shared-storage-integration-v0.1`。只读GOWM优先选择已包含共享存储的main，否则用该功能分支的当前有效头。不得从旧main误报上游缺失，不根据包内SHA强制回滚，不为了追逐上游新SHA无限重跑。

保护用户未提交修改，不强推、不自动合并、不打Tag、不发布。GOWM/SMPP只读检出和临时构建不应污染其工作区。

## 必须读取的GOWM文件

```text
docs/shared-business-storage-handoff/sdar-handoff.md
docs/shared-business-storage-handoff/smpp-handoff.md
docs/shared-business-storage-handoff/repository-adaptation-matrix.md
docs/shared-business-storage-handoff/data-dictionary.md
docs/shared-business-storage-handoff/connection-examples.env
docs/shared-business-storage-handoff/device-scope-key-inventory.json
database/migrations/078_device_shared_business_storage.sql
database/shared-business-storage/install-manifest.json
database/shared-business-storage/source-inventory.json
database/shared-business-storage/expected-structure.json
database/shared-business-storage/overlays/ugv_sdar.sql
database/shared-business-storage/overlays/sdar-hardening.sql
database/shared-business-storage/overlays/sdar-additional.sql
database/shared-business-storage/overlays/sdar-derived-ownership.sql
database/shared-business-storage/overlays/smpp-additional.sql
database/shared-business-storage/overlays/read-model.sql
packages/integrations/device-business-storage/src/repository.ts
scripts/business-storage/installer.ts
```

路径发生变化时读实际继任文件；不臆造列/方法。最终已安装DDL、全部overlay和约束优先于早期说明。交接中的验证PASS不能替代本任务使用真实SDAR代码验证。

## 已核实的重要差异

1. `agent_task`新增 `device_id / gowm_binding_id / sdar_service_key`，三者同时为空或同时有值。设备任务不允许后补修改归属。
2. `workflow_plan`是设备执行计划投影时保存 `device_id / gowm_task_id`；`goal / user_goal_plan / skill_goal`等共享规划语义不能强行归给一台设备。
3. `initial_task_admission`已改用内部 `admission_id:uuid` 主键；设备幂等是 `(device_id,sdar_service_key,idempotency_key) WHERE device_id IS NOT NULL`，非设备仍有独立partial unique key。
4. `remote_task_binding`设备唯一身份为 `(device_id,smpp_service_key,server_id,remote_task_id)` 的设备partial index；非设备为原server/remote的独立partial index。
5. `canonical_mcp_task_id`可为空；非空时必须指向同device、同smpp_service_key的真实provider_task。不是把remote字符串直接写成UUID。
6. `business_event_subscription` current和generation都增加设备/服务维度；其子表仍由真实subscription_id继承。
7. `external_task_projection`、临时Skill、Evidence来源和Task配置绑定等无硬Task FK的表也新增设备列及父级一致性校验。
8. `workflow_steps`分开返回 `NATIVE_EVENT` 与 `REMOTE_NODE_RUN`，不承诺每条node event都具有可证明的Node Run ID。

## 交付到SDAR仓库的紧凑摄取物

建议 `contracts/gowm-shared-storage/current/`：来源记录、相关表/列/键/触发器摘要、必需迁移family/overlay、必要只读DDL参考、许可证。不是SMPP/GOWM安装副本，不在启动中执行这些DDL；不把1.7MB全量键清单写日志。

生成 `schema-consumption-matrix.json`，逐项覆盖实际入口、插入、更新、冲突处理、查询、claim、恢复、清理、序列和触发器依赖。不能只修改几张根表。

当SDAR当前主线比GOWM捕获的原生baseline更新，比较实际必需差异：能在消费者通过参数/SQL/调用顺序解决的直接做；缺表/缺列/不相容约束的输出最小UPSTREAM_STORAGE_GAP，禁止自行ALTER GOWM或禁用触发器。继续完成其他部分，受影响场景不得PASS。
