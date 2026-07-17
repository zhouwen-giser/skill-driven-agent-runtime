# SDAR v1.1 MCP Tasks 规范化设计

状态：Phase 1–6 本地实现与验收已验证；外部生产 Provider 互操作仍未验证<br>
日期：2026-07-17<br>
执行计划：`execplans/EP-09-v1.1-mcp-tasks.md`

## 1. 权威范围

本文把 `docs/sdar_v1_1_mcp_tasks_codex_parallel_upgrade_package.md` 与 `docs/SDAR_v1.1_MCP_Tasks_升级设计文档.md` 转换为可追踪的 v1.1 增量要求，不修改 V1.0 SRS 或 `docs/01_REQUIREMENTS_BASELINE.md`。发生冲突时仍按 `AGENTS.md` 的权威顺序处理。

协议来源冻结为：

- `@modelcontextprotocol/client@2.0.0-beta.4`，annotated tag object `5aa0a82829f83b6b62a8ce41531921b34180ff84` 指向 commit `e81758caed29f6568ce8873f7f9a3bd65b017d9c`，仅在 MCP Adapter 内用于 extension-era 协商、Streamable HTTP 与 legacy fallback；
- `@modelcontextprotocol/sdk@1.29.0`，tag `v1.29.0` commit `e12cbd7078db388152f6e839abdbe09ba01f3f32`，迁移期只保留现有 legacy loopback Server fixture；
- 官方 `modelcontextprotocol/ext-tasks` commit `8966bea9c4f4e6d71060cc8284a539086e9e234f`；
- `schema/draft/schema.json` blob `d6ccaff7e3fb2131b5d752dd8b6f34096e58e976`；
- `schema/draft/schema.ts` blob `2634c47c2b25ac8fafe7fadaa7dd3f3b732c0abc`；
- Provider 扩展 `io.sdar/taskExecution` 的线协议由 `docs/23_V1_1_MCP_TASKS_PROVIDER_EXTENSION.md` 冻结。

## 2. 目标与非目标

目标是让现有 `mcp_tool` 节点同时安全处理同步 Tool 结果和长时 MCP Task，并使远程等待、输入、取消、重启轮询、时间风险和最终结果具备 PostgreSQL 权威证据。

非目标：

- 不引入第二 Workflow Runtime，不替换 LangGraph.js；
- 不把 Provider 的资源、抢占、排队、暂停或业务 Timer 变成 SDAR 权威状态；
- 不默认新增 `mcp_task` DSL 节点；
- 不使用旧版 `tasks/result`、`tasks/list` 或 SDK `experimental.tasks`；
- 不提供认证、多租户、分布式 Worker 恢复或运行中普通 Workflow 自动恢复；
- 不动态执行 LLM 代码，不允许 LLM 绕过 Schema、确认、工具白名单或确定性 Guard。

## 3. 规范化需求

