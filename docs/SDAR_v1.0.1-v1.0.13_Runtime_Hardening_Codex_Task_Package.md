# SDAR v1.0.1～v1.0.13 Runtime Hardening
## Codex 连续修复、提交、Tag 与远程推送任务包

**仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
**基线分支：** `main`  
**实施分支：** `release/v1.0-hardening`  
**任务性质：** 连续 13 个小版本的执行内核加固  
**后续路线：** v1.1 MCP Tasks → v1.2 Experience Instrumentation → v2 Experience Foundation  
**核心定位：** Skill 驱动的 A2A Task Runtime，而不是终端用户聊天系统

---

# 0. Codex 总指令

你需要在当前 Git 仓库中依次完成：

```text
v1.0.1
v1.0.1-bug-fixed
v1.0.2
v1.0.2-bug-fixed
...
v1.0.13
v1.0.13-bug-fixed
```

每个功能版本完成后必须：

1. 更新代码、测试、文档、版本号和 CHANGELOG；
2. 运行该版本要求的最小门禁；
3. 创建一个独立功能提交；
4. 创建 annotated tag；
5. 推送 `release/v1.0-hardening`；
6. 推送该版本 tag；
7. 立即进入对应的 `bug-fixed` 阶段；
8. 修复该阶段发现的问题；
9. 创建独立 bug-fixed 提交；
10. 创建对应 annotated tag；
11. 再次推送分支和 tag；
12. 才能开始下一个功能版本。

禁止：

- 在已经推送的提交上 amend；
- rebase 已经推送的版本提交；
- force push；
- 删除失败测试；
- 降低断言；
- 用 Mock 替代要求的真实实现；
- 修改旧 Migration；
- 在版本未完成时跳到后续版本；
- 在当前任务中提前实现 MCP Tasks；
- 在当前任务中提前实现 v1.2 Experience Event Store；
- 把上游 Agent 的设备冲突调度职责塞入 SDAR；
- 把 MCP 掌握的真实设备状态复制为 SDAR 权威状态。

只有以下情况允许停止：

- 基线 `pnpm verify` 在未修改代码时失败；
- Git 远程写权限不足；
- 分支或 Tag 被保护且无法推送；
- 当前仓库与任务包存在无法通过适配解决的根本冲突。

出现阻塞时必须输出阻塞报告，不得假装完成。

---

# 1. 已锁定的系统边界

## 1.1 A2A Task 来源

A2A Task 由上游 Agent 发起，不把 SDAR 设计为面向终端用户的通用聊天系统。

结构化 A2A Follow-up 是合法且优先的控制接口。

## 1.2 权威职责

```text
上游 Agent
  ├─ 生成 A2A Task
  ├─ 处理跨任务、跨设备冲突
  ├─ 决定任务优先级
  └─ 在 capability gap 后决定何时重新提交任务

SDAR
  ├─ 接收和管理 A2A Task
  ├─ Goal 解析与推进
  ├─ Skill 选择、组合和版本绑定
  ├─ Workflow 规划、确认、执行、重规划
  ├─ 调用 MCP Tools
  ├─ 处理 Task / Goal / Workflow 生命周期
  ├─ 根据 Skill 流程评估 Goal
  └─ 保存运行事实、结果和经验

MCP Server
  ├─ 掌握设备真实运行状态
  ├─ 提供状态查询工具
  ├─ 提供设备控制工具
  ├─ 校验操作前提
  ├─ 提供命令回执和状态查询
  ├─ 提供取消、对账和补偿工具
  └─ 后续负责识别 simulation / historical-replay 请求
```

## 1.3 非目标

本加固包不实现：

- 设备级资源锁；
- 世界状态中心；
- 跨任务冲突仲裁；
- 用户租户隔离；
- 通用自然语言聊天路由；
- MCP Tasks；
- MCP Server 内部状态机；
- v1.2 Experience Event Store；
- 强制向后兼容；
- 旧数据自动迁移适配。

---

# 2. Git 与发布规则

## 2.1 创建长期分支

