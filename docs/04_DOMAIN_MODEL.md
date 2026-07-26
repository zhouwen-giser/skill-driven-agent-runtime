# 领域模型

## 核心聚合

### ConversationContext

- `contextId`
- `userId`，缺省 `anonymous`
- message history
- active Goal
- serialized task queue relation

### Goal

- `goalId`, `contextId`, `version`
- title, normalized description
- constraints, success criteria
- status: active/achieved/canceled/unachievable/superseded
- relation to previous Goal/stage
- patch history

Goal Patch 一旦生效，旧 Workflow、确认和中间结果全部失效。

### Skill / SkillVersion

- Skill：稳定 ID、名称、生命周期和当前版本指针。
- SkillVersion：描述、能力边界、工具约束、流程指导、输入输出 JSON Schema、预算、确认、暂停/取消/补偿策略、版本来源、验证结果和指标。
- 状态：draft/validating/enabled/disabled/deprecated/validation_failed。

### WorkflowDefinition / WorkflowInstance

- Definition 是已校验 DSL 和计划版本。
- Instance 是一次编译执行，引用 Goal 版本和实际 Skill 版本。
- 当前执行图不可变；重新规划产生新的 Definition/Instance。
- WorkflowNodeEvent 持久化节点开始/终止事件；终止事件保存单调时钟测得的非负 `durationMs`，供管理 Trace 定位慢节点。

### Task

- A2A Task 与内部 Task 一对一关联，但内部阶段更细。
- Task 可以多次推进同一 Goal。
- 同一 context 严格串行。

### McpServer / McpTool / McpInvocation

- Server 保存加密凭据、传输配置和注册时工具快照。
- Tool 保存原始 Schema 和 LLM 增强元数据；实际调用以当前注册 Schema 为准。
- Invocation 保存输入、标准化结果、错误、耗时和取消状态。

### MemoryItem / Experience

- 原始轨迹在 PostgreSQL。
- MemoryItem 是提炼、去重、结构化内容，带证据引用、向量、状态和替代关系。
- Experience 保存成功/失败任务的 Goal、Skill、Workflow、工具组合和评估。

### McpManagementOperation

- Immutable PostgreSQL evidence for register, refresh, health check, credential rotation, Tool metadata update, and deletion.
- Uses the explicit `anonymous-management` V1 actor because authentication is intentionally absent.
- Stores credential-safe summaries only and remains queryable after the current Server row is deleted.

### EvaluationReport

由 Goal、Workflow、Skill、Result、Tool 五类评估器输出，汇总为任务质量报告。

### EvaluationInfluenceRecord

- References one Task quality report and its replayable Evolution Experience.
- Records the resulting Skill-version observation, quality-gated Workflow Template disposition, and inactive Prompt candidate identity.
- Is audit evidence only; it cannot mutate a running Workflow or bypass Skill/Prompt publication rules.

### EvaluationAnalyticsSnapshot

- Aggregates immutable Experience, Workflow budget/error, model invocation, Tool, SkillVersion, and quality-report evidence.
- Supports Skill/version/provider/model/Server/Tool filters while PostgreSQL remains authoritative.
- Contains success, duration, cost, failure, version-stability, and ordered quality-trend projections.
- Contains Task-linked model effects, MCP usage, observed Skill-version capability growth, and evidence-counted advisory optimization suggestions. Suggestions are read models only and cannot change runtime state.

## 不变量

- enabled SkillVersion 必须具有合法 input/output schema 和通过的验证记录。
- Workflow 必须引用存在的 Goal 版本；执行记录必须保存实际使用 Skill 版本。
- 任何 MCP Tool 参数都必须通过原始 Tool input schema。
- 任何最终结构化结果必须通过主 Skill output schema。
- 不允许将展示层或 SDK 状态直接当作领域状态的唯一来源。

### MCP Task Execution Readiness（v1.1）

- `McpTaskOperationSemantics` 是发现元数据的领域投影，不包含 SDK 类型。
- `TaskExecutionTiming` 明确区分 immediate/scheduled、启动容差与可空 `maxElapsedMs`。
- `TaskAvailabilitySnapshot` 追加保存计划/节点/Server/operation、已知参数或 unresolved paths、规范化参数 hash、timing、Provider 结果、来源修订与检查时间。
- `DslExecutionReadiness` 保存允许动作、结构化模型决定、最终 Guard 动作和确认要求；disabled、非法能力/合约与无引用 guaranteed 预约不可被模型覆盖。
- pre-invocation 必须引用真实 Workflow Definition 与 node-run，并使用解析后不可变参数/timing。旧确认只覆盖同节点、规划时已经 restricted 且风险未升级的刷新结果。

### Skill Usage and execution evidence (v1.2)

- `SkillUsageSpecification` belongs to one immutable `SkillVersion` and records intent, applicability,
  context requirements, guidance/template/procedure modes, Provider binding, bounded composition,
  four child-failure policies and evidence hard gates. Normative fields cannot be relaxed by adaptive
  text, observed history or model output.
- `SkillUsageCandidateSnapshot` freezes exact Skill/version, context evidence, admitted mode and live
  Task/Provider readiness. An exact-version plan policy carries only that verified authority into the
  existing Workflow planner and confirmation path.
- `SkillUsageCompositionPlan` resolves fixed dependencies and capability slots through the existing
  Skill Graph. Native parent child policies are exact allowlists; legacy projections remain governed by
  their immutable legacy composition snapshot and existing graph authority.
- `SkillExecutionRecord` is append-only evidence linked to existing Goal, Task, Workflow, Provider and
  Remote Task authorities. Parent/child order, hard-gate evidence, intervention and degraded outcome
  are queryable, but execution rows cannot create or overwrite an authoritative lifecycle transition.
- The SRS rule to use the current Skill version remains the legacy default. A native v1.2 Usage plan
  intentionally freezes an exact version from selection through execution; version drift invalidates
  the plan instead of silently upgrading it.

## SDAR v1.3 Runtime Artifact aggregate

P01 adds `CompiledArtifact` as a Domain-owned immutable planning-data aggregate. It has exactly one of
five definition kinds (`intent_route`, `plan_template`, `decision_rule`, `case_template`, or
`model_route`), plus applicability, capability/policy requirements, a dependency snapshot, risk,
lineage, validation reference, status, content hash, and creation time.

The Artifact lifecycle is separate from Knowledge promotion, Skill publication, Workflow execution,
and Goal terminal state. Domain owns transition legality; later PostgreSQL repositories may own
durable instances and active pointers but cannot redefine the aggregate. `ArtifactRuntimeBinding` is
a rebuildable projection and is never the active Artifact authority. Artifact data cannot invoke a
Skill, MCP tool, Provider, or LangGraph execution and cannot write Goal or Outcome state. Detailed
boundary decisions are recorded in ADR-116.