| ID           | P0 要求                                                                                                                                 | 验证期望                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| FR-MCPT-001  | Adapter 必须在能力协商后支持 `tools/call`、`tasks/get`、`tasks/update`、`tasks/cancel`，并隔离全部 SDK/wire 类型。                      | 协议合约与架构门禁          |
| FR-MCPT-002  | `tools/call` 必须返回受验证联合：同步结果、同步业务错误或远程 Task handle；未知/矛盾结果 fail closed。                                  | 单元、合约、loopback        |
| FR-MCPT-003  | Provider Task 状态必须限于 `working`、`input_required`、`completed`、`failed`、`cancelled`，并保存有序观测。                            | Schema、归约与持久化测试    |
| FR-MCPT-004  | 每个远程 Task 必须创建唯一、显式区分本地/远程 ID 的 `RemoteTaskBinding`，关联调用、Goal、Task、Context、Workflow、节点运行和执行模式。  | PostgreSQL 集成与 E2E       |
| FR-MCPT-005  | BullMQ 必须以绑定 ID/期望版本幂等轮询；启动与周期 Reconciler 必须补齐丢失 Job，忽略陈旧/终态 Job。                                      | Redis/PG 故障注入           |
| FR-MCPT-006  | Provider 通信故障必须退避并记录 `provider_unreachable`，不得伪造业务终态或恢复图。                                                      | 失败注入与时钟测试          |
| FR-MCPT-007  | 远程 Task 等待必须结束当前图调用并持久化 continuation snapshot；已完成节点和副作用不得重放。                                            | LangGraph 单元、重启 E2E    |
| FR-MCPT-008  | pause/resume/progress/heartbeat 只更新观测；只有 input-required/completed/failed/cancelled 控制事件可解锁对应分支。                     | 状态机与 E2E                |
| FR-MCPT-009  | 计划期必须检查 operation availability，保存快照与风险；执行前用实际参数重新检查并应用确定性 Guard。                                     | 规划、校验、执行合约        |
| FR-MCPT-010  | `TaskExecutionTiming` 必须区分 immediate/scheduled、启动容差和可空 `maxElapsedMs`；预测、预约、TTL、Provider 不可达和业务期限不得混同。 | Schema/时钟/Provider 合约   |
| FR-MCPT-011  | restricted 仅产生风险与受限决策；Provider 在调用时最终接纳/拒绝并负责资源抢占，不由 SDAR 预先暂停任何图或远程 Task。                    | 零越权调用与拒绝 E2E        |
| FR-MCPT-012  | `input_required` 必须复用 Task input/A2A 提交能力，但答案通过 `tasks/update` 回到原绑定，不触发新的 Goal 规划。                         | A2A+MCP E2E                 |
| FR-MCPT-013  | Cancel 必须区分本地请求、协议确认和 Provider 终态；不可达时保留不确定性，不伪造 remote cancelled。                                      | 合约、失败注入、E2E         |
| FR-MCPT-014  | API/Console 必须显示 capability、availability、binding、观测、控制、时间、输入、取消和最终结果的真实关联，并允许受约束操作。            | OpenAPI、管理合约、UI E2E   |
| NFR-MCPT-001 | 所有远程 payload、快照、响应和 `_meta` 必须经过有界 JSON Schema 校验；凭据、私有思维链和未清洗错误不得落库/展示。                       | 安全单元、架构、日志测试    |
| NFR-MCPT-002 | 同一 `context_id` 继续严格串行；轮询/控制至少一次投递必须幂等，且普通执行仍 attempts=1、故障不恢复不重试。                              | 并发、Redis/进程故障 E2E    |
| NFR-MCPT-003 | 远程等待在进程或 Redis 重启后必须由 PostgreSQL 重建；不得声称恢复普通 running/evaluating Workflow。                                     | 真实 PG/Redis 重启 E2E      |
| NFR-MCPT-004 | 每个协议请求、绑定、观测、控制、continuation、结果和错误必须按 Task/Goal/Workflow/Skill/MCP 调用可追踪，并记录 Token/耗时而非思维链。   | 查询合约、Console、审计 E2E |

## 4. 领域状态与权威

三类状态严格分开：

```text
Operation availability: available | restricted | disabled | unknown
MCP Task status:        working | input_required | completed | failed | cancelled
Provider substate:      scheduled | queued | running | paused | resuming | stopping
```

Provider substate只是观察。`paused` 与 `resumed` 不改变本地 `WAITING_REMOTE_TASK`。Provider 对远程执行、资源仲裁、业务 Timer 和最终 Tool Result 权威；SDAR 对本地 Workflow、Binding、轮询、continuation、A2A 投影和审计权威。

`serverId` 是 v1.1 的 Provider identity。严禁把现有 `McpInvocation.taskId`（Agent Task）解释为远程 Task ID。

## 5. MCP 客户端边界

应用层端口采用领域中立联合：