开始前执行：

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git status --short
git checkout -b release/v1.0-hardening
git push -u origin release/v1.0-hardening
```

若分支已存在：

```bash
git fetch origin
git checkout release/v1.0-hardening
git pull --ff-only origin release/v1.0-hardening
```

不得删除或重建远程同名分支。

## 2.2 基线报告

在修改任何代码前运行：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

保存：

```text
reports/v1.0-hardening/00-baseline.md
reports/v1.0-hardening/00-baseline.json
```

至少记录：

- 基线 commit SHA；
- Node 和 pnpm 版本；
- PostgreSQL/Redis/Docker 环境；
- `pnpm verify` 结果；
- 现有测试数量；
- 当前 Migration 最大序号；
- 当前 package version；
- 当前公开 API 和 DSL Schema 摘要。

基线失败时停止，不进入版本修复。

## 2.3 功能版本提交

示例：

```bash
git add .
git commit -m "feat(v1.0.1): add workflow runtime data binding"
git tag -a v1.0.1 -m "SDAR v1.0.1 workflow runtime data binding"
git push origin release/v1.0-hardening
git push origin v1.0.1
```

功能提交要求：

- 功能核心验收通过；
- TypeScript 编译通过；
- 相关测试通过；
- 允许存在已经明确记录的非阻塞缺陷；
- 不允许保留会破坏数据或导致明显错误执行的已知 P0 缺陷。

## 2.4 Bug-fixed 提交

示例：

```bash
git add .
git commit -m "fix(v1.0.1): harden workflow runtime data binding"
git tag -a v1.0.1-bug-fixed -m "SDAR v1.0.1 bug-fixed"
git push origin release/v1.0-hardening
git push origin v1.0.1-bug-fixed
```

若未发现需要修改代码的 Bug，也必须：

1. 增加 bug-fixed 验证报告；
2. 增加边界测试或回归证据；
3. 创建一个独立提交；
4. 创建 `v1.0.x-bug-fixed` Tag。

可使用：

```text
chore(v1.0.x): complete bug-fixed verification
```

## 2.5 项目版本号

功能版本修改：

```json
{
  "version": "1.0.x"
}
```

Bug-fixed 阶段不改变 SemVer，仍保持 `1.0.x`。

`v1.0.x-bug-fixed` 只作为 Git Tag 和验证阶段标识。

## 2.6 每三个版本的完整门禁

在以下 bug-fixed 阶段运行完整：

```text
v1.0.3-bug-fixed
v1.0.6-bug-fixed
v1.0.9-bug-fixed
v1.0.12-bug-fixed
v1.0.13-bug-fixed
```

必须运行：

```bash
pnpm verify
```

其他版本至少运行：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
```

并运行该版本指定的集成/E2E 测试。

## 2.7 Migration 规则

允许破坏性新版本演进，但：

- 不修改现有 Migration；
- 只新增后续 Forward Migration；
- 当前基线若仍以 `0053` 为最新版本，则从 `0054` 开始；
- Codex 必须先重新检查实际最大序号；
- 开发和测试环境允许重建数据库；
- 不为旧 Skill、旧 Plan 和旧运行数据编写兼容层；
- Migration 路径测试必须保持通过。

---

# 3. 每个版本统一交付物

每个 `v1.0.x` 新增：

```text
reports/v1.0-hardening/v1.0.x/implementation.md
reports/v1.0-hardening/v1.0.x/test-results.md
reports/v1.0-hardening/v1.0.x/changed-files.md
reports/v1.0-hardening/v1.0.x/known-issues.md
```

每个 bug-fixed 新增：

```text
reports/v1.0-hardening/v1.0.x/bug-fixed.md
reports/v1.0-hardening/v1.0.x/bug-fixed-test-results.md
```

持续维护：

```text
CHANGELOG.md
docs/17_TRACEABILITY_MATRIX.md
docs/21_V1_0_HARDENING_TRACEABILITY.md
```

追踪矩阵至少包含：

```text
版本
问题
设计决策
实现文件
Migration
测试文件
功能提交 SHA
功能 Tag
Bug-fixed 提交 SHA
Bug-fixed Tag
门禁结果
已知限制
```

---

# 4. v1.0.1 — Workflow 动态数据绑定

## 4.1 目标

让后续节点能够使用：

- Workflow 初始输入；
- 前序 LLM 输出；
- 前序 MCP 输出；
- 前序 Skill 输出；
- 循环和条件状态；
- 错误信息。

必须能够表达真实的：

```text
query_device_state
→ control_device(deviceId, target)
→ query_command_status(commandId)
→ verify_device_state(deviceId)
```

## 4.2 当前问题

当前 MCP `arguments`、Skill `input`、LLM `instruction` 和 Subworkflow 输入主要是静态定义，运行时未统一解析前序节点输出。

## 4.3 目标设计

新增统一递归绑定模型，例如：

```ts
type WorkflowBoundValue =
  | string
  | number
  | boolean
  | null
  | readonly WorkflowBoundValue[]
  | Readonly<Record<string, WorkflowBoundValue>>
  | Readonly<{
      op: "ref";
      path: readonly string[];
    }>;
```

解析范围：

```text
input
nodes.<nodeId>
outputs.<nodeId>
errors.<nodeId>
loopCounts.<nodeId>
result
```

建议 DSL 调整：

```ts
interface LlmWorkflowNode {
  instruction: string;
  context?: WorkflowBoundValue;
}

interface McpToolWorkflowNode {
  arguments: WorkflowBoundValue;
}

interface SkillCallWorkflowNode {
  input: WorkflowBoundValue;
}

interface SubworkflowNode {
  input: WorkflowBoundValue;
}
```

## 4.4 运行时要求

- 在节点执行前递归解析；
- 解析后生成不可变快照；
- 缺失引用使用稳定错误码；
- MCP 参数在解析后再次按当前 MCP Schema 校验；
- 子 Skill 输入在解析后按 Skill input schema 校验；
- LLM 获得静态 instruction + 动态 context；
- Subworkflow 使用解析后的 input，不再固定传父初始输入；
- 不允许任意代码执行；
- 不允许 JSONPath/Javascript 表达式；
- 只支持受限引用。

## 4.5 必测场景

- MCP 参数引用初始输入；
- MCP 参数引用上一个 MCP 输出；
- 嵌套 Object/Array 引用；
- LLM context 引用多个节点；
- Skill input 引用前序结果；
- Subworkflow input 引用节点输出；
- 缺失引用；
- 运行时 Schema 失败；
- 并行分支结果汇合；
- 循环中引用当前输出；
- 引用对象在后续修改后不影响快照。

