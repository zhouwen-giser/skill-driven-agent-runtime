# SDAR v1.1 MCP Tasks
## Codex 并行升级、阶段提交、Hardening 同步与最终集成任务包

**仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
**目标版本：** `v1.1.0`  
**并行基线：** `release/v1.0-hardening` 当前已完成 `v1.0.4-bug-fixed`，`v1.0.5～v1.0.13` 仍在持续开发  
**建议实施分支：** `feature/v1.1-mcp-tasks`  
**最终集成基线：** 最新完成并推送的 `v1.0.x-bug-fixed`；正式合并前必须包含 `v1.0.13-bug-fixed`，除非用户书面授权提前集成  
**任务性质：** 在不重构现有 Skill、Workflow DSL 和 LangGraph Runtime 的前提下，增加 MCP Tasks 客户端能力  
**核心定位：** Skill 驱动的 A2A Task Runtime；SDAR 负责编排和远程 Task 生命周期关联，MCP Provider 负责资源、执行态、预约、抢占、暂停恢复和业务计时

---

# 0. Codex 总指令

你需要在 `zhouwen-giser/skill-driven-agent-runtime` 仓库中，以独立分支并行完成 SDAR v1.1 MCP Tasks 客户端升级。

本任务不是重新设计 SDAR，不得把系统行为树化，不得替换 LangGraph，不得建立资源本体或设备调度中心，也不得开发通用 MCP Tasks Server。

必须保持以下既有架构：

```text
A2A Task
  → Goal / Skill 选择
  → Skill 生成 Workflow DSL
  → DSL 校验、确认
  → 编译为 LangGraph.js
  → DSL 中的 parallel 节点形成并行执行分支
  → 普通 skill_call / subworkflow 由当前分支等待子图返回
  → parallel 下的多个分支或子图可以并行执行
  → MCP Tool 节点可能立即返回，也可能返回远程 MCP Task
```

本任务的核心增量是：

```text
MCP Tool call
  ├─ CallToolResult
  │    ├─ 正常结果
  │    └─ 调用阶段业务拒绝
  │
  └─ CreateTaskResult
       → 持久化 RemoteTaskBinding
       → 当前执行分支进入 WAITING_REMOTE_TASK
       → BullMQ 可靠轮询 tasks/get
       → 观测事件只记录
       → input_required / terminal 事件重新进入原执行分支
```

## 0.1 强制要求

1. 在修改代码前，阅读本任务包列出的全部权威文件。
2. 创建并持续维护 v1.1 ExecPlan、ADR、追踪矩阵和阶段报告。
3. 每个 Phase 必须形成独立提交并立即推送 GitHub。
4. 每个 Phase 开始前和提交前必须执行 `git fetch --tags origin`。
5. 必须持续检查并行运行的 `release/v1.0-hardening`。
6. 与正在执行的 bug-fixed 任务发生文件或语义冲突时：
   - 立即暂停冲突子任务；
   - 非冲突工作可以继续；
   - 等待对应 `v1.0.x-bug-fixed` 提交和 Tag 推送；
   - 主动将该稳定 Tag 或对应稳定分支提交 merge 到 v1.1 分支；
   - 保留 bug-fixed 修复；
   - 重新运行回归测试；
   - 再继续被暂停的 v1.1 子任务。
7. 已推送历史禁止 amend、rebase 和 force push。
8. 并行同步必须使用显式 merge commit。
9. 不允许用旧代码覆盖 hardening 修复。
10. 不允许因为 MCP Provider 不可达而伪造远程 Task 终态。
11. 不允许把 Provider 内部 `scheduled / queued / running / paused / resumed` 复制为 SDAR 权威执行状态。
12. 不使用 LangGraph `interrupt/resume` 作为业务恢复机制。
13. 不使用进程内 `setTimeout` 作为远程 Task 可靠轮询的唯一实现。
14. 不提前把实验性 MCP Tasks SDK 类型扩散到 domain/application 层。
15. 不得宣称完成未真实运行的测试。

## 0.2 只有以下情况允许停止

- 未修改代码的基线 `pnpm verify` 失败；
- GitHub 远程无写权限；
- 分支或 Tag 保护导致无法按要求推送；
- 并行 hardening 的冲突文件仍处于未完成、未推送的 bug-fixed 阶段；
- 当前 MCP TypeScript SDK 无法通过底层自定义 JSON-RPC 请求实现冻结的协议契约；
- 仓库实际架构与任务包存在无法通过 ADR 和小范围适配解决的根本冲突。

停止时必须创建阻塞报告并推送已有非冲突成果，不得假装完成。

---

# 1. 当前仓库基线与已确认事实

文档生成时对 `release/v1.0-hardening` 的检查结果：

- `package.json` 版本为 `1.0.4`；
- Node.js 要求为 `>=20.19.0`；
- MCP 依赖为 `@modelcontextprotocol/sdk@1.29.0`；
- LangGraph 依赖为 `@langchain/langgraph@1.4.7`；
- 队列基础设施已经包含 `bullmq@5.80.1`、Redis 和 PostgreSQL；
- `docs/21_V1_0_HARDENING_TRACEABILITY.md` 已将：
  - `v1.0.1-bug-fixed`
  - `v1.0.2-bug-fixed`
  - `v1.0.3-bug-fixed`
  - `v1.0.4-bug-fixed`
  标记为通过；
- `v1.0.5～v1.0.13` 仍为 pending；
- 最新已知 Migration 为 `0056_mcp_execution_mode`；
- `v1.0.11` 将增加 MCP Tool execution semantics；
- `v1.0.13` 将增加本地 Task 状态通知与低频安全轮询；
- 当前主架构规定：
  - LangGraph.js 是唯一 Workflow Runtime；
  - PostgreSQL 是权威存储；
  - Redis/BullMQ 是临时协调与队列；
  - 官方 MCP SDK 必须隔离在 Adapter 后面；
  - 外部 SDK 类型不能跨越 Adapter 边界；
  - 同一 Workflow 实例执行期间结构不可变；
  - 重新规划在图外生成新版本；
  - 当前普通 running A2A Task 不做进程故障自动恢复。

以上只是任务包生成时的观察结果。Codex Phase 0 必须重新确认实际 SHA、Tag、测试和 Migration，不得把本文档中的状态当作不可变事实。

---

# 2. 与 v1.0 Runtime Hardening 任务包的关系

已有 `SDAR v1.0.1～v1.0.13 Runtime Hardening` 任务包明确禁止在 hardening 分支中提前实现 MCP Tasks。

因此：

```text
release/v1.0-hardening
  └─ 只完成 v1.0.1～v1.0.13 加固

feature/v1.1-mcp-tasks
  └─ 并行实现 MCP Tasks 客户端升级
```

v1.1 不得直接提交到：

- `main`
- `release/v1.0-hardening`
- 任意正在执行的 `v1.0.x` 或 `v1.0.x-bug-fixed` 临时分支

## 2.1 已完成 hardening 能力必须复用

### v1.0.1

复用 Workflow runtime data binding：

- Task 调用参数和 timing 字段允许使用既有限制引用；
- 解析后必须生成不可变快照；
- 调用前再次按 Tool/Task Schema 校验；
- 不新增字符串模板、JSONPath 或任意代码执行。

### v1.0.2

复用真实 `skill_call` 子 Workflow：

- MCP Task 事件异常判断可以调用既有允许的 `skill_call`；
- 不创建第二套 Skill 执行器；
- 不把 MCP Task 处理变成 LLM-only 假执行。

### v1.0.3

复用 A2A `input-required` 基础：

- MCP Task `input_required` 可以借用现有结构化输入请求、回答和 attempt 机制；
- 需要区分：
  - A2A Task 自身 input-required；
  - 某个 Workflow 节点绑定的远程 MCP Task input-required；
- 不得重复建设完全独立的人工输入系统。

### v1.0.4

继承 Simulation / Historical Replay Header：

- MCP Task 的 `tools/call`、`tasks/get`、`tasks/update`、`tasks/cancel` 必须继承相同 execution context；
- 预约 Task 后续轮询也必须保存并使用原始 execution mode；
- 不得因异步化丢失 simulation/replay 隔离 Header 和审计。

