# SDAR v1.2.3 最佳实现方案 V1.0

## 融合 Mastra、Codex 与 Claude Code 的经验驱动任务理解、能力认知和人机协同规划

> **文档状态：** Implementation Design Candidate  
> **目标版本：** SDAR v1.2.3  
> **上位需求：** `SDAR_v1.2.3_Upgrade_Requirements_V0.1.md`  
> **前置版本：** SDAR v1.2.2 User Goal Planning Runtime  
> **适用仓库：** `zhouwen-giser/skill-driven-agent-runtime`  
> **实现原则：** 借鉴机制，不引入第二套 Agent/Workflow/Memory Runtime  
> **运行权威：** PostgreSQL + v1.2.2 Goal Runtime + LangGraph.js  
> **外部参考基线日期：** 2026-07-22  
> **参考来源：**
> - Mastra Observational Memory、Memory Extractors、Task Lists；
> - Codex Goal Mode、Skills、Record & Replay、Hooks；
> - Claude Code Plan Mode、Auto Memory、Hooks、Permission Modes。
> **替代关系：** 本文是 v1.2.3 的实现方案，不替代上位需求。

---

# 1. 执行结论

v1.2.3 最佳实现方式不是把 Mastra、Codex 或 Claude Code 作为依赖接入 SDAR，而是将三者的优势重组为 SDAR 自有的五个内核：

```text
Mastra
→ Experience Observation Kernel

Claude Code
→ Interactive Planning Kernel

Codex
→ Reusable Knowledge Packaging + Goal Steering + Verification

SDAR v1.2.2
→ Goal / Skill / Outcome / Recovery Authority

最终：
SDAR v1.2.3 Cognitive Planning Runtime
```

总体架构：

```text
┌────────────────────── 在线任务闭环 ──────────────────────┐
│                                                         │
│ User Request                                            │
│   → Generic Task Understanding                          │
│   → Missing Dimension Interview                         │
│   → User Goal Contract Candidate                        │
│   → Human Confirm / Patch                               │
│   → Capability Index + Experience Context               │
│   → Skill Goal Plan Candidate                           │
│   → Human Review / Edit / Confirm                       │
│   → v1.2.2 Execute / Judge / Recover                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Transactional Runtime Facts
                           ▼
┌────────────────────── 离线学习闭环 ──────────────────────┐
│                                                         │
│ Episode Builder                                         │
│   → Observer                                             │
│   → Typed Extractors                                     │
│   → Reflector                                            │
│   → Candidate Knowledge                                  │
│   → Support / Contradiction / Replay Evaluation          │
│   → Human / Policy Promotion                             │
│   → Active Task Type / Planning Heuristic / Capability   │
│                                                         │
└─────────────────────────────────────────────────────────┘
                           │
                           └────────→ 反哺下一次任务理解和拆解
```

版本最重要的三个技术判断：

1. **经验事实库与在线 Memory 必须分开。**  
   Goal Episode、Observation、反例和晋升状态使用规范化结构持久化；现有 MemoryService 只承载已经晋升且适合检索的知识投影。

2. **用户规划修订必须是一等业务事实。**  
   不能只保存最终计划；必须保存原理解、原合同、原计划、每次 Patch、用户原因和最终 Outcome，才能真正学习任务类型和能力模式。

3. **经验不得直接控制执行。**  
   经验只能改变 Planner 的候选空间；最终仍经过 User Goal Contract、SkillGoalPlanValidator、Skill Selection、Provider Readiness、Policy 和 Outcome Judge。

---

# 2. 三个参考项目的最优融合

## 2.1 Mastra：采用经验观察内核

借鉴：

```text
Observer
Reflector
Typed Extractor
Async Buffer
Token Threshold
Stable Context Projection
Observation / Reflection Telemetry
```

在 SDAR 中映射为：

```text
GoalExperienceEpisode
→ ExperienceObserver
→ ExperienceExtractor
→ ExperienceReflector
→ Candidate Knowledge
```

不采用：

- Mastra Agent Runtime；
- Mastra Workflow Runtime；
- Mastra Storage 作为权威；
- 将自由文本 Observation 直接当作正式经验；
- 将会话 Token 阈值作为唯一触发条件。

原因：

SDAR 的经验来源不是单纯会话，而是：

```text
Goal Contract
Plan DAG
Attempt
Workflow
Outcome Judgment
Progress
Recovery
Business Event Impact
Human Revision
```

所以需要在 Mastra 风格 Observer 之前增加：

```text
GoalExperienceEpisodeBuilder
```

把结构化事实转换为受控观察输入。

## 2.2 Claude Code：采用只读 Plan Mode 和多轮修订

借鉴：

```text
Read-only Plan Mode
Plan Review
Keep Planning with Feedback
Direct Plan Editing
Permission Modes
Auto Memory from Corrections
Lifecycle Hooks
```

在 SDAR 中映射为：

```text
understanding_mode
goal_contract_review_mode
plan_review_mode
execution_mode
```

并形成：

```text
InteractiveGoalSession
InteractivePlanningSession
PlanningInteractionEpisode
```

不采用：

- 将 Markdown Plan 作为运行权威；
- 将自由文本 Memory 直接注入高风险规划；
- 将 Permission Mode 替代 SDAR Policy；
- 未版本化的原地 Plan 编辑。

SDAR 中每次用户编辑必须转换为结构化 Patch：

```text
User Patch
→ Candidate Revision
→ Deterministic Validation
→ New Immutable Version
```

## 2.3 Codex：采用 Goal、Skill 沉淀和验证优先

借鉴：

```text
Goal Mode
Outcome + Constraints + Verification
Pause / Resume / Edit Goal
Progress Tracking
Skills Progressive Disclosure
Record & Replay
Lifecycle Hooks
Evidence-driven Completion
```

在 SDAR 中映射为：

```text
User Goal Contract
Goal Progress Snapshot
Planning Knowledge Package
Task Type Progressive Disclosure
Planning Interaction Replay Harness
Experience Promotion Evidence
```

最关键的两个借鉴：

### Progressive Disclosure

初始 Planner Context 只放：

```text
Task Type:
  id
  name
  short description
  trigger boundary
  confidence

Capability:
  id
  domain
  short description
  effects summary
  limitations summary
```

只有被召回的 Top-K Task Type、Capability 和 Heuristic 才加载完整定义。

### Record & Replay

SDAR 不回放物理副作用，而是回放：

```text
Task Understanding
Goal Contract Generation
Skill Goal Plan Generation
Validator
Outcome Evaluation
```

用于证明候选经验确实改善规划。

---

# 3. 不引入三套运行时

## 3.1 运行时边界

v1.2.3 MUST 保持：

