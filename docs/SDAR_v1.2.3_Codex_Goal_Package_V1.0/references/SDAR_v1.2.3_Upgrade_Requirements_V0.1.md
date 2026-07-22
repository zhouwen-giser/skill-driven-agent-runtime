# SDAR v1.2.3 升级需求 V0.1

## 经验驱动的任务理解、能力认知与人机协同规划

> **文档状态：** Draft Requirements  
> **目标版本：** SDAR v1.2.3  
> **前置版本：** SDAR v1.2.2 User Goal Planning Runtime  
> **适用仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
> **开发关系：** v1.2.3 建立在 v1.2.2 已完成能力之上，不得阻断或重构 v1.2.2 当前开发计划  
> **参考项目：** Mastra Observational Memory、Claude Code Plan Mode/Auto Memory、Codex Skills/Record & Replay，仅作为设计参考，不构成运行时依赖  
> **规范用语：** MUST/SHOULD/MAY 分别表示强制、建议和可选要求  
> **冻结状态：** 本文尚未冻结，后续需完成需求评审、关键决策登记和实现 Skeleton 后方可进入正式 Codex Goal

---

# 1. 版本定位

SDAR v1.2.2 解决：

```text
明确用户请求
→ User Goal Completion Contract
→ User Goal Planning
→ Skill Goal DAG
→ Skill Selection
→ Skill Attempt / Workflow / MCP Task
→ Task/Skill/User Outcome
→ Progress / Recovery / Plan Revision
```

SDAR v1.2.3 在此基础上增加：

```text
泛型用户任务
→ 任务理解
→ 缺失维度识别
→ 多轮澄清
→ 候选 User Goal Contract
→ 用户确认或修订
→ 能力总结 + 规划经验
→ 候选 Skill Goal Plan
→ 用户确认或修订
→ v1.2.2 执行运行时
→ 结构化执行事实
→ 经验归纳
→ 任务类型与能力模式归纳
→ 验证与晋升
→ 反哺后续任务理解和目标拆解
```

v1.2.3 的核心不是增加一个通用 Memory，而是建立：

```text
Experience-governed Task Understanding
+
Capability Cognition
+
Human-in-the-loop Goal Planning
+
Task Type and Capability Learning
```

---

# 2. 版本目标

v1.2.3 MUST 实现：

1. 基于 v1.2.2 结构化运行事实构建任务经验 Episode；
2. 对 Episode 执行观察、总结、反思和结构化经验提取；
3. 将单次经验与跨任务经验区分管理；
4. 根据 Skill Registry 和 Skill Outcome Specification 生成 Runtime Capability Summary；
5. 根据公开策略生成稳定、可追溯的 A2A Capability Card；
6. 理解信息不完整、目标模糊的泛型用户任务；
7. 识别形成 User Goal Contract 所缺少的关键维度；
8. 支持目标合同和 Skill Goal Plan 的多轮人机交互式确认与调整；
9. 保存用户对理解、目标和规划的每次修订；
10. 从用户修订和执行结果中归纳候选任务类型；
11. 从 Skill 声明、执行结果和用户修订中归纳候选能力模式；
12. 对候选经验、任务类型和能力模式执行支持、反例和适用性验证；
13. 只有通过晋升门禁的知识才能影响正式规划；
14. 经验和能力学习不可用时，v1.2.2 原始规划链必须继续运行；
15. 所有经验对 Planner 只具有建议权，不具有完成、执行或安全权威。

---

# 3. 总体架构

## 3.1 在线任务循环

```text
User Request
→ GenericTaskUnderstandingService
→ Missing Dimension Analysis
→ Interactive Goal Clarification
→ Candidate UserGoalCompletionContract
→ User Goal Confirmation
→ Capability Context Builder
→ Planning Experience Retrieval
→ UserGoalPlanningNode
→ Candidate Skill Goal Plan
→ Interactive Plan Confirmation / Revision
→ SkillGoalPlanValidator
→ v1.2.2 UserGoalPlanController
→ Execution / Outcome / Recovery
```

## 3.2 离线学习循环

```text
v1.2.2 Runtime Facts
→ GoalExperienceEpisodeBuilder
→ ExperienceObserver
→ ExperienceExtractor
→ ExperienceReflector
→ Candidate Lesson
→ Cross-episode Validation
→ Knowledge Promotion
→ Validated Planning Heuristic
→ Task Type / Capability Pattern
→ PlanningExperienceRetriever
```

## 3.3 能力认知链

```text
Skill Registry
+ SkillUsageSpecification
+ SkillOutcomeSpecification
+ Execution Evidence
        │
        ▼
RuntimeCapabilitySummary
        ├── Internal Planning Projection
        ├── Management/Console Projection
        └── Public Capability Card Projection
```

## 3.4 双循环关系

```text
在线循环：
Understand → Clarify → Plan → Confirm → Execute → Judge

离线循环：
Observe → Summarize → Reflect → Validate → Promote → Reuse
```

离线循环不得成为在线任务的硬依赖。

---

# 4. 前置依赖

## 4.1 v1.2.2 必须提供的事实

v1.2.3 依赖 v1.2.2 已存在或计划存在的：

```text
UserGoalCompletionContract
UserGoalPlan
SkillGoalDefinition
SkillGoalExecutionContract
SkillAttempt
WorkflowExecutionOutcome
TaskGoalOutcomeJudgment
SkillGoalOutcomeJudgment
UserGoalOutcomeJudgment
GoalProgressSnapshot
WorkflowRecoveryAssessment
BusinessEventImpactAssessment
CompletedEffectRecord
```

## 4.2 Skill 能力声明

每个 Enabled Skill MUST 提供：

```text
SkillVersion
SkillUsageSpecification
SkillOutcomeSpecification
Input/Output Schema
Tool Policy
Runtime Policy
```

## 4.3 不得反向依赖

v1.2.2 MUST NOT 依赖：

- Experience Observer；
- Experience Reflector；
- Task Type Registry；
- Capability Experience Aggregator；
- Interactive Planning；
- Capability Card Narrative；
- 任意 Mastra 运行时。

---

# 5. 非目标

v1.2.3 不建设：