## 4.6 版本门禁

相关 Unit + Contract + LangGraph Unit + Workflow E2E。

## 4.7 Bug-fixed 阶段重点

- 深层嵌套；
- 空数组和 null；
- 引用到错误对象；
- 并行输出覆盖；
- 原始参数对象不可变；
- 错误路径可读性。

## 4.8 提交

```text
feat(v1.0.1): add workflow runtime data binding
fix(v1.0.1): harden workflow runtime data binding
```

---

# 5. v1.0.2 — `skill_call` 执行真实子 Skill

## 5.1 目标

`skill_call` 不得再退化为“调用一次 LLM 伪造子 Skill 输出”。

必须真实执行：

```text
加载子 Skill
→ 校验输入
→ 生成子 Workflow
→ 校验子 Workflow
→ 执行子 Workflow
→ 调用需要的 MCP Tools
→ 处理子结果
→ 保存父子关系
→ 返回父 Workflow
```

## 5.2 实施要求

重构 `SkillCallWorkflowService`：

- 注入 Workflow Planner；
- 注入 Workflow Validator；
- 注入 Tool planning metadata；
- 使用子 Skill：
  - description
  - workflowGuidance
  - inputSchema
  - outputSchema
  - toolPolicy
  - runtimePolicy
- 创建独立 child plan；
- 创建独立 child instance；
- 记录实际 Skill Version；
- 子执行使用 v1.0.1 的动态输入；
- 子结果必须通过 output schema；
- 父节点只接收真实子执行结果；
- 子执行失败不能返回模型伪造成功结果。

## 5.3 已知阶段依赖

完整确认策略将在 v1.0.5 修复。

v1.0.2 功能版本必须在报告中明确记录：

```text
Nested confirmation policy will be finalized in v1.0.5.
```

但不得继续保留 LLM-only 假执行。

## 5.4 必测场景

- 子 Skill 调用真实 MCP；
- 子 Skill 输入 Schema 拒绝；
- 子 Skill 输出 Schema 拒绝；
- 子 Workflow 失败；
- 父子 Instance 关联；
- 父取消传播到子执行；
- 子 Skill 当前版本被记录；
- 子 Skill MCP 调用出现在审计中；
- 多层 skill_call 深度限制；
- 循环依赖检测。

## 5.5 Bug-fixed 阶段重点

- 父子异常传播；
- 子计划保存失败；
- 子执行取消；
- 子执行结果过大；
- 同一父节点重复进入；
- 递归 Skill 调用。

## 5.6 提交

```text
feat(v1.0.2): execute skill_call through real child workflows
fix(v1.0.2): harden child skill workflow execution
```

---

# 6. v1.0.3 — A2A `input-required` 补充输入与继续执行

## 6.1 目标

实现完整闭环：

```text
SDAR 请求输入
→ 上游 Agent provide_input
→ 保存补充输入
→ 绑定原等待请求
→ 创建新的执行尝试
→ 同 Context 串行继续
→ Goal / Plan / Control 使用新输入
```

## 6.2 数据模型

新增等价模型：

```ts
interface TaskInputRequest {
  inputRequestId: string;
  taskId: string;
  contextId: string;
  source: "goal_deliberation" | "goal_evaluation" | "workflow";
  question: string;
  status: "waiting" | "answered" | "expired" | "canceled";
  createdAt: string;
  answeredAt?: string;
}

interface TaskInputResponse {
  inputResponseId: string;
  inputRequestId: string;
  taskId: string;
  content: unknown;
  createdAt: string;
}

interface TaskExecutionAttempt {
  attemptId: string;
  taskId: string;
  reason: "initial" | "input_response";
  status: "queued" | "running" | "completed" | "failed";
}
```

具体表名按仓库规范适配。

## 6.3 Queue 调整

不能继续只使用 `taskId` 作为唯一 Job ID。

改为类似：

```text
{taskId}:{attemptId}
```

Worker Job 必须携带：

```ts
{
  taskId: string;
  contextId: string;
  attemptId: string;
  mode: "initial" | "continue_after_input";
}
```

## 6.4 两类恢复

### Goal 形成前缺参

继续 Goal Deliberation，不重新创建 Task。

### Goal Evaluation 后 request_input

新增：

```ts
WorkflowControllerService.continueAfterInput(...)
```

要求：

- 原 Control 从 `awaiting_input` 继续；
- 将补充输入并入 Control input；
- 生成下一版 Plan；
- 新 Plan 默认等待确认；
- 不重放已经完成的旧 Workflow；
- 保存输入与旧 Round 的关联。

## 6.5 A2A 行为

- `provide_input` 仍通过结构化 `sdar_action`；
- 保存输入后返回 working/queued 状态；
- 后续由标准 Task 查询或流式事件返回进展；
- 重复回答同一 input request 必须幂等或冲突；
- 过期问题不能被回答；
- 没有 pending input 时拒绝 provide_input。

## 6.6 必测场景

- 初始 Goal 缺参后补充完成；
- Goal Evaluation request_input 后补充；
- 输入保存；
- 新 attempt 创建；
- 旧 BullMQ Job 不阻止继续；
- 重复输入；
- 错误 Task；
- 过期输入；
- 同 Context 两个任务严格串行；
- 重启后等待输入仍可回答；
- E2E 必须验证补充值真实进入后续 MCP 参数，而不只验证状态改变。

