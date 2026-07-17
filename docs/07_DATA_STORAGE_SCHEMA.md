# 数据与存储设计

## PostgreSQL 表建议

- `user_identity`
- `conversation_context`
- `conversation_message`
- `goal`
- `goal_patch`
- `agent_task`
- `task_transition`
- `skill`
- `skill_version`
- `skill_package_import_audit`
- `skill_relation`
- `skill_validation_run`
- `skill_test_case`
- `mcp_server`
- `mcp_tool`
- `mcp_tool_warning`
- `workflow_definition`
- `workflow_instance`
- `skill_call_workflow`
- `workflow_node_run`
- `mcp_invocation`
- `model_provider`
- `model_stage_binding`
- `model_invocation`
- `prompt`
- `prompt_version`
- `runtime_event`
- `raw_experience`
- `memory_item`
- `memory_relation`
- `evaluation_report`
- `evaluation_dimension`
- `workflow_template`
- `system_config`
- `retention_policy`
- `remote_task_binding`
- `remote_task_observation`
- `remote_task_control_event`
- `remote_task_protocol_attempt`
- `task_execution_readiness`
- `task_availability_snapshot`
- `workflow_continuation_snapshot`
- `workflow_continuation_wait_binding`
- `workflow_continuation_attempt`
- `remote_task_input_link`
- `remote_task_input_attempt`
- `remote_task_cancel_request`
- `remote_task_cancel_attempt`

## pgvector

向量字段至少用于：

- Skill 描述；
- MemoryItem；
- 成功/失败 Experience；
- Workflow Template；
- 测试案例相似度。

检索必须支持类型、状态、Skill、时间和证据范围过滤。

## Redis

- BullMQ 队列；
- context 串行锁；
- 运行态和短期缓存；
- 流式事件 Pub/Sub 或 Streams；
- 暂停/确认等待信号；
- 临时 Workflow checkpoint。

执行中状态不承诺故障恢复。服务启动时识别遗留 running 任务并标记失败，不自动重试。

V1.1 的例外只适用于有完整 PostgreSQL 证据的 `waiting_external`：active continuation snapshot、waiting binding、匹配的 Workflow instance/node run 和未失效 RemoteTaskBinding 必须同时成立。Poll、continuation、input 和 cancellation Job 仍为 attempts=1，Redis 丢失后从 PostgreSQL 重建；正在运行的 Job 不恢复也不自动重试。普通 running/paused/evaluating 执行仍按 V1 规则失败。

## 密钥

数据库只保存 AES-256-GCM 密文、nonce、auth tag、key version。主密钥来自环境变量或挂载 secret，不写入日志、数据库、前端或 Trace。

## 迁移规则

- 每次 Schema 变化必须有 forward migration；
- 破坏性迁移需要备份与回滚说明；
- CI 在空库和升级库上都运行 migration test；
- 种子数据只包含 Mock Skill、Mock MCP 和开发配置，不含真实凭据。

Migration `0054_skill_call_history` 将 `skill_call_workflow` 的主键改为独立 `call_id`，使同一父实例/节点的重复执行保留追加历史；`find(parent,node)` 仍按时间返回最新调用。其 rollback 为兼容旧主键会只保留每个父实例/节点最新一条关系，因此回滚前必须备份需要保留的重复调用审计。

Migration `0055_task_input_continuation` 新增 `task_input_request`、`task_input_response` 与 `task_execution_attempt`。问题和回答以 PostgreSQL 为权威；同一 Task 同时最多一个 `waiting` 问题，回答与新的 `input_response` attempt 在一个事务内创建。Goal Evaluation 问题保存 `control_id` 和 `control_round_index`，BullMQ 只携带 Task/Context/attempt/mode 的临时调度副本。rollback 会删除全部补充输入与 attempt 审计，回滚前必须备份。

Migration `0056_mcp_execution_mode` 为 `mcp_invocation` 增加 `execution_mode` 与 `simulation_id`。`live` 审计不得带 simulation ID；`simulation` 与 `historical-replay` 必须保存稳定 ID。rollback 会删除这两个隔离审计字段，回滚前必须导出需要保留的非 live 调用关联。

Migration `0057_nested_skill_confirmation` 为 `skill_call_workflow` 增加 `parent_plan_id` 与 `confirmation_status`，并允许确认期间的 `child_instance_id`、`completed_at` 暂时为空。`call_id` 确定计划中的子实例身份；实际子实例创建后，终态关联仍受既有外键保护。rollback 仅在全部关联已终态、已完成且具有实际子实例时允许执行。

Migration `0058_runtime_terminal_outcome` 新增 `runtime_terminal_outcome`，并为 `workflow_control` 与 `workflow_control_round` 增加唯一终态引用。Processed Result、Task Output/phase、Goal、Control、当前 Round 与 Runtime Event 在同一 PostgreSQL 事务内提交；Memory、Quality 与 Evolution 警告仅作为提交后增强证据。rollback 仅在终态结果证据为空且没有 canceled Control 时允许执行。

V1.1 使用保留的 `0100+` 范围并要求显式 `v1.1-isolated` profile、acknowledgement 和 `sdar_v11_*` disposable database；V1.2 Phase 7 在不放宽该隔离门禁的前提下把同一 append-only 链延伸到 0105。支持的升级顺序是完整 `v1.0.13-bug-fixed` ledger 后再按文件名应用：

- `0100_remote_mcp_task_tracking`：Binding、ordered observation、control inbox 和 protocol attempt；
- `0101_task_execution_readiness`：Tool Task 语义、planning/pre-call readiness 与 availability snapshot；
- `0102_remote_task_continuation`：`waiting_external` instance、versioned continuation snapshot、wait binding 和 attempt；
- `0103_remote_task_input_and_cancellation`：`source=remote_task` input link/attempt 与 cooperative cancel request/attempt；
- `0104_workflow_external_wait_event`：把 `node_waiting_external` 加入 `workflow_node_event.event_type` CHECK 约束。
- `0105_skill_usage_specification`：向现有 `skill_version` 增加 exact-version Usage JSONB snapshot，并以同一 `(skill_id, version)` 记录 package root、package/file checksum、validation/import time 审计；不新增平行 Registry 或 lifecycle authority。

`0104` 的 down migration 在存在任何 `node_waiting_external` 证据时以 `MIGRATION_0104_ROLLBACK_REQUIRES_NO_EXTERNAL_WAIT_EVENTS` 拒绝，避免删除仍被引用的审计语义。`0105` 在存在原生 Usage 或 package import evidence 时以 `MIGRATION_0105_ROLLBACK_REQUIRES_NO_SKILL_USAGE_EVIDENCE` 拒绝回滚。Phase 7 migration gate验证 released profile 仍停在 0064，以及显式 isolated profile 的 0064→0105 upgrade、空证据 rollback/reapply、profile/isolation guard 和 ledger gap fail-closed；当前记录共检查 69 个可逆 migration pairs。