- 第二套 Workflow Runtime；
- 第二套 Goal/Skill/Task Outcome Authority；
- 自动训练基础模型；
- 自动修改模型权重；
- 通用领域本体平台；
- 无治理的自由文本长期记忆；
- 自动发布正式 Skill；
- 自动启用候选任务类型；
- 自动启用候选能力模式；
- 以经验替代 Skill Registry；
- 以历史成功替代当前 Provider Readiness；
- 以能力总结替代精确 Skill Selection；
- 以用户一次修订直接形成正式全局规则；
- 将私有思维链保存为经验；
- 跨租户共享未脱敏经验；
- 让 LLM 直接写入权威规划、执行或终态；
- 对 v1.2.2 Completion Contract、Outcome 和 Recovery 权威重新设计。

---

# 6. 核心概念

## 6.1 Goal Experience Episode

```ts
interface GoalExperienceEpisode {
  episodeId: string;
  goalId: string;
  goalVersion: number;
  agentTaskId: string;
  contextId: string;

  userGoalContract: UserGoalCompletionContract;
  userGoalPlans: UserGoalPlan[];
  skillGoals: SkillGoalDefinition[];
  skillAttempts: SkillAttempt[];

  taskGoalJudgments: OutcomeJudgment[];
  skillGoalJudgments: OutcomeJudgment[];
  userGoalJudgment: OutcomeJudgment;

  progressSnapshots: GoalProgressSnapshot[];
  recoveryAssessments: WorkflowRecoveryAssessment[];
  businessEventImpacts: BusinessEventImpactAssessment[];
  completedEffects: CompletedEffectRecord[];
  planningInteractions: PlanningInteractionEpisode[];

  terminalOutcome: "achieved" | "unachievable" | "cancelled";
  episodeHash: string;
  createdAt: string;
}
```

## 6.2 Experience Observation

```ts
interface ExperienceObservation {
  observationId: string;
  scope: "goal_episode" | "planning_interaction" | "cross_episode_batch";
  sourceEpisodeIds: string[];

  observations: string[];
  extractedLessons: ExtractedExperienceLesson[];

  modelInvocationRef?: string;
  observationHash: string;
  status: "candidate" | "validated" | "rejected" | "superseded";
  createdAt: string;
}
```

## 6.3 Validated Planning Heuristic

```ts
interface ValidatedPlanningHeuristic {
  heuristicId: string;
  version: number;

  kind:
    | "decomposition"
    | "dependency"
    | "criterion"
    | "evidence"
    | "artifact"
    | "risk"
    | "failure"
    | "recovery"
    | "no_progress"
    | "confirmation";

  statement: string;
  applicability: ApplicabilityCondition[];

  supportCount: number;
  contradictionCount: number;
  confidence: number;

  supportingEpisodeRefs: string[];
  contradictingEpisodeRefs: string[];

  status: "candidate" | "validating" | "active" | "deprecated" | "rejected";
  createdAt: string;
  updatedAt: string;
}
```

## 6.4 Runtime Capability Summary

```ts
interface RuntimeCapabilitySummary {
  summaryId: string;
  catalogHash: string;
  domains: CapabilityDomainSummary[];
  capabilities: CapabilitySummaryItem[];
  compositionPatterns: CapabilityCompositionPattern[];
  knownLimitations: CapabilityLimitation[];
  sourceSkillRefs: SkillVersionRef[];
  generatedAt: string;
}
```

## 6.5 Public Capability Card

```ts
interface PublicCapabilityCardSnapshot {
  cardId: string;
  catalogHash: string;
  profileVersion: string;
  agentName: string;
  description: string;
  publicDomains: string[];
  publicCapabilities: PublicCapabilityItem[];
  generatedFrom: SkillVersionRef[];
  generatedAt: string;
}
```

## 6.6 Generic Task Understanding

```ts
interface GenericTaskUnderstanding {
  understandingId: string;
  originalRequest: string;
  interpretedObjective: string;
  taskTypeCandidates: TaskTypeCandidate[];
  capabilityRequirements: CapabilityRequirement[];
  knownConstraints: GoalConstraint[];
  missingDimensions: MissingTaskDimension[];
  assumptions: PlanningAssumption[];
  confidence: number;
  disposition:
    | "ready_for_contract"
    | "clarification_required"
    | "confirmation_required"
    | "capability_gap";
  stateHash: string;
  createdAt: string;
}
```

## 6.7 Planning Interaction Episode

```ts
interface PlanningInteractionEpisode {
  interactionEpisodeId: string;
  taskId: string;
  goalId?: string;
  goalVersion?: number;

  originalRequest: string;
  initialUnderstanding: GenericTaskUnderstanding;
  initialGoalContract?: UserGoalCompletionContract;
  initialPlan?: UserGoalPlan;

  turns: PlanningInteractionTurn[];
  acceptedGoalContract?: UserGoalCompletionContract;
  acceptedPlan?: UserGoalPlan;

  addedCriterionIds: string[];
  removedCriterionIds: string[];
  addedSkillGoalPatterns: string[];
  removedSkillGoalPatterns: string[];
  dependencyCorrections: DependencyCorrection[];
  capabilityCorrections: CapabilityCorrection[];

  outcomeRef?: string;
  episodeHash: string;
  createdAt: string;
}
```

## 6.8 Task Type Definition

```ts
interface TaskTypeDefinition {
  taskTypeId: string;
  version: number;
  name: string;
  description: string;

  recognitionPatterns: TaskRecognitionPattern[];
  requiredDimensions: TaskDimension[];
  optionalDimensions: TaskDimension[];
  typicalCriteria: CompletionCriterionTemplate[];
  typicalCapabilityRequirements: CapabilityRequirementTemplate[];
  typicalSkillGoalPatterns: SkillGoalPattern[];
  typicalDependencyPatterns: DependencyPattern[];

  supportCount: number;
  contradictionCount: number;
  confidence: number;

  source:
    | "manual"
    | "planning_interaction"
    | "execution_experience"
    | "cross_episode_induction"
    | "manual_correction";

  status: "candidate" | "validating" | "active" | "deprecated" | "rejected";
  sourceExperienceRefs: string[];
  createdAt: string;
  updatedAt: string;
}
```