## 2.2 尚未完成 hardening 的依赖与冲突

| Hardening 版本 | 与 v1.1 的关系 | 并行处理规则 |
|---|---|---|
| v1.0.5 子 Skill 确认 | DSL restricted 风险可能进入确认流程 | 若 Phase 3 修改确认核心文件，等待 `v1.0.5-bug-fixed` 后 merge |
| v1.0.6 终态一致性 | Remote Task 终态回注可能触及 Task/Goal/Control 权威提交 | Phase 4/5 不得覆盖该事务边界；最终集成前必须 merge |
| v1.0.7 Skill Input | Task timing/arguments 可能依赖结构化 Skill 输入 | 使用既有绑定 Port；不复制输入解析 |
| v1.0.8 Goal Contract | 风险决策应看到完整 Goal 约束 | Phase 3 通过接口隔离；merge 后补齐上下文 |
| v1.0.9 Skill Graph | 异常恢复可能 invoke_skill | 继续使用允许的组合上下文，不开放任意 Skill |
| v1.0.10 Capability Gap | MCP Task 不可用不等于 capability gap | 不改变 capability gap 终态契约 |
| v1.0.11 MCP Tool Semantics | 与 task-capable/task-required、cancel、idempotency 元数据直接重叠 | 禁止在 v1.1 内复制一套通用 Tool Semantics；先隔离 v1.1 扩展，待 bug-fixed 后主动 merge 适配 |
| v1.0.12 Memory | 远程 Task 当前状态属于 volatile | 不写入长期 Memory 权威事实 |
| v1.0.13 Task Notification | 可复用本地通知器减少内部忙轮询 | 不提前建设竞争实现；远程查询仍由 BullMQ Poller 负责，merge 后复用通知接口 |

## 2.3 最终集成条件

Phase 0～Phase 5 可以在 `v1.0.4-bug-fixed` 之后并行开发。

Phase 6 最终集成、RC Tag 和可合并 PR 必须满足：

```text
feature/v1.1-mcp-tasks
已经 merge 最新 v1.0.13-bug-fixed
```

若用户明确要求提前发布，可以在报告中列出未合并 hardening 版本及风险，并等待用户书面确认后调整。

---

# 3. 冻结的架构与语义

## 3.1 Skill、DSL 和 LangGraph 保持现状

冻结关系：

```text
Skill
  → 生成一个 Workflow DSL
  → DSL 编译为 LangGraph.js StateGraph
  → parallel 节点在同一图中形成并行执行分支
  → 普通 skill_call/subworkflow 节点由当前分支等待子图完成
  → parallel 下可并行执行多个普通节点、skill_call 或 subworkflow
```

禁止改成：

```text
SkillExecution
  ├─ 独立 LangGraph A
  ├─ 独立 LangGraph B
  └─ 独立 LangGraph C
```

除非当前仓库实际代码已经如此实现，并且 Phase 0 有明确证据。

v1.1 的增量应理解为：

> 一个已有 `mcp_tool` 节点在调用后返回远程 Task 句柄，使当前执行分支停止在该节点；同一 `parallel` 区域的其他可运行分支继续执行。

## 3.2 v1.1 默认不新增新的 DSL 节点类型

MCP Task 是 `tools/call` 的异步结果，不是独立业务能力种类。

默认方案：

- 保留 `mcp_tool` 节点；
- 增加可选的 Task execution contract；
- Runtime 同时处理：
  - `CallToolResult`
  - `CreateTaskResult`
  - 调用阶段 `CallToolResult.isError=true`

建议 DSL 形态：

```ts
interface McpTaskExecutionSpec {
  mode: "allow_task" | "require_task";

  timing?: {
    start:
      | {
          mode: "immediate";
          startToleranceMs: number;
        }
      | {
          mode: "scheduled";
          scheduledAt: WorkflowBoundValue;
          startToleranceMs: number;
        };

    maxElapsedMs?: number | null;
  };

  availabilityCheck?: "required" | "best_effort";
}

interface McpToolWorkflowNode {
  type: "mcp_tool";
  serverId: string;
  toolName: string;
  arguments: WorkflowBoundValue;
  taskExecution?: McpTaskExecutionSpec;
}
```

约束：

- 未声明 `taskExecution` 时，若 Provider 合法返回 Task，客户端仍必须兼容；
- `scheduled` 必须显式声明；
- `mode=require_task` 时 Provider 返回同步结果，应产生稳定的契约不匹配错误；
- 不允许 LLM 在运行时生成新字段或绕过 Schema。

若当前 MCP Tasks 扩展的实际线协议不允许通过标准参数传递 timing，必须通过 namespaced `_meta` 或 Provider 约定的受验证参数边界承载，并记录 ADR。

## 3.3 三类状态必须分离

### Task 操作可用性

```ts
type TaskOperationAvailability =
  | "available"
  | "restricted"
  | "disabled"
  | "unknown";
```

对象是：

```text
Provider + Operation + 实际参数 + 计划启动时间
```

### MCP Task 实例状态

```ts
type McpTaskStatus =
  | "working"
  | "input_required"
  | "completed"
  | "failed"
  | "cancelled";
```

### Provider 内部执行子状态

```text
scheduled
queued
running
paused
resuming
stopping
```

这些只作为观测信息，不是 SDAR 权威状态。

## 3.4 restricted Task 的最终语义

DSL 检查阶段：

```text
restricted
→ 只产生风险提示
→ 不提前暂停任何图或 Task
```

节点实际调用阶段：

```text
调用 restricted Task
  → Provider 根据实时资源和当前 Task 自行仲裁
     ├─ 接受
     │   ├─ Provider 可暂停/恢复自己管理的其他 Task
     │   ├─ 创建新 Task
     │   └─ 返回 taskId
     │
     └─ 拒绝
         ├─ 不创建 taskId
         └─ 返回 CallToolResult.isError=true
```

SDAR 不判断：

- 两个操作是否争抢同一物理资源；
- 哪个旧 Task 应被暂停；
- 旧 Task 是否已经真正释放资源；
- 哪个 Task 优先；
- Provider 是否应抢占。

## 3.5 pause/resume 是观测事件

当某个远程 Task 已经被创建：

```text
LangGraph 分支
  → WAITING_REMOTE_TASK
```

Provider 后续暂停该远程 Task：

```text
Task working/running
  → Task working/paused
```

对应 LangGraph 状态保持：

```text
WAITING_REMOTE_TASK
  → WAITING_REMOTE_TASK
```

`task.paused`、`task.resumed`、`task.progress`、`task.heartbeat`：

- 可以写审计；
- 可以更新 Console；
- 可以调整轮询间隔；
- 不创建新的 Graph Run；
- 不恢复节点；
- 不触发异常路径；
- 不改变节点本地等待状态。

只有以下事件可以重新进入对应执行分支：

```text
input_required
completed
failed
cancelled
```

## 3.6 Task 时间契约

```ts
interface TaskExecutionTiming {
  start:
    | {
        mode: "immediate";
        startToleranceMs: number;
      }
    | {
        mode: "scheduled";
        scheduledAt: string;
        startToleranceMs: number;
      };

  /**
   * null / 未声明：无期限。
   * 有值：从 Provider 约定基准时间计算的最大墙钟时间。
   * 包含 scheduled、queued、running、paused、resuming。
   */
  maxElapsedMs: number | null;
}
```

Provider 负责：

- 预约；
- 排队；
- 启动窗口；
- 资源判断；
- 暂停和恢复；
- 最大墙钟时间；
- 强制停止；
- 资源释放；
- 最终结果。

SDAR 只保存请求快照用于审计和解释，不维护业务 Timer。

## 3.7 启动窗口错过和最大等待到达

预约 Task 到达：

```text
latestStartAt = scheduledAt + startToleranceMs
```

仍不可启动时，Provider 必须安全结束 Task：

```text
status = completed
result.isError = true
structuredContent.outcome = "start_window_missed"
```

到达 `maxElapsedMs` 时，Provider 必须先停止或隔离底层执行、释放资源，再返回：

```text
status = completed
result.isError = true
structuredContent.outcome = "deadline_reached"
```

`completed` 只表示 Task 生命周期结束，不代表业务成功。