```text
LangGraph.js
→ 唯一 Workflow Runtime

PostgreSQL
→ 唯一持久化权威

Redis/BullMQ
→ 可重建异步执行层

SDAR Model Runtime
→ 唯一模型调用入口

v1.2.2 UserGoalPlanController
→ 唯一 User Goal / A2A Terminal Authority
```

## 3.2 不直接依赖 Mastra

推荐：

```text
Mastra-inspired implementation
```

不推荐：

```text
@mastra/core
@mastra/memory
```

作为产品运行依赖。

原因：

- SDAR 已有 Model Runtime；
- SDAR 已有 PostgreSQL Memory；
- SDAR 已有 LangGraph Runtime；
- SDAR 经验输入不是 Mastra Message Thread；
- 直接接入会产生双 Processor Lifecycle；
- 会形成双 Storage Authority；
- 上游 API 变化会影响核心任务理解。

可选择性参考或移植 Apache-2.0 算法时，必须：

- 记录源文件和 commit；
- 保留 License/Notice；
- 去除 Mastra Runtime 类型；
- 通过 SDAR Port 封装；
- 不复制 `ee/` 目录内容；
- 增加独立 Contract Test。

## 3.3 Codex 和 Claude Code 仅作为交互范式参考

两者均不作为可嵌入 Runtime。

SDAR 重新实现：

- Goal Steering；
- Plan Review；
- Plan Patch；
- Memory from Correction；
- Hook Lifecycle；
- Knowledge Package。

---

# 4. 总体模块架构

```text
packages/domain
├── experience
├── knowledge-promotion
├── capability-cognition
├── generic-task-understanding
├── interactive-goal
├── interactive-planning
├── task-type
└── capability-pattern

packages/application
├── goal-experience-episode-builder
├── experience-observer
├── experience-reflector
├── experience-extractor
├── experience-promotion
├── planning-experience-retriever
├── capability-summary
├── capability-card
├── generic-task-understanding
├── missing-dimension-question
├── interactive-goal-session
├── interactive-planning-session
├── task-type-induction
├── capability-pattern-induction
└── planning-knowledge-projection

packages/persistence-postgres
├── experience repositories
├── capability repositories
├── interactive planning repositories
├── knowledge promotion repositories
└── outbox repositories

packages/runtime-redis
├── experience episode queue
├── observer queue
├── reflector queue
├── promotion queue
└── capability rebuild queue

packages/a2a-adapter
├── input-required projection
├── planning interaction actions
└── capability profile projection

packages/management-api
├── experience API
├── capability API
├── task type API
└── interactive planning API

apps/console
├── task understanding
├── goal contract review
├── plan DAG review
├── experience governance
├── capability cognition
└── task type governance
```

---

# 5. 核心分层

## 5.1 L0：v1.2.2 运行事实层

只读输入：

```text
UserGoalCompletionContract
UserGoalPlan
SkillGoal
SkillAttempt
WorkflowExecutionOutcome
TaskGoalOutcomeJudgment
SkillGoalOutcomeJudgment
UserGoalOutcomeJudgment
GoalProgressSnapshot
WorkflowRecoveryAssessment
BusinessEventImpactAssessment
CompletedEffect
Planning Interaction
```

该层是经验归纳的事实来源。

## 5.2 L1：Episode 层

将同一 Goal 生命周期的事实组装为：

```text
GoalExperienceEpisode
```

职责：

- 统一时间顺序；
- 解析 Plan Revision 链；
- 解析 Attempt 和 Outcome；
- 计算事实完整度；
- 生成 Episode Hash；
- 脱敏；
- 过滤私有思维链；
- 标记事实 Authority。

## 5.3 L2：Observation 层

输出：

```text
ExperienceObservation
ExtractedExperienceFact
CandidateLesson
```

职责：

- 单 Episode 压缩；
- 事实/推断/建议分离；
- 结构化提取；
- 对用户修订进行语义归类；
- 识别重要失败、恢复和证据缺口。

## 5.4 L3：Reflection 层

输出：

```text
CrossEpisodeReflection
CandidateTaskType
CandidatePlanningHeuristic
CandidateCapabilityPattern
```

职责：

- 合并相似 Episode；
- 发现重复修订；
- 发现支持和反例；
- 发现适用条件；
- 发现能力缺口；
- 生成候选知识，不激活。

## 5.5 L4：Promotion 层

负责：

```text
candidate
→ validating
→ active / rejected
```

使用：

- 确定性门禁；
- 历史回放；
- Shadow Planning；
- 用户接受率；
- Outcome 改善；
- 反例比例；
- 风险等级；
- 人工审核。

## 5.6 L5：Serving 层

仅服务 Active Knowledge：

```text
Active Task Type Index
Active Planning Heuristic Index
Active Capability Pattern Index
Capability Summary Snapshot
Public Capability Card Snapshot
```

Planner 不直接查询 Candidate 表。

---

# 6. 对现有 SDAR 资产的复用

## 6.1 MemoryService 的正确定位

当前 MemoryService 已具备：

- Memory Type；
- Authority；
- Durability；
- Confidence；
- Source Refs；
- Vector Search；
- Supersede/Invalidate；
- Model Refinement。

v1.2.3 不应废弃它，而应将其定位为：

```text
Active Knowledge Retrieval Projection
```

正确关系：

```text
Structured Experience / Task Type / Heuristic
→ Promotion
→ Active Knowledge Projection
→ MemoryService / pgvector
→ Planner Retrieval
```

不正确：

```text
Raw Runtime Trace
→ MemoryService
→ 直接影响 Planner
```

建议新增 Memory Type：

```text
planning_heuristic_projection
task_type_projection
capability_pattern_projection
user_planning_preference
```

MemoryItem 中只保存检索摘要和权威对象引用：

```json
{
  "knowledgeType": "planning_heuristic",
  "knowledgeId": "ph-123",
  "knowledgeVersion": 3,
  "statement": "...",
  "applicabilitySummary": "...",
  "sourceHash": "..."
}
```

完整数据仍从结构化 Repository 读取。

## 6.2 SkillEvolutionService 的正确复用

现有 Skill Evolution 已包含：

```text
Experience Threshold
Induction
Duplicate Check
Static Validation
Simulation
Historical Replay
Correction
Publication
```

可抽取通用组件：

```text
EvidenceThresholdEvaluator
DuplicateCandidateDetector
ReplayEvaluationRunner
PromotionCaseRunner
CorrectionDiffRecorder
```

形成：

```text
KnowledgePromotionFramework
```

但必须修改以下边界：