## 6.9 Capability Pattern

```ts
interface CapabilityPatternDefinition {
  capabilityPatternId: string;
  version: number;
  capability: string;
  description: string;

  applicableConditions: ApplicabilityCondition[];
  typicalEffects: string[];
  typicalEvidence: string[];
  typicalArtifacts: string[];

  commonPrerequisites: string[];
  commonDependencies: string[];
  knownFailurePatterns: string[];
  knownLimitations: string[];

  supportingSkillRefs: SkillVersionRef[];
  supportCount: number;
  contradictionCount: number;
  confidence: number;

  status: "candidate" | "validating" | "active" | "deprecated" | "rejected";
  sourceExperienceRefs: string[];
  createdAt: string;
  updatedAt: string;
}
```

---

# 7. 权威边界

## 7.1 User Goal 权威

```text
用户确认后的 UserGoalCompletionContract
> 自动任务类型
> 历史经验
> 能力总结文案
```

经验不得删除、弱化或替换用户明确 Criterion。

## 7.2 能力声明权威

```text
SkillVersion
+ SkillUsageSpecification
+ SkillOutcomeSpecification
> Runtime Capability Summary
> Capability Narrative
> Capability Experience
```

能力总结只能投影 Skill 声明，不能凭经验制造不存在的正式能力。

## 7.3 当前执行可用性权威

```text
Provider Readiness / Availability
> 历史成功率
> Capability Card
```

## 7.4 任务完成权威

```text
Task/Skill/User Outcome Judge
> Skill completed
> Experience
> User Planning Confirmation
```

## 7.5 规划准入权威

```text
SkillGoalPlanValidator
> UserGoalPlanningNode
> Experience Heuristic
```

## 7.6 知识晋升权威

只有：

```text
ExperiencePromotionService
+
Deterministic Promotion Policy
+
必要时人工批准
```

可以将 Candidate Lesson、Task Type 或 Capability Pattern 变为 Active。

---

# 8. 经验采集需求

## FR-EX-001 Episode 创建时机

系统 MUST 在以下时机创建或更新 GoalExperienceEpisode：

- User Goal 达成；
- User Goal 判定不可达；
- 用户取消；
- UserGoalPlan Revision；
- 重大 Recovery；
- Business Event 导致 Plan Assumption 失效；
- 多轮规划确认结束。

## FR-EX-002 异步执行

Episode 构建和经验归纳 MUST 异步执行，不得阻塞：

- A2A 终态提交；
- User Goal Planning；
- Skill Goal Scheduler；
- Recovery Admission。

## FR-EX-003 权威数据来源

Episode MUST 只读取已持久化的 v1.2.2 权威事实。

不得使用：

- 私有思维链；
- 未提交的临时 Prompt；
- 未校验的 Provider 原始状态；
- 未授权跨租户数据。

## FR-EX-004 幂等

Episode 创建 MUST 以：

```text
goalId + goalVersion + terminalJudgmentId + planRevisionSetHash
```

幂等。

## FR-EX-005 不完整 Episode

缺少非关键事实时 MAY 创建 `partial` Episode。

缺少以下事实时 MUST 拒绝归纳：

- User Goal Contract；
- Current/Terminal User Goal Judgment；
- UserGoalPlan Version；
- Source Authority 信息。

## FR-EX-006 Episode 版本

运行事实后续补齐时，系统 MUST 创建新 Episode Revision，不得修改旧 Revision。

---

# 9. 经验观察与总结需求

## FR-EO-001 Observer

新增：

```text
ExperienceObserver
```

职责：

- 压缩单次 Episode；
- 提取关键目标、计划、结果、失败和修订；
- 区分事实、推断和候选经验；
- 输出结构化 Observation。

## FR-EO-002 Reflector

新增：

```text
ExperienceReflector
```

职责：

- 跨 Episode 合并相似 Observation；
- 发现重复模式和反例；
- 形成 Candidate Lesson；
- 删除被新事实明确推翻的旧候选；
- 不直接激活 Planning Heuristic。

## FR-EO-003 Extractor

第一版 MUST 支持：

```text
Goal Pattern Extractor
Decomposition Lesson Extractor
Dependency Lesson Extractor
Criterion Lesson Extractor
Evidence Lesson Extractor
Artifact Lesson Extractor
Failure Pattern Extractor
Recovery Lesson Extractor
No Progress Pattern Extractor
Human Correction Extractor
```

## FR-EO-004 结构化校验

所有提取结果 MUST 经过：

- JSON Schema/Zod；
- 长度限制；
- 引用存在性；
- Source Episode 校验；
- 允许 Enum；
- Prompt Injection 清洗。

## FR-EO-005 Model 失败

Observer/Reflector 失败：

- 不影响原 Task；
- 记录失败原因；
- 有界重试；
- 超限进入 Dead Letter；
- 不生成默认经验。

## FR-EO-006 事实与经验分离

Observation MUST 区分：

```text
fact
inference
candidate_lesson
uncertainty
contradiction
```

---

# 10. 经验验证与晋升需求

## FR-EP-001 Candidate 默认不可用

新 Candidate Lesson、Task Type 和 Capability Pattern 默认：

```text
status=candidate
```

不得直接进入正式 Planner。

## FR-EP-002 支持和反例

每个候选 MUST 保存：

- supportCount；
- contradictionCount；
- supportingEpisodeRefs；
- contradictingEpisodeRefs；
- applicableConditions；
- confidence。

## FR-EP-003 晋升策略

第一版 SHOULD 支持以下晋升条件组合：

- 最小支持 Episode 数；
- 最小独立 User Goal 数；
- 最小成功比例；
- 最大反例比例；
- Evidence 完整度；
- 用户修订支持；
- 人工批准；
- 安全风险等级。

## FR-EP-004 高风险经验

涉及以下内容 MUST 人工批准：

- 设备控制副作用；
- 跳过确认；
- 取消/暂停策略；
- 安全边界；
- 高风险恢复；
- 降级完成标准。

## FR-EP-005 经验失效

出现明确反例或 Skill/Capability 版本变化时：

```text
active
→ validating
→ active / deprecated / rejected
```

## FR-EP-006 经验版本