```ts
type McpToolCallOutcome =
  | { kind: 'immediate'; result: InternalToolResult }
  | { kind: 'remote_task'; task: RemoteTaskCreated };

interface McpTasksClientPort {
  callTool(input: McpToolCallInput): Promise<McpToolCallOutcome>;
  get(remoteTaskId: string): Promise<RemoteTaskSnapshot>;
  update(
    remoteTaskId: string,
    responses: Readonly<Record<string, unknown>>,
  ): Promise<RemoteTaskOperationAck>;
  cancel(remoteTaskId: string): Promise<RemoteTaskOperationAck>;
}
```

Adapter 验证协商协议修订、能力、方法、`resultType`、Headers、Task ID、状态与内容。普通 Server 无扩展能力时保持同步行为；legacy `2025-11-25` 连接不得启用扩展。`mode=require_task` 却返回同步结果时产生稳定契约错误。同步 `CallToolResult.isError=true` 是业务错误，不是成功结果，也不创建 Binding。`tasks/update`/`tasks/cancel` 的 ack 不是状态证明，权威状态只能由后续 `tasks/get` 给出。

## 6. 持久模型

### 6.1 RemoteTaskBinding

至少包含：`bindingId`、`serverId`、`operationName`、`remoteTaskId`、`agentTaskId`、`contextId`、`goalId`/version、`workflowPlanId`/version、`workflowInstanceId`、`workflowNodeId`、`workflowNodeRunId`、可选父/子 Skill/Workflow lineage、`mcpInvocationId`、`protocolStatus`、`localState`、requested timing、execution context、credential/session revision、poll counters/time、result/error snapshots、invalidation/terminal timestamps和乐观锁 `version`。

核心约束：

```text
UNIQUE(server_id, remote_task_id)
UNIQUE(workflow_instance_id, workflow_node_run_id)
```

### 6.2 Observation 与 control inbox

Observation 追加保存 accepted/scheduled/started/paused/resumed/progress/heartbeat/provider-unreachable 等展示事件。Control inbox 只保存 input-required/completed/failed/cancelled，并以 `bindingId + type + remoteRevision/resultHash` 幂等。`runtime_event` 只是派生投影。

### 6.3 Continuation snapshot

快照必须有 Schema/version/大小限制，并保存 Workflow/plan/version、等待节点运行、可运行 frontier、已完成节点、outputs/errors/routes/loop/recovery counts、parallel predecessors、execution context和 state version，足以避免从 START 重放。

### 6.4 Availability snapshot

保存 plan/node/server/operation、已知参数或 unresolved paths、参数 hash、timing、完整查询结果、checkedAt 和 source revision。没有 `reservationRef` 的结果绝不展示为已预约。

## 7. 可用性与时间决策

```text
DSL Schema/引用/注册检查
  → 批量 Availability
  → 风险报告
  → Schema 约束的 LLM 决策
  → 确定性 Guard
  → 计划确认
  → 节点前用解析后的实际参数刷新
  → tools/call，由 Provider 最终仲裁
```

LLM 只能从 `proceed | reschedule | revise_dsl | request_confirmation | abort` 中选择，不能覆盖 disabled、Schema/权限/安全硬拒绝、非法时间、无效预约或未注册 Server。

`TaskExecutionTiming`：

```ts
interface TaskExecutionTiming {
  start:
    | { mode: 'immediate'; startToleranceMs: number }
    | { mode: 'scheduled'; scheduledAt: string; startToleranceMs: number };
  maxElapsedMs: number | null;
}
```

Provider 执行启动窗口与最大墙钟时间。`start_window_missed` 与 `deadline_reached` 是 Provider 的 completed+isError Tool Result；SDAR 只验证和映射，绝不因本地 poll/TTL/网络故障伪造。

Phase 3 的已实现 Guard 还要求：执行前 restricted 只有在计划已确认、同一节点的规划快照也是 restricted 且刷新风险未升级时才可继续；否则返回重新确认原因并保持零 Tool 调用。规划证据与执行前证据追加保存在 0101 表中，Console/API 只展示清洗后的 hash、窗口、有效期、timing 和真实预约引用。