- Task Type/Heuristic/Capability Pattern 不得调用 Skill Registry publish；
- 高风险候选不得自动激活；
- 一次成功阈值不得等同于通用性；
- 必须保存反例；
- Replay 不得调用真实物理 Tool；
- Skill 自动发布与 Planning Knowledge 晋升分离。

## 6.3 Skill Catalog 和 A2A Card

当前 Agent Card 的 Skill 列表继续作为公开明细。

v1.2.3 增加：

```text
RuntimeCapabilitySummary
PublicCapabilityCardSnapshot
```

Agent Card 构建不再直接临时读取全部 Skill 并拼装自然语言，而是：

```text
Enabled Skill Set
→ CapabilitySummaryBuilder
→ Capability Summary Snapshot
→ Public Projection Policy
→ Capability Card Snapshot
→ A2A Agent Card
```

---

# 7. 经验内核设计

## 7.1 GoalExperienceEpisodeBuilder

### 触发

通过 Transactional Outbox 监听：

```text
user_goal.terminal_committed
user_goal_plan.superseded
workflow_recovery.assessed
business_event_impact.plan_invalidated
planning_session.confirmed
planning_session.cancelled
```

### 流程

```text
Outbox Event
→ Acquire Episode Build Lease
→ Read Persisted Facts
→ Validate Authority
→ Redact / Normalize
→ Compute Completeness
→ Compute Episode Hash
→ Insert Immutable Episode Revision
→ Enqueue Observer
```

### 完整度

```ts
interface EpisodeCompleteness {
  contract: boolean;
  currentPlan: boolean;
  terminalJudgment: boolean;
  skillGoalCoverage: number;
  attemptCoverage: number;
  progressCoverage: number;
  interactionCoverage: number;
}
```

缺少以下对象时不进入 Observer：

```text
User Goal Contract
Current Plan
User Goal Judgment
Authority References
```

## 7.2 ExperienceObserver

采用 Mastra 风格，但输入是 Episode。

### 输入分区

```text
A. Goal and Contract
B. Plan Revisions
C. Skill Goal / Attempt Timeline
D. Outcome and Progress
E. Recovery and Events
F. Human Corrections
G. Previous Episode Observation（有界）
```

### 输出

```ts
interface ExperienceObserverOutput {
  factualSummary: ExperienceFact[];
  humanCorrectionSummary: HumanCorrectionFact[];
  successFactors: CandidateFactor[];
  failureFactors: CandidateFactor[];
  decompositionLessons: CandidateLesson[];
  dependencyLessons: CandidateLesson[];
  criterionLessons: CandidateLesson[];
  evidenceLessons: CandidateLesson[];
  recoveryLessons: CandidateLesson[];
  unresolvedUncertainty: UncertaintyItem[];
}
```

### Typed Extractors

每个 Extractor 独立失败：

```text
GoalPatternExtractor
TaskTypeSignalExtractor
DecompositionExtractor
DependencyExtractor
CriterionExtractor
EvidenceExtractor
CapabilityExtractor
FailureExtractor
RecoveryExtractor
HumanCorrectionExtractor
```

一个 Extractor 失败不得使其他结果失效。

## 7.3 ExperienceReflector

### 批次

按以下维度分批：

```text
tenant
taskTypeCandidate
goalPatternFingerprint
capabilityFingerprint
time window
```

### 输入

- 新 Observation；
- 相关 Active/Candidate Knowledge；
- 支持 Episode；
- 反例 Episode；
- Skill Catalog Hash；
- Policy Version。

### 输出

```text
CandidatePlanningHeuristic
CandidateTaskTypeRevision
CandidateCapabilityPatternRevision
ContradictionFinding
SupersedeSuggestion
```

Reflector 不写 Active 状态。

## 7.4 异步缓冲

借鉴 Mastra Async Buffer：

```text
Episode Created
→ Queue Immediately
→ Small Batch Observer
→ Accumulated Observation Threshold
→ Background Reflection
```

建议初始默认：

```text
observerBatchMaxEpisodes = 8
observerBatchMaxInputBytes = 512 KB
reflectionTriggerNewObservations = 20
reflectionTriggerTokenEstimate = 40,000
reflectionBatchMaxObservations = 100
```

这些为实施建议值，最终由性能测试调整。

## 7.5 Temporal Anchoring

每条经验保存：

```text
observedAt
sourceOccurredAt
sourceCompletedAt
knowledgeValidFrom
knowledgeLastVerifiedAt
```

避免将过去正确的规则永久当作当前事实。

---

# 8. Knowledge Promotion Framework

## 8.1 统一候选接口

```ts
interface KnowledgeCandidate {
  candidateId: string;
  candidateType:
    | "planning_heuristic"
    | "task_type"
    | "capability_pattern";

  contentHash: string;
  sourceEpisodeRefs: string[];

  supportCount: number;
  contradictionCount: number;

  confidence: number;
  riskLevel: "low" | "medium" | "high" | "critical";

  status:
    | "candidate"
    | "validating"
    | "active"
    | "rejected"
    | "deprecated";

  createdAt: string;
}
```

## 8.2 晋升证据

```ts
interface PromotionEvidence {
  uniqueGoalCount: number;
  uniqueUserCount: number;
  successfulOutcomeCount: number;
  failedOutcomeCount: number;

  userAcceptedPlanningCount: number;
  userRejectedPlanningCount: number;

  replayPassedCount: number;
  replayFailedCount: number;

  shadowImprovedCount: number;
  shadowRegressedCount: number;

  supportingRefs: string[];
  contradictingRefs: string[];
}
```

## 8.3 晋升门禁

推荐第一版：

### Planning Heuristic

```text
supportingGoalCount ≥ 3
contradictionRatio ≤ 0.25
at least 2 successful outcomes
replay pass
risk != high/critical
```

### Task Type

```text
supportingGoalCount ≥ 5
at least 3 distinct user requests
required dimensions stable
criterion coverage stable
shadow understanding improves
human approval
```

### Capability Pattern

```text
supportingGoalCount ≥ 5
at least 1 current Skill mapping
effect/evidence consistency
no safety-policy contradiction
human approval
```

### 高风险知识

必须：

```text
Human Approval
+
Replay
+
Shadow Evaluation
+
Explicit Policy Allow
```

## 8.4 反例处理

新的反例触发：

```text
active
→ validating
```

在 `validating` 期间：

- 仍可用于解释；
- 不用于自动补齐；
- 不用于自动确认；
- Planner 注入时标注 degraded；
- 达到反例阈值后 deprecated/rejected。

## 8.5 Shadow Planning

每个 Candidate 可在后台执行：

```text
Baseline Planning
vs
Candidate-enhanced Planning
```

比较：