经验 Statement、Applicability 或 Promotion Policy 变化 MUST 创建新版本。


---

# 11. 能力总结需求

## FR-CS-001 确定性生成

新增：

```text
CapabilitySummaryBuilder
```

MUST 根据当前 Enabled Skill 的精确版本确定性生成 RuntimeCapabilitySummary。

相同 Skill Version 集合必须生成相同：

```text
catalogHash
structured capability summary
```

## FR-CS-002 输入来源

Capability Summary MUST 使用：

- Skill ID/Version；
- name/summary/description；
- capabilities；
- SkillUsageSpecification；
- SkillOutcomeSpecification；
- Input/Output Schema 摘要；
- Visibility；
- Composition；
- Context Requirement；
- Evidence Policy；
- Artifact/Effect 声明。

## FR-CS-003 结构化能力项

```ts
interface CapabilitySummaryItem {
  capability: string;
  domain: string;
  skillRefs: SkillVersionRef[];
  producibleEffects: string[];
  evidenceTypes: string[];
  artifactTypes: string[];
  requiredContext: string[];
  supportedModes: string[];
  taskTypes: string[];
  composable: boolean;
  visibility: "public" | "internal";
}
```

## FR-CS-004 能力限制

Summary MUST 明确保存：

- 无匹配 Skill；
- 仅内部 Skill；
- 缺少 Evidence 声明；
- 仅特定 Context 适用；
- 不可组合；
- 需要人工确认；
- 当前没有 Enabled Skill。

## FR-CS-005 不包含动态可用性

RuntimeCapabilitySummary 不得声明：

- 当前设备空闲；
- 当前 Provider 可用；
- 当前资源已预约；
- 当前任务一定能执行。

动态可用性仍在 Skill Selection/Readiness 阶段判断。

## FR-CS-006 Narrative

MAY 使用 LLM 生成：

```text
CapabilityNarrative
```

Narrative 只是展示或 Prompt 压缩，不是结构化能力权威。

## FR-CS-007 增量重建

以下变化 MUST 触发 Summary 重建：

- Skill Enable/Disable；
- 当前 Skill Version 变化；
- Skill Outcome Specification 变化；
- Visibility 变化；
- Composition 变化。

---

# 12. 能力经验需求

## FR-CE-001 声明、观察和验证分层

能力状态 MUST 区分：

```text
Declared Capability
Observed Capability
Validated Capability
```

## FR-CE-002 Observed Capability

执行记录 MAY 表明某 Skill 曾产生特定 Effect/Evidence/Artifact，但不得自动修改 Skill 声明。

## FR-CE-003 Capability Experience

```ts
interface CapabilityExperienceEvidence {
  capability: string;
  skillRefs: SkillVersionRef[];
  applicableConditions: string[];
  successfulGoalPatterns: string[];
  failurePatterns: string[];
  observedSuccessCount: number;
  observedFailureCount: number;
  evidenceReliability: number;
  confidence: number;
  commonDependencies: string[];
  commonMissingPrerequisites: string[];
  experienceRefs: string[];
}
```

## FR-CE-004 Planner 使用

Capability Experience 只能用于：

- 候选能力排序；
- 提醒常见前置条件；
- 提醒失败模式；
- 建议 Evidence；
- 提醒能力限制。

不得用于：

- 绕过 Skill Outcome Compatibility；
- 绕过 Readiness；
- 自动选择高风险 Skill；
- 自动宣告能力可用。

---

# 13. 能力卡片生成需求

## FR-CC-001 公开投影

新增：

```text
CapabilityCardPublisher
```

根据 RuntimeCapabilitySummary 和公开策略生成 A2A Agent Card。

## FR-CC-002 当前 Skill Projection

每个公开 Skill MUST 继续保留：

```text
id
name
description
tags
inputModes
outputModes
```

## FR-CC-003 顶层能力总结

Agent Card 顶层 description SHOULD 根据公开 Capability Summary 生成稳定描述。

不得在每次 HTTP 请求时调用 LLM。

## FR-CC-004 Capability Profile Extension

MAY 增加：

```text
io.sdar/capabilityProfile
```

公开字段限于：

- profileVersion；
- catalogHash；
- domains；
- capabilities；
- public limitations；
- generatedAt。

## FR-CC-005 隐私

公开卡片不得包含：

- Provider Endpoint；
- Credential；
- Tool Policy 明细；
- 内部 Workflow；
- 私有经验；
- 用户数据；
- 失败统计；
- 当前资源状态；
- 内部 Skill；
- Prompt。

## FR-CC-006 卡片版本

Capability Card MUST 绑定：

```text
catalogHash
generationPolicyVersion
```

## FR-CC-007 降级

Narrative 生成失败时：

- 使用确定性模板；
- 继续提供 Agent Card；
- 不返回旧 Skill 集合对应的新 Hash。

---

# 14. 泛型任务理解需求

## FR-GT-001 泛型任务定义

符合以下任一条件的输入视为泛型任务候选：

- 目标描述过于宽泛；
- 缺少目标对象；
- 缺少完成标准；
- 缺少时间/空间范围；
- 缺少副作用授权；
- 缺少输出物；
- 包含多个潜在任务类型；
- 能力需求无法确定；
- 用户只表达问题而未表达期望结果。

## FR-GT-002 Understanding Service

新增：

```text
GenericTaskUnderstandingService
```

## FR-GT-003 输入

服务输入至少包括：

- 原始用户请求；
- Conversation Context；
- 当前 World State 摘要；
- Active Task Type Definitions；
- RuntimeCapabilitySummary；
- Policy；
- 可选 Planning Experience。

## FR-GT-004 输出

必须输出：

- interpretedObjective；
- Task Type Candidates；
- Capability Requirements；
- Known Constraints；
- Missing Dimensions；
- Assumptions；
- Confidence；
- Disposition。

## FR-GT-005 缺失维度

第一版 MUST 支持：

```text
target
scope
time_range
priority
completion_criteria
required_artifact
required_evidence
side_effect_authorization
risk_tolerance
degradation_policy
uncovered_case_policy
human_confirmation_policy
```

## FR-GT-006 禁止擅自补齐

关键缺失维度不得仅根据经验自动填充。