Phase 6 补齐了 `task_required` 隐式 Guard：若 Tool 注册语义要求 Task，而模型生成的 `mcp_tool` 没有 `taskExecution`，规划期和节点执行前都必须推导 `require_task + availabilityCheck=required`。执行边界从 PostgreSQL 重新读取 Tool 语义，并以解析、冻结后的实际参数运行 pre-call check；缺少 readiness runtime、Workflow Definition 或有效证据时稳定拒绝。因此 DSL 字段省略不能降级为同步调用或绕过确认。

## 8. 轮询、等待与继续

Poll job 仅包含 `bindingId` 和 `expectedVersion`，使用 attempts=1。Worker 读取 PostgreSQL 后才发 `tasks/get`；版本陈旧或绑定关闭即 no-op。working 保存观察并安排下一次；控制状态先原子落 inbox 再调度 continuation。通信失败只增加 failure count、告警与退避。

LangGraph 节点收到远程 handle 后原子保存 invocation/binding/snapshot/event，并返回 `waiting_remote_task`。无可运行节点且存在远程等待时 WorkflowInstance 是 `waiting_external`，不是 `paused`。其他并行分支可以继续，Join 不把等待前驱视作完成。

Continuation 原子 claim 控制，验证 Goal/plan/instance/binding仍有效，只更新相应 node run 和 frontier，并创建 continuation attempt。多个远程 Task 独立解锁；子 Workflow 先完成自身 continuation，父节点随后继续。Goal Patch/取消/终态后迟到事件只审计。

等待节点把 `workflow_node_event.event_type` 写为 `node_waiting_external`，不写成功，不满足 Join。Migration `0104_workflow_external_wait_event` 把该值加入数据库 CHECK；只要存在这类事件，down migration 就 fail closed，防止回滚后留下无法表示的审计证据。

启动恢复是 V1.1 组合的显式 opt-in。只有 active continuation snapshot、waiting binding、`waiting_external` Workflow instance、未失效且处于可观察 local state 的 RemoteTaskBinding 全部匹配时，启动流程才保留 Task/attempt 并从 PostgreSQL 重建 Poll/continuation Job。它不恢复当时正在运行的 Worker，也不重试失败 Job。普通 running/paused/evaluating Workflow 和 Task 仍以 `PROCESS_EXECUTION_LOST` 失败。真实 restart integration 同时验证远程等待完成、Redis 队列完全丢失后重建、`tools/call` 只发生一次，以及普通 running Task 仍失败。

## 9. Input、Cancel 与业务结果

- input-required 创建 source=`remote_task` 的 TaskInputRequest 与 binding link；上游回答校验后调用 `tasks/update`，继续轮询，不创建新 Goal/plan。
- Cancel 记录 request/attempt/ack，随后继续观察 Provider。Provider 不可达显示 `cancel_uncertain`；只有 Provider snapshot 可令 remote status 成为 cancelled/completed/failed。
- 调用阶段 `isError=true` 且无 Task：`admission_rejected`，无 Binding，节点立即走 error handler。
- completed+`isError=false`：节点成功。
- completed+`isError=true`：结构化业务错误，如 `start_window_missed`、`deadline_reached`、`partial_completion`、`business_failure`。
- failed：Provider 无法形成最终 Tool Result或协议/设施失败。
- cancelled：进入已有取消/错误策略；不得自动补偿。

## 10. 管理与风险界面

管理 API/OpenAPI/Console 已提供：Tool Task 语义和 capability；计划 availability/risk/timing；Task/Goal/Workflow/Skill/invocation/binding关联；状态、Provider substate、轮询、观测、control、protocol attempt、continuation、输入、取消不确定性、结果/错误；受约束的 refresh/cancel/provide-input。

权威入口是 `GET /api/v1/tasks/{taskId}/remote-task-lifecycle`。版本 CAS refresh 通过 `POST /api/v1/remote-task-bindings/{bindingId}/refresh` 进入同一 context-serialized polling service；management cooperative cancel 通过 `POST /api/v1/remote-task-bindings/{bindingId}/cancel` 持久化幂等请求；输入继续通过现有 Task `provide_input` action。Console 不复制状态，只呈现清洗后的 PostgreSQL read model。所有页面保留 trusted-intranet、无认证、共享记忆、副作用、普通运行不可自动恢复等现有告警，并新增 Provider Task 权威与取消不确定性说明。

