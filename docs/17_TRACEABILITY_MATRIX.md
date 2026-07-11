# 需求追踪矩阵

Codex 必须持续更新本表。状态只允许：未实现 / 开发中 / 已实现待验证 / 已验证 / 阻塞。

| 需求编号     | 阶段  | 最低测试层级         | 状态   | 实现文件 | 测试文件 | 验证证据 |
| ------------ | ----- | -------------------- | ------ | -------- | -------- | -------- |
| FR-A2A-001   | EP-01 | contract+e2e         | 已验证 | `apps/server/src/runtime.ts`; `packages/a2a-adapter/src/http-endpoint.ts`; `packages/a2a-adapter/src/task-service-executor.ts` | `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts`; `reports/EP-01-protocol-domain-skeleton/a2a-tck-http-json-must-protocol-harness/junitreport.xml` | `pnpm test:e2e` + `pnpm test:a2a-tck`：官方客户端在真实 composition 提交/继续任务；官方 HTTP+JSON MUST 协议 harness 67 passed/0 failed |
| FR-A2A-002   | EP-01 | contract+e2e         | 开发中 | `packages/a2a-adapter/src/compatibility.ts`; `packages/a2a-adapter/src/http-endpoint.ts`; `apps/a2a-tck-sut/src/main.ts` | `packages/a2a-adapter/test/a2a-compatibility.contract.test.ts`; `reports/EP-01-protocol-domain-skeleton/a2a-tck-http-json-must-protocol-harness/junitreport.xml` | `pnpm test:a2a-tck`：官方 pinned TCK HTTP+JSON MUST 67 passed/0 failed（模拟协议 harness）；TCK 内嵌 v1.0.0 branch，字面 1.0.1 标签证据缺口已记录 |
| FR-A2A-003   | EP-01 | contract+e2e         | 已验证 | `packages/a2a-adapter/src/compatibility.ts`; `packages/a2a-adapter/src/task-mapping.ts`; `packages/a2a-adapter/src/task-service-executor.ts` | `packages/a2a-adapter/test/a2a-compatibility.contract.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:contract` + `pnpm test:e2e`：内部阶段仅投影为标准 TaskState，等待确认原因通过状态消息返回 |
| FR-A2A-004   | EP-01 | contract+e2e         | 已验证 | `packages/application/src/task-service.ts`; `packages/application/src/result-processor.ts`; `packages/a2a-adapter/src/task-service-executor.ts` | `packages/application/test/task-service.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:unit` + `pnpm test:e2e`：真实 A2A 覆盖提交、查询、列表、计划修改/确认、补充输入、多轮上下文、暂停、恢复、取消及最终结果获取 |
| FR-A2A-005   | EP-01 | contract+e2e         | 已验证 | `packages/a2a-adapter/src/http-endpoint.ts`; `packages/a2a-adapter/src/task-service-executor.ts`; `apps/server/src/runtime.ts` | `packages/a2a-adapter/test/http-endpoint.contract.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:contract` + `pnpm test:e2e`：生产流断开后 BullMQ/TaskService 继续，可轮询并通过标准 resubscribe 获取快照；活动连接不阻塞优雅关闭 |
| FR-A2A-006   | EP-01 | contract+e2e         | 已验证 | `packages/application/src/skill-registry.ts`; `packages/persistence-postgres/src/repositories.ts`; `packages/a2a-adapter/src/http-endpoint.ts`; `apps/server/src/runtime.ts` | `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:e2e`：持久化 SkillVersion 启用/禁用无需重启即动态加入/移出 Agent Card |
| FR-A2A-007   | EP-01 | contract+e2e         | 已验证 | `packages/domain/src/identity.ts`; `packages/application/src/task-service.ts`; `packages/a2a-adapter/src/task-mapping.ts` | `packages/domain/test/domain.unit.test.ts`; `packages/application/test/task-service.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:unit` + `pnpm test:e2e`：metadata user_id 经验证映射，缺省固定 anonymous，既有 context 归属不可被覆盖 |
| FR-A2A-008   | EP-01 | contract+e2e         | 已验证 | `packages/domain/src/conversation-context.ts`; `packages/application/src/task-service.ts`; `packages/a2a-adapter/src/task-service-executor.ts` | `packages/application/test/task-service.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:unit` + `pnpm test:e2e`：缺省 context_id 自动生成并随 A2A Task 返回，显式 context 可复用 |
| FR-A2A-009   | EP-01 | contract+e2e         | 已验证 | `apps/server/src/runtime.ts`; `packages/runtime-redis/src/context-serial-executor.ts`; `packages/runtime-redis/src/bullmq-context-queue.ts` | `packages/runtime-redis/test/context-serial-executor.unit.test.ts`; `packages/runtime-redis/test/bullmq-context-queue.integration.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:unit` + `pnpm test:integration` + `pnpm test:e2e`：A2A submit 进入 BullMQ，同 context 严格串行、不同 context 可重叠、排队 job 重启保留 |
| FR-A2A-010   | EP-01 | contract+e2e         | 已验证 | `packages/application/src/skill-registry.ts`; `packages/application/src/result-processor.ts`; `packages/json-schema-adapter/src/ajv-validator.ts`; `apps/server/src/runtime.ts`; `packages/a2a-adapter/src/task-mapping.ts` | `packages/json-schema-adapter/test/result-processor.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:unit` + `pnpm test:e2e`：自动加载当前启用 SkillVersion.output_schema 严格校验，并返回 text/plain 与 application/json 双 Part |
| FR-A2A-011   | EP-01 | contract+e2e         | 已验证 | `packages/a2a-adapter/src/http-endpoint.ts`; `apps/server/src/runtime.ts`; `docs/08_SECURITY_AND_RISK.md` | `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:e2e`：`UserBuilder.noAuthentication` 无凭据调用通过；安全文档明确仅限可信内网 |
| FR-A2A-012   | EP-01 | contract+e2e         | 开发中 | `packages/domain/src/skill-draft.ts`; `packages/application/src/task-service.ts`; `packages/a2a-adapter/src/task-mapping.ts`; `packages/persistence-postgres/src/repositories.ts` | `packages/application/test/task-service.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:unit` + `pnpm test:integration` + `pnpm test:e2e`：创建/修改 Skill 意图只保存 draft，且不进入 Agent Card；管理端查看待 EP-06 |
| FR-GOAL-001  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-002  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-003  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-004  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-005  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-006  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-007  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-GOAL-008  | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-001   | EP-02 | unit+integration     | 开发中 | `packages/domain/src/skill.ts`; `infra/postgres/migrations/0007_skill_registry.up.sql` | `packages/application/test/skill-registry.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | 轻量描述、能力、流程/输出提示、Schema、工具与运行策略模型已持久化；管理 API 待实现 |
| FR-SKL-002   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-003   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-004   | EP-02 | unit+integration     | 开发中 | `packages/domain/src/skill.ts` | `packages/application/test/skill-registry.unit.test.ts` | 三类 Tool 边界已建模并拒绝重叠；规划执行约束待 EP-03 |
| FR-SKL-005   | EP-02 | unit+integration     | 开发中 | `packages/domain/src/skill.ts`; `infra/postgres/migrations/0007_skill_registry.up.sql` | `packages/persistence-postgres/test/repositories.integration.test.ts` | 运行策略已建模持久化；运行时消费待后续闭环 |
| FR-SKL-006   | EP-02 | unit+integration     | 开发中 | `packages/application/src/skill-registry.ts`; `packages/persistence-postgres/src/repositories.ts`; `infra/postgres/migrations/0007_skill_registry.up.sql` | `packages/application/test/skill-registry.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | 修改/启禁/回滚均生成不可变新版本并保留来源/链；差异查询 API 待实现 |
| FR-SKL-007   | EP-02 | unit+integration     | 已验证 | `packages/application/src/skill-registry.ts`; `packages/persistence-postgres/src/repositories.ts`; `apps/server/src/runtime.ts` | `packages/persistence-postgres/test/repositories.integration.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | `pnpm test:integration` + `pnpm test:e2e`：禁用生成新版本、不得列为 enabled，并即时移出 Agent Card |
| FR-SKL-008   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-009   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-010   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-011   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-012   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-013   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-014   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-SKL-015   | EP-02 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-001   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-002   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-003   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-004   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-005   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-006   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-007   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-008   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-009   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVO-010   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MCP-001   | EP-02 | unit+integration     | 已验证 | `packages/domain/src/mcp.ts`; `packages/application/src/mcp-registry.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | 仅接受 HTTP/HTTPS `streamable_http`；不存在 stdio 配置或实现 |
| FR-MCP-002   | EP-02 | unit+integration     | 已验证 | `packages/application/src/ports.ts`; `packages/mcp-adapter/src/streamable-http-adapter.ts` | `packages/mcp-adapter/test/streamable-http.contract.test.ts` | 统一业务端口与官方 SDK Adapter 发现、调用、取消通过真实 loopback |
| FR-MCP-003   | EP-02 | unit+integration     | 已验证 | `packages/application/src/ports.ts`; `packages/mcp-adapter/src/streamable-http-adapter.ts` | `packages/mcp-adapter/test/streamable-http.contract.test.ts` | 端口仅定义 Tools 发现/调用；不暴露 Resources/Prompts |
| FR-MCP-004   | EP-02 | unit+integration     | 开发中 | `packages/application/src/mcp-registry.ts`; `apps/server/src/runtime.ts`; `packages/persistence-postgres/src/repositories.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | 运行时注册/删除/刷新无需重启且不审批；管理 HTTP API 待实现 |
| FR-MCP-005   | EP-02 | unit+integration     | 已验证 | `packages/application/src/mcp-registry.ts` | `packages/application/test/mcp-registry.unit.test.ts` | 注册发现一次，仅显式 refresh 再发现；无定时刷新 |
| FR-MCP-006   | EP-02 | unit+integration     | 已验证 | `packages/application/src/mcp-registry.ts`; `packages/mcp-adapter/src/streamable-http-adapter.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | 注册级固定凭据由发现/调用共享 |
| FR-MCP-007   | EP-02 | unit+integration     | 已验证 | `packages/crypto-adapter/src/aes-gcm-secret-cipher.ts`; `infra/postgres/migrations/0008_mcp_registry.up.sql` | `packages/crypto-adapter/test/aes-gcm-secret-cipher.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | AES-256-GCM 随机 IV/认证标签；数据库只含密文，主密钥来自环境 |
| FR-MCP-008   | EP-02 | unit+integration     | 开发中 | `packages/domain/src/mcp.ts`; `packages/application/src/mcp-registry.ts`; `packages/persistence-postgres/src/repositories.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | 六类增强元数据可校验、编辑、持久化且刷新保留；LLM 自动生成与管理展示待实现 |
| FR-MCP-009   | EP-02 | unit+integration     | 已验证 | `packages/application/src/mcp-registry.ts`; `packages/json-schema-adapter/src/ajv-validator.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | 调用前加载当前原始 input schema；无效参数不进入 Transport |
| FR-MCP-010   | EP-02 | unit+integration     | 已验证 | `packages/application/src/mcp-registry.ts`; `packages/persistence-postgres/src/repositories.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | 按名称读取当前注册定义；刷新原子替换而非锁定快照 |
| FR-MCP-011   | EP-02 | unit+integration     | 开发中 | `packages/application/src/mcp-registry.ts`; `packages/persistence-postgres/src/repositories.ts`; `infra/postgres/migrations/0009_mcp_audit.up.sql` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | 刷新原子生成受影响 enabled SkillVersion 的持久化告警且不禁用 Skill；管理展示待实现 |
| FR-MCP-012   | EP-02 | unit+integration     | 开发中 | `packages/domain/src/mcp.ts`; `packages/application/src/mcp-registry.ts`; `packages/persistence-postgres/src/repositories.ts` | `packages/application/test/mcp-registry.unit.test.ts`; `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` | 成功/失败/取消调用参数、结果、错误、关联 ID、耗时可回放；LLM 动态后续决策待 Workflow Runtime |
| FR-MCP-013   | EP-02 | unit+integration     | 已验证 | `packages/application/src/mcp-registry.ts`; `packages/mcp-adapter/src/streamable-http-adapter.ts` | `packages/application/test/mcp-registry.unit.test.ts` | 相同参数重复调用实际进入 Transport 两次并形成两条审计；未实现幂等键、去重或逐次确认 |
| FR-LLM-001   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-002   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-003   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-004   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-005   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-006   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-007   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-LLM-008   | EP-03 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-001    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-002    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-003    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-004    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-005    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-006    | EP-03 | unit+integration+e2e | 开发中 | `packages/langgraph-runtime/src/dynamic-graph-spike.ts` | `packages/langgraph-runtime/test/dynamic-graph.unit.test.ts` | `pnpm test:unit`：LangGraph StateGraph 条件路由和有界循环真实执行通过；完整 DSL compiler 待 EP-03 |
| FR-WF-007    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-008    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-009    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-WF-010    | EP-03 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-001   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-002   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-003   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-004   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-005   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-006   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-007   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-008   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-009   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EXE-010   | EP-04 | unit+integration+e2e | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-001   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-002   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-003   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-004   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-005   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-RST-006   | EP-04 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-001   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-002   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-003   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-004   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-005   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-MEM-006   | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-001  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-002  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-003  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-004  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-EVAL-005  | EP-05 | unit+integration     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-001   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-002   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-003   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-004   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-005   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-006   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-007   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| FR-ADM-008   | EP-06 | api contract+e2e     | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-PERF-001 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-PERF-002 | EP-07 | non-functional+e2e   | 开发中 | `packages/domain/src/mcp.ts`; `packages/application/src/mcp-registry.ts`; `infra/postgres/migrations/0009_mcp_audit.up.sql` | `packages/persistence-postgres/test/repositories.integration.test.ts` | MCP 调用 duration_ms 已持久化；队列/模型/Workflow 节点耗时与管理展示待后续 EP |
| NFR-REL-001  | EP-07 | non-functional+e2e   | 开发中 | `packages/runtime-redis/src/bullmq-context-queue.ts`; `compose.yaml` | `packages/runtime-redis/test/bullmq-context-queue.integration.test.ts` | `pnpm test:integration`：排队 job 跨 queue client 重启保留；真实进程崩溃/Redis restart 矩阵待 EP-04/07 |
| NFR-REL-002  | EP-07 | non-functional+e2e   | 开发中 | `packages/runtime-redis/src/bullmq-context-queue.ts` | `packages/runtime-redis/test/bullmq-context-queue.integration.test.ts` | job `attempts=1` 与 Worker `maxStalledCount=0` 已实现并验证 attempts；运行中故障不重试 e2e 待 EP-04/07 |
| NFR-SEC-001  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-SEC-002  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-OBS-001  | EP-07 | non-functional+e2e   | 开发中 | `packages/domain/src/mcp.ts`; `packages/application/src/mcp-registry.ts`; `infra/postgres/migrations/0009_mcp_audit.up.sql` | `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts`; `packages/persistence-postgres/test/repositories.integration.test.ts` | MCP invocation_id/task_id/context_id 可关联；完整任务/节点/模型/Goal/Evaluation 导航待后续 EP |
| NFR-OBS-002  | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-MNT-001  | EP-07 | non-functional+e2e   | 开发中 | `packages/domain/`; `packages/application/`; `packages/a2a-adapter/`; `packages/mcp-adapter/`; `packages/langgraph-runtime/`; `scripts/check-architecture.mjs` | domain/application/adapter/runtime unit+contract tests | `pnpm verify:architecture`：19 个 TS 文件的 Domain/Application/SDK/LangGraph 边界自动守卫通过；完整模块集待 EP-07 |
| NFR-COMP-001 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-DATA-001 | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
| NFR-UX-001   | EP-07 | non-functional+e2e   | 未实现 | 待填写   | 待填写   | 待填写   |