## 3.8 Provider 不可达与业务超时分离

Provider 暂时不可达时：

- RemoteTaskBinding 保持原状态；
- Poller 退避重试；
- 产生 `provider_unreachable` 运行告警；
- 不生成 `deadline_reached`；
- 不把 Task 标记为 failed/completed/cancelled；
- 不恢复对应 LangGraph。

---

# 4. Task 可用性与可用时间窗口

## 4.1 DSL 计划级检查

结构校验通过后、计划确认和执行前，对所有 Task-capable/Task-required 节点进行批量检查：

```text
Workflow DSL
  → 结构、引用、Schema、注册表校验
  → Task Operation Availability Check
  → DSL Risk Report
  → LLM 风险决策
  → Deterministic Policy Guard
  → 计划确认
  → 编译与执行
```

## 4.2 请求模型

```ts
interface TaskAvailabilityCheckRequest {
  nodeId: string;
  providerId: string;
  operationName: string;
  arguments: Readonly<Record<string, unknown>>;
  timing?: TaskExecutionTiming;
}
```

## 4.3 响应模型

```ts
interface TaskAvailableWindow {
  startTime: string;
  endTime: string;
}

interface TaskAvailabilityCheckResult {
  nodeId: string;
  providerId: string;
  operationName: string;

  availability:
    | "available"
    | "restricted"
    | "disabled"
    | "unknown";

  riskLevel:
    | "low"
    | "medium"
    | "high"
    | "critical";

  reasonCode?: string;
  description?: string;

  /**
   * Provider 对该预测快照的有效期。
   */
  validUntil?: string;

  /**
   * restricted 时必须尽可能提供。
   */
  earliestStartTime?: string;
  nextAvailableWindows?: TaskAvailableWindow[];
  estimatedDelayMs?: number;

  /**
   * none：只是状态提示；
   * best_effort：窗口可能变化；
   * guaranteed：Provider 已承诺能力，必须附 reservationRef。
   */
  reservationMode:
    | "none"
    | "best_effort"
    | "guaranteed";

  reservationRef?: string;

  possibleEffects: Array<
    | "task_preemption"
    | "task_pause"
    | "start_rejection"
    | "start_window_missed"
    | "deadline_reached"
    | "partial_completion"
  >;
}
```

规则：

- `restricted` 时 Provider 应返回当前可用时间信息，至少包括：
  - `earliestStartTime`，或
  - 非空 `nextAvailableWindows`
- `validUntil` 必须说明预测何时过期；
- `reservationMode=guaranteed` 必须携带 `reservationRef`；
- 没有 reservationRef 的检查结果不得被 SDAR 描述为已预约；
- 可用窗口是计划信息，不替代节点调用时的最终 Provider 判断。

## 4.4 LLM 可做的决策

```ts
type DslRiskDecision =
  | {
      action: "proceed";
      acceptedRiskNodeIds: string[];
    }
  | {
      action: "reschedule";
      nodeId: string;
      selectedStartTime: string;
      reason: string;
    }
  | {
      action: "revise_dsl";
      reason: string;
    }
  | {
      action: "request_confirmation";
      riskNodeIds: string[];
    }
  | {
      action: "abort";
      reason: string;
    };
```

LLM 可以：

- 接受 restricted 风险；
- 根据 `earliestStartTime` 改期；
- 从 `nextAvailableWindows` 选择新的预约时间；
- 替换 Task；
- 请求确认；
- 放弃分支或计划。

LLM 不能覆盖：

- `disabled`；
- 权限拒绝；
- Schema 错误；
- 安全策略硬阻断；
- 非法时间；
- 无效 reservationRef；
- 未注册 Provider；
- 确定性 Policy Guard。

## 4.5 节点执行前刷新

计划检查不是资源锁。

节点执行前必须再次刷新操作可用性：

```text
available
  → 正常 tools/call

restricted
  → 允许发起 tools/call，由 Provider 最终仲裁

disabled
  → 不发起调用，产生稳定本地节点异常

unknown
  → 按配置处理；默认保守地进入风险/异常判断，不伪造 available
```

---

# 5. MCP Tasks 客户端隔离层

JavaScript/TypeScript 官方高层 Tasks API 仍未作为稳定生产接口锁定。

v1.1 必须在当前 MCP Adapter 内建立隔离层：

```ts
interface McpTasksClientPort {
  callTool(
    input: McpToolCallInput
  ): Promise<
    | { kind: "immediate"; result: InternalToolResult }
    | { kind: "remote_task"; task: RemoteTaskCreated }
  >;

  get(taskId: string): Promise<RemoteTaskSnapshot>;

  update(
    taskId: string,
    responses: Readonly<Record<string, unknown>>
  ): Promise<RemoteTaskSnapshot>;

  cancel(taskId: string): Promise<RemoteTaskSnapshot>;
}
```

要求：

- 可以基于现有稳定 MCP Client 的底层 `request` 能力实现；
- 固定并验证当前使用的 Task Schema；
- 记录 Schema revision 或来源 commit；
- external SDK 类型只存在于 adapter 内；
- domain/application 使用内部稳定类型；
- 未来官方高层库稳定后只替换 Adapter；
- 不引用旧版 `tasks/result`、`tasks/list` 或已废弃 interception API；
- 通过能力协商确认 Provider 支持当前 Tasks 扩展；
- Provider 不支持时保持普通同步 Tool 行为。

---

# 6. 数据模型草案

最终字段名按仓库风格适配，但语义必须保留。

## 6.1 RemoteTaskBinding

```ts
interface RemoteTaskBinding {
  bindingId: string;

  providerId: string;
  serverId: string;
  operationName: string;
  remoteTaskId: string;

  agentTaskId: string;
  contextId: string;

  workflowPlanId: string;
  workflowInstanceId: string;
  workflowNodeRunId: string;

  protocolStatus:
    | "working"
    | "input_required"
    | "completed"
    | "failed"
    | "cancelled";

  localState:
    | "polling"
    | "awaiting_input"
    | "terminal_event_pending"
    | "terminal_event_claimed"
    | "reentered"
    | "closed";

  requestedTiming?: TaskExecutionTiming;
  executionMode: "live" | "simulation" | "historical-replay";
  simulationId?: string;

  nextPollAt?: string;
  pollAttempt: number;
  providerFailureCount: number;

  resultSnapshot?: unknown;
  errorSnapshot?: unknown;

  createdAt: string;
  updatedAt: string;
  terminalAt?: string;

  version: number;
}
```

唯一约束：

```text
UNIQUE(server_id, remote_task_id)
```

## 6.2 RemoteTaskObservation

```ts
interface RemoteTaskObservation {
  observationId: string;
  bindingId: string;

  type:
    | "task.accepted"
    | "task.scheduled"
    | "task.started"
    | "task.paused"
    | "task.resumed"
    | "task.progress"
    | "task.heartbeat"
    | "provider_unreachable";

  providerEventId?: string;
  payload: unknown;
  observedAt: string;
}
```

观测可以复用 `runtime_event`，但不得使 `runtime_event` 变成远程 Task 权威表。

## 6.3 RemoteTaskControlEvent

```ts
interface RemoteTaskControlEvent {
  eventId: string;
  bindingId: string;

  type:
    | "task.input_required"
    | "task.completed"
    | "task.failed"
    | "task.cancelled";

  remoteRevision?: string;
  payload: unknown;

  status:
    | "pending"
    | "claimed"
    | "processed"
    | "failed";

  createdAt: string;
  claimedAt?: string;
  processedAt?: string;
}
```

唯一幂等键应至少覆盖：

```text
bindingId + type + remoteRevision/resultHash
```

## 6.4 TaskAvailabilitySnapshot

计划风险快照至少保存：

```ts
interface TaskAvailabilitySnapshot {
  snapshotId: string;
  workflowPlanId: string;
  nodeId: string;
  providerId: string;
  operationName: string;
  argumentsHash: string;
  timingSnapshot?: TaskExecutionTiming;
  result: TaskAvailabilityCheckResult;
  checkedAt: string;
}
```

可存入现有 Plan Attempt/Audit JSON，也可新建表。Phase 0 必须基于当前存储模型做最小改动 ADR。

## 6.5 Migration 并行规则