- Criterion Coverage；
- DAG Validity；
- Plan Size；
- Capability Gap；
- User Patch 数；
- 最终 Outcome；
- Attempt 数；
- Recovery 数；
- No-progress 数；
- Token/Latency。

只有改善且不增加风险时才支持晋升。

---

# 9. 能力认知内核

## 9.1 CapabilitySummaryBuilder

必须确定性执行。

输入：

```text
Enabled SkillVersion[]
SkillUsageSpecification
SkillOutcomeSpecification
Visibility
Composition
Context Requirements
Evidence Policy
Runtime Policy
```

输出：

```ts
interface RuntimeCapabilitySummary {
  summaryId: string;
  catalogHash: string;
  policyVersion: string;

  capabilityIndex: CapabilityIndexEntry[];
  domainSummaries: CapabilityDomainSummary[];
  compositionPatterns: CapabilityCompositionPattern[];
  limitations: CapabilityLimitation[];

  generatedAt: string;
}
```

## 9.2 Catalog Hash

```text
Sort exact Skill Version refs
→ Canonicalize declarations
→ SHA-256
```

Hash 输入不包含：

- 当前 Provider Readiness；
- 当前设备状态；
- 经验成功率；
- LLM Narrative；
- 生成时间。

相同 Skill 集合和声明必须得到相同 Hash。

## 9.3 Progressive Disclosure

借鉴 Codex Skills：

### Level 0：Capability Index

Planner 初始只读取：

```ts
interface CapabilityIndexEntry {
  capability: string;
  domain: string;
  shortDescription: string;
  effectSummary: string[];
  limitationSummary: string[];
  detailRef: string;
}
```

限制：

```text
maxInitialCapabilityItems = 64
maxInitialCapabilityChars = 8,000
```

### Level 1：Capability Detail

只对 Top-K 候选加载：

- Skill refs；
- Effects；
- Evidence；
- Artifacts；
- Context；
- Composition；
- Risks；
- Known limitations。

### Level 2：Exact Skill

只在 Skill Selection 阶段读取精确 Skill Version。

## 9.4 Capability Experience

经验不修改 Capability Summary，而形成并行投影：

```text
Declared Capability Summary
+
Capability Experience Evidence
→ Planning Capability Context
```

Planner 可知道：

- 何时容易失败；
- 常见前置能力；
- 哪类证据可靠；
- 用户常修订什么。

但当前可用性仍由 Readiness 判断。

## 9.5 Public Capability Card

### 生成链

```text
Runtime Capability Summary
→ Public Visibility Filter
→ Public Capability Profile
→ Optional Narrative Generator
→ Deterministic Validation
→ Snapshot
→ A2A Agent Card
```

### LLM Narrative

仅生成：

- 顶层 description；
- domain descriptions；
- human-readable limitations。

Narrative 失败使用模板。

### A2A Extension

建议增加：

```text
io.sdar/capabilityProfile
```

内容：

```json
{
  "profileVersion": "1.0",
  "catalogHash": "...",
  "domains": [],
  "capabilities": [],
  "limitations": [],
  "generatedAt": "..."
}
```

不公开：

- Tool；
- Provider；
- Workflow；
- 用户经验；
- 失败统计；
- 当前资源状态。

---

# 10. 泛型任务理解内核

## 10.1 三阶段理解

```text
Stage A: Intent Framing
Stage B: Task Type / Capability Matching
Stage C: Missing Dimension Analysis
```

## 10.2 输入

```ts
interface GenericTaskUnderstandingInput {
  requestText: string;
  conversationContext: ConversationContextSummary;
  worldStateSummary?: WorldStateSummary;

  activeTaskTypeIndex: TaskTypeIndexEntry[];
  capabilityIndex: CapabilityIndexEntry[];

  userPreferenceMemory?: UserPlanningPreference[];
  activePlanningHeuristics?: PlanningHeuristicIndexEntry[];

  policy: TaskUnderstandingPolicy;
}
```

## 10.3 输出

```ts
interface GenericTaskUnderstanding {
  interpretedObjective: string;

  taskTypeCandidates: TaskTypeCandidate[];
  capabilityRequirements: CapabilityRequirement[];

  knownDimensions: TaskDimensionValue[];
  missingDimensions: MissingTaskDimension[];
  assumptions: PlanningAssumption[];

  disposition:
    | "ready_for_contract"
    | "clarification_required"
    | "confirmation_required"
    | "capability_gap";

  confidence: number;
}
```

## 10.4 缺失维度分类

### Blocking

```text
target
scope
completion_criteria
side_effect_authorization
high_risk_boundary
```

### Conditionally Blocking

```text
time_range
required_artifact
required_evidence
degradation_policy
uncovered_case_policy
```

### Non-blocking

```text
display preference
narrative format
optional prioritization
```

关键维度不得由经验静默补齐。

## 10.5 信息增益问题

`MissingDimensionQuestionService` 计算：

```text
blocking impact
× uncertainty
× downstream plan divergence
× safety impact
```

每轮优先问一个问题。

可以一次询问多个高度相关且用户可一次回答的字段，但第一版建议：

```text
maxQuestionsPerTurn = 1
maxClarificationRounds = 5
```

## 10.6 Task Type Progressive Disclosure

初始只向模型提供 Task Type Index：

```text
id
name
description
trigger boundaries
required dimension names
confidence
```

选中 Top-3 后再读取完整：

- Recognition；
- Criteria Template；
- Capability Requirements；
- Skill Goal Patterns；
- Dependencies；
- Risks；
- Negative examples。

---

# 11. 人机协同规划内核

## 11.1 模式设计

借鉴 Claude Code Plan Mode：

```text
UNDERSTAND
→ 可读，不产生 Goal Contract Authority

GOAL_REVIEW
→ 只生成/修改 Contract Candidate

PLAN_REVIEW
→ 只生成/修改 UserGoalPlan Candidate

EXECUTE
→ 仅在 Contract 和 Plan confirmed 后进入
```

## 11.2 Session

```ts
interface InteractiveGoalSession {
  sessionId: string;
  taskId: string;
  status:
    | "understanding"
    | "awaiting_clarification"
    | "contract_candidate"
    | "awaiting_contract_confirmation"
    | "contract_confirmed"
    | "cancelled"
    | "superseded";

  currentUnderstandingVersion: number;
  currentContractCandidateVersion?: number;
  expectedVersion: number;
}
```

```ts
interface InteractivePlanningSession {
  sessionId: string;
  taskId: string;
  goalId: string;
  goalVersion: number;

  status:
    | "planning"
    | "plan_candidate"
    | "awaiting_plan_confirmation"
    | "plan_revision"
    | "confirmed"
    | "cancelled"
    | "superseded";

  currentPlanCandidateVersion: number;
  expectedVersion: number;
}
```