必须进入：

```text
clarification_required
```

## FR-GT-007 安全优先

涉及高风险设备操作但授权不明确时：

```text
confirmation_required
```

不得进入 Planning/Execution。

## FR-GT-008 任务类型非权威

Task Type Candidate 只帮助理解，不得覆盖用户原始表达。

---

# 15. 多轮目标澄清需求

## FR-IG-001 Interactive Goal Session

新增：

```text
InteractiveGoalSession
```

状态：

```text
understanding
→ awaiting_clarification
→ contract_candidate
→ awaiting_contract_confirmation
→ contract_confirmed
→ superseded / cancelled
```

## FR-IG-002 一次只问关键问题

系统 SHOULD 每轮优先询问一个最高信息增益问题。

## FR-IG-003 问题来源

问题 MUST 绑定：

- Missing Dimension；
- 影响的 Criterion；
- 风险；
- 规划阻断原因；
- Source Understanding Version。

## FR-IG-004 用户回答

用户回答后 MUST：

- 创建新 Understanding Revision；
- 更新 Assumption；
- 保存原回答；
- 不修改旧 Revision；
- 重新判断 Disposition。

## FR-IG-005 Contract Candidate

只有 Missing Critical Dimension 关闭后才可生成 Candidate UserGoalCompletionContract。

## FR-IG-006 用户确认

Contract 必须支持：

```text
accept
patch
reject
restart_understanding
cancel
```

## FR-IG-007 用户修订权威

用户修订后的字段优先级高于：

- Task Type Template；
- Experience；
- Capability Narrative；
- 默认策略。

## FR-IG-008 交互预算

必须有：

```text
maxClarificationRounds
maxContractRevisions
maxElapsedMs
```

预算耗尽时进入：

```text
input_required / failed
```

不得无限对话。

---

# 16. 交互式规划需求

## FR-IP-001 Plan Session

新增：

```text
InteractivePlanningSession
```

状态：

```text
planning
→ plan_candidate
→ awaiting_plan_confirmation
→ plan_revision
→ confirmed
→ superseded / cancelled
```

## FR-IP-002 候选计划

候选计划必须先通过基础结构校验，才可展示给用户：

- Schema；
- DAG；
- Coverage；
- Bounds；
- Capability Shape；
- Policy。

## FR-IP-003 展示内容

用户至少能看到：

- Skill Goal；
- Goal Objective；
- Dependency；
- Required Criterion Coverage；
- Required Capability；
- Required Evidence/Artifact；
- 并行关系；
- 风险；
- 需要确认的副作用；
- 能力缺口；
- 经验建议来源。

## FR-IP-004 用户动作

第一版 MUST 支持：

```text
accept_plan
reject_plan
request_replan
add_skill_goal
remove_skill_goal
patch_skill_goal
change_dependency
change_priority
change_completion_criterion
change_parallelism
change_confirmation_policy
```

## FR-IP-005 版本化修订

每次修改 MUST 创建新 UserGoalPlan Candidate Version。

不得原地修改。

## FR-IP-006 修订校验

每次用户修改后 MUST 重新执行：

- DAG Validation；
- Coverage；
- Capability Shape；
- Policy；
- Side Effect；
- Bounds；
- No Replay 检查。

## FR-IP-007 执行门禁

未确认 Plan 不得：

- 创建 Active SkillAttempt；
- 调用 MCP；
- 执行副作用；
- 激活 UserGoalPlan。

## FR-IP-008 自动确认

只有用户策略明确允许且：

- 无高风险副作用；
- 无关键 Assumption；
- 无 Capability Gap；
- Plan 由 Active Task Type/Heuristic 支持；
- Policy 允许；

才 MAY 自动确认。

## FR-IP-009 交互学习

每次 Plan 修订 MUST 写入 PlanningInteractionEpisode。

---

# 17. 规划经验注入需求

## FR-PR-001 Optional Input

UserGoalPlanningInput MUST 将经验定义为可选：

```ts
interface UserGoalPlanningInput {
  contract: UserGoalCompletionContract;
  capabilitySummary: RuntimeCapabilitySummary;
  worldState: GoalPlanningWorldState;
  planningExperience?: PlanningExperienceContext;
}
```

## FR-PR-002 Experience Context

```ts
interface PlanningExperienceContext {
  decompositionHints: PlanningHint[];
  dependencyHints: DependencyHint[];
  criterionLessons: CriterionLesson[];
  evidenceLessons: EvidenceLesson[];
  failurePatterns: FailurePattern[];
  riskLessons: RiskLesson[];

  applicability: {
    matchedConditions: string[];
    unmatchedConditions: string[];
    confidence: number;
  };

  sourceExperienceRefs: string[];
  contextHash: string;
}
```

## FR-PR-003 无经验回退

以下情况 MUST 正常调用基础 Planner：

- 无相关经验；
- Experience Repository 不可用；
- Retriever 超时；
- Context 校验失败；
- 经验低置信度；
- 经验矛盾；
- 经验与 Contract 冲突。

## FR-PR-004 双次规划回退

经验增强 Plan 被 Validator 拒绝时，系统 SHOULD 使用无经验输入执行一次有界重规划。

## FR-PR-005 经验使用记录

每次注入 MUST 保存：

```text
ExperienceUsageRecord
```

记录：

- 使用了哪些经验；
- 影响了哪些 Skill Goal；
- 是否被用户接受；
- 是否被 Validator 接受；
- 最终 Outcome；
- 是否产生反例。

---

# 18. 任务类型归纳需求

## FR-TI-001 来源

Task Type Candidate MAY 来源于：

- 多次相似 User Goal；
- 多次相似 Skill Goal DAG；
- 用户反复添加相同 Criterion；
- 用户反复添加相同 Skill Goal；
- 多次相同 Dependency 修订；
- 同类任务执行结果；
- 人工定义。

## FR-TI-002 归纳

新增：

```text
TaskTypeInductionService
```

它只生成 Candidate。

## FR-TI-003 任务类型内容

Task Type MUST 描述：

- 如何识别；
- 需要询问哪些维度；
- 常见完成标准；
- 常见能力需求；
- 常见 Skill Goal 模式；
- 常见依赖；
- 常见风险；
- 不适用条件。