当前 hardening 已使用到 `0056`，后续 v1.0.5～v1.0.13 可能继续占用编号。

Codex 不得未经检查直接创建 `0057`。

Phase 0 必须检查 Migration Loader 是否允许编号间隔：

- 若允许间隔：
  - 为 v1.1 预留非冲突区间，例如 `0100～0109`；
  - 通过 ADR 和 migration verifier 固化。
- 若要求严格连续：
  - Phase 1 先完成 domain/adapter/in-memory contract；
  - 创建数据库 Migration 前先同步最新完成的 bug-fixed；
  - 使用当时真实最大编号；
  - 后续发生编号冲突时，在未发布的 v1.1 分支增加专门 integration commit 重命名本分支新 Migration；
  - 禁止修改已进入 hardening Tag 的 Migration。

---

# 7. 可靠轮询与重启恢复

当前仓库已经依赖 BullMQ、Redis 和 PostgreSQL。v1.1 默认复用 BullMQ，不新增 pg-boss、Temporal、Restate 或新的 Workflow Runtime。

## 7.1 调度接口

```ts
interface RemoteTaskPollScheduler {
  schedule(
    bindingId: string,
    expectedVersion: number,
    runAt: Date
  ): Promise<void>;

  cancel(bindingId: string): Promise<void>;
}
```

## 7.2 BullMQ Job

建议：

```ts
interface RemoteTaskPollJob {
  bindingId: string;
  expectedVersion: number;
}
```

Job ID 必须支持幂等调度，例如：

```text
mcp-task-poll:{bindingId}:{expectedVersion}
```

## 7.3 Poll Worker

```text
读取 Binding
  → 检查 expectedVersion 和终态
  → tasks/get
  → Schema 校验
  → 原子归约状态
     ├─ working：保存观测并安排下一次
     ├─ input_required：创建控制事件
     ├─ completed：创建控制事件
     ├─ failed：创建控制事件
     └─ cancelled：创建控制事件
```

## 7.4 启动 Reconciler

SDAR 启动时扫描：

```text
protocol_status IN (working, input_required)
AND local_state NOT IN (reentered, closed)
```

重新调度缺失 Job。

增加周期 Reconciler 修复：

- PostgreSQL 有 Binding，Redis Job 丢失；
- Worker 更新状态后下一 Job 未创建；
- 进程重启空窗；
- 重复 Job；
- 终态 Job 未取消。

## 7.5 不改变现有 A2A running Task 恢复边界

当前架构规定普通 running A2A Task 不做进程故障自动重试。

v1.1 只恢复：

> 对已经由远程 MCP Provider 持有和执行的 Task 的状态观察与结果获取。

不得把该机制扩大为：

- 重跑整个 A2A Task；
- 重放已完成 Workflow；
- 自动重试非幂等 Tool；
- 复活本地 running 节点。

---

# 8. Task 事件回注

## 8.1 不使用 LangGraph interrupt/resume

远程 Task 创建后：

1. 保存 `RemoteTaskBinding`；
2. 当前 `mcp_tool` 节点记录 `WAITING_REMOTE_TASK`；
3. 当前图执行轮次自然结束或在其他并行分支完成后结束；
4. 不保留内存 Graph 对象作为权威 continuation；
5. Task 控制事件到达后，通过现有持久化 Workflow/Controller 入口创建新的执行 attempt；
6. 只继续被绑定节点的后续语义；
7. 不重放已经完成的副作用节点。

## 8.2 建议应用接口

```ts
interface RemoteTaskContinuationService {
  continueAfterRemoteTaskEvent(
    eventId: string
  ): Promise<void>;
}
```

处理要求：

```text
原子 claim event
  → 加载 Binding
  → 加载 Workflow Instance / Node Run
  → 验证节点仍在 WAITING_REMOTE_TASK
  → 验证 Instance 未终止或被新计划替代
  → 映射远程结果为节点输出/错误
  → 创建 continuation attempt
  → 进入正常后继或 error_handler
  → 标记 event processed
```

## 8.3 业务结果路由

| 远程结果 | 本地节点结果 |
|---|---|
| completed + isError=false | 成功，写节点输出，正常后继 |
| completed + isError=true | 业务异常，进入既有 error_handler |
| failed | 远程执行基础失败，进入 error_handler |
| cancelled | 取消路径 |
| input_required | 创建输入请求，等待回答后 tasks/update |
| tools/call 阶段 isError=true，无 taskId | 节点提前异常，不创建 Binding |

## 8.4 幂等

重复轮询、重复通知、Worker 重试、应用重启均不得使同一节点继续两次。

必须使用：

- 数据库唯一约束；
- 事件 claim；
- Workflow/Node expected status；
- version compare-and-set；
- 稳定 idempotency key。

---

# 9. Git 分支、阶段提交与 GitHub 推送

## 9.1 Phase 0 创建分支

先确认稳定基线：

```bash
git fetch --tags origin
git checkout release/v1.0-hardening
git pull --ff-only origin release/v1.0-hardening
git tag --list "v1.0.*-bug-fixed" --sort=-version:refname
```

优先从最新完成并且是 `release/v1.0-hardening` 祖先的 bug-fixed Tag 创建：

```bash
git checkout -b feature/v1.1-mcp-tasks <latest-stable-bug-fixed-tag>
git push -u origin feature/v1.1-mcp-tasks
```

本任务生成时预期为：

```text
v1.0.4-bug-fixed
```

但必须以实际 Git 为准。

若分支已存在：

```bash
git checkout feature/v1.1-mcp-tasks
git pull --ff-only origin feature/v1.1-mcp-tasks
```

不得删除或重建远程同名分支。

## 9.2 每个 Phase 的统一 Git 流程

Phase 开始前：

```bash
git fetch --tags origin
git status --short
```

Phase 完成后：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
# 加上本 Phase 要求的 integration/e2e/migration/build

git add .
git commit -m "<phase commit message>"
git push origin feature/v1.1-mcp-tasks
```

每个 Phase 必须：

- 独立提交；
- 独立报告；
- 推送远程；
- 不得和下一 Phase 压成一个提交；
- 不得只留本地未推送。

## 9.3 推荐提交信息

```text
docs(v1.1): freeze MCP Tasks upgrade baseline
feat(v1.1): add isolated MCP Tasks client adapter
feat(v1.1): persist and reconcile remote MCP tasks
feat(v1.1): validate task availability and time windows
feat(v1.1): continue workflows from remote task events
feat(v1.1): complete task input cancellation and error semantics
test(v1.1): complete MCP Tasks integration acceptance
```

同步 hardening 使用：

```text
merge(hardening): sync v1.0.x-bug-fixed into v1.1
```

## 9.4 Tag 策略

Phase 0～Phase 5 只要求提交和 push，不创建稳定版本 Tag。

Phase 6 全部门禁通过并 merge `v1.0.13-bug-fixed` 后，可创建：

```text
v1.1.0-rc.1
```

稳定 `v1.1.0` Tag 只能指向最终合并后的发布提交，不得提前指向 feature 分支的未审查提交。

---

# 10. 并行 Hardening 冲突治理

## 10.1 同步状态文件

持续维护：

```text
reports/v1.1-mcp-tasks/sync-state.json
```

至少包含：

```json
{
  "currentPhase": "phase-2",
  "lastMergedHardeningTag": "v1.0.4-bug-fixed",
  "lastMergedHardeningSha": "<sha>",
  "lastObservedHardeningSha": "<sha>",
  "blockedFiles": [],
  "updatedAt": "<time>"
}
```

## 10.2 每次检查流程

```bash
git fetch --tags origin