## 11.3 Plan Review Actions

```text
accept
reject
request_replan
add_skill_goal
remove_skill_goal
patch_skill_goal
change_dependency
change_priority
change_parallelism
change_criterion_coverage
change_confirmation_policy
```

## 11.4 Patch Compiler

用户自然语言修改：

```text
User Instruction
→ InteractivePlanPatchModel
→ Structured Patch
→ Deterministic Patch Validator
→ Apply to Candidate
→ Full Plan Validator
→ New Candidate Version
```

模型不可直接修改数据库。

## 11.5 Plan Diff

每个 Revision 保存：

```text
addedGoals
removedGoals
modifiedGoals
dependencyChanges
criterionCoverageChanges
riskChanges
confirmationChanges
experienceHintsAccepted
experienceHintsRejected
```

## 11.6 确认级别

借鉴 Permission Modes，但使用 SDAR 语义：

```text
manual_all
→ 所有 Goal Contract 和 Plan 必须用户确认

manual_risky
→ 低风险计划可自动确认，高风险必须确认

auto_validated
→ 仅满足严格模板、Active Task Type、无假设、无风险时自动确认

never_auto
→ 租户策略禁止自动确认
```

确认策略不能绕过：

- Tool Policy；
- Side Effect Policy；
- Provider Confirmation；
- Outcome Authority。

## 11.7 运行中 Goal Steering

借鉴 Codex Goal Mode：

用户可在运行中：

```text
pause
resume
patch_goal
add_constraint
change_priority
request_status
cancel
```

所有修改走 v1.2.2 Goal Patch / Plan Revision。

不得直接改 Active Plan。

---

# 12. 用户修订学习

## 12.1 一等事实

每个用户修订保存：

```ts
interface PlanningCorrectionFact {
  correctionId: string;

  scope:
    | "task_understanding"
    | "goal_contract"
    | "skill_goal_plan";

  beforeRef: string;
  afterRef: string;

  correctionType:
    | "missing_target"
    | "missing_scope"
    | "missing_criterion"
    | "missing_artifact"
    | "missing_evidence"
    | "missing_capability"
    | "wrong_decomposition"
    | "wrong_dependency"
    | "wrong_priority"
    | "unsafe_side_effect"
    | "unnecessary_goal"
    | "parallelism_correction"
    | "degradation_correction";

  userInstruction: string;
  normalizedReason?: string;

  accepted: boolean;
  finalOutcomeRef?: string;

  createdAt: string;
}
```

## 12.2 Auto Memory 的正确借鉴

类似 Claude Auto Memory，将用户纠正分为：

```text
User Preference
Project/Tenant Rule
Task-specific Correction
Candidate Global Lesson
```

仅以下内容可快速进入 User-scoped Memory：

- 展示偏好；
- 交互偏好；
- 默认报告格式；
- 低风险规划偏好。

以下不得快速记忆为默认行为：

- 安全边界；
- 副作用授权；
- 完成标准降低；
- 自动确认；
- 设备控制规则。

## 12.3 作用域

```text
task_scoped
user_scoped
tenant_scoped
global_candidate
```

晋升：

```text
task_scoped
→ user_scoped（用户明确或多次）
→ tenant_candidate（管理员审核）
→ global_candidate（脱敏、多租户支持）
```

不允许自动跨用户晋升。

---

# 13. Task Type 设计

## 13.1 Task Type 不是 Skill

```text
Task Type
→ 描述用户意图和典型目标结构

Skill
→ 描述可执行能力

Capability Pattern
→ 描述能力需求和适用规律
```

## 13.2 Task Type Package

借鉴 Codex Skill Package：

```text
task-types/<taskTypeId>/
├── definition.json
├── recognition.json
├── dimensions.json
├── criteria.json
├── capability-requirements.json
├── goal-patterns.json
├── negative-examples.json
└── README.md
```

数据库是权威；导出 Package 用于审计、版本控制和测试。

## 13.3 Definition

```ts
interface TaskTypeDefinition {
  taskTypeId: string;
  version: number;

  name: string;
  description: string;

  recognitionPatterns: TaskRecognitionPattern[];
  negativeRecognitionPatterns: TaskRecognitionPattern[];

  requiredDimensions: TaskDimensionDefinition[];
  optionalDimensions: TaskDimensionDefinition[];

  typicalCriteria: CompletionCriterionTemplate[];
  typicalCapabilityRequirements: CapabilityRequirementTemplate[];
  typicalSkillGoalPatterns: SkillGoalPattern[];
  typicalDependencyPatterns: DependencyPattern[];

  supportCount: number;
  contradictionCount: number;
  confidence: number;

  status:
    | "candidate"
    | "validating"
    | "active"
    | "deprecated"
    | "rejected";
}
```

## 13.4 归纳方式

不能只用向量聚类。

Fingerprint：

```text
semantic objective
+ criterion types
+ required artifacts
+ capability requirements
+ Skill Goal graph shape
+ user correction types
+ outcome
```

先确定性生成候选簇，再由 Model 命名和归纳。

---

# 14. Capability Pattern 设计

## 14.1 作用

表达：

```text
某类目标在某些条件下通常需要某项能力
该能力需要哪些前置
应产生什么 Effect/Evidence/Artifact
有哪些失败和限制
```

## 14.2 与 Skill 的关系

```text
Capability Pattern
→ zero or more Skill Version refs
```

映射为空：

```text
capability_gap_candidate
```

系统可创建：

```text
SkillAuthoringCandidate
```

但不得自动发布 Skill。

## 14.3 与现有 Skill Evolution 对接

```text
Active Capability Gap
+ Multiple Successful Temporary Skill Experiences
→ Existing Skill Evolution Candidate
```

需要增加人工审核状态，避免直接自动发布高风险 Skill。

---

# 15. Lifecycle Hooks

借鉴 Codex/Claude Hooks，但实现为内部 Domain Event + Outbox。

## 15.1 Hook 点

```text
task.request_received
task.understanding_created
task.clarification_requested
task.clarification_answered
goal.contract_candidate_created
goal.contract_confirmed
plan.candidate_created
plan.revised
plan.confirmed
skill_goal.attempt_completed
user_goal.terminal_committed
experience.episode_created
experience.observation_completed
knowledge.candidate_created
knowledge.promoted
capability.summary_rebuilt
capability.card_published
```

## 15.2 Hook 类型

```text
deterministic_policy
async_worker
audit_projection
model_job
external_notification
```

## 15.3 安全边界