## 6.7 完整门禁

`v1.0.3-bug-fixed` 必须运行：

```bash
pnpm verify
```

## 6.8 提交

```text
feat(v1.0.3): complete A2A input-required continuation
fix(v1.0.3): harden A2A input continuation
```

---

# 7. v1.0.4 — Simulation / Historical Replay MCP Header 隔离

## 7.1 目标

所有模拟和历史回放中的 MCP 请求必须向 MCP Server 传递明确 Header。

## 7.2 Header 契约

Simulation：

```http
X-SDAR-Execution-Mode: simulation
X-SDAR-Simulation-Id: <stable-id>
```

Historical Replay：

```http
X-SDAR-Execution-Mode: historical-replay
X-SDAR-Simulation-Id: <stable-id>
```

Live 执行不得附加上述 Header。

## 7.3 实施要求

增加：

```ts
type RuntimeExecutionMode =
  | "live"
  | "simulation"
  | "historical-replay";

interface RuntimeExecutionContext {
  mode: RuntimeExecutionMode;
  simulationId?: string;
}
```

传播到：

- Skill Evolution simulation；
- Historical replay；
- LangGraph MCP Port；
- McpRegistryService；
- MCP Transport Adapter；
- Invocation Audit。

Header 合并规则：

- Credential Header 不得覆盖保留 Header；
- 保留 Header 必须由 Runtime 最终写入；
- 管理端配置相同 Header 时拒绝；
- 日志中记录 execution mode 和 simulation ID；
- 不记录凭据。

## 7.4 安全边界

本版本不假设 SDAR 自己阻止设备操作。

MCP Server 后续负责识别：

```text
simulation
historical-replay
```

并采取兼容行为。

## 7.5 必测场景

- Live 无 Header；
- Simulation Header 正确；
- Replay Header 正确；
- Simulation ID 稳定；
- 子 Workflow 继承；
- Skill call 继承；
- Header 与凭据合并；
- 保留 Header 冲突；
- MCP Mock Server 真实收到 Header；
- Invocation Audit 保存 mode。

## 7.6 提交

```text
feat(v1.0.4): mark simulation and replay MCP requests
fix(v1.0.4): harden MCP execution-mode propagation
```

---

# 8. v1.0.5 — 子 Skill 确认策略与父子权限传播

## 8.1 目标

防止父计划或 `skill_call` 绕过子 Skill 的确认策略。

## 8.2 锁定规则

采用保守策略：

```text
子 Skill autoConfirmPlan = true
→ 子计划可自动确认

子 Skill autoConfirmPlan = false
→ 子计划必须独立进入确认
→ 父计划已经确认也不能覆盖子 Skill 策略
```

顶层自动确认要求：

```text
顶层 Skill
+
计划直接引用的所有 Skill
+
递归可到达的全部子 Skill
```

均允许自动确认。

## 8.3 实施要求

- `SkillCallWorkflowService` 不再固定 `confirmed`；
- 子计划必须按子 Skill runtime policy 决定；
- 父 Workflow 可进入 paused/input-required 等待子计划确认；
- 保存：
  - parentPlanId
  - parentInstanceId
  - parentNodeId
  - childPlanId
  - childSkillId/version
  - confirmationStatus
- 子 Skill 替代或版本变化必须重新确认；
- 初始计划和重规划使用同一套 transitive confirmation evaluator；
- 禁止初始路径只检查顶层 Skill。

## 8.4 必测场景

- 父 auto=true，子 auto=false；
- 父 auto=false，子 auto=true；
- 多层子 Skill；
- 子计划确认后继续父 Workflow；
- 子计划拒绝；
- 子 Skill 版本变化；
- 子 Skill 替代；
- 取消等待中的子计划；
- 初始规划和 replan 策略一致。

## 8.5 Bug-fixed 阶段重点

- 父子暂停状态；
- 重复确认；
- 陈旧确认；
- 已取消父 Task 上确认子计划；
- 确认后子计划被修改。

## 8.6 提交

```text
feat(v1.0.5): enforce nested skill confirmation policy
fix(v1.0.5): harden parent-child confirmation flow
```

---

# 9. v1.0.6 — Task、Goal、WorkflowControl 权威终态一致性

## 9.1 目标

避免：

```text
Task completed
Goal active
WorkflowControl failed
```

或：

```text
Workflow achieved
Memory 写入失败
Task 未完成
```

## 9.2 权威状态与增强状态分离

权威终态：

- Processed Result；
- Task terminal state；
- Goal terminal state；
- WorkflowControl terminal state；
- 当前 Round terminal reference。

非权威增强：

- Long-term Memory；
- Task Quality Evaluation；
- Skill Quality；
- Evolution Experience；
- Prompt/Skill Evolution；
- Experience v1.2 事件。

## 9.3 实施要求

新增原子提交 Port/Repository，例如：

```ts
interface RuntimeTerminalOutcomeRepository {
  commitAchieved(input: ...): Promise<void>;
  commitUnachievable(input: ...): Promise<void>;
  commitCanceled(input: ...): Promise<void>;
}
```

要求：