## FR-TI-004 避免过拟合

一次 Episode 不得自动创建 Active Task Type。

## FR-TI-005 聚类边界

任务类型归纳不得仅依赖语义向量相似度。

必须同时考虑：

- Contract Criterion；
- Capability Requirement；
- Skill Goal Structure；
- Dependency；
- Artifact/Evidence；
- User Correction；
- Outcome。

## FR-TI-006 Active 使用

只有 Active Task Type 可用于：

- Generic Task Understanding；
- Missing Dimension Template；
- Candidate Contract；
- Candidate Skill Goal Pattern。

## FR-TI-007 不强制套用

Task Type 与当前用户约束冲突时必须放弃模板。

---

# 19. 能力模式归纳需求

## FR-CI-001 来源

Capability Pattern MAY 来源于：

- Skill Outcome Declaration；
- Skill Attempt Outcome；
- Evidence；
- Artifact；
- Progress；
- User Planning Correction；
- Recovery；
- Business Event Impact。

## FR-CI-002 不是 Skill

Capability Pattern 不得直接进入 Skill Selection。

它只描述：

```text
什么条件下通常需要什么能力
能力通常产生什么效果
需要什么前置和证据
```

## FR-CI-003 Skill 映射

每个 Capability Pattern MUST 映射当前精确 Skill Version，且允许映射为空。

映射为空表示：

```text
capability_gap_candidate
```

## FR-CI-004 能力缺口

反复出现但没有 Skill 支持的 Active Capability Pattern MAY 触发：

- 管理告警；
- Skill Authoring Candidate；
- 人工创建 Skill Proposal。

不得自动发布 Skill。

## FR-CI-005 Skill 版本变化

Supporting Skill Version 变化后，Capability Pattern MUST 重新验证。

---

# 20. 人机交互学习需求

## FR-HL-001 记录修订差异

系统 MUST 记录：

- 原理解；
- 用户回答；
- 原 Contract；
- Contract Patch；
- 原 Plan；
- Plan Patch；
- 修订原因；
- 最终接受版本；
- 最终执行结果。

## FR-HL-002 修订类型

第一版 MUST 分类：

```text
missing_target
missing_scope
missing_criterion
missing_artifact
missing_evidence
missing_capability
wrong_decomposition
wrong_dependency
wrong_priority
unsafe_side_effect
unnecessary_goal
parallelism_correction
degradation_correction
```

## FR-HL-003 学习条件

用户修订只有在以下至少一项满足后才可支持经验晋升：

- 最终执行成功；
- 用户明确说明通用性；
- 多次相似修订；
- 人工审核通过；
- 后续 Episode 验证。

## FR-HL-004 用户个性化与全局经验分离

用户偏好经验和全局任务经验 MUST 分开：

```text
user_scoped
tenant_scoped
global_candidate
```

## FR-HL-005 跨用户晋升

用户级经验不得自动晋升为全局经验。


---

# 21. 数据持久化需求

新增或扩展：

```text
goal_experience_episode
experience_observation
experience_extraction
planning_heuristic
experience_promotion_evaluation
experience_usage_record

runtime_capability_summary
capability_summary_item
capability_experience_evidence
public_capability_card_snapshot

generic_task_understanding
interactive_goal_session
interactive_goal_turn
interactive_planning_session
interactive_planning_revision
planning_interaction_episode

task_type_definition
task_type_evidence
capability_pattern_definition
capability_pattern_evidence
```

## FR-DB-001 PostgreSQL 权威

PostgreSQL 是以上对象的权威。

## FR-DB-002 不可变版本

以下对象 MUST 版本化且不可原地修改：

- Experience Episode；
- Planning Heuristic；
- Capability Summary；
- Capability Card；
- Task Understanding；
- Goal Contract Candidate；
- Plan Candidate；
- Task Type；
- Capability Pattern。

## FR-DB-003 Hash

每个对象 MUST 保存：

- sourceHash；
- contentHash；
- modelInvocationRef；
- policyVersion；
- createdAt。

## FR-DB-004 删除与保留

经验数据 MUST 支持：

- Retention；
- Tenant/User 删除；
- Source Episode 删除传播；
- PII 标记；
- Public Card 重建。

---

# 22. Model Runtime 需求

新增建议 Stage：

| 场景 | Stage |
|---|---|
| 泛型任务理解 | `task_understanding` |
| 缺失维度问题生成 | `task_clarification` |
| Contract 候选 | `goal_contract` |
| 交互式 Plan 修订 | `interactive_goal_planning` |
| 单 Episode 观察 | `experience_observation` |
| 跨 Episode 反思 | `experience_reflection` |
| Task Type 归纳 | `task_type_induction` |
| Capability Pattern 归纳 | `capability_induction` |
| Capability Narrative | `capability_summary` |

## FR-MR-001 Schema

所有 Stage MUST 使用结构化输出 Schema。

## FR-MR-002 Bound

每个 Stage MUST 有：

- maxInputBytes；
- maxOutputBytes；
- maxAttempts；
- timeout；
- model route；
- cost budget。

## FR-MR-003 权威限制

Model 不得：

- 激活 Task Type；
- 激活 Capability Pattern；
- 提交 Goal Contract；
- 激活 Plan；
- 执行副作用；
- 提交 Outcome；
- 修改 Skill Registry；
- 修改 Public Card 权威数据。

---

# 23. 状态机

## 23.1 Generic Task Understanding

```text
draft
→ analyzing
→ clarification_required
→ ready_for_contract
→ capability_gap
→ rejected
→ superseded
```

## 23.2 Interactive Goal Session

```text
understanding
→ awaiting_clarification
→ contract_candidate
→ awaiting_contract_confirmation
→ contract_confirmed
→ superseded
→ cancelled
```

## 23.3 Interactive Planning Session

```text
planning
→ plan_candidate
→ awaiting_plan_confirmation
→ plan_revision
→ confirmed
→ superseded
→ cancelled
```

## 23.4 Experience Observation

```text
pending
→ observing
→ candidate
→ validating
→ validated
→ rejected
→ superseded
```

## 23.5 Task Type/Capability Pattern