- Policy Hook 可 deny；
- Model Hook 不可直接 allow 高风险操作；
- 所有 Hook 结果持久化；
- 同一 Event + Handler 幂等；
- Hook 失败默认不影响主链，除明确 Policy Gate；
- 外部 Hook 不进入第一版。

---

# 16. Model Runtime 设计

## 16.1 Stage

```text
task_understanding
task_clarification
goal_contract_generation
interactive_plan_patch
experience_observation
experience_reflection
task_type_induction
capability_pattern_induction
capability_narrative
knowledge_promotion_assessment
```

## 16.2 模型分级

### Fast Model

- task clarification；
- simple extraction；
- capability narrative；
- low-volume summarization。

### Reasoning Model

- task understanding；
- plan patch；
- reflection；
- task type induction；
- promotion assessment。

### Deterministic Only

- Summary Hash；
- DAG；
- Coverage；
- Promotion threshold；
- Risk Policy；
- Visibility；
- Card Schema；
- Terminal Authority。

## 16.3 Prompt Context

采用 Progressive Disclosure：

```text
System Policy
Current User Request
Current Contract/Plan
Top Task Type Index
Top Capability Index
Top Active Heuristic Index
Selected Full Definitions
```

禁止：

- 注入全部 Skill；
- 注入全部 Episode；
- 注入所有候选知识；
- 注入未脱敏原始 Tool Result。

---

# 17. 数据库方案

## 17.1 Experience

```text
goal_experience_episode
goal_experience_episode_source
experience_observation
experience_observation_fact
experience_extraction
experience_reflection
experience_job
experience_dead_letter
```

## 17.2 Knowledge

```text
planning_heuristic
planning_heuristic_evidence
task_type_definition
task_type_evidence
capability_pattern_definition
capability_pattern_evidence
knowledge_promotion_evaluation
knowledge_status_transition
experience_usage_record
```

## 17.3 Capability

```text
runtime_capability_summary
runtime_capability_summary_item
runtime_capability_limitation
capability_experience_evidence
public_capability_card_snapshot
```

## 17.4 Interactive Planning

```text
generic_task_understanding
generic_task_understanding_dimension
interactive_goal_session
interactive_goal_turn
goal_contract_candidate
interactive_planning_session
interactive_planning_turn
user_goal_plan_candidate
planning_correction_fact
planning_interaction_episode
```

## 17.5 Outbox

```text
cognitive_runtime_outbox
cognitive_runtime_consumer_cursor
```

## 17.6 关键约束

```text
UNIQUE(goal_id, goal_version, episode_hash)
UNIQUE(source_event_id, handler_id)
UNIQUE(catalog_hash, generation_policy_version)
UNIQUE(task_id) WHERE interactive_session_active
UNIQUE(goal_id, goal_version) WHERE planning_session_active
UNIQUE(knowledge_id, version)
```

所有状态更新使用：

```text
expectedVersion / CAS
```

---

# 18. 队列与 Worker

```text
sdar-experience-episode
sdar-experience-observer
sdar-experience-reflector
sdar-knowledge-promotion
sdar-capability-summary
sdar-capability-card
sdar-shadow-planning
```

## 18.1 优先级

```text
Interactive Understanding
> Interactive Plan
> Capability Summary
> Episode Observation
> Reflection
> Promotion
> Shadow Evaluation
```

## 18.2 Backpressure

- Episode 永不丢；
- Observation 可延迟；
- Reflection 可合并；
- Shadow Evaluation 可丢弃过期版本；
- Capability Summary 只保留最新 Catalog Hash；
- Card Build 只处理最新 Summary。

---

# 19. Planner 接入

## 19.1 输入

```ts
interface EnrichedUserGoalPlanningInput {
  contract: UserGoalCompletionContract;
  capabilitySummaryRef: string;
  worldState: GoalPlanningWorldState;

  previousPlan?: UserGoalPlan;
  replanTrigger?: GoalPlanReplanTrigger;

  taskTypeContext?: TaskTypePlanningContext;
  planningExperience?: PlanningExperienceContext;
  capabilityExperience?: CapabilityExperienceContext;
}
```

## 19.2 Decorator

```text
Base UserGoalPlanningService
        ▲
        │
ExperienceEnrichedUserGoalPlanningService
```

流程：

```text
Load Capability Context
→ Try Retrieve Active Knowledge
→ Validate Applicability
→ Build Enriched Input
→ Base Planner
→ Validator
→ if rejected:
     Base Planner without Experience
→ Persist Usage Record
```

## 19.3 Fail-open / Fail-closed

### Fail-open

以下失败回退基础 Planner：

- Experience DB unavailable；
- Retriever timeout；
- Candidate conflict；
- Task Type mismatch；
- Capability Experience unavailable；
- Narrative unavailable。

### Fail-closed

以下失败不得继续：

- User Goal Contract invalid；
- Capability Summary Hash mismatch；
- Skill Goal DAG invalid；
- Criterion Coverage incomplete；
- Safety Policy violation；
- Plan Confirmation missing。

---

# 20. A2A 与交互协议

## 20.1 Input Required

澄清和确认映射为标准：

```text
A2A input-required
```

Message metadata 可包含：

```json
{
  "io.sdar/interaction": {
    "sessionId": "...",
    "interactionType": "task_clarification",
    "questionId": "...",
    "expectedVersion": 3
  }
}
```

## 20.2 Action

用户回答继续使用标准 Message/Task input，不新增私有 Task State。

内部识别：

```text
clarification_answer
goal_contract_action
plan_action
goal_patch
```

## 20.3 Capability Card

`/.well-known/agent-card.json` 返回当前 Public Snapshot。

不在请求时调用 Model。

---

# 21. Management API

```text
GET  /api/v1/capabilities/summary
GET  /api/v1/capabilities/card
POST /api/v1/capabilities/rebuild

GET  /api/v1/tasks/{taskId}/understanding
GET  /api/v1/tasks/{taskId}/goal-session
POST /api/v1/tasks/{taskId}/goal-session/actions

GET  /api/v1/tasks/{taskId}/planning-session
POST /api/v1/tasks/{taskId}/planning-session/actions
GET  /api/v1/tasks/{taskId}/planning-interactions

GET  /api/v1/experience/episodes
GET  /api/v1/experience/observations
GET  /api/v1/experience/dead-letters

GET  /api/v1/knowledge/heuristics
POST /api/v1/knowledge/heuristics/{id}/promote
POST /api/v1/knowledge/heuristics/{id}/reject
POST /api/v1/knowledge/heuristics/{id}/revalidate

GET  /api/v1/task-types
POST /api/v1/task-types/{id}/promote
POST /api/v1/task-types/{id}/reject

GET  /api/v1/capability-patterns
POST /api/v1/capability-patterns/{id}/promote
POST /api/v1/capability-patterns/{id}/reject
```