- 同一个 PostgreSQL Transaction；
- 锁定 Task、Goal、Control；
- 检查预期版本和状态；
- 幂等重入；
- 禁止终态被陈旧 Worker 覆盖；
- Processed Result 与 Task Output 同时提交；
- `#advanceOrFail` 不得在权威终态已提交后反转为 failed；
- 后置增强失败只记录警告；
- 后置增强不得阻塞 A2A 最终结果。

## 9.4 必测故障注入

在以下位置注入失败：

- ProcessedResult 保存前；
- Task 更新后；
- Goal 更新后；
- Control 更新后；
- Memory；
- Quality Evaluation；
- Evolution Experience；
- Runtime Event；
- 模型审计。

必须证明：

- 事务内失败全部回滚；
- 事务提交后增强失败不反转终态；
- 重复提交幂等；
- 陈旧 Worker 不能复活终态。

## 9.5 完整门禁

`v1.0.6-bug-fixed` 必须运行：

```bash
pnpm verify
```

## 9.6 提交

```text
feat(v1.0.6): atomically commit authoritative runtime outcomes
fix(v1.0.6): harden terminal outcome consistency
```

---

# 10. v1.0.7 — 顶层 Skill Input Resolution

## 10.1 目标

让正式 Skill 的 `inputSchema` 在顶层 Task 主链真实生效。

目标链路：

```text
A2A Task
→ Skill Selection
→ Structured Skill Input Resolution
→ Skill input schema validation
→ 缺参则 input-required
→ 结构化输入进入 Workflow
```

## 10.2 输入来源

按优先级：

1. A2A metadata 中明确提供的 structured input；
2. Task request text；
3. Goal Contract；
4. 同 Context 已处理数据；
5. v1.0.3 补充输入；
6. 长期 Memory 只作为证据，不作为设备实时状态权威。

## 10.3 新模型阶段

增加等价阶段：

```text
skill_input_resolution
```

需要：

- Provider Route；
- Prompt；
- Structured response schema；
- Invocation Audit；
- 管理 API/Console 配置支持。

## 10.4 持久化

保存：

```ts
interface SkillInputResolutionRecord {
  resolutionId: string;
  taskId: string;
  skillId: string;
  skillVersion: number;
  structuredInput?: unknown;
  unresolvedFields: readonly string[];
  sourceRefs: readonly string[];
  decisionSummary: string;
  status: "resolved" | "input_required" | "failed";
}
```

## 10.5 运行要求

- resolved input 必须通过 Skill input schema；
- unresolved 进入 v1.0.3 input request；
- Workflow 初始 input 使用 structured Skill input；
- raw requestText 作为辅助上下文保存；
- 重规划继续使用固定输入版本，除非收到新的 input response；
- Goal Patch 后重新解析输入。

## 10.6 必测场景

- metadata 直接提供；
- 文本提取；
- 缺参追问；
- 补充输入后完成；
- 非法类型；
- 多来源冲突；
- Goal Patch 后重新解析；
- 子 Skill 仍单独校验自己的输入；
- 结构化输入进入 MCP 参数绑定。

## 10.7 提交

```text
feat(v1.0.7): resolve and validate top-level skill inputs
fix(v1.0.7): harden top-level skill input resolution
```

---

# 11. v1.0.8 — 完整 Goal Execution Contract 传播

## 11.1 目标

Skill 选择、Workflow 规划、执行和评估使用同一 Goal Contract。

## 11.2 类型

增加等价类型：

```ts
interface GoalExecutionContract {
  goalId: string;
  version: number;
  title: string;
  description: string;
  constraints: readonly string[];
  successCriteria: readonly string[];
}
```

## 11.3 传播范围

必须进入：

- Skill candidate retrieval；
- Skill selection LLM；
- Skill replacement；
- Temporary Skill resolution；
- Workflow planning；
- Replanning；
- Child Skill planning；
- Goal Evaluation；
- Model Invocation Audit；
- Plan Attempt snapshot。

## 11.4 Candidate 信息增强

Skill 候选至少包含：

- capabilities；
- input/output schema 摘要；
- tool policy；
- workflow guidance 摘要；
- runtime policy；
- quality metrics；
- active MCP dependency warnings；
- semantic score。

## 11.5 必测场景

- Goal constraint 改变 Skill 选择；
- Success criteria 改变 Workflow；
- 安全约束进入 Planner；
- Replacement 保留 Goal Contract；
- Goal Patch 使用新版本；
- 旧 Goal Version 不可用于新计划；
- Model Audit 可看到使用的 Contract snapshot。

## 11.6 提交

```text
feat(v1.0.8): propagate the complete goal execution contract
fix(v1.0.8): harden goal contract propagation
```

---

# 12. v1.0.9 — Skill 图谱参与组合规划

## 12.1 目标

Skill Graph 不再只用于失败后的 alternative 查找，而要参与初始组合规划。

## 12.2 支持关系

根据仓库当前关系枚举适配，至少覆盖语义：

- parent/child；
- depends_on；
- input_output_match；
- alternative；
- composable；
- capability_coverage。

不得臆造不存在的枚举；必要时新增领域类型和 Migration。

## 12.3 规划上下文

增加：

```ts
interface SkillCompositionContext {
  selectedSkill: SkillVersionSnapshot;
  relatedSkills: readonly SkillVersionSnapshot[];
  relations: readonly SkillRelation[];
  allowedChildSkillIds: readonly string[];
  decisionSummary: string;
}
```

