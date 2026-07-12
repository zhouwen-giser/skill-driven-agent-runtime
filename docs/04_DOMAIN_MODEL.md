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

### EvaluationReport

由 Goal、Workflow、Skill、Result、Tool 五类评估器输出，汇总为任务质量报告。

### EvaluationInfluenceRecord

- References one Task quality report and its replayable Evolution Experience.
- Records the resulting Skill-version observation, quality-gated Workflow Template disposition, and inactive Prompt candidate identity.
- Is audit evidence only; it cannot mutate a running Workflow or bypass Skill/Prompt publication rules.

## 不变量

- enabled SkillVersion 必须具有合法 input/output schema 和通过的验证记录。
- Workflow 必须引用存在的 Goal 版本；执行记录必须保存实际使用 Skill 版本。
- 任何 MCP Tool 参数都必须通过原始 Tool input schema。
- 任何最终结构化结果必须通过主 Skill output schema。
- 不允许将展示层或 SDK 状态直接当作领域状态的唯一来源。