所有写操作：

- expectedVersion；
- idempotency key；
- actor；
- reason；
- audit；
- auth；
- no direct side effect。

---

# 22. Console 设计

## 22.1 Task Understanding

显示：

- 原始任务；
- 当前理解；
- Task Type 候选；
- 缺失维度；
- 假设；
- 置信度；
- 澄清时间线。

## 22.2 Goal Contract Review

- Candidate；
- Diff；
- Criteria；
- Artifact；
- Evidence；
- Risk；
- Accept/Patch/Reject。

## 22.3 Plan Review

- DAG；
- Criterion Coverage；
- Capability Requirements；
- Experience Hints；
- Risk；
- Plan Diff；
- Accept/Patch/Replan。

## 22.4 Experience Governance

- Episode；
- Observation；
- Extractor；
- Reflection；
- Candidate；
- Support/Contradiction；
- Replay；
- Promotion。

## 22.5 Capability

- Declared；
- Observed；
- Validated；
- Gap；
- Catalog Hash；
- Public Card Preview。

---

# 23. 特性开关与灰度

```text
SDAR_CAPABILITY_SUMMARY_ENABLED
SDAR_CAPABILITY_CARD_ENABLED

SDAR_GENERIC_TASK_UNDERSTANDING_ENABLED
SDAR_INTERACTIVE_GOAL_ENABLED
SDAR_INTERACTIVE_PLANNING_ENABLED

SDAR_EXPERIENCE_CAPTURE_ENABLED
SDAR_EXPERIENCE_OBSERVER_ENABLED
SDAR_EXPERIENCE_REFLECTION_ENABLED

SDAR_TASK_TYPE_INDUCTION_ENABLED
SDAR_CAPABILITY_INDUCTION_ENABLED
SDAR_KNOWLEDGE_PROMOTION_ENABLED

SDAR_EXPERIENCE_INJECTION_MODE
  = off | shadow | advisory | active
```

建议初始：

```text
Capability Summary = on
Capability Card = on
Generic Understanding = on for ambiguous tasks
Interactive Planning = on for manual policy
Experience Capture = on
Observer = on
Reflection = on
Induction = shadow
Promotion = manual
Injection = shadow
```

---

# 24. 灰度路线

## Stage 1：Capture Only

```text
记录事实
不归纳
不影响 Planner
```

## Stage 2：Observe Only

```text
生成 Observation
管理端可见
不影响 Planner
```

## Stage 3：Candidate Knowledge

```text
生成 Candidate
不允许 Active
```

## Stage 4：Shadow Injection

```text
后台生成经验增强 Plan
不展示给用户
与正式 Plan 比较
```

## Stage 5：Advisory

```text
经验建议展示给用户和 Planner
不得自动确认
```

## Stage 6：Active Low-risk

```text
仅低风险 Active Knowledge 自动注入
仍经过 Validator
```

高风险知识长期保持人工确认。

---

# 25. 评估体系

## 25.1 Task Understanding

```text
Task Type Top-1 / Top-3 Accuracy
Missing Dimension Recall
Unnecessary Question Rate
Clarification Round Count
Contract Acceptance Rate
```

## 25.2 Planning

```text
Criterion Coverage
Plan Validator Pass Rate
User Plan Patch Count
Wrong Dependency Rate
Capability Gap Precision
Plan Confirmation Rate
```

## 25.3 Experience

```text
Observation Schema Pass
Extractor Failure Rate
Candidate Precision
Contradiction Detection
Promotion Acceptance
Knowledge Deprecation Rate
```

## 25.4 Runtime

```text
User Goal Success Rate
Attempt Count
Recovery Count
No-progress Round Count
Side-effect Replay Count
Completion Evidence Quality
```

## 25.5 成本

```text
Understanding Tokens
Observation Tokens
Reflection Tokens
Retrieval Latency
Plan Latency
Async Queue Lag
```

---

# 26. Replay 与测试 Harness

## 26.1 Planning Replay Dataset

来源：

- 历史 User Requests；
- Contract；
- User Patches；
- Plans；
- Outcomes。

数据集：

```text
input request
expected missing dimensions
accepted contract
accepted plan
user corrections
final outcome
```

## 26.2 Replay 类型

```text
Understanding Replay
Contract Generation Replay
Plan Generation Replay
Experience Injection Replay
Task Type Recognition Replay
Capability Gap Replay
```

## 26.3 禁止

Replay 不得：

- 调用真实设备；
- 发送真实 MCP 副作用；
- 修改生产 Skill；
- 激活候选知识。

---

# 27. 实施阶段

## Phase 0：Architecture Skeleton

交付：

- ADR；
- Domain；
- Schema；
- State Machine；
- Ports；
- Feature Flags；
- Traceability；
- No product behavior。

## Phase 1：Capability Summary and Card

交付：

- Deterministic Builder；
- Catalog Hash；
- Snapshot；
- Public Projection；
- A2A Card；
- API/Console。

这是最独立、风险最低的阶段。

## Phase 2：Generic Task Understanding

交付：

- Understanding；
- Missing Dimension；
- Task Type Index；
- Question Service；
- A2A input-required。

Task Type 先使用人工 Fixture，不等待经验学习。

## Phase 3：Interactive Goal and Plan

交付：

- Goal Session；
- Plan Session；
- Patch Compiler；
- Diff；
- Confirmation；
- A2A/API/Console。

## Phase 4：Experience Capture

交付：

- Outbox；
- Episode Builder；
- Episode Repository；
- Redaction；
- Queue；
- Retry/Dead Letter。

## Phase 5：Observer and Extractors

交付：

- Observer；
- Typed Extractors；
- Batch；
- Model Stage；
- Management View。

## Phase 6：Reflector and Candidate Knowledge

交付：

- Reflector；
- Candidate Heuristic；
- Candidate Task Type；
- Candidate Capability Pattern；
- Contradiction。

## Phase 7：Promotion Framework

交付：

- Threshold；
- Replay；
- Shadow Planning；
- Human Review；
- Active Projection；
- MemoryService Projection。

## Phase 8：Planner Injection

交付：

- Retriever；
- Progressive Disclosure；
- Decorator；
- Shadow/Advisory/Active；
- Fallback；
- Usage Record。

## Phase 9：Hardening and Release

交付：

- Concurrency；
- Restart；
- Tenant Isolation；
- Cost/Capacity；
- Full E2E；
- A2A TCK；
- SBOM；
- Release Report。

---

# 28. 推荐依赖关系

