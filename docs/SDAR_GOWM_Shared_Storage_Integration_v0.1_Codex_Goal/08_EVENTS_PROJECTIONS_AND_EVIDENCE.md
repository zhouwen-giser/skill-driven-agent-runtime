# D08 — 业务事件、A2A投影及证据归属

## 事件订阅最终键

GOWM `sdar-derived-ownership.sql`已规定：

```text
设备current: (device_id, smpp_service_key, provider_id) WHERE status='current' AND device_id IS NOT NULL
设备generation: (device_id, smpp_service_key, provider_id, stream_id, generation) WHERE device_id IS NOT NULL
非设备current: provider_id，独立partial index
非设备generation: provider_id, stream_id, generation，独立partial index
```

适配初始化/UPSERT、current查询、generation切换、去重、游标推进、重放和关闭订阅。不得沿旧provider_id单例返回另一台车的订阅。

inbox、continuity、relation等子记录通过真实subscription_id继承范围；不要对不存在device列的表盲加条件。订阅切换保持旧generation历史，不把旧事件写进新generation。

本任务只消费现有SMPP business event合同，不要求并行SMPP新增事件字段。事件来源无法唯一归属时保留原拒绝/未知语义，不按当前agent猜设备。

## 没有硬Task FK的业务来源

至少核对以下已由GOWM增device列的表及所有写入路径：

```text
external_task_projection
artifact_execution
artifact_match_log
episode_evidence_manifest
evidence_expected_record
evidence_outbox
fast_gateway_request
planning_correction_fact
planning_interaction_episode
runtime_task_configuration_binding
runtime_task_model_route_binding
temporary_skill
temporary_skill_experience
workflow_plan_attempt
```

这些新增字段必须由真实Task上下文提供。父Task存在时要求一致；原设计允许历史或异步来源暂时没有父Task的场景仍可保留，不能靠补假Task满足校验。

`goal / user_goal_plan / skill_goal`及知识模板仍可能共享。业务归属由实际执行Task确定，不对共享对象强制写设备所有权。

## A2A与管理读取

A2A Task Store、事件流、结果投影、管理列表/单条读取应正确限定设备范围，但对外继续遵守现有A2A协议。不得把数据库source字段硬塞进严格不允许额外属性的A2A任务体。

Task metadata、provenance允许位置可沿既有扩展约定表达；强制路由信息应在服务端context和持久化字段，不能依赖客户端随意传入的payload。

## 证据与完成判定

保留已有Result/Evidence存储与导出功能；禁止为任务主数据另外增加导出采集链。既有evidence_export表属于已托管运行依赖，不应被误删。

从GOWM lineage读到Mission映射可以用于关联解释，不能替代原物理结果证据或让目标达成判定自动成功。未适配SMPP时显示PROVIDER_PENDING/未关联，不伪造设备状态。

若沿用当前物理证据Repository，新增canonical link可作为明确JOIN依据，但不绕过现有Task/Admission/receipt authority和版本校验。