LAST_MERGED=<lastMergedHardeningSha>
git diff --name-only "$LAST_MERGED"..origin/release/v1.0-hardening
```

将 hardening 变化文件与当前 Phase 计划修改文件比较。

## 10.3 冲突判定

以下任一情况视为冲突：

- 修改同一文件；
- 修改同一数据库表或 Migration；
- 修改同一公开 TypeScript 接口；
- 修改同一 Workflow DSL Schema；
- 修改同一状态枚举；
- 修改同一 OpenAPI Schema；
- 修改同一 Adapter/Port；
- hardening 的设计决策会使 v1.1 当前实现失效；
- v1.1 计划依赖的 bug-fixed 尚未完成。

## 10.4 冲突发生后的强制行为

1. 停止修改冲突文件；
2. 保留当前工作，不删除；
3. 创建：

```text
reports/v1.1-mcp-tasks/blockers/YYYYMMDD-<phase>-hardening-conflict.md
```

4. 报告：
   - 当前 v1.1 SHA；
   - 当前 hardening SHA；
   - 进行中的 v1.0.x / bug-fixed；
   - 冲突文件；
   - 冲突符号或数据表；
   - 已完成的非冲突工作；
   - 等待的 Tag；
5. 推送报告和已完成的非冲突提交；
6. 持续执行不冲突的子任务；
7. 不得标记当前 Phase 完成；
8. 等对应 bug-fixed Tag 推送。

## 10.5 bug-fixed 推送后的主动合并

确认 Tag：

```bash
git fetch --tags origin
git merge-base --is-ancestor <bug-fixed-tag> origin/release/v1.0-hardening
```

在 v1.1 分支执行：

```bash
git checkout feature/v1.1-mcp-tasks
git pull --ff-only origin feature/v1.1-mcp-tasks
git merge --no-ff <bug-fixed-tag> \
  -m "merge(hardening): sync <bug-fixed-tag> into v1.1"
```

解决冲突时：

- 以 bug-fixed 行为为新基线；
- 重新应用 v1.1 增量；
- 不允许恢复旧缺陷；
- 不允许删除新增回归测试；
- 不允许降低断言；
- 不允许覆盖 hardening Migration。

随后运行：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:architecture
pnpm verify:migrations
```

根据影响补充 `pnpm verify`。

创建 Merge Checkpoint 报告后推送 merge commit：

```bash
git push origin feature/v1.1-mcp-tasks
```

## 10.6 无直接冲突时的强制同步点

即使没有文件冲突，也必须在以下节点主动 merge 最新完成的 bug-fixed Tag：

- Phase 3 开始前；
- Phase 4 完成后；
- Phase 6 开始前；
- 最终 PR 进入 ready 状态前。

不得把所有 hardening 合并拖到最后一次完成。

## 10.7 Merge Checkpoint 报告模板

```text
reports/v1.1-mcp-tasks/merge-checkpoints/
  YYYYMMDD-<tag>.md
```

内容：

```md
# Hardening Merge Checkpoint

- Source tag:
- Source SHA:
- Source branch:
- Target branch:
- Target pre-merge SHA:
- Merge commit SHA:
- Hardening versions included:
- Files changed:
- Conflicts:
- Resolution:
- Regression tests:
- Full gate:
- Remaining risks:
```

---

# 11. 仓库设计与引用文件

## 11.1 Codex 必须先阅读

```text
AGENTS.md
PLANS.md
PROJECT_STATUS.md
CHANGELOG.md

source/Agent通用模板Server需求规格说明书_V1.0.docx

docs/01_REQUIREMENTS_BASELINE.md
docs/02_ARCHITECTURE_BASELINE.md
docs/03_OPEN_SOURCE_REUSE_STRATEGY.md
docs/05_WORKFLOW_DSL_SPEC.md
docs/06_API_AND_PROTOCOL_CONTRACTS.md
docs/07_DATA_STORAGE_SCHEMA.md
docs/08_SECURITY_AND_RISK.md
docs/09_TEST_AND_ACCEPTANCE_STRATEGY.md
docs/16_DEFINITION_OF_DONE.md
docs/17_TRACEABILITY_MATRIX.md
docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md
docs/20_CONFIGURATION_OPERATIONS_TROUBLESHOOTING.md
docs/21_V1_0_HARDENING_TRACEABILITY.md

docs/SDAR_v1.0.1-v1.0.13_Runtime_Hardening_Codex_Task_Package.md
execplans/EP-08-runtime-hardening-v1.0.1-v1.0.13.md

schemas/workflow-dsl.schema.json
schemas/management-api.openapi.yaml

package.json
pnpm-workspace.yaml
vitest.config.ts
```

同时读取本任务包对应的设计稿：

```text
SDAR_v1.1_MCP_Tasks_升级方案.md
```

并将冻结后的仓库内正式设计保存为：

```text
docs/22_V1_1_MCP_TASKS_DESIGN.md
docs/23_V1_1_MCP_TASKS_PROVIDER_EXTENSION.md
```

若编号已被占用，使用下一个可用编号并更新引用。

## 11.2 已知需要重点审查的代码

当前证据已经确认：

```text
packages/domain/src/workflow.ts
packages/langgraph-runtime/src/bound-value-resolver.ts
```

Phase 0 必须使用以下命令定位剩余真实路径：

```bash
rg -n "mcp_tool|skill_call|subworkflow|parallel|error_handler" packages apps schemas
rg -n "StateGraph|WorkflowCompiler|compileWorkflow|LangGraph" packages apps
rg -n "callTool|tools/call|McpRegistry|MCP" packages apps
rg -n "BullMQ|Queue|Worker|Job" packages apps infra
rg -n "WorkflowControllerService|continueAfterInput|TaskExecutionAttempt" packages apps
rg -n "RuntimeEvent|TaskStateNotifier|waitForChange" packages apps
rg -n "mcp_invocation|workflow_node_run|workflow_instance" packages infra
rg -n "execution_mode|simulation_id" packages apps infra
```

输出：

```text
reports/v1.1-mcp-tasks/00-repository-map.md
reports/v1.1-mcp-tasks/00-symbol-map.json
```

## 11.3 预计修改范围

以实际仓库为准，预计涉及：

```text
packages/domain/
  - Workflow DSL 内部类型
  - Remote MCP Task 内部模型
  - 稳定错误码

packages/application/
  - MCP 调用结果联合处理
  - Task availability readiness
  - Remote Task continuation
  - input/update/cancel orchestration

packages/langgraph-runtime/
  - mcp_tool 节点 WAITING_REMOTE_TASK
  - Task 控制事件重新进入
  - error_handler 路由
  - 不修改 bound-value 安全边界

packages/*mcp*/
  - MCP Tasks Client Adapter
  - Task Schema
  - Availability Provider Extension Adapter
  - execution context Header 传播

packages/*persistence*/
  - RemoteTaskBinding Repository
  - 控制事件 Inbox
  - Migration

packages/*runtime*/
  - BullMQ Poll Queue/Worker
  - 启动 Reconciler
  - Event Dispatcher

apps/server/
  - DI 和启动恢复
  - 运维配置
  - 管理 API

apps/console/
  - Plan 风险提示
  - Task availability/time windows
  - Remote Task 观测和终态展示

schemas/
  - Workflow DSL
  - Management OpenAPI

tests / scripts / examples
  - Mock MCP Tasks Provider
  - Contract、Integration、E2E、Restart、Migration
```

## 11.4 谨慎修改

以下区域可能与 hardening 高度重叠，必须先检查对应 bug-fixed：

```text
Workflow plan confirmation
Task/Goal/WorkflowControl terminal transaction
MCP Tool execution semantics
Task state notifier
A2A input-required
Skill input resolution
Management OpenAPI
Migration sequence
```

## 11.5 明确禁止修改

除非单独 ADR 且用户批准：

```text
LangGraph.js 唯一 Workflow Runtime 的原则
A2A Provider-only 定位
同 context_id 串行规则
Goal Patch 使旧计划失效的规则
Capability Gap 终态规则
MCP Server 真实设备状态权威
现有 released Migration
已推送 bug-fixed 测试和断言
认证/多租户非目标
```

---

# 12. Phase 0 — 基线、分支、设计冻结与冲突地图

## 12.1 目标

建立可复现的 v1.1 并行开发基线，不修改功能代码。

## 12.2 工作

1. 同步远程和 Tags；
2. 确认最新稳定 bug-fixed Tag；
3. 创建或复用 `feature/v1.1-mcp-tasks`；
4. 运行未修改代码的基线；
5. 统计：
   - branch/head SHA；
   - package version；
   - Node/pnpm；
   - MCP SDK；
   - LangGraph；
   - BullMQ；
   - Migration 最大编号；
   - 测试数量；