```text
candidate
→ validating
→ active
→ deprecated
→ rejected
```

---

# 24. 非功能需求

## NFR-001 非阻断

经验、反思、任务类型归纳和 Capability Narrative 失败不得阻断 v1.2.2 基础 Planner 和 Runtime。

## NFR-002 幂等

以下必须幂等：

- Episode Build；
- Observation；
- Reflection；
- Promotion；
- Capability Summary Build；
- Card Publish；
- Understanding Revision；
- Interaction Turn；
- Experience Injection。

## NFR-003 可解释

每次 Understanding、Plan、Experience、Promotion MUST 保存：

- Source Refs；
- Model Invocation；
- Policy Version；
- Reason Codes；
- Confidence；
- State Hash；
- User Revision；
- Promotion Basis。

## NFR-004 隐私

- 不保存私有思维链；
- 不跨租户泄露；
- PII 可删除；
- Public Card 不包含私有经验；
- User-scoped Memory 不自动全局化。

## NFR-005 安全

经验不得改变：

- Tool Policy；
- Safety Policy；
- Confirmation Policy；
- Provider Authority；
- Outcome Authority。

## NFR-006 性能

在线请求建议目标：

```text
Task Understanding P95 ≤ 3s（不含用户等待）
Experience Retrieval P95 ≤ 500ms
Capability Summary Cache Hit P95 ≤ 50ms
```

具体指标在实现设计阶段校准。

## NFR-007 成本

Observer/Reflector MUST 支持：

- Batch；
- Token Threshold；
- Async Buffer；
- Model Tier；
- Cost Budget；
- Backpressure。

## NFR-008 可恢复

重启后恢复：

- Interactive Goal Session；
- Interactive Planning Session；
- Pending Episode；
- Promotion Job；
- Capability Summary；
- Experience Injection Audit。

## NFR-009 有界

必须限制：

```text
maxClarificationRounds
maxContractRevisions
maxPlanRevisions
maxExperienceCandidatesPerGoal
maxRetrievedHeuristics
maxEpisodeBatch
maxReflectionDepth
maxPromotionAttempts
```

## NFR-010 一致性

Capability Summary 和 Card 必须绑定 catalogHash，禁止旧 Skill 集合与新 Card Hash 混用。

## NFR-011 可观测

必须提供：

- Experience Job Lag；
- Observation Failure；
- Promotion Rate；
- Contradiction Rate；
- Experience Usage；
- User Plan Revision；
- Card Generation；
- Capability Gap；
- Task Type Hit Rate。

---

# 25. 管理 API 需求

建议新增：

```text
GET  /api/v1/capabilities/summary
GET  /api/v1/capabilities/card
POST /api/v1/capabilities/card/rebuild

GET  /api/v1/experience/episodes
GET  /api/v1/experience/observations
GET  /api/v1/experience/heuristics
POST /api/v1/experience/heuristics/{id}/promote
POST /api/v1/experience/heuristics/{id}/reject

GET  /api/v1/task-types
GET  /api/v1/task-types/{id}
POST /api/v1/task-types/{id}/promote
POST /api/v1/task-types/{id}/reject

GET  /api/v1/capability-patterns
POST /api/v1/capability-patterns/{id}/promote
POST /api/v1/capability-patterns/{id}/reject

GET  /api/v1/tasks/{taskId}/understanding
GET  /api/v1/tasks/{taskId}/planning-interactions
POST /api/v1/tasks/{taskId}/goal-contract/actions
POST /api/v1/tasks/{taskId}/plan/actions
```

所有管理动作 MUST：

- 鉴权；
- 审计；
- expectedVersion；
- 幂等；
- 不直接执行副作用。

---

# 26. Console 需求

Console SHOULD 展示：

## 26.1 Task Understanding

- 原始请求；
- 当前理解；
- Task Type Candidates；
- Missing Dimensions；
- Assumptions；
- Confidence；
- 澄清历史。

## 26.2 Goal Contract

- Candidate/Confirmed Version；
- Criteria；
- Artifact/Evidence；
- 用户 Patch；
- Contract Diff。

## 26.3 Interactive Plan

- Skill Goal DAG；
- Criterion Coverage；
- Capability Requirement；
- Experience Hint；
- Risk；
- 用户修订；
- Plan Diff；
- Confirm/Reject/Replan。

## 26.4 Experience

- Episode；
- Observation；
- Lesson；
- Support/Contradiction；
- Promotion；
- 使用结果。

## 26.5 Capability

- Runtime Capability Summary；
- Declared/Observed/Validated；
- Capability Gap；
- Public Capability Card；
- catalogHash。

## 26.6 Task Type

- Candidate/Active；
- Recognition；
- Required Dimensions；
- Typical Criteria；
- Capability Pattern；
- Evidence；
- Contradiction。

---

# 27. A2A 状态映射

| 内部状态 | A2A |
|---|---|
| Generic Task Understanding | `working` |
| 需要用户澄清 | `input-required` |
| 等待 Goal Contract 确认 | `input-required` |
| 等待 Plan 确认 | `input-required` |
| 用户修订处理中 | `working` |
| Plan confirmed / executing | `working` |
| User Goal achieved | `completed` |
| 用户取消 | `cancelled` |
| Capability Gap / Unachievable | `failed` 或 `input-required`，按合同 |

A2A 状态不增加私有枚举。

---

# 28. 关键验收场景