提供给 Workflow Planner。

## 12.4 约束

- 不把全部 Skill 无限制暴露给 Planner；
- `skill_call` 目标必须来自允许的组合上下文，或由显式能力缺口流程产生；
- 子 Skill 输入输出 Schema 必须匹配；
- 组合关系快照必须持久化；
- 实际执行由 v1.0.2 完成；
- 确认由 v1.0.5 完成；
- 图谱不替代 LLM 最终裁决。

## 12.5 必测场景

- depends_on 自动加入上下文；
- composable Skill 进入 Plan；
- 无关系 Skill 被拒绝；
- input/output 不匹配；
- alternative 不在初始计划中误用；
- 多级组合；
- 循环依赖；
- 组合决策可审计。

## 12.6 完整门禁

`v1.0.9-bug-fixed` 必须运行：

```bash
pnpm verify
```

## 12.7 提交

```text
feat(v1.0.9): use the skill graph for composition planning
fix(v1.0.9): harden skill graph composition
```

---

# 13. v1.0.10 — Capability Gap 终态契约

## 13.1 锁定决策

`capability_gap` 是当前 A2A Task 的终态。

上游完成 MCP Tool/Skill 补充后，必须重新提交一个新 A2A Task。

原 Task 不恢复。

## 13.2 内部语义

建议保留内部 `capability_gap` phase，但将其加入：

```ts
TaskTerminalPhase
isTerminalTaskPhase()
```

要求：

- Terminal mutation protection；
- WorkflowControl 终止为 capability gap；
- Goal 可以保持 active，供同 Context 新 Task 继续；
- 不提供 resume capability action；
- 不自动扫描新 MCP Tool；
- 不自动执行新任务。

## 13.3 A2A 投影

`capability_gap` 投影为标准终态，建议：

```text
TASK_STATE_FAILED
```

同时保留结构化：

```ts
{
  errorCode: "CAPABILITY_GAP",
  capabilityGap: {
    missingCapability,
    suggestedToolContract,
    evaluationSummary
  },
  nextAction: "register-capability-and-submit-new-task"
}
```

不得继续映射为 `input-required`。

## 13.4 必测场景

- Capability Gap Task 终态；
- A2A failed 投影；
- 结构化缺口证据；
- Task 不能 follow-up resume；
- 同 Context 新 Task 继续活动 Goal；
- 陈旧 Worker 不能修改终态；
- Wait timeout 不再处理 terminal capability gap。

## 13.5 提交

```text
feat(v1.0.10): make capability gap a terminal A2A outcome
fix(v1.0.10): harden capability gap terminal semantics
```

---

# 14. v1.0.11 — MCP Tool 执行语义元数据

## 14.1 目标

让 Planner、Skill、Console 和后续 MCP Tasks 能明确理解 Tool 的执行语义，但不让 SDAR 成为设备状态权威。

## 14.2 数据模型

增加等价模型：

```ts
interface McpToolExecutionSemantics {
  effect: "read_only" | "side_effecting" | "unknown";

  execution:
    | "synchronous"
    | "task_capable"
    | "task_required"
    | "unknown";

  cancellation:
    | "unsupported"
    | "cooperative"
    | "task_cancel"
    | "unknown";

  idempotency:
    | "none"
    | "client_request_key"
    | "server_managed"
    | "unknown";

  replay:
    | "allowed"
    | "simulation_only"
    | "forbidden"
    | "unknown";

  source:
    | "mcp_declared"
    | "admin_override"
    | "default_unknown";
}
```

字段名可适配项目风格，但语义必须保留。

## 14.3 来源

优先级：

1. MCP 发现结果中可用的声明；
2. 管理员覆盖；
3. 保守 unknown。

不得由 LLM 单独决定真实执行语义。

LLM Enhancement 可描述，但不能成为权威。

## 14.4 使用范围

- Tool Planning Metadata；
- Workflow Planner；
- Plan Confirmation UI；
- Simulation/Replay Audit；
- MCP Invocation；
- Skill Tool Policy 展示；
- 后续 v1.1 MCP Tasks 兼容准备。

## 14.5 本版本不做

- 不实现 MCP Task Binding；
- 不轮询远程 Task；
- 不改变设备状态权威；
- 不实现设备冲突控制。

## 14.6 必测场景

- MCP 声明导入；
- Admin override；
- Unknown 默认；
- Refresh 保留 override；
- Planner 可见；
- Console/API 可见；
- Invocation 保存 semantics snapshot；
- Simulation mode 可审计；
- 凭据不泄漏。

## 14.7 提交

```text
feat(v1.0.11): model MCP tool execution semantics
fix(v1.0.11): harden MCP tool semantics handling
```

---

# 15. v1.0.12 — Memory 生产化加固

## 15.1 目标

修复：

1. Memory Embedding 固定 3 维；
2. 动态 MCP/设备状态进入长期 Memory；
3. Memory 增强失败影响权威 Task 终态。

第 3 项应建立在 v1.0.6 上。

## 15.2 Embedding

要求：

- Memory 支持不同 Provider 的不同维度；
- 不再使用 `vector(3)`；
- 维度必须大于 0；
- 所有元素必须有限数；
- 检索只比较相同 Provider 和维度；
- Migration 使用通用 `vector`；
- 不修改旧 Migration；
- 空库和升级库测试通过。