6. 生成仓库路径和符号地图；
7. 对比当前 hardening active phase；
8. 创建 v1.1 ExecPlan；
9. 创建 ADR：
   - MCP Tasks Client Adapter 隔离；
   - Provider authority 与 restricted 语义；
   - Task timing、availability windows 和 business terminal；
   - 事件回注不用 LangGraph interrupt/resume；
10. 将正式设计稿和 Provider 扩展契约写入 docs；
11. 创建 draft PR，目标暂指向 `release/v1.0-hardening`，用于持续 CI 和代码可见性；
12. 不将 draft PR 标为 ready。

## 12.3 交付

```text
execplans/EP-09-v1.1-mcp-tasks.md
# 若 EP-09 已存在，选择下一个编号

adr/ADR-xxx-mcp-tasks-client-boundary.md
adr/ADR-xxx-provider-task-authority.md
adr/ADR-xxx-mcp-task-time-and-availability.md
adr/ADR-xxx-remote-task-continuation.md

docs/22_V1_1_MCP_TASKS_DESIGN.md
docs/23_V1_1_MCP_TASKS_PROVIDER_EXTENSION.md

reports/v1.1-mcp-tasks/00-baseline.md
reports/v1.1-mcp-tasks/00-baseline.json
reports/v1.1-mcp-tasks/00-repository-map.md
reports/v1.1-mcp-tasks/00-symbol-map.json
reports/v1.1-mcp-tasks/00-hardening-overlap-map.md
reports/v1.1-mcp-tasks/sync-state.json
```

## 12.4 门禁

```bash
pnpm install --frozen-lockfile
pnpm verify
```

基线失败时停止。

## 12.5 提交

```text
docs(v1.1): freeze MCP Tasks upgrade baseline
```

提交后立即 push。

---

# 13. Phase 1 — MCP Tasks 协议适配与联合返回

## 13.1 目标

在不依赖不稳定高层 API 的情况下，实现隔离的 MCP Tasks 客户端协议层。

## 13.2 工作

1. 增加内部稳定类型；
2. 增加固定 Schema；
3. 增加 capability negotiation；
4. 扩展 `tools/call` 返回识别：
   - immediate result；
   - remote task；
   - business rejection；
5. 实现：
   - `tasks/get`
   - `tasks/update`
   - `tasks/cancel`
6. 保持 simulation/historical-replay Header；
7. 不向 domain 泄漏 MCP SDK 类型；
8. 增加 Mock Provider：
   - sync_success
   - async_success
   - rejected_without_task
9. 对 unknown fields 和 malformed response fail closed；
10. 记录当前协议 revision。

## 13.3 接口验收

```ts
type McpInvocationOutcome =
  | {
      kind: "immediate";
      result: InternalToolResult;
    }
  | {
      kind: "remote_task";
      task: RemoteTaskCreated;
    };
```

调用阶段拒绝仍属于 `immediate` 的 `isError=true` 结果，不创建 Binding。

## 13.4 测试

- 普通 Tool 不受影响；
- Task Provider 返回 Task；
- Provider 未声明 Tasks 时拒绝 Task 结果；
- malformed taskId；
- 未知 status；
- Header 传播；
- schema revision；
- SDK 类型隔离 architecture test；
- rejected 不创建 taskId。

## 13.5 门禁

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm verify:architecture
pnpm build
```

## 13.6 提交

```text
feat(v1.1): add isolated MCP Tasks client adapter
```

提交后立即 push。

---

# 14. Phase 2 — RemoteTaskBinding、BullMQ 轮询与重启恢复

## 14.1 目标

可靠保存远程 Task 引用、轮询状态并在 SDAR 重启后继续获取远程结果。

## 14.2 前置同步

开始前必须 fetch。

若 hardening 已完成新的 bug-fixed，主动 merge 最新稳定 Tag。

Migration 编号必须重新检查。

## 14.3 工作

1. 新增 RemoteTaskBinding Repository；
2. 新增 Control Event Inbox；
3. 观测事件复用 runtime_event 或增加轻量表；
4. 新增 Forward Migration；
5. 新增 BullMQ Poll Queue；
6. 新增 Poll Worker；
7. 新增 Startup Reconciler；
8. 新增周期 Reconciler；
9. 实现数据库与队列之间的补偿；
10. Provider 不可达时退避；
11. 终态后停止轮询；
12. `input_required` 停止普通轮询或按 Provider 建议低频检查；
13. 保存 execution mode 和 simulation ID；
14. 不恢复整个 A2A Task；
15. 不重放本地副作用。

## 14.4 重试要求

- tasks/get 网络失败：可重试；
- Schema 错误：进入告警/隔离，不篡改远程状态；
- 数据库状态冲突：CAS 重读；
- 同一 job 重复：幂等；
- 死信：可管理查询和人工恢复；
- 不得无限热循环。

## 14.5 测试

- Binding 唯一性；
- 重复 Task 创建结果；
- Poll Job 丢失；
- Worker 崩溃；
- Redis 清空；
- 进程重启；
- Provider 临时不可达；
- Provider 恢复；
- 终态停止；
- 过期 job；
- simulation/replay context 保留；
- Migration 空库和升级库。

## 14.6 门禁

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm verify:migrations
pnpm build
```

## 14.7 提交

```text
feat(v1.1): persist and reconcile remote MCP tasks
```

提交后立即 push。

---

# 15. Phase 3 — DSL 可用性、可用时间窗口与风险决策

## 15.1 强制同步点

Phase 3 开始前必须 merge 最新完成的 hardening bug-fixed Tag。

若当前 hardening 正在实现 v1.0.5 或 v1.0.11，且将修改确认或 MCP Tool metadata 核心文件：

- 暂停重叠子任务；
- 等 bug-fixed；
- merge 后继续。

## 15.2 目标

Skill 生成 DSL 后，检查 Task 操作在目标启动时间的可用性和可用窗口，使 LLM 能继续、改期、替换、确认或放弃。

## 15.3 工作

1. 为 task-capable/task-required MCP Tool 建立 readiness port；
2. 批量查询 Provider；
3. 支持：
   - available
   - restricted
   - disabled
   - unknown
4. restricted 支持：
   - earliestStartTime
   - nextAvailableWindows
   - validUntil
   - reservationMode
   - reservationRef
   - estimatedDelayMs
5. 增加 timing DSL；
6. 解析动态 scheduledAt；
7. 保存参数和 timing 不可变快照；
8. 生成 DslExecutionReadiness；
9. 增加 LLM 结构化风险决策；
10. 增加 Policy Guard；
11. restricted 风险进入 Plan Confirmation；
12. disabled 硬阻断；
13. 节点执行前刷新可用性；
14. restricted 仍可调用，由 Provider 最终判断；
15. Console/API 展示窗口和预测有效期。

## 15.4 不允许

- DSL 检查阶段申请设备锁；
- DSL 检查阶段暂停远程 Task；
- 把 best_effort 窗口展示为 guaranteed；
- 让 LLM 覆盖 disabled；
- 将 Provider 预测保存为真实设备状态权威；
- 重复实现 v1.0.11 的通用 Tool Semantics。

## 15.5 测试

- available；
- restricted + earliest；
- restricted + multiple windows；
- restricted 无窗口；
- validUntil 过期；
- best_effort；
- guaranteed 无 reservationRef 被拒绝；
- disabled；
- unknown；
- LLM 选择改期；
- 非法 scheduledAt；
- startToleranceMs 边界；
- maxElapsedMs null；
- 风险进入确认；
- 执行前状态改变；
- 参数不同导致可用性不同。