```text
P0 Architecture Skeleton
        │
        ├── P1 Capability Summary/Card
        │
        ├── P2 Generic Task Understanding
        │       └── P3 Interactive Goal/Plan
        │
        └── P4 Experience Capture
                └── P5 Observer/Extractor
                        └── P6 Reflector/Candidates
                                └── P7 Promotion
                                        └── P8 Planner Injection

P1 + P3 + P8
        └── P9 Hardening/Release
```

P1、P2 和 P4 可并行。

---

# 29. 建议工程拆包

```text
Goal 00  Requirements/ADR/Domain Skeleton
Goal 01  Capability Summary Builder
Goal 02  Public Capability Card
Goal 03  Generic Task Understanding
Goal 04  Interactive Goal Session
Goal 05  Interactive Plan Session
Goal 06  Planning Correction Facts
Goal 07  Experience Outbox/Episode
Goal 08  Experience Observer/Extractors
Goal 09  Experience Reflector
Goal 10  Task Type Induction
Goal 11  Capability Pattern Induction
Goal 12  Knowledge Promotion Framework
Goal 13  Planning Retrieval/Progressive Disclosure
Goal 14  Experience-enriched Planning
Goal 15  Console/API/A2A Integration
Goal 16  Evaluation/Replay Harness
Goal 17  Hardening/Release
```

禁止将以下内容合并到一个 PR：

- Interactive Planning + Experience Promotion；
- Capability Card + Task Type Induction；
- Promotion + Skill Auto-publish；
- Schema + 全量 Console；
- Planner Injection + High-risk Auto-confirm。

---

# 30. 关键决策

## KD-01

```text
不引入 Mastra Runtime，采用机制级参考。
```

推荐：批准。

## KD-02

```text
现有 MemoryService 作为 Active Knowledge Serving Projection，
不作为 Experience Source of Truth。
```

推荐：批准。

## KD-03

```text
用户修订保存为 PlanningCorrectionFact 和 PlanningInteractionEpisode。
```

推荐：批准。

## KD-04

```text
Task Type、Planning Heuristic、Capability Pattern 统一使用 Promotion Framework。
```

推荐：批准。

## KD-05

```text
Capability Summary 确定性生成；Narrative 仅展示。
```

推荐：批准。

## KD-06

```text
Task Type 和 Capability 使用 Progressive Disclosure。
```

推荐：批准。

## KD-07

```text
经验增强 Planner 被拒绝时，有界回退无经验 Planner。
```

推荐：批准。

## KD-08

```text
第一版 Promotion 默认人工；自动晋升仅低风险且后续开放。
```

推荐：批准。

## KD-09

```text
Record & Replay 只回放理解、规划和判断，不回放物理副作用。
```

推荐：批准。

## KD-10

```text
v1.2.3 不自动发布正式 Skill。
```

推荐：批准。

---

# 31. 主要风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 将 Observation 当作事实 | 高 | Episode Authority + Fact/Inference 分类 |
| 经验污染 Planner | 极高 | Candidate 默认不可用、Promotion |
| 一次用户修订全局化 | 极高 | Scope + Support Threshold |
| Task Type 过拟合 | 高 | Multi-feature clustering + negative examples |
| 能力总结虚构能力 | 极高 | Deterministic Skill projection |
| Capability Card 泄露内部信息 | 高 | Public Projection Policy |
| 多轮交互过长 | 中 | 信息增益 + Round Budget |
| Plan Patch 破坏 DAG | 高 | Full Validator |
| 经验系统阻断在线链 | 极高 | Async + Fail-open |
| Model 成本失控 | 高 | Batch/Buffer/Tier/Budget |
| Reflection 反复重写知识 | 中 | Immutable Version + Supersede |
| Planner Context 过大 | 高 | Progressive Disclosure |
| SkillEvolution 自动发布越权 | 极高 | Promotion 与 Publish 分离 |
| Replay 产生副作用 | 极高 | No physical provider + sandbox |
| 用户偏好和安全策略混淆 | 极高 | Memory Scope/Authority separation |
| Catalog 与 Card 不一致 | 高 | catalogHash |
| Knowledge 版本失效 | 高 | Skill version invalidation |
| 经验成功率代替 Readiness | 极高 | Authority guard |
| 高风险经验自动启用 | 极高 | Mandatory human approval |
| Candidate 数量爆炸 | 中 | Dedup/Fingerprint/Retention |

---

# 32. Definition of Done

```text
Capability Summary:
- 对相同 Skill Catalog 生成稳定 Hash
- 结构化能力不依赖 LLM
- Public Card 不泄露内部信息

Task Understanding:
- 模糊任务识别
- 缺失维度识别
- 有界多轮澄清
- 用户确认 Goal Contract

Interactive Planning:
- Plan Candidate 可查看、修改和确认
- 所有 Patch 版本化
- 修改后重新验证
- 未确认不执行

Experience:
- v1.2.2 Runtime Facts 可生成 Episode
- Observer/Extractor/Reflector 异步
- 失败不阻断基础 Runtime
- 不保存私有思维链

Learning:
- 生成候选 Heuristic/Task Type/Capability Pattern
- 保存支持和反例
- Replay/Shadow/Human Promotion
- Candidate 不影响正式 Planner

Planner Injection:
- Progressive Disclosure
- 只注入 Active Knowledge
- 经验失败回退基础 Planner
- 使用记录和最终 Outcome 可追踪

Authority:
- User Goal Contract 仍是意图权威
- Skill Registry 仍是能力声明权威
- Provider Readiness 仍是当前可用性权威
- Outcome Judge 仍是完成权威
- UserGoalPlanController 仍是 A2A Terminal Authority
```

---

# 33. 最终实现形态

```text
SDAR v1.2.3
=
Mastra-inspired Observation / Reflection / Extraction
+
Claude-inspired Read-only Plan Review / Human Revision / Correction Memory
+
Codex-inspired Goal Steering / Progressive Skills / Record & Replay / Verification
+
SDAR-native Goal Contract / Skill Goal DAG / Outcome / Recovery / Knowledge Promotion
```

最终闭环：

```text
User Request
→ Understand
→ Clarify
→ Confirm Goal
→ Load Capability Index
→ Retrieve Active Experience
→ Plan
→ Human Review / Patch / Confirm
→ v1.2.2 Execute / Judge / Recover
→ Build Episode
→ Observe / Extract
→ Reflect
→ Validate / Replay / Shadow
→ Promote
→ Project Active Knowledge
→ Improve Next Task
```

该方案的核心价值不是让 SDAR “记住更多”，而是让它：

```text
知道自己能做什么
知道用户真正想完成什么
知道计划为什么被用户修改
知道过去哪些拆解有效或无效
知道哪些经验已经被验证
并且只在权威边界内使用这些知识
```