## 15.3 Durability

增加：

```ts
type MemoryDurability =
  | "durable"
  | "volatile"
  | "unknown";

type MemoryAuthority =
  | "mcp"
  | "skill_experience"
  | "admin"
  | "model_inferred";
```

自动准入策略：

```text
durable
→ 可自动准入

volatile
→ 不进入长期 Memory

unknown
→ 默认不自动准入
```

动态内容示例：

- 当前坐标；
- 当前电量；
- 当前在线状态；
- 当前占用；
- 当前设备任务；

必须被判断为 volatile，后续 Task 应重新查询 MCP。

## 15.4 Refinement Schema

Memory Refinement 模型必须返回：

- type；
- content；
- summary；
- confidence；
- durability；
- authority；
- durabilityReason。

所有字段结构化校验。

## 15.5 后置增强

Memory 创建、Embedding、去重失败：

- 不反转已提交 Task 终态；
- 记录警告；
- 可查询增强失败状态；
- 不伪造 Memory 成功。

## 15.6 必测场景

- 3、8、1536 等不同维度；
- Provider 不匹配不比较；
- volatile 设备状态拒绝；
- durable Skill 经验准入；
- unknown 默认拒绝；
- Memory 失败不影响 completed Task；
- supersede/invalidate 保持工作；
- Migration 路径。

## 15.7 完整门禁

`v1.0.12-bug-fixed` 必须运行：

```bash
pnpm verify
```

## 15.8 提交

```text
feat(v1.0.12): harden production memory semantics
fix(v1.0.12): harden memory durability and embeddings
```

---

# 16. v1.0.13 — A2A 同步等待与状态通知优化

## 16.1 目标

替换 10ms 高频 PostgreSQL 轮询。

## 16.2 目标模型

使用：

```text
Task State Notification
+
低频安全轮询
```

首选在当前单进程 Runtime 中实现内部通知器：

```ts
interface TaskStateNotifier {
  publish(task: AgentTask): void;
  waitForChange(
    taskId: string,
    knownUpdatedAt: string,
    timeoutMs: number
  ): Promise<AgentTask | undefined>;
}
```

所有 Task 状态保存成功后通知。

为防止漏通知，增加低频安全轮询，禁止恢复到 10ms。

## 16.3 同步等待超时语义

等待窗口结束时：

- 不抛 `A2A_TASK_WAIT_TIMEOUT`；
- 返回当前 Task Snapshot；
- 若仍在运行，保持标准 working 状态；
- 后台 Task 继续；
- 客户端可轮询或重新订阅。

## 16.4 要求

- return-immediately 行为保持；
- 流式连接断开不终止任务；
- Task terminal 立即唤醒；
- input-required 立即唤醒；
- capability-gap terminal 立即唤醒；
- 关闭 Runtime 时释放 waiters；
- 不造成未处理 Promise；
- 保留 PostgreSQL 权威状态。

## 16.5 性能验证

增加测试或基准证明：

- 单 Task 同步等待不再每秒查询约 100 次；
- 多并发等待数据库查询量有明显下降；
- 状态变化响应延迟合理；
- 漏通知时安全轮询能恢复；
- Server close 不挂起。

不得伪造生产性能数字；报告实际测试环境和结果。

## 16.6 完整门禁

`v1.0.13-bug-fixed` 必须运行：

```bash
pnpm verify
pnpm demo:local
pnpm demo:acceptance
```

若 `pnpm verify` 已包含其中步骤，仍要在报告中明确对应结果。

## 16.7 提交

```text
feat(v1.0.13): replace A2A busy polling with task notifications
fix(v1.0.13): harden A2A wait and notification behavior
```

---

# 17. 各版本依赖关系

```text
v1.0.1 动态数据绑定
    ↓
v1.0.2 真实子 Skill
    ↓
v1.0.5 子 Skill 确认
    ↓
v1.0.9 Skill 图谱组合

v1.0.3 输入恢复
    ↓
v1.0.7 顶层 Skill Input
    ↓
v1.0.8 Goal Contract

v1.0.4 Simulation Header
    ↓
v1.0.11 MCP Tool Semantics
    ↓
未来 v1.1 MCP Tasks

v1.0.6 终态一致性
    ↓
v1.0.10 Capability Gap Terminal
    ↓
v1.0.12 Memory 后置增强

v1.0.13 最终 A2A 等待优化
```

Codex 必须按版本顺序实施，不得并行跨版本修改相同核心模块。

---

# 18. 每个 Bug-fixed 阶段的统一检查

每个 `v1.0.x-bug-fixed` 都必须进行：

## 18.1 代码审查

检查：

- 原业务异常是否被吞；
- 数据库事务边界；
- 状态机是否有无效路径；
- 终态是否可被覆盖；
- AbortSignal 是否传播；
- Mock 是否掩盖真实执行；
- 新字段是否进入 Persistence 和 API；
- 是否新增未处理 Promise；
- 是否产生资源泄漏；
- 是否存在循环/递归无界；
- 是否泄漏凭据；
- 是否误把 SDAR 作为 MCP 真实状态权威。

## 18.2 负面测试

至少增加一类：

- 重复请求；
- 状态冲突；
- 数据库写失败；
- MCP 失败；
- LLM 失败；
- 取消；
- 超时；
- 并发；
- 重启；
- 陈旧 Worker；
- Schema 不匹配。