## 15.6 门禁

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:management-openapi
pnpm build
```

## 15.7 提交

```text
feat(v1.1): validate task availability and time windows
```

提交后立即 push。

---

# 16. Phase 4 — WAITING_REMOTE_TASK 与控制事件回注

## 16.1 目标

远程 Task 创建后，当前执行分支安全等待；终态或 input_required 到达时只继续绑定节点的后续路径。

## 16.2 工作

1. 为 `mcp_tool` 节点增加等待远程 Task 语义；
2. 保存 Binding 后才允许当前图轮次退出；
3. Binding 保存失败时：
   - 不得假装节点等待成功；
   - 尽可能取消已创建远程 Task；
   - 记录不确定执行告警；
4. 增加 continuation application service；
5. 增加 TaskControlEvent claim；
6. 重新加载不可变 Workflow Definition 和 Instance；
7. 验证 Plan/Instance/Node 未失效；
8. 创建新的 continuation attempt；
9. completed success 进入正常后继；
10. completed isError 进入 error_handler；
11. failed/cancelled 进入既有异常路径；
12. pause/resume/progress 不重新进入；
13. 重复终态只处理一次；
14. Parent Task/Workflow 已终止时不继续；
15. Goal Patch 已替换旧计划时关闭旧 Binding；
16. 并行分支仍按现有 LangGraph 语义运行。

## 16.3 强制同步点

Phase 4 完成后 merge 最新 hardening bug-fixed。

特别检查 v1.0.6 权威终态一致性；不能让远程 Task continuation 绕过事务提交。

## 16.4 测试

- async Task 创建后节点等待；
- 同一 parallel 其他分支继续；
- pause 事件不增加 Graph Run；
- resume 事件不增加 Graph Run；
- progress 不增加 Graph Run；
- completed 只回注一次；
- failed；
- cancelled；
- completed isError；
- Goal Patch 后旧 Task 完成；
- Parent Workflow 已取消；
- 重启后终态发现；
- Binding 保存失败；
- Task 创建成功但客户端断线；
- 多个并行 Task 独立完成。

## 16.5 门禁

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:architecture
pnpm build
```

## 16.6 提交

```text
feat(v1.1): continue workflows from remote task events
```

提交后立即 push。

---

# 17. Phase 5 — Input、Cancel、拒绝与时间业务终态

## 17.1 目标

完成 MCP Task 控制接口和全部业务异常语义。

## 17.2 工作

### input_required

- 将远程输入请求映射到现有 TaskInputRequest；
- 保存 remoteTaskId、bindingId、workflowNodeRunId；
- 回答后调用 `tasks/update`；
- Provider 回到 working 后继续轮询；
- 重复回答幂等或冲突；
- 过期输入拒绝；
- Parent Task 已取消时拒绝更新。

### cancel

- Parent A2A Task 或 Workflow 取消时调用 `tasks/cancel`；
- cooperative cancel 不得立即伪造远程 cancelled；
- 继续查询直到 Provider 返回终态或通信不可达；
- 记录 cancel requested 与 confirmed 的区别。

### 调用阶段拒绝

```text
tools/call
  → CallToolResult.isError=true
  → outcome=admission_rejected
  → 无 taskId
  → 不创建 Binding
  → 当前节点提前异常
  → error_handler / 下一节点
```

### 预约启动窗口错过

```text
Task completed
  → result.isError=true
  → outcome=start_window_missed
```

### 最大墙钟时间到达

```text
Task completed
  → result.isError=true
  → outcome=deadline_reached
```

SDAR 不计算这两个时间，也不生成该结果。

## 17.3 结构化业务结果

至少支持：

```text
success
admission_rejected
start_window_missed
deadline_reached
partial_completion
business_failure
```

要求稳定 reasonCode、retryable、partialResult 和 alternatives。

## 17.4 测试

- input_required 一次；
- input_required 多轮；
- update Schema；
- 重复回答；
- cancel requested；
- cancel confirmed；
- cancel 网络失败；
- 调用阶段 rejected 无 Binding；
- start_window_missed；
- deadline_reached；
- partial result；
- completed isError 进入现有 error_handler；
- failed 与 completed business error 不混淆；
- maxElapsedMs 不在 SDAR 建 Timer；
- Provider 不可达不产生 deadline_reached。

## 17.5 门禁

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm build
```

## 17.6 提交

```text
feat(v1.1): complete task input cancellation and error semantics
```

提交后立即 push。

---

# 18. Phase 6 — 最终 Hardening 合并、完整验收和 PR

## 18.1 前置条件

默认必须等待：

```text
v1.0.13-bug-fixed
```

已推送并且属于 `release/v1.0-hardening`。

然后：

```bash
git fetch --tags origin
git checkout feature/v1.1-mcp-tasks
git pull --ff-only origin feature/v1.1-mcp-tasks
git merge --no-ff v1.0.13-bug-fixed \
  -m "merge(hardening): sync v1.0.13-bug-fixed into v1.1"
```

解决全部冲突并运行完整门禁。

## 18.2 完整 Mock Provider 场景

必须有可运行的测试 Provider：

```text
sync_success
task_success
task_business_failure
task_protocol_failure
task_cancelled
task_input_required
task_multi_input
task_restricted_accept
task_restricted_reject
task_scheduled_success
task_start_window_missed
task_deadline_reached
task_pause_resume_observation
task_provider_unreachable
task_malformed_response
task_duplicate_terminal
```

## 18.3 全链路验收

```text
Skill
→ DSL
→ Task availability/time windows
→ LLM risk decision
→ Plan confirmation
→ LangGraph
→ mcp_tool
→ CreateTaskResult
→ RemoteTaskBinding
→ BullMQ polling
→ Provider observation
→ terminal/input event
→ continuation
→ result/error handler
→ Goal evaluation
→ A2A result
```

## 18.4 完整门禁

```bash
pnpm verify
pnpm demo:local
pnpm demo:acceptance
```

另外必须记录：

```bash
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:migrations
pnpm verify:management-openapi
pnpm verify:architecture
pnpm build
pnpm smoke
```

若 `pnpm verify` 已包含，报告仍需列出各阶段结果。

## 18.5 文档

更新：

```text
README.md
CHANGELOG.md
PROJECT_STATUS.md

docs/02_ARCHITECTURE_BASELINE.md
docs/05_WORKFLOW_DSL_SPEC.md
docs/06_API_AND_PROTOCOL_CONTRACTS.md
docs/07_DATA_STORAGE_SCHEMA.md
docs/08_SECURITY_AND_RISK.md
docs/09_TEST_AND_ACCEPTANCE_STRATEGY.md
docs/16_DEFINITION_OF_DONE.md
docs/17_TRACEABILITY_MATRIX.md
docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md
docs/20_CONFIGURATION_OPERATIONS_TROUBLESHOOTING.md
docs/22_V1_1_MCP_TASKS_DESIGN.md
docs/23_V1_1_MCP_TASKS_PROVIDER_EXTENSION.md
```

## 18.6 最终报告

```text
reports/v1.1-mcp-tasks/FINAL_REPORT.md
reports/v1.1-mcp-tasks/FINAL_TRACEABILITY.md
reports/v1.1-mcp-tasks/FINAL_TEST_RESULTS.md
reports/v1.1-mcp-tasks/FINAL_HARDENING_MERGE.md
reports/v1.1-mcp-tasks/FINAL_KNOWN_LIMITATIONS.md
```

## 18.7 版本和提交

最终将 package version 更新为：

```text
1.1.0
```

提交：

```text
test(v1.1): complete MCP Tasks integration acceptance
```

push 后创建：

```text
v1.1.0-rc.1
```

## 18.8 PR

如果 v1.0 hardening 已经合并到 `main`：

```text
feature/v1.1-mcp-tasks → main
```

如果尚未合并：

- Draft PR 可以继续指向 `release/v1.0-hardening`；
- 不得标记 ready；
- 等 hardening 合并 main 后，先同步 main；
- 重新运行完整门禁；
- 将 PR base 调整为 main。

PR 标题：

```text
release: SDAR v1.1 MCP Tasks client runtime
```

不得绕过分支保护，不得 force merge。

稳定 `v1.1.0` Tag 只在 PR 合并后的发布提交上创建。

---

# 19. 统一测试矩阵

## 19.1 同步兼容

| 场景 | 预期 |
|---|---|
| 普通同步 MCP Tool | 行为与 v1.0 一致 |
| 同步业务错误 | 进入 error_handler |
| Provider 不支持 Tasks | 不启用远程 Task 路径 |
| Task-capable Tool 同步返回 | allow_task 接受 |
| require_task 同步返回 | 稳定契约错误 |

## 19.2 Availability

| 场景 | 预期 |
|---|---|
| available | ready |
| restricted + earliestStartTime | LLM 可改期 |
| restricted + windows | LLM 可选窗口 |
| restricted + best_effort | 显示非保证 |
| guaranteed 无 reservationRef | 校验失败 |
| disabled | 硬阻断 |
| unknown | 保守策略 |
| validUntil 已过期 | 执行前刷新 |

## 19.3 Task 生命周期

| 场景 | 图行为 |
|---|---|
| working | 保持 WAITING_REMOTE_TASK |
| paused observation | 不重新进入 |
| resumed observation | 不重新进入 |
| progress | 不重新进入 |
| input_required | 进入输入流程 |
| completed success | 正常后继 |
| completed isError | error_handler |
| failed | 失败路径 |
| cancelled | 取消路径 |

## 19.4 时间

| 场景 | 权威方 | 结果 |
|---|---|---|
| immediate 可启动 | Provider | Task working |
| immediate 被拒绝 | Provider | 无 taskId，CallToolResult error |
| scheduled 尚未到时 | Provider | working/scheduled observation |
| 启动窗口错过 | Provider | completed + start_window_missed |
| maxElapsed 到达 | Provider | completed + deadline_reached |
| pause 超过很久 | Provider | SDAR 不自行结束 |
| Provider 不可达 | SDAR Poller | 重试和告警，不造终态 |

## 19.5 可靠性

- 重复 Task 创建结果；
- 重复终态；
- 轮询 Worker 重试；
- Redis 清空；
- PostgreSQL 重启；
- SDAR 重启；
- Provider 短暂不可达；
- Provider 长期不可达；
- Node Run 已失效；
- Goal Patch；
- Workflow 已取消；
- Parent A2A Task 已终态；
- 数据库事件保存成功但队列失败；
- 队列成功但数据库事务回滚；
- Migration rollback/reapply；
- 陈旧 Worker；
- 并行多个 Remote Task。

---

# 20. Phase 报告统一要求

每个 Phase 新增：

```text
reports/v1.1-mcp-tasks/phase-N/
  implementation.md
  test-results.md
  changed-files.md
  hardening-sync.md
  known-issues.md
