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