## 18.3 报告

`bug-fixed.md` 必须记录：

- 功能版本发现的问题；
- 修复内容；
- 新增测试；
- 尚存已知限制；
- 功能 Tag SHA；
- Bug-fixed Tag SHA；
- 是否允许继续下一版本。

---

# 19. CHANGELOG 格式

示例：

```md
## [1.0.1] - YYYY-MM-DD

### Added
- Workflow runtime data binding.

### Changed
- MCP, Skill and Subworkflow inputs now resolve from Workflow state.

### Known issues at feature tag
- ...

## [1.0.1-bug-fixed] - YYYY-MM-DD

### Fixed
- ...

### Verification
- Focused tests ...
```

Bug-fixed 不是 package SemVer，但必须在 CHANGELOG 中保留。

---

# 20. 最终分支验收

完成 `v1.0.13-bug-fixed` 后：

1. 确认工作区干净；
2. 确认所有 26 个 Tag 已推送；
3. 运行最终完整门禁；
4. 生成总报告：

```text
reports/v1.0-hardening/FINAL_REPORT.md
reports/v1.0-hardening/FINAL_TRACEABILITY.md
reports/v1.0-hardening/FINAL_TEST_RESULTS.md
```

总报告包括：

- 基线 SHA；
- 最终 SHA；
- 13 个功能提交；
- 13 个 bug-fixed 提交；
- 26 个 Tag；
- Migration 清单；
- API/DSL 变化；
- 测试数量变化；
- 已知限制；
- v1.1 MCP Tasks 前置条件；
- v1.2 Experience 前置条件。

## 20.1 合并方式

完成后创建：

```text
release/v1.0-hardening → main
```

的 Pull Request。

PR 标题建议：

```text
release: SDAR v1.0.1-v1.0.13 runtime hardening
```

PR 描述必须引用最终报告。

若 main 分支保护要求审查：

- 创建 PR；
- 不绕过保护；
- 不强制合并；
- 在报告中说明等待人工合并。

若仓库允许自动合并且所有检查通过，仍优先保留 PR 审查证据。

---

# 21. 当前任务完成后的路线

本包完成后按顺序进入：

```text
v1.1 MCP Tasks
  - 等待官方 TypeScript MCP SDK 能力成熟
  - 持久化 MCP Task Binding
  - Workflow suspend/resume
  - tasks/get / cancel / input
  - 进程重启后远程状态对账

v1.2 Experience Instrumentation
  - Runtime Context
  - Typed Event Catalog
  - Descriptor Catalog
  - PostgreSQL Raw Event Store
  - Local Artifact
  - 全链路埋点

v2 Experience Foundation
  - 数据质量
  - Projection
  - Evaluation 数据基础
  - Replay / Evolution 支撑
```

---

# 22. Codex 启动提示词

```text
请在 zhouwen-giser/skill-driven-agent-runtime 仓库中，严格按照《SDAR v1.0.1～v1.0.13 Runtime Hardening Codex 连续任务包》实施。

本仓库定位是 Skill 驱动的 A2A Task Runtime：

- A2A Task 由上游 Agent 发起；
- 上游 Agent 负责跨任务和跨设备冲突；
- MCP Server 掌握设备真实运行状态；
- SDAR 负责 Goal、Skill、Workflow 和 MCP Tool 编排；
- 不要把本任务改造成终端用户聊天系统；
- 不要在本任务中实现 MCP Tasks 或 v1.2 Experience。

开始前：

1. 同步 main；
2. 创建或复用 release/v1.0-hardening；
3. 运行基线 pnpm verify；
4. 生成基线报告；
5. 基线失败时停止。

然后严格按顺序完成 v1.0.1 到 v1.0.13。

每个版本必须有两个独立提交和两个 Tag：

- v1.0.x
- v1.0.x-bug-fixed

每次提交后立即推送远程 release/v1.0-hardening 和对应 Tag。

禁止 amend、rebase 已推送提交和 force push。

每三个功能版本在 bug-fixed 阶段运行完整 pnpm verify：

- v1.0.3-bug-fixed
- v1.0.6-bug-fixed
- v1.0.9-bug-fixed
- v1.0.12-bug-fixed
- v1.0.13-bug-fixed

允许功能 Tag 存在已经记录的非阻塞缺陷，但 bug-fixed 阶段必须修复该版本发现的问题。功能核心验收、类型检查和相关测试失败时，不得创建功能 Tag。

Migration 只能新增，不得修改已有 Migration。当前不要求旧数据和旧 DSL 向后兼容，优先形成正确的新运行语义。

Simulation MCP 请求必须附加：

X-SDAR-Execution-Mode: simulation
X-SDAR-Simulation-Id: <stable-id>

Historical Replay MCP 请求必须附加：

X-SDAR-Execution-Mode: historical-replay
X-SDAR-Simulation-Id: <stable-id>

Capability Gap 是原 A2A Task 的终态；上游补齐能力后重新提交新 Task，不恢复原 Task。

完成 v1.0.13-bug-fixed 后：

- 运行最终完整门禁和 Demo；
- 生成最终报告；
- 确认所有提交和 Tag 已推送；
- 创建 release/v1.0-hardening 到 main 的 Pull Request；
- 不绕过分支保护。
```