1. 模糊请求被识别为泛型任务；
2. 系统识别缺少目标对象；
3. 系统识别缺少完成标准；
4. 高风险操作缺少授权时请求确认；
5. 用户回答后 Understanding 创建新 Revision；
6. Contract Candidate 生成；
7. 用户修改 Criterion；
8. 用户拒绝 Contract 并重新理解；
9. Skill Goal Plan 生成并展示；
10. 用户增加 Skill Goal；
11. 用户删除不必要 Skill Goal；
12. 用户修改 Dependency；
13. 修改后 DAG 出现环被拒绝；
14. 修改后 Required Criterion 未覆盖被拒绝；
15. 未确认 Plan 不产生副作用；
16. 确认 Plan 进入 v1.2.2 Runtime；
17. Task 完成后异步创建 Experience Episode；
18. Episode 缺少 User Goal Judgment 时拒绝归纳；
19. Observer 失败不影响 A2A Terminal；
20. Reflector 输出非法 Schema 被拒绝；
21. 单次修订只生成 Candidate Lesson；
22. 多次相同修订形成 Candidate Task Type；
23. Candidate Task Type 未晋升前不影响正式理解；
24. Active Task Type 提醒缺失维度；
25. Task Type 与用户约束冲突时放弃模板；
26. Skill Registry 变化触发 Capability Summary；
27. 相同 Skill 集合生成相同 catalogHash；
28. Capability Narrative 失败使用确定性模板；
29. Public Card 不泄露内部 Tool/Provider；
30. Capability Experience 不绕过 Readiness；
31. 无经验时基础 Planner 正常运行；
32. Experience Repository 故障时基础 Planner 正常运行；
33. 经验增强 Plan 失败后无经验重规划；
34. Experience Usage 记录用户是否接受；
35. 经验产生反例后进入 validating；
36. 高风险 Heuristic 必须人工批准；
37. User-scoped 修订不自动全局化；
38. Capability Pattern 无 Skill 映射时产生 Capability Gap Candidate；
39. Capability Gap 不自动创建正式 Skill；
40. 重启后恢复交互 Session；
41. 重启后恢复 Pending Experience Job；
42. Clarification Round 超限后停止；
43. Plan Revision 超限后停止；
44. A2A Agent Card 动态反映当前公开能力；
45. Card catalogHash 与 Skill Registry 一致；
46. Active Task Type 版本变化保留历史；
47. 用户取消交互不进入执行；
48. Experience 中不保存私有思维链；
49. 跨租户经验隔离；
50. 完整在线和离线闭环 E2E 通过。

---

# 29. 发布门禁

v1.2.3 不得发布，除非：

- v1.2.2 完整 Release Gate 已通过；
- 所有新 Domain/Schema 已评审；
- 在线链在无 Experience 情况下完整通过；
- Experience Failure 不阻断测试通过；
- Capability Summary Deterministic Test 通过；
- Public Capability Card 隐私检查通过；
- Generic Task Understanding 核心场景通过；
- Multi-turn Goal/Plan Interaction 通过；
- 用户修订 Traceability 通过；
- Candidate/Active Promotion Gate 通过；
- 高风险经验人工门禁通过；
- Task Type/Capability Pattern 不自动越权；
- Restart/Concurrency/Idempotency 通过；
- Cost/Capacity/Backpressure 通过；
- Management API/OpenAPI/Console 更新；
- Security/PII/Tenant Isolation 通过；
- A2A MUST TCK 通过；
- Release Report 明确经验为 Advisory，不是完成权威。

---

# 30. 关键设计不变量

1. v1.2.2 是唯一执行与 Outcome 基础；
2. v1.2.3 不引入第二套 Workflow Runtime；
3. PostgreSQL 是运行和知识权威；
4. 经验是 Advisory Input；
5. 用户确认后的 Goal Contract 是任务意图权威；
6. Skill Registry 是声明能力权威；
7. Provider Readiness 是当前执行可用性权威；
8. Outcome Judge 是目标完成权威；
9. Capability Summary 不等于当前可执行性；
10. Public Capability Card 是授权后的公开投影；
11. Candidate Task Type 默认不可用于正式规划；
12. Candidate Capability Pattern 不是 Skill；
13. 一次用户修订不能自动形成全局规则；
14. User-scoped 经验不得自动全局化；
15. 高风险知识晋升必须人工审核；
16. 未确认 Goal Contract/Plan 不执行副作用；
17. 经验系统失败不阻断基础规划；
18. 经验增强 Plan 仍必须通过 SkillGoalPlanValidator；
19. 不保存私有思维链；
20. 所有学习结果可追踪、可版本化、可撤销。

---

# 31. 建议实施阶段

## Phase 0：需求、Domain 与 Promotion Policy

- Requirements Freeze；
- Domain Schema；
- State Machine；
- Knowledge Authority；
- Promotion Policy；
- Privacy/Tenant Policy；
- Traceability。

## Phase 1：Capability Summary 与 Card

- CapabilitySummaryBuilder；
- catalogHash；
- Public Projection；
- Agent Card；
- Management/Console。

## Phase 2：Generic Task Understanding

- Task Understanding；
- Missing Dimensions；
- Task Type Candidate Retrieval；
- Contract Candidate。

## Phase 3：Interactive Goal/Plan

- Interactive Sessions；
- Multi-turn Input；
- Contract Diff；
- Plan Diff；
- Confirmation Gate；
- Planning Interaction Episode。

## Phase 4：Experience Capture 与 Observation

- Episode Builder；
- Async Outbox；
- Observer；
- Extractor；
- Failure/Retry；
- Management View。

## Phase 5：Reflection、Task Type 与 Capability Induction

- Reflector；
- Candidate Lessons；
- Task Type Induction；
- Capability Pattern Induction；
- Contradiction。

## Phase 6：Promotion 与 Planning Injection

- Promotion Gate；
- Active Knowledge；
- Planning Experience Retrieval；
- Optional Planner Injection；
- Fallback；
- Usage Evaluation。

## Phase 7：Hardening 与发布

- Full E2E；
- Restart；
- Capacity；
- Security；
- Tenant Isolation；
- Console；
- Release Report。

---

# 32. 最终定义

```text
SDAR v1.2.3
=
基于 v1.2.2 结构化执行事实的经验观察与总结
+
基于 Skill 声明和执行证据的能力认知
+
稳定、可追溯、可授权的能力卡片
+
泛型任务理解和缺失维度识别
+
多轮人机交互式目标合同与规划确认
+
从用户修订和执行结果中归纳任务类型与能力模式
+
经过验证和晋升后反哺后续 User Goal Planning
```

其最终闭环为：

```text
User Request
→ Understand
→ Clarify
→ Confirm Goal
→ Summarize Capability
→ Retrieve Experience
→ Plan
→ Human Revise/Confirm
→ v1.2.2 Execute/Judge/Recover
→ Build Episode
→ Observe/Reflect
→ Validate/Promote
→ Reuse
```