## 11. Migration 与 hardening 同步

v1.1 使用 `0100+` 避免文件冲突，并保持显式 `v1.1-isolated` profile、acknowledgement 和 `sdar_v11_*` disposable database 保护。已验证的支持路径是完整 `v1.0.13-bug-fixed` schema 后依次应用：`0100` tracking、`0101` readiness、`0102` continuation、`0103` input/cancellation、`0104` external-wait event constraint。迁移 gate 覆盖空库、精确 upgrade、rollback/reapply、默认 profile 拒绝和 ledger gap fail-closed；记录共 68 个 migration pairs。

## 12. 验收场景

| ID         | 场景                  | 主要判定                                                  |
| ---------- | --------------------- | --------------------------------------------------------- |
| AC-MCPT-01 | 同步 Tool 回归        | 同步成功/业务错误正确归一化，无 Binding                   |
| AC-MCPT-02 | Task 协商与创建       | capability 通过，handle/Headers/Binding/追踪真实          |
| AC-MCPT-03 | 不支持 Tasks          | 普通 Tool 可同步；require_task 稳定拒绝且零远程等待       |
| AC-MCPT-04 | working→completed     | Poll、观察、continuation、节点输出、终态完整              |
| AC-MCPT-05 | pause/resume 观察     | 不恢复节点、不创建 Graph Run、不改变等待状态              |
| AC-MCPT-06 | input_required        | A2A 输入经 tasks/update 回原 Task，不重新规划             |
| AC-MCPT-07 | cancel success        | 请求/ack/Provider cancelled分离，节点取消可追踪           |
| AC-MCPT-08 | cancel unreachable    | 显示不确定性，不伪造 remote cancelled                     |
| AC-MCPT-09 | restricted accepted   | 风险/确认/节点前刷新后 Provider 接纳并创建 Task           |
| AC-MCPT-10 | admission rejected    | 无 Task ID/Binding；结构化错误走 error handler            |
| AC-MCPT-11 | scheduled missed      | Provider 返回 start_window_missed；SDAR验证映射           |
| AC-MCPT-12 | maximum elapsed       | Provider先停止/隔离后返回 deadline_reached；SDAR不伪造    |
| AC-MCPT-13 | provider unreachable  | 退避、告警、状态不变，恢复后继续轮询                      |
| AC-MCPT-14 | process/Redis restart | PostgreSQL重建等待/Job，已完成副作用不重放                |
| AC-MCPT-15 | parallel/child waits  | 多绑定独立继续、Join正确、父子 lineage正确                |
| AC-MCPT-16 | Goal Patch/late event | 旧绑定/snapshot/control失效，迟到事件仅审计，新计划重确认 |

## 13. 完成判定

Phase 6 本地验收由 `pnpm verify`、`pnpm demo:acceptance`、`pnpm demo:local`、`pnpm verify:v11-acceptance` 和 focused MCP Tasks contract/restart/composition tests 复现。记录的 full gate 为 493 unit+contract、80 PostgreSQL/Redis integration、49 E2E、232 architecture assertions、110 OpenAPI operations 和 68 migration pairs；机器可读与人工可读结果位于 `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.{json,md}` 与 `V11-LOCAL-DEMO.{json,md}`。

证据分类：真实本地验证包括 PostgreSQL/pgvector、Redis/BullMQ、MCP/A2A HTTP loopback、LangGraph continuation、进程/队列重启组合、Management API、Console production bundle 与 migration path；模拟验证包括确定性 Mock Model 和 16-scenario Mock MCP Tasks Provider 的业务行为；未验证项是任何外部生产 MCP Provider、真实资源抢占/业务 Timer 以及生产部署。后者不得被报告为完成的互操作认证。
