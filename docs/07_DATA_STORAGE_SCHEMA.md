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