```

报告必须记录：

- 开始 SHA；
- 结束 SHA；
- hardening 最新观察 SHA；
- 上次 merge Tag；
- 本阶段修改文件；
- 测试命令；
- 真实结果；
- 已知限制；
- 未验证项；
- commit SHA；
- GitHub push 结果；
- 是否允许继续。

---

# 21. 阻塞报告模板

```md
# v1.1 Hardening Conflict Blocker

## Context
- Phase:
- v1.1 branch:
- v1.1 SHA:
- hardening branch:
- hardening SHA:
- active hardening version:
- awaited bug-fixed tag:

## Conflict
- Files:
- Symbols/tables/contracts:
- Why the changes cannot safely proceed in parallel:

## Work preserved
- Completed non-conflicting changes:
- Commit/push:

## Required resolution
- Expected bug-fixed behavior:
- Merge command after tag:
- Regression tests:

## Resume condition
- Tag exists:
- Tag is ancestor of release/v1.0-hardening:
- Merge completed:
- Tests passed:
```

---

# 22. 设计禁止项

本任务明确不做：

- 通用 MCP Tasks Server；
- MCP Provider 内部 Task Scheduler；
- 设备资源锁；
- Capability Registry；
- 资源类型和能力本体；
- 跨 Provider 资源冲突仲裁；
- 世界状态中心；
- Skill 静态互斥矩阵；
- 行为树 Runtime；
- 第二套 Workflow Runtime；
- 每个并行分支独立 LangGraph 的大规模重构；
- LangGraph interrupt/resume 业务流程；
- SDAR 业务 maxElapsed Timer；
- SDAR 自行暂停/恢复远程 Task；
- SDAR 自行判定物理资源释放；
- 把 pause/resume 变成 MCP Task 标准状态；
- 把业务 deadline 当成 Task failed；
- 在 Memory 中保存动态远程 Task 状态为长期权威事实；
- 依赖未锁定的 MCP Tasks 高层 Beta API；
- 修改已发布 hardening Migration；
- 覆盖并行 bug-fixed 修复。

---

# 23. Codex 完成判定

只有以下条件全部满足，才能宣告 v1.1 完成：

1. Phase 0～6 均有独立提交和 GitHub push；
2. 所有阶段报告完整；
3. MCP SDK 类型没有泄漏出 Adapter；
4. 同步 MCP Tool 行为未回归；
5. RemoteTaskBinding 可持久化和重启恢复；
6. Poller 使用 BullMQ，不依赖单进程 Timer；
7. pause/resume 只作为观测；
8. restricted 调用由 Provider 最终仲裁；
9. Provider 拒绝时不创建 Binding；
10. available windows 能进入 LLM 改期决策；
11. start_window_missed 和 deadline_reached 由 Provider 返回 completed business error；
12. SDAR 不维护 Task 业务计时；
13. input/update/cancel 完整；
14. 终态回注幂等；
15. Simulation/Replay context 保持；
16. Migration 空库和升级库通过；
17. Console/API/文档完整；
18. `pnpm verify`、两个 Demo 全部通过；
19. 已 merge `v1.0.13-bug-fixed`；
20. 最终 PR 已创建且未绕过保护；
21. Traceability 中每项有实现和测试证据。

---

# 24. Codex 启动提示词

```text
请在 zhouwen-giser/skill-driven-agent-runtime 仓库中，严格执行《SDAR v1.1 MCP Tasks Codex 并行升级任务包》。

当前已知状态：
- release/v1.0-hardening 已完成 v1.0.4-bug-fixed；
- v1.0.5～v1.0.13 仍在并行开发；
- v1.1 必须使用独立 feature/v1.1-mcp-tasks 分支；
- 每个 Phase 必须独立 commit 并立即 push GitHub；
- 不得修改 hardening 分支。

开始前：
1. 阅读 AGENTS.md、PLANS.md、架构、DSL、协议、存储、测试、追踪矩阵、hardening 任务包和本任务包；
2. git fetch --tags origin；
3. 确认最新稳定 v1.0.x-bug-fixed Tag；
4. 创建或复用 feature/v1.1-mcp-tasks；
5. 运行未修改基线 pnpm verify；
6. 生成基线、仓库符号地图、hardening overlap map、ExecPlan 和 ADR；
7. 基线失败则停止并输出报告。

冻结设计：
- Skill 生成 Workflow DSL，DSL 编译为现有 LangGraph；
- parallel 仍由现有图机制实现；
- MCP Task 是 mcp_tool 调用的异步结果，默认不新增新节点类型；
- SDAR 只实现 MCP Tasks Client、Binding、可靠轮询、input/cancel 和事件回注；
- Provider 负责 available/restricted/disabled、资源仲裁、预约、抢占、暂停恢复和 maxElapsed；
- restricted 的可用性检查必须返回可用时间信息供 LLM 改期；
- pause/resume/progress 只记录观测，不重新进入图；
- 只有 input_required/completed/failed/cancelled 回注图；
- start_window_missed 和 deadline_reached 是 completed + isError=true；
- SDAR 不维护远程 Task 业务执行态和 maxElapsed Timer；
- 不使用 LangGraph interrupt/resume；
- BullMQ 负责可靠 tasks/get 调度和重启恢复。

严格按 Phase 0～6 实施。

每个 Phase 开始和提交前：
- git fetch --tags origin；
- 检查 release/v1.0-hardening 新提交和 Tag；
- 比较当前 Phase 修改文件与 hardening 修改文件。

如冲突：
- 立即暂停冲突子任务；
- 非冲突任务可继续；
- 创建并 push blocker 报告；
- 等对应 bug-fixed Tag；
- 主动 git merge --no-ff 该稳定 Tag；
- 保留 bug-fixed 修复；
- 重新运行回归；
- push merge commit；
- 再继续。

禁止 amend、rebase 已推送提交、force push、覆盖 hardening 修复、修改旧 Migration、降低测试、伪造终态或测试结果。

Phase 6 默认必须等待并 merge v1.0.13-bug-fixed，运行 pnpm verify、pnpm demo:local、pnpm demo:acceptance，生成最终报告和 v1.1.0-rc.1，创建受保护 PR。稳定 v1.1.0 Tag 只能指向最终合并提交。
```
