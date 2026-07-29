# SDAR v1.3 设计合订版 V1.0


---

<!-- Source: 00_README.md -->

# SDAR v1.3 设计材料包 V1.0

## 1. 文档定位

本材料包基于 SDAR v1.2.3 完成态，面向下一阶段“经验编译型自主运行时”升级。

v1.2.3 解决：

```text
任务理解
→ 目标澄清
→ 计划生成与确认
→ 执行与 Outcome
→ Experience / Knowledge
```

v1.3 进一步解决：

```text
Experience / Knowledge
→ 模式发现
→ 运行制品候选
→ Replay / Simulation / Shadow
→ 人工批准
→ Fast Path
→ 低成本确定性执行
```

版本中文定位：**经验编译型自主运行时**。  
英文定位：**Experience-Compiled Autonomous Runtime**。

## 2. 材料结构

| 编号 | 文档 | 内容 |
|---|---|---|
| 01 | 总体设计 | 双平面总体架构、组件边界、运行闭环 |
| 02 | Runtime Artifact 数据模型 | 运行制品分类、版本、谱系与生命周期 |
| 03 | Fast Gateway | 在线快速匹配、适用性与回退流程 |
| 04 | Validation / Replay / Shadow | 制品上线前及运行后的验证体系 |
| 05 | Experience Compilation Pipeline | 经验规范化、模式发现、候选生成 |
| 06 | Plan Template Compiler | 工作流模式到 Skill Goal DAG 模板 |
| 07 | Rule / Policy Compiler | 业务规则、安全策略和冲突治理 |
| 08 | Case Runtime / CBR | 特殊案例检索、适配和恢复 |
| 09 | Model Cascade | Rule、Template、小模型、大模型和人工分级 |
| 10 | Artifact Runtime | 制品进入现有 Goal/Skill Runtime 的方式 |
| 11 | v1.2.x 集成改造 | 与 v1.2.2/v1.2.3 的接口和权威边界 |
| 12 | 数据库与接口契约 | 表、Repository、API、Event 和 Worker |
| 13 | 开源项目与论文映射 | 参考项目、论文及采用边界 |
| 99 | 合订版 | 上述文档合并版本 |

## 3. 核心约束

```text
Artifact 不直接调用 Skill 或 MCP Tool
Artifact 不修改 Skill Registry、Policy 或 Outcome
Artifact 只产生决策、参数、Goal Contract Candidate、Plan Candidate 或 Plan Patch Candidate
所有执行继续经过 v1.2.2 Goal / Skill / Provider / Outcome 权威链
所有候选制品默认不可用于生产
生产激活必须具备验证证据和人工批准
Fast Path 不确定时必须回退 v1.2.3 Cognitive Runtime
```

## 4. 推荐阅读顺序

```text
01 总体设计
→ 02 Runtime Artifact
→ 03 Fast Gateway
→ 04 Validation
→ 05 Experience Compilation
→ 06 Plan Template
→ 07 Rule / Policy
→ 08 Case Runtime
→ 09 Model Cascade
→ 10 Artifact Runtime
→ 11 集成改造
→ 12 数据库与接口
→ 13 开源与论文映射
```

## 5. 使用说明

本包适合作为 v1.3 需求冻结、架构评审、PoC、数据库与接口详细设计，以及后续 Codex Goal 任务包的上位输入。本包暂不包含实施任务拆包。


---

<!-- Source: 01_SDAR_v1.3_Overall_Design_V1.0.md -->

# SDAR v1.3 总体设计 V1.0

## 1. 版本定位

SDAR v1.3 在 v1.2.3 的认知与经验学习基础上，引入“经验编译层”和“在线快速执行层”。

```text
v1.2.2  可靠执行闭环
v1.2.3  认知、交互规划与经验学习闭环
v1.3    经验编译、运行制品与低成本快速执行闭环
```

核心目标不是继续增加模型推理，而是将经过验证的推理结果沉淀为可部署、可回滚、可解释的运行制品。

## 2. 总体闭环

```text
User Request
→ Fast Gateway
→ Compiled Path / Cognitive Path
→ v1.2.2 Execution Runtime
→ Outcome / Feedback
→ v1.2.3 Experience / Knowledge
→ v1.3 Experience Compilation
→ Artifact Candidate
→ Replay / Simulation / Shadow
→ Human Approval
→ Active Artifact
→ 改善下一次任务
```

## 3. 双平面架构

### 3.1 在线运行平面

```text
User Request
    |
    v
Runtime Request Normalizer
    |
    v
Fast Gateway
    |
    +-------------------+--------------------+
    |                   |                    |
    v                   v                    v
Decision Rule      Plan Template        Case Retrieval
    |                   |                    |
    +-------------------+--------------------+
                        |
                        v
Applicability / Capability / Readiness / Policy
                        |
             +----------+----------+
             |                     |
             v                     v
Compiled Plan Candidate      Cognitive Fallback
             |                     |
             +----------+----------+
                        |
                        v
v1.2.2 UserGoalPlanController / Skill Runtime / Outcome
```

### 3.2 离线编译平面

```text
GoalExperienceEpisode
PlanningInteraction
SkillAttempt / Workflow / Outcome
Recovery / Business Event
Artifact Execution Feedback
        |
        v
Experience Normalization
        |
        +--------------+---------------+--------------+
        |              |               |              |
        v              v               v              v
Process Mining   Workflow Mining   Rule Mining   Case Mining
        |              |               |              |
        +--------------+---------------+--------------+
                               |
                               v
                     Pattern Generalization
                               |
                               v
                     Artifact Candidate Generator
                               |
                               v
             Replay → Simulation → Shadow → Approval
                               |
                               v
                     Compiled Artifact Registry
```

## 4. 分层架构

```text
L1 Experience Facts
   Episode、Interaction、Outcome、Recovery、Events

L2 Knowledge
   Task Type、Capability Pattern、Planning Heuristic

L3 Compilation
   Experience Trace、Pattern、Artifact Candidate、Validation

L4 Runtime Artifact
   Intent Route、Plan Template、Decision Rule、Case、Model Route

L5 Fast Runtime
   Matcher、Applicability、Rule、Template、Case、Model Cascade

L6 Existing Execution
   Goal、Skill Goal、Attempt、Workflow、Provider、Outcome
```

## 5. 核心组件

```text
ExperienceTraceBuilder
ProcessVariantMiner
WorkflowPatternMiner
RulePatternMiner
CasePatternMiner
PatternGeneralizer
ArtifactCandidateGenerator
ArtifactRegistryService
ArtifactValidationService
ReplayRunner
SimulationRunner
ShadowRunner
ArtifactPromotionService
FastGatewayService
ArtifactMatcher
ApplicabilityEvaluator
TemplatePlanBuilder
DecisionRuleRuntime
CaseRuntime
ModelCascadeRouter
ArtifactExecutionRecorder
ArtifactFeedbackService
```

## 6. 运行制品类型

1. `intent_route`：请求到 Task Type 或后续路径的路由候选。
2. `plan_template`：将成熟流程实例化为 User Goal Plan Candidate。
3. `decision_rule`：输出风险、确认、路由、恢复或降级决策。
4. `case_template`：为特殊问题提供历史解决路径及适配依据。
5. `model_route`：选择无模型、小模型、中型模型、强推理模型或人工。

## 7. 生命周期

```text
discovered
→ candidate
→ validating
→ awaiting_approval
→ active
→ revalidating
→ deprecated
→ archived / rejected
```

- `discovered` 只是模式发现结果；
- `candidate` 已结构化但不可运行；
- `validating` 正在 Replay、Simulation 或 Shadow；
- `active` 才能参与 Fast Gateway；
- `revalidating` 期间禁止自动 Fast Execute；
- `deprecated` 不再匹配新任务。

## 8. 权威边界

```text
User-confirmed Goal Contract
> Artifact / Task Type / Case / Model

Skill Registry + Outcome Specification
> Plan Template capability declaration

Provider Readiness
> Historical success or Case outcome

SkillGoalPlanValidator
> Template / Rule / Case generated plan

Policy Authority
> Business optimization rule

Outcome Judge
> Artifact execution status

v1.2.2 UserGoalPlanController
> Fast Gateway / Artifact Runtime
```

## 9. Fast Path 适用边界

只有同时满足以下条件才允许 Fast Path：

- Intent 置信度达到制品阈值；
- 所有必需参数具有可信来源；
- Required Conditions 成立；
- Forbidden Conditions 不成立；
- 能力声明存在；
- 当前 Provider Readiness 满足；
- Policy 决策为 allow；
- Artifact 状态为 active；
- Artifact 所依赖的 Skill、Policy、Schema 和 Catalog 版本有效；
- 风险级别允许自动执行；
- Plan Candidate 通过现有 Validator。

任何条件不满足都必须回退。

## 10. 初始发布范围

v1.3.0 推荐只发布：

```text
Plan Template Artifact
Decision Rule Artifact
Fast Gateway
Replay Validation
Shadow Validation
Human Approval
Cognitive Fallback
```

默认关闭：Case 自动适配执行、Model Route 自动优化、Artifact 自动发布、自动 Skill 创建和跨租户固化。

## 11. 建议初始目标

```text
Fast Path 命中率：30%～50%
错误 Fast Match：低于 0.5%
Fast Gateway P95：低于 200ms
Template Plan 生成 P95：低于 500ms
大模型任务调用量降低：30%+
在线失败可回退率：100%
高风险自动执行：0
```


---

<!-- Source: 02_Runtime_Artifact_Data_Model_V1.0.md -->

# SDAR v1.3 Runtime Artifact 数据模型设计 V1.0

## 1. 核心概念

Runtime Artifact 是经过验证后可以参与在线决策或计划生成的编译资产。

```text
Experience
→ Knowledge
→ Artifact Candidate
→ Validation
→ Active Runtime Artifact
→ Runtime Instance
```

Knowledge 回答“为什么、通常如何、哪些经验有效”；Artifact 回答“当前满足什么条件时，系统可以生成什么确定性结果”。

## 2. 通用模型

```ts
type CompiledArtifactType =
  | "intent_route"
  | "plan_template"
  | "decision_rule"
  | "case_template"
  | "model_route";

type CompiledArtifactStatus =
  | "discovered"
  | "candidate"
  | "validating"
  | "awaiting_approval"
  | "active"
  | "revalidating"
  | "deprecated"
  | "archived"
  | "rejected";

interface CompiledArtifact {
  artifactId: string;
  artifactKey: string;
  version: number;
  artifactType: CompiledArtifactType;
  name: string;
  description: string;
  scope: { tenantId?: string; domain: string; taskTypeIds: string[] };
  definition: unknown;
  applicability: ArtifactApplicability;
  requiredCapabilities: CapabilityRequirement[];
  requiredPolicies: PolicyReference[];
  dependencySnapshot: ArtifactDependencySnapshot;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: CompiledArtifactStatus;
  lineageRef: string;
  validationSummaryRef?: string;
  contentHash: string;
  createdAt: string;
}
```

## 3. Applicability

```ts
interface ArtifactApplicability {
  requiredConditions: ConditionExpression[];
  optionalConditions: ConditionExpression[];
  forbiddenConditions: ConditionExpression[];
  requiredParameters: string[];
  allowedEnvironmentClasses: string[];
  excludedEnvironmentClasses: string[];
  minimumIntentScore: number;
  minimumConditionScore: number;
  maximumUncertainty: number;
  outOfDistributionPolicy:
    | "fallback_reasoning"
    | "require_confirmation"
    | "deny";
}
```

Applicability 必须是显式、可执行和可审计的数据，不允许只保存自然语言描述。

## 4. Dependency Snapshot

```ts
interface ArtifactDependencySnapshot {
  capabilityCatalogHash: string;
  policyVersionRefs: string[];
  taskTypeVersionRefs: string[];
  schemaVersionRefs: string[];
  requiredSkillVersionRefs?: string[];
  compilerVersion: string;
}
```

Capability Catalog、Skill、Policy、Schema、Task Type 或 Compiler 兼容边界变化时触发重新验证。

## 5. Intent Route Artifact

```ts
interface IntentRouteArtifactDefinition {
  taskTypeId: string;
  semanticExamples: string[];
  exactPatterns: ExactPattern[];
  structuredHints: StructuredHint[];
  nextPath:
    | "plan_template"
    | "case_retrieval"
    | "small_model"
    | "cognitive_runtime";
}
```

它只能产生路由候选，不授予执行权限。

## 6. Plan Template Artifact

```ts
interface PlanTemplateArtifactDefinition {
  goalPattern: {
    objectiveTemplate: string;
    criterionTemplates: CriterionTemplate[];
  };
  parameterSchema: JsonSchema;
  parameterBindings: ParameterBindingRule[];
  skillGoalGraph: {
    nodes: SkillGoalNodeTemplate[];
    dependencies: SkillGoalDependencyTemplate[];
  };
  completionContractTemplate: CompletionContractTemplate;
  recoveryBranches: RecoveryBranchTemplate[];
}
```

```ts
interface SkillGoalNodeTemplate {
  nodeKey: string;
  nodeType: "action" | "observation" | "reasoning" | "verification" | "recovery";
  objectiveTemplate: string;
  requiredCapabilities: string[];
  requiredEffectRefs: string[];
  evidenceRequirements: string[];
  artifactRequirements: string[];
  inputTemplate: unknown;
  constraints: string[];
}
```

## 7. Decision Rule Artifact

```ts
interface DecisionRuleArtifactDefinition {
  category:
    | "risk"
    | "routing"
    | "confirmation"
    | "recovery"
    | "degradation"
    | "model_selection";
  condition: ConditionExpression;
  decision: DecisionOutput;
  priority: number;
  conflictGroup?: string;
  conflictPolicy:
    | "deny_overrides"
    | "higher_priority"
    | "most_specific"
    | "require_human";
}
```

Rule 输出决策，不直接执行 Tool。

## 8. Case Artifact

```ts
interface CaseArtifactDefinition {
  problemFingerprint: ProblemFingerprint;
  solutionPattern: CaseSolutionPattern;
  adaptationRules: CaseAdaptationRule[];
  applicability: CaseApplicability;
  failureBoundaries: FailureBoundary[];
  priorOutcomeSummary: OutcomeSummary;
}
```

Case 的运行结果必须先变成 Plan Patch Candidate 或 Plan Candidate。

## 9. Model Route Artifact

```ts
interface ModelRouteArtifactDefinition {
  conditions: ConditionExpression[];
  route: "none" | "local_small" | "cloud_medium" | "cloud_reasoning" | "human";
  budget: { maxTokens: number; maxLatencyMs: number; maxCostUnits: number };
  fallbackRoutes: string[];
}
```

## 10. Lineage

```ts
interface ArtifactLineage {
  lineageId: string;
  artifactId: string;
  artifactVersion: number;
  sourceEpisodeRefs: string[];
  sourceKnowledgeRefs: string[];
  sourceCorrectionRefs: string[];
  sourcePatternRefs: string[];
  generationMethods: (
    | "process_mining"
    | "workflow_induction"
    | "rule_mining"
    | "case_mining"
    | "model_assisted_generalization"
    | "human_authored"
  )[];
  validationRunRefs: string[];
  supersedesArtifactRefs: string[];
}
```

## 11. 不可变性

Artifact Definition、Applicability、Dependency Snapshot、Validation Result、Approval Record 和 Active Pointer Transition 均不可原地修改。任何修改生成新版本。

## 12. Runtime Binding

```ts
interface ArtifactRuntimeBinding {
  bindingId: string;
  artifactId: string;
  artifactVersion: number;
  runtimeType:
    | "template_plan_builder"
    | "decision_engine"
    | "case_adapter"
    | "model_router";
  compilerVersion: string;
  compiledPayloadHash: string;
  compiledAt: string;
}
```

Runtime Binding 是可重建投影，Artifact 仍是权威。


---

<!-- Source: 03_Fast_Gateway_Design_V1.0.md -->

# SDAR v1.3 Fast Gateway 决策流程设计 V1.0

## 1. 作用

Fast Gateway 是在线任务入口的确定性路由层，用于判断当前请求能否安全地使用已激活制品。

它不负责直接创建最终 Goal、直接调用 Skill/MCP、判断最终完成或绕过确认和 Policy。

## 2. 在线流程

```text
Request
→ Request Normalization
→ Exact Intent Match
→ Semantic Intent Match
→ Artifact Index Retrieval
→ Applicability Evaluation
→ Parameter Binding Check
→ Capability Check
→ Provider Readiness
→ Business Rule
→ Safety Policy
→ Execution Decision
```

```ts
type FastGatewayPath =
  | "compiled_fast"
  | "template_adapt"
  | "case_adapt"
  | "small_model"
  | "cognitive_runtime"
  | "human_input"
  | "denied";
```

## 3. Runtime Request Context

```ts
interface RuntimeRequestContext {
  requestId: string;
  taskId: string;
  contextId: string;
  rawText: string;
  normalizedText: string;
  actor: { userId?: string; tenantId?: string; roles: string[] };
  extractedFeatures: {
    verbs: string[];
    entities: RuntimeEntity[];
    taskTypeHints: string[];
    constraints: StructuredConstraint[];
    requestedArtifacts: string[];
  };
  worldStateRef?: string;
  capabilitySummaryRef: string;
  policySnapshotRef: string;
  createdAt: string;
}
```

## 4. Request Normalization

第一版使用确定性格式规范化、领域词典、Identifier 正则、现有 Task Type Index 和 Embedding。只有规则提取不足时才调用小模型。每个字段保存 Source 和 Confidence。

## 5. Intent 路由

顺序：Exact Pattern → Structured Hint → Semantic Embedding → Small Model Classification → v1.2.3 Generic Task Understanding。

Exact Pattern 命中仅缩小候选范围，不代表允许执行。

## 6. Progressive Retrieval

```text
Level 0: id / type / taskType / domain / risk / status / embedding
Level 1: applicability / required capabilities / dependency snapshot
Level 2: full definition / lineage / validation summary
```

只查询 active、Tenant 可见、依赖有效且风险策略允许的制品。

## 7. Match Score

```ts
interface ArtifactMatchScore {
  intentScore: number;
  structuredConditionScore: number;
  parameterCoverageScore: number;
  capabilityShapeScore: number;
  environmentSimilarityScore: number;
  validationConfidenceScore: number;
  recentReliabilityScore: number;
  riskPenalty: number;
  totalScore: number;
}
```

总分只用于排序。Forbidden Condition、Missing Required Parameter、Capability Gap、Readiness Failure、Policy Deny 和 Dependency Mismatch 是硬拒绝条件。

## 8. Applicability Evaluation

```ts
interface ArtifactApplicabilityResult {
  applicable: boolean;
  confidence: number;
  satisfiedConditionIds: string[];
  missingConditionIds: string[];
  violatedConditionIds: string[];
  uncertainConditionIds: string[];
  outOfDistribution: boolean;
  disposition:
    | "eligible"
    | "requires_adaptation"
    | "fallback"
    | "require_confirmation"
    | "deny";
}
```

任何未知高风险字段不能以默认值填充。

## 9. Parameter Binding

```text
User-confirmed Goal Contract
> Explicit request field
> Trusted world state
> Runtime context
> User low-risk preference
> Small-model candidate
```

安全授权、目标、范围和完成标准不得由模型静默补齐。

## 10. Capability 与 Readiness

```text
Artifact required capability
→ Runtime Capability Summary
→ Exact Skill candidates
→ Provider Readiness
```

历史成功、Artifact 验证分和 Case 结果不能证明当前可用性。

## 11. Rule 与 Policy

业务规则产生业务决策候选，安全 Policy 输出 allow / deny / require_confirmation。安全 Policy 始终覆盖业务优化规则。

## 12. 决策输出

```ts
interface RuntimeExecutionDecision {
  decisionId: string;
  requestId: string;
  path: FastGatewayPath;
  selectedArtifactRef?: string;
  parameterBindings: Record<string, unknown>;
  missingParameters: string[];
  requiredConfirmations: string[];
  reasonCodes: string[];
  matcherSnapshotHash: string;
  policySnapshotHash: string;
  createdAt: string;
}
```

## 13. 冲突处理

排序：Exact applicability → Lower risk → Higher validation confidence → More specific condition → Newer verified version → Lower cost。前两名差距不足时返回 Cognitive Runtime 或 Human。

## 14. Fast Path 失败

执行前失败直接回退；执行中失败由 v1.2.2 Recovery 权威处理，并记录 Artifact Feedback 和 Revalidation Signal。

## 15. 性能目标

```text
Exact Route P95             < 10ms
Artifact Index Retrieval    < 50ms
Applicability Evaluation    < 30ms
Rule/Policy Evaluation      < 50ms
Fast Gateway Overall P95    < 200ms
Fallback Context Build      < 100ms
```


---

<!-- Source: 04_Artifact_Validation_Replay_Shadow_V1.0.md -->

# SDAR v1.3 Artifact Validation / Replay / Shadow 体系设计 V1.0

## 1. 验证目标

验证体系必须证明 Artifact 能覆盖目标任务、不会过度匹配、能够泛化、不降低安全性，并且成本和延迟收益真实存在。

## 2. 验证流水线

```text
Candidate
→ Static Validation
→ Historical Replay
→ Holdout Replay
→ Simulation（具身场景）
→ Shadow
→ Human Review
→ Active
```

所有阶段生成独立不可变记录。

## 3. Replay Dataset

```ts
interface ArtifactReplayCase {
  replayCaseId: string;
  requestSnapshot: unknown;
  goalContractSnapshot: unknown;
  capabilityCatalogSnapshot: unknown;
  worldStateSnapshot: unknown;
  policySnapshot: unknown;
  acceptedPlanSnapshot?: unknown;
  actualExecutionTrace?: unknown;
  finalOutcomeSnapshot: unknown;
  environmentClass: string;
  deviceClass?: string;
  sourceEpisodeRefs: string[];
}
```

数据至少划分为：`discovery_set`、`candidate_development_set`、`promotion_holdout_set` 和 `counterexample_set`。不得使用同一批案例同时发现模式和证明晋升。

## 4. Replay 类型

### Plan Replay

```text
Goal Contract
→ Artifact Plan Candidate
→ Validator
→ 与 accepted plan / actual outcome 对比
```

### Rule Replay

历史 Context 经 Rule 产生决策，与人工或运行权威决策对比。

### Case Replay

Problem Fingerprint 经 Case Retrieval / Adaptation，和历史恢复及 Outcome 对比。

### Counterfactual Replay

比较正式路径和“若当时采用 Candidate Artifact”的路径，不执行真实副作用。

## 5. Simulation

具身设备场景必须验证：碰撞、禁区、覆盖率、路径可达性、能源、故障、通信中断、NPC、突发事件和 Recovery Branch。Scenario 与仿真平台版本都必须冻结。

## 6. Shadow

```text
Production Request
    |
    +---- Formal Runtime → 正式执行
    |
    +---- Candidate Artifact → 只生成 Decision / Plan
```

Shadow 禁止调用真实 MCP 副作用、创建正式 Attempt、修改正式 Plan、产生终态和触发真实通知。

## 7. 指标体系

### 结果

- User Goal Success；
- Criterion Coverage；
- Evidence Completeness；
- Artifact Correctness；
- Recovery Success。

### 流程质量

- Fitness；
- Precision；
- Generalization；
- Variant Coverage；
- Unexpected Branch Rate。

### 效率

- Planning Latency；
- Token Cost；
- Model Call Count；
- Plan Node Count；
- Human Interaction Count。

### 风险

- False Positive；
- False Negative；
- Unsafe Allow；
- Missed Confirmation；
- Policy Override；
- Side-effect Replay。

## 8. Validation Result

```ts
interface ArtifactValidationResult {
  validationRunId: string;
  artifactId: string;
  artifactVersion: number;
  validationType: "static" | "replay" | "simulation" | "shadow";
  datasetRef: string;
  environmentRefs: string[];
  metrics: Record<string, number>;
  failures: ValidationFailure[];
  counterexampleRefs: string[];
  result: "passed" | "failed" | "needs_more_data" | "unsafe";
  completedAt: string;
}
```

## 9. 首版晋升证据

### Plan Template

```text
独立 Goal ≥ 30
Holdout ≥ 10
至少 2 个环境类别
成功率不低于基础 Planner
Criterion Coverage 不退化
无高风险失败
Shadow ≥ 10
人工批准
```

### Decision Rule

```text
独立案例 ≥ 100
关键风险规则使用更高样本阈值
False Negative 满足领域安全阈值
无 Unsafe Allow
Shadow ≥ 30
人工批准
```

阈值必须支持租户和领域配置。

## 10. 运行后监控

持续计算 rolling success、fallback、correction、policy deny、latency saving、cost saving 和 environment novelty。

以下变化触发 revalidating：成功率下降、修订率上升、新反例、Skill Catalog 变化、Policy 变化、环境 OOD、安全失败或长期未使用。

## 11. 降级

Revalidating Artifact 不再自动 Fast Execute，只能 Shadow 或人工参考，不能自动确认或产生新的 Active Binding。

## 12. 激活证据

每次激活必须保存 Artifact Definition Hash、Dependency Snapshot、Replay Report、Shadow Report、Counterexample Summary、Risk Review、Approver、Reason 和 Activation Event。


---

<!-- Source: 05_Experience_Compilation_Pipeline_V1.0.md -->

# SDAR v1.3 Experience Compilation Pipeline 设计 V1.0

## 1. 输入

来自 v1.2.3 的权威事实：GoalExperienceEpisode、PlanningInteractionEpisode、PlanningCorrectionFact、Skill Goal/Attempt、Workflow/MCP Task、Outcome Judgment、Recovery、Business Event Impact、Capability Pattern、Task Type、Planning Heuristic 和 Artifact Feedback。

## 2. Pipeline

```text
Source Selection
→ Experience Normalization
→ Trace Construction
→ Cohort / Cluster
→ Pattern Mining
→ Pattern Generalization
→ Candidate Artifact Generation
→ Static Validation
→ Replay Queue
```

## 3. Experience Trace

```ts
interface ExperienceTrace {
  traceId: string;
  sourceEpisodeRef: string;
  taskTypeCandidates: string[];
  goalFingerprint: string;
  capabilityFingerprint: string;
  environmentFingerprint: string;
  events: ExperienceTraceEvent[];
  corrections: ExperienceCorrection[];
  outcome: ExperienceOutcome;
  completeness: number;
  dataClassification: string;
  createdAt: string;
}
```

```ts
interface ExperienceTraceEvent {
  eventId: string;
  eventType:
    | "goal_created"
    | "plan_created"
    | "skill_goal_ready"
    | "skill_attempt_started"
    | "skill_attempt_completed"
    | "workflow_failed"
    | "recovery_started"
    | "human_intervention"
    | "plan_revised"
    | "goal_completed"
    | "goal_failed";
  occurredAt: string;
  actorType: "user" | "agent" | "runtime" | "provider";
  capabilityRefs: string[];
  sourceRefs: string[];
}
```

## 4. 规范化

必须保留顺序、并行、条件分支、权威引用、用户修订、反例、环境类别、设备类别、失败与恢复。

必须抽象或去除实例 ID、具体地点、临时时间戳、用户隐私、Credential、原始大 Tool Result 和私有思维链。

## 5. Process Mining 通道

负责确定性发现必经节点、常见顺序、可选节点、并行节点、循环、Recovery Branch、失败变体和流程质量。

```ts
interface DiscoveredProcessPattern {
  patternId: string;
  mandatoryActivities: string[];
  optionalActivities: string[];
  orderingConstraints: OrderingConstraint[];
  parallelGroups: string[][];
  recoveryBranches: RecoveryPattern[];
  variants: ProcessVariant[];
}
```

## 6. Semantic / Agent Mining 通道

负责步骤语义归一、Task Type 命名、参数抽象、Capability 映射、Negative Example、Failure Boundary 和候选解释。模型结果不能覆盖 Process Mining 的结构化统计。

## 7. Pattern Fusion

```text
Process Mining：顺序、频率、分支、异常
LLM/Agent Mining：含义、变量、能力、适用边界
Domain Rules：安全、禁止条件、完成标准
```

```ts
interface FusedPattern {
  structuralPattern: unknown;
  semanticPattern: unknown;
  applicabilityCandidate: unknown;
  supportEpisodeRefs: string[];
  contradictionEpisodeRefs: string[];
  confidence: number;
}
```

## 8. Workflow Pattern

归纳 Task Type、Skill Goal Node Pattern、Capability Requirements、Dependency Pattern、Completion Pattern 和 Recovery Pattern。

## 9. Rule Pattern

发现 Context Features + Event/State 到 Decision/Route/Confirmation/Recovery 的稳定关联。记录 support、contradiction、false positive、false negative、环境覆盖和决策权威来源。

## 10. Case Pattern

重点来自 Exception Path、Recovery、Human Correction、Rare Successful Plan 和多故障组合。Case 不要求高频，但要求明确边界和 Outcome 证据。

## 11. Pattern Generalization

```ts
interface GeneralizedPattern {
  domain: string;
  taskTypeId: string;
  variables: GeneralizedVariable[];
  invariants: string[];
  preconditions: ConditionExpression[];
  negativeConditions: ConditionExpression[];
  retainedExamples: string[];
  counterexamples: string[];
}
```

单一设备、环境或用户选择不得全局化。

## 12. Candidate Generator

```text
Workflow Pattern → Plan Template Candidate
Condition Pattern → Decision Rule Candidate
Exception Pattern → Case Candidate
Cost Pattern → Model Route Candidate
```

Candidate 保存 Source Trace、Generator Version、Model Invocation、Hash、Assumptions、Unknowns 和 Explanation。

## 13. 触发

第一版以离线批量和人工触发为主；在线完成 Episode 后只产生低优先级 Candidate Signal。

## 14. Worker

```text
experience-normalization
process-discovery
workflow-induction
rule-induction
case-induction
pattern-generalization
artifact-candidate-generation
candidate-static-validation
```

全部异步、幂等、可重放，不阻断在线任务。


---

<!-- Source: 06_Plan_Template_Compiler_V1.0.md -->

# SDAR v1.3 Plan Template Compiler 设计 V1.0

## 1. 目标

将 Workflow Pattern 编译为可实例化的 Skill Goal DAG Template。

```text
Workflow Pattern
→ Step Classification
→ Capability Mapping
→ Goal Decomposition
→ Parameter Extraction
→ Completion Contract Template
→ Recovery Branch
→ Plan Template Candidate
```

## 2. 输入

```ts
interface PlanTemplateCompilationInput {
  taskTypeRef: string;
  fusedWorkflowPattern: unknown;
  capabilityPatterns: unknown[];
  acceptedGoalContracts: unknown[];
  acceptedPlans: unknown[];
  outcomeSpecifications: unknown[];
  counterexamples: unknown[];
}
```

## 3. Step Classification

步骤类型：action、observation、reasoning、verification、recovery、human_gate。分类依据 Skill Outcome、Workflow Node、Provider Side Effect、Process Mining、模型候选和人工修订。

## 4. Capability Mapping

```ts
interface HistoricalStepCapabilityMapping {
  sourceStepRef: string;
  sourceSkillVersionRefs: string[];
  capabilityId: string;
  confidence: number;
  evidenceRefs: string[];
}
```

Template Node 只绑定 Capability Requirement。

## 5. Goal Decomposition

```ts
interface CompiledSkillGoalNodeTemplate {
  nodeKey: string;
  objectiveTemplate: string;
  requiredCapabilities: string[];
  requiredEffectRefs: string[];
  coveredCriterionTemplateIds: string[];
  evidenceRequirements: string[];
  artifactRequirements: string[];
  assumptionsAllowed: string[];
  constraints: string[];
}
```

## 6. Dependencies

```ts
interface CompiledDependencyTemplate {
  dependencyKey: string;
  predecessorNodeKey: string;
  successorNodeKey: string;
  predicate: "required" | "optional";
  condition?: ConditionExpression;
}
```

必须验证无环、深度/节点有界、Required Criterion 覆盖、Optional Branch 不破坏完成标准、Recovery 不重放已完成副作用。

## 7. 参数模型

```ts
interface TemplateParameterDefinition {
  parameterName: string;
  schema: JsonSchema;
  required: boolean;
  allowedSources:
    | "user_confirmed"
    | "request"
    | "world_state"
    | "runtime_context"
    | "small_model_candidate";
  trustLevel: "authoritative" | "trusted" | "candidate";
  defaultPolicy: "none" | "low_risk_only";
}
```

安全授权、目标、范围和完成标准不允许模型默认补齐。

## 8. Completion Contract Template

```ts
interface CompletionContractTemplate {
  titleTemplate: string;
  descriptionTemplate: string;
  criteria: CriterionTemplate[];
  evidenceRequirements: string[];
  artifactRequirements: string[];
}
```

实例化后仍生成 v1.2.2 UserGoalCompletionContract。

## 9. Plan 实例化

```text
Active Template
+ Confirmed Goal Contract
+ Trusted Parameter Bindings
+ Current Capability Catalog
→ UserGoalPlan Candidate
→ SkillGoalPlanValidator
```

保存 Artifact Ref、Version、Parameter Binding、Catalog Hash、Policy Snapshot、Compiler Version 和 Plan Hash。

## 10. Recovery Branch

```ts
interface RecoveryBranchTemplate {
  trigger: FailureCondition;
  requiredCapabilities: string[];
  planPatchTemplate: unknown;
  maximumApplications: number;
  sideEffectReplayPolicy: "forbidden" | "explicitly_safe";
}
```

是否采用仍由 v1.2.2 Recovery 权威决定。

## 11. LangGraph 关系

Plan Template 不新增 Workflow Runtime。最终链仍为 User Goal Plan → Skill Selection → Existing Workflow Plan → LangGraph.js。

## 12. 适配模式

```text
exact_instance：参数完整，无模型
parameter_adapt：小模型只提取低风险参数
plan_patch_adapt：Template 生成基础 Plan，Planner 补差异
fallback：完整认知规划
```

## 13. 指标

Plan Validator Pass、User Patch、Criterion Coverage、Capability Gap、Fallback、Plan Size、Latency、Token Saving、Outcome Success 和 Recovery Rate。

## 14. 失效

Task Type、Capability、Skill Outcome、Policy、Parameter Schema、Environment 或连续失败/高修订率变化时进入 revalidating。


---

<!-- Source: 07_Rule_Policy_Compiler_V1.0.md -->

# SDAR v1.3 Rule / Policy Compiler 设计 V1.0

## 1. 分层

```text
Business Rule：根据成熟业务经验建议如何判断
Safety Policy：是否允许、是否需要确认
```

业务规则不得覆盖安全策略。

## 2. Rule 类型

risk、routing、confirmation、recovery、degradation、model_selection。

## 3. 结构化条件

```ts
type ConditionExpression =
  | { type: "all" | "any"; children: ConditionExpression[] }
  | { type: "not"; child: ConditionExpression }
  | {
      type: "atomic";
      field: string;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";
      value?: unknown;
    };
```

Active Rule 不能依赖 LLM 解释自然语言条件。

## 4. Decision Output

```ts
interface DecisionOutput {
  decisionType:
    | "set_risk"
    | "select_template"
    | "require_confirmation"
    | "select_recovery"
    | "select_model"
    | "degrade";
  parameters: Record<string, unknown>;
  explanationCode: string;
}
```

## 5. Rule Candidate 来源

Outcome Pattern、Human Correction、Repeated Manual Decision、Failure Pattern、Recovery Pattern 和 Cost Pattern。自动发现只生成 Candidate。

## 6. Rule Generalization

Instance Field 抽象为 Domain/Device/Environment Class；临时值转成变量/区间/枚举；一次用户选择保留为 task-scoped correction；安全授权不得从经验自动生成 Active Rule。

## 7. 冲突治理

```ts
interface RuleConflictRecord {
  conflictId: string;
  leftRuleRef: string;
  rightRuleRef: string;
  conflictType:
    | "logical_overlap"
    | "opposite_decision"
    | "scope_overlap"
    | "priority_ambiguity";
  witnessContexts: unknown[];
  resolution: "priority" | "more_specific" | "merge" | "disable" | "human_required";
}
```

优先级：Safety Policy > Regulatory/Tenant Policy > Confirmation Rule > Business Rule > Cost Rule。

## 8. Rule Runtime

在线引擎需要 JSON Decision Model、确定性 Evaluation、bounded input、Decision Trace、conflict group、version、timeout 和 no side effect。ZEN 可作为候选，实施前重新锁定版本和许可证。

## 9. Policy Runtime

安全 Policy 使用现有 SDAR Policy Authority，或 OPA 作为外部/嵌入式引擎。OPA 只输出 allow、deny、require_confirmation，不生成 Plan。

## 10. Replay

计算 Accuracy、Precision、Recall、False Positive、False Negative、Unsafe Allow、Missed Confirmation、Human Override 和 Unknown Context。高风险规则重点关注 False Negative 和 Unsafe Allow。

## 11. 在线链

```text
Feature Context
→ Business Rule Evaluation
→ Candidate Decision
→ Safety Policy Evaluation
→ Final Decision
→ Fast Gateway / Goal Runtime
```

## 12. 规则爆炸治理

使用 Conflict Group、领域数量限制、Merge Candidate、Deprecated 排除、Decision Table、Negative Example、Condition Fingerprint 去重。低频特殊问题进入 Case，而不是 Rule。


---

<!-- Source: 08_Case_Runtime_CBR_V1.0.md -->

# SDAR v1.3 Case Runtime 与 Case-Based Reasoning 设计 V1.0

## 1. 定位

```text
Rule：什么时候做出某种决定
Template：标准情况下怎么做
Case：特殊情况下过去如何成功处理
```

Case 主要用于异常恢复和低频复杂组合。

## 2. CBR 生命周期

```text
Retrieve
→ Reuse
→ Revise
→ Validate
→ Retain Feedback
```

Retain 不等于自动创建新 Active Case。

## 3. Problem Fingerprint

```ts
interface ProblemFingerprint {
  taskTypeId: string;
  goalFeatureHash: string;
  entityClasses: string[];
  environmentClasses: string[];
  eventTypes: string[];
  failureTypes: string[];
  capabilityState: string[];
  constraints: StructuredConstraint[];
  riskLevel: string;
}
```

文本 Embedding 不能作为唯一相似性。

## 4. Case Definition

```ts
interface CaseTemplateDefinition {
  problemFingerprint: ProblemFingerprint;
  contextRequirements: ConditionExpression[];
  solutionPattern: {
    planPatchTemplate?: unknown;
    recoveryPlanTemplate?: unknown;
    decisionSuggestions?: DecisionOutput[];
  };
  adaptationRules: CaseAdaptationRule[];
  failureBoundaries: FailureBoundary[];
  priorOutcome: OutcomeSummary;
}
```

## 5. 检索流程

```text
Structured Filter
→ Capability / Environment Filter
→ Semantic Retrieval
→ Constraint Match
→ Failure Boundary Check
→ Outcome / Risk Ranking
```

## 6. Match Score

```ts
interface CaseMatchScore {
  taskTypeScore: number;
  semanticScore: number;
  environmentScore: number;
  failureScore: number;
  constraintScore: number;
  capabilityScore: number;
  outcomeScore: number;
  riskPenalty: number;
  totalScore: number;
}
```

## 7. Case Adaptation

Case 只产生 Plan Patch Candidate、Recovery Plan Candidate、Parameter Mapping Candidate 或 Explanation。

```ts
interface CaseAdaptationResult {
  caseRef: string;
  parameterMappings: Record<string, unknown>;
  planPatchCandidate?: unknown;
  recoveryPlanCandidate?: unknown;
  confidence: number;
  unknowns: string[];
  validationRequired: true;
}
```

## 8. 与 Template 协同

首版中普通任务 Template First；执行前不适用则回退 Cognitive Runtime；执行中异常由 Recovery Authority 决定是否检索 Case。Case 不能直接主导普通任务。

## 9. Case 形成

来源包括 Exception Path、Recovery Success、Human Intervention、Rare Failure Combination，以及标准 Template 无法覆盖但最终成功的任务。

## 10. 反馈

状态包括 retrieved、adapted、accepted、rejected、successful、failed、out_of_scope、unsafe。失败补充 Failure Boundary，不覆盖原 Case。

## 11. 第一版限制

- 只允许同 Tenant；
- 只允许同 Task Type 或明确兼容类型；
- 不跨域迁移；
- 不自动合并；
- 不自动执行高风险恢复；
- 必须有 Outcome；
- 必须保留来源 Episode。


---

<!-- Source: 09_Model_Cascade_Cost_Optimization_V1.0.md -->

# SDAR v1.3 Model Cascade 与成本优化设计 V1.0

## 1. 目标

将大模型从默认路径变成未知问题、复杂问题和异常问题的兜底能力。

```text
Rule
→ Template
→ Case
→ Small Model
→ Medium Model
→ Strong Reasoning
→ Human
```

## 2. Cascade Level

### L0 无模型

Exact Rule、Deterministic Parameter Binding 和 Exact Plan Template。

### L1 小模型

Intent Classification、低风险参数提取、简单字段映射和模板解释。

### L2 中型模型

Template 局部修订、Case 参数适配和低风险 Plan Patch。

### L3 强推理模型

v1.2.3 Generic Task Understanding、新任务规划、多冲突处理和新异常恢复。

### L4 人工

高风险、授权不明、无安全解、多候选不能消歧或模型失败。

## 3. Complexity Features

```ts
interface RuntimeComplexityFeatures {
  knownTaskType: boolean;
  activeArtifactMatches: number;
  maximumArtifactScore: number;
  missingRequiredParameters: number;
  uncertainConditions: number;
  environmentNovelty: number;
  capabilityGapCount: number;
  readinessFailureCount: number;
  riskLevel: number;
  policyRequiresHuman: boolean;
}
```

## 4. Model Route

```ts
interface ModelRouteDecision {
  route:
    | "none"
    | "local_small"
    | "cloud_medium"
    | "cloud_reasoning"
    | "human";
  reasonCodes: string[];
  budget: { maxTokens: number; maxLatencyMs: number; maxCostUnits: number };
  fallbackRoutes: string[];
}
```

## 5. 路由权威

```text
Safety / Tenant Policy
> Explicit Task Budget
> Model Route Artifact
> Historical Cost Statistics
> Model Self-confidence
```

模型自信度不能单独决定升级或降级。

## 6. Budget

预算分为 Task Budget、Goal Budget、Tenant Daily Budget、Runtime Concurrent Model Budget 和 Edge/Offline Availability。达到上限后优先使用 Compiled Path、Small Model 或 input-required，不能无界升级。

## 7. Fallback

```text
Compiled Plan invalid
→ Small Model Parameter Adaptation

Small Model invalid
→ Medium / Strong Model

Strong Model invalid or unsafe
→ Human
```

每次升级保存原因，防止循环。

## 8. Model Artifact

```ts
interface ModelProgramArtifact {
  operation: string;
  modelClass: string;
  promptVersionRef: string;
  responseSchemaRef: string;
  examplesRef: string[];
  validationSummaryRef: string;
}
```

它不等于 Skill，也不具有执行权限。

## 9. 优化

模型路由优化只在离线运行：Model Execution Records → Cost/Quality Dataset → Candidate Route → Replay → Shadow → Human Approval。

可参考 RouteLLM、FrugalGPT 和 DSPy，但生产运行继续使用 SDAR Model Runtime 和权威数据。

## 10. 初始发布

v1.3.0 只要求 Compiled Path → 强推理 Cognitive Fallback。小模型路由和自动 Route 优化在后续小版本加入。


---

<!-- Source: 10_Artifact_Runtime_Execution_V1.0.md -->

# SDAR v1.3 Artifact Runtime 执行架构设计 V1.0

## 1. 核心关系

```text
Artifact Runtime：生成决策或 Plan Candidate
v1.2.2 Runtime：正式执行、恢复和 Outcome
```

## 2. 执行链

```text
Fast Gateway Decision
→ Artifact Runtime Binding
→ Artifact Adapter
→ Goal Contract / Plan Candidate
→ Existing Validator
→ Confirmed Handoff
→ v1.2.2 Execution
```

## 3. Adapter

```ts
interface ArtifactPlanAdapter {
  compile(input: {
    artifactRef: string;
    goalContract: UserGoalCompletionContract;
    parameterBindings: Record<string, unknown>;
    capabilityCatalogRef: string;
    policySnapshotRef: string;
  }): Promise<UserGoalPlanCandidate>;
}
```

## 4. Template Runtime

```text
Active Plan Template
+ Confirmed Goal Contract
+ Parameter Bindings
→ Skill Goal DAG Candidate
→ SkillGoalPlanValidator
```

Template 不选择精确 Skill。

## 5. Rule Runtime

```text
Decision Rule
→ Decision Candidate
→ Safety Policy
→ Goal / Planning / Confirmation Boundary
```

Rule 输出不能直接调用 Tool。

## 6. Case Runtime

```text
Failure / Exception Context
→ Case Retrieval
→ Adaptation
→ Recovery Plan Candidate / Plan Patch Candidate
→ Validator
→ v1.2.2 Recovery Authority
```

## 7. Execution Record

```ts
interface ArtifactExecutionRecord {
  artifactExecutionId: string;
  artifactRef: string;
  taskId: string;
  goalId: string;
  goalVersion: number;
  mode: "fast" | "adapted" | "shadow";
  decisionRef: string;
  generatedPlanRef?: string;
  status:
    | "selected"
    | "compiled"
    | "submitted"
    | "executing"
    | "completed"
    | "failed"
    | "fallback";
  fallbackReasonCode?: string;
  createdAt: string;
}
```

Artifact completed 只表示制品路径结束，不等于 User Goal 完成。

## 8. Handoff

要求 Artifact Active、Dependency Snapshot Valid、Parameter Binding Valid、Goal Version Match、Validator Passed、Confirmation Policy Passed、Goal Lock 和 Idempotent Commit。

## 9. 状态机

```text
selected
→ binding
→ compiled
→ validated
→ submitted
→ executing
→ completed / failed / fallback
→ feedback_recorded
```

## 10. 失败

执行前失败回退 Cognitive Runtime；执行中失败由 v1.2.2 Outcome/Recovery 处理，并追加 Feedback 和 Revalidation Signal。

## 11. LangGraph

v1.3 不新增 Workflow Engine。最终链仍为 User Goal Plan → Skill Attempt → Existing Workflow Plan → LangGraph.js。任何预编译 Graph 仍经过 Workflow Validator。

## 12. 缓存

允许缓存 Active Artifact Index、Definition、Runtime Binding 和 Rule Model，但缓存必须绑定 Artifact Version、Active Pointer、Catalog Hash、Policy Hash 和 Tenant Scope。PostgreSQL 仍是权威。


---

<!-- Source: 11_v1.2x_Integration_Upgrade_V1.0.md -->

# SDAR v1.3 与 v1.2.2 / v1.2.3 集成改造方案 V1.0

## 1. 保留权威

### v1.2.2

User Goal Completion Contract、User Goal Plan、Skill Goal DAG、Scheduler、Skill Selection、Provider Readiness、Skill Attempt、Workflow/MCP Task、Outcome Judge、Recovery 和 UserGoalPlanController Terminal Authority。

### v1.2.3

Generic Task Understanding、Interactive Goal Session、Interactive Planning Session、Planning Correction、Experience Episode、Knowledge Promotion、Task Type、Capability Pattern 和 Planning Heuristic。

## 2. v1.3 插入位置

```text
Request
→ v1.3 Fast Gateway
→ Compiled Candidate or Fallback
→ v1.2.3 Goal / Plan Interaction
→ v1.2.2 Execution
```

Fast Gateway 不拥有 Goal 权威。

## 3. 新增 Port

```ts
interface RuntimeArtifactResolver {
  resolve(context: RuntimeRequestContext): Promise<ArtifactMatch[]>;
}

interface RuntimeArtifactApplicabilityEvaluator {
  evaluate(
    artifact: CompiledArtifact,
    context: RuntimeRequestContext
  ): Promise<ArtifactApplicabilityResult>;
}

interface CompiledPlanCandidateBuilder {
  build(input: CompiledPlanBuildInput): Promise<UserGoalPlanCandidate>;
}

interface CognitiveFallbackPlanner {
  plan(input: CognitiveFallbackInput): Promise<UserGoalPlanCandidate>;
}

interface ArtifactExecutionFeedbackPort {
  record(input: ArtifactFeedbackInput): Promise<void>;
}
```

## 4. 入口模式

```text
Feature Flag off      → 完全使用 v1.2.3
Feature Flag shadow   → v1.2.3 正式运行，v1.3 只 Shadow
Feature Flag advisory → v1.3 候选展示给用户
Feature Flag active   → 低风险 Active Artifact 可生成 Plan Candidate
```

## 5. Goal Contract

Fast Gateway 可以识别 Task Type、使用已确认 Contract 或产生 Contract Candidate，但不能绕过现有 Contract Validator 和确认策略。

## 6. Interactive Planning

Template Plan Candidate 可以进入现有 Plan Review，并显示 Artifact 来源、版本和验证摘要。低风险自动确认只在现有策略允许时开放。

## 7. Experience

新增 Artifact Selected、Match、Compile、Fallback、Outcome、User Patch 和 Policy Deny 事实进入 v1.2.3 Experience，用于重新编译但不直接修改 Active Artifact。

## 8. Capability Summary

Artifact 只声明 Required Capability。精确 Skill 和 Provider 仍由当前 Skill Registry、Capability Summary 和 Readiness 决定。

## 9. Memory

MemoryService 只保存 Artifact 检索摘要、用户低风险偏好和 Active Artifact Ref 投影。完整 Artifact Definition 不存入 Memory。

## 10. Skill Evolution

Skill Evolution 产生可执行 Skill Version；Artifact Compilation 产生决策、计划、案例和路由资产。能力缺口只能创建 Skill Proposal。

## 11. A2A

公开 Agent Card 继续展示 Capability 和 Skill，不展示内部 Artifact、规则、案例、失败统计和 Policy。

## 12. MCP

Artifact 不能直接调用 MCP。正式链仍为 Artifact Plan → Skill Selection → Workflow → MCP。

## 13. Feature Flags

```text
SDAR_ARTIFACT_REGISTRY_ENABLED
SDAR_EXPERIENCE_COMPILER_ENABLED
SDAR_FAST_GATEWAY_ENABLED
SDAR_TEMPLATE_RUNTIME_ENABLED
SDAR_RULE_RUNTIME_ENABLED
SDAR_CASE_RUNTIME_ENABLED
SDAR_MODEL_CASCADE_ENABLED
SDAR_ARTIFACT_INJECTION_MODE=off|shadow|advisory|active
```

默认：Registry on、Compiler candidate-only、Fast Gateway shadow、Template advisory、Rule shadow、Case off、Model Cascade off。


---

<!-- Source: 12_Database_API_Event_Worker_Design_V1.0.md -->

# SDAR v1.3 数据库详细设计与接口契约 V1.0

## 1. Schema

建议在现有 PostgreSQL 增加逻辑 Schema `sdar_compiler`；若仓库坚持单 Schema，可使用统一表名前缀。PostgreSQL 仍是唯一持久化权威。

## 2. 核心表

### compiled_artifact

```sql
compiled_artifact(
  artifact_id text primary key,
  artifact_key text not null,
  version integer not null,
  artifact_type text not null,
  tenant_id text,
  domain text not null,
  status text not null,
  risk_level text not null,
  definition jsonb not null,
  applicability jsonb not null,
  dependency_snapshot jsonb not null,
  lineage_id text not null,
  validation_summary_id text,
  content_hash text not null,
  created_at timestamptz not null,
  unique(artifact_key, version)
)
```

### artifact_active_pointer

```sql
artifact_active_pointer(
  artifact_key text primary key,
  artifact_id text not null,
  artifact_version integer not null,
  activated_by text not null,
  activated_at timestamptz not null,
  lock_version integer not null
)
```

### artifact_lineage

```sql
artifact_lineage(
  lineage_id text primary key,
  artifact_id text not null,
  artifact_version integer not null,
  source_episode_refs jsonb not null,
  source_knowledge_refs jsonb not null,
  source_correction_refs jsonb not null,
  source_pattern_refs jsonb not null,
  generation_methods jsonb not null,
  compiler_version text not null,
  created_at timestamptz not null
)
```

### artifact_validation_run

```sql
artifact_validation_run(
  validation_run_id text primary key,
  artifact_id text not null,
  artifact_version integer not null,
  validation_type text not null,
  dataset_ref text not null,
  status text not null,
  result text,
  metrics jsonb not null,
  counterexample_refs jsonb not null,
  started_at timestamptz not null,
  completed_at timestamptz
)
```

### artifact_approval

```sql
artifact_approval(
  approval_id text primary key,
  artifact_id text not null,
  artifact_version integer not null,
  approver_id text not null,
  decision text not null,
  reason text not null,
  validation_summary_hash text not null,
  created_at timestamptz not null
)
```

### artifact_execution

```sql
artifact_execution(
  artifact_execution_id text primary key,
  artifact_id text not null,
  artifact_version integer not null,
  task_id text not null,
  goal_id text,
  goal_version integer,
  mode text not null,
  decision_snapshot jsonb not null,
  generated_plan_id text,
  status text not null,
  fallback_reason_code text,
  started_at timestamptz not null,
  completed_at timestamptz
)
```

### artifact_feedback

```sql
artifact_feedback(
  feedback_id text primary key,
  artifact_execution_id text not null,
  artifact_id text not null,
  feedback_type text not null,
  reason_code text not null,
  summary text not null,
  impact jsonb not null,
  outcome_ref text,
  created_at timestamptz not null
)
```

### artifact_match_log

```sql
artifact_match_log(
  match_id text primary key,
  request_id text not null,
  task_id text not null,
  candidate_artifact_id text not null,
  score jsonb not null,
  applicability jsonb not null,
  decision text not null,
  reason_codes jsonb not null,
  policy_snapshot_hash text not null,
  created_at timestamptz not null
)
```

### experience_trace / pattern_candidate

```sql
experience_trace(
  trace_id text primary key,
  source_episode_id text not null,
  task_type_refs jsonb not null,
  goal_fingerprint text not null,
  capability_fingerprint text not null,
  environment_fingerprint text not null,
  trace jsonb not null,
  completeness numeric not null,
  created_at timestamptz not null
)

pattern_candidate(
  pattern_id text primary key,
  pattern_type text not null,
  cohort_fingerprint text not null,
  definition jsonb not null,
  support_refs jsonb not null,
  contradiction_refs jsonb not null,
  confidence numeric not null,
  status text not null,
  created_at timestamptz not null
)
```

## 3. 事务

激活：CAS Candidate → 校验 Approval/Validation → 切 Active Pointer → Outbox，一个事务。  
废弃：CAS Active Pointer → Artifact deprecated → Outbox，一个事务。

## 4. Repository Ports

```ts
interface ArtifactRepository {
  findActiveIndex(query: ArtifactIndexQuery): Promise<ArtifactIndexEntry[]>;
  getDefinition(ref: ArtifactRef): Promise<CompiledArtifact | undefined>;
  saveCandidate(candidate: CompiledArtifact): Promise<void>;
  activate(input: ArtifactActivationInput): Promise<void>;
  deprecate(input: ArtifactDeprecationInput): Promise<void>;
}

interface ArtifactValidationRepository {
  createRun(input: ValidationRunInput): Promise<ArtifactValidationRun>;
  appendResult(input: ValidationResultInput): Promise<void>;
  findPromotionSummary(ref: ArtifactRef): Promise<ValidationSummary | undefined>;
}

interface ArtifactExecutionRepository {
  start(input: ArtifactExecutionStart): Promise<ArtifactExecutionRecord>;
  complete(input: ArtifactExecutionCompletion): Promise<void>;
  appendFeedback(input: ArtifactFeedbackInput): Promise<void>;
}
```

## 5. Management API

```text
GET  /api/v1/artifacts
GET  /api/v1/artifacts/{artifactId}
GET  /api/v1/artifacts/{artifactId}/lineage
GET  /api/v1/artifacts/{artifactId}/validations
POST /api/v1/artifacts/{artifactId}/validate
POST /api/v1/artifacts/{artifactId}/approve
POST /api/v1/artifacts/{artifactId}/activate
POST /api/v1/artifacts/{artifactId}/deprecate
POST /api/v1/artifacts/{artifactId}/revalidate

GET  /api/v1/artifact-executions
GET  /api/v1/artifact-executions/{executionId}

GET  /api/v1/compiler/traces
GET  /api/v1/compiler/patterns
POST /api/v1/compiler/runs
POST /api/v1/compiler/patterns/{patternId}/generate-artifact
```

所有写操作要求 auth、actor、reason、idempotency、expectedVersion、audit 和无物理副作用。

## 6. Runtime API

```ts
interface FastGateway {
  evaluate(input: RuntimeRequestContext): Promise<RuntimeExecutionDecision>;
}
interface TemplateRuntime {
  instantiate(input: TemplateInstantiationInput): Promise<UserGoalPlanCandidate>;
}
interface RuleRuntime {
  evaluate(input: RuleDecisionContext): Promise<RuleDecisionResult>;
}
interface CaseRuntime {
  retrieve(input: CaseRetrievalInput): Promise<CaseMatch[]>;
  adapt(input: CaseAdaptationInput): Promise<CaseAdaptationResult>;
}
```

## 7. Events

```text
experience.trace_created
compiler.pattern_discovered
compiler.artifact_candidate_created
artifact.validation_started
artifact.validation_completed
artifact.approval_recorded
artifact.activated
artifact.revalidating
artifact.deprecated
artifact.match_evaluated
artifact.execution_started
artifact.execution_completed
artifact.execution_failed
artifact.feedback_recorded
```

## 8. Queues

```text
sdar-compiler-normalization
sdar-compiler-process-mining
sdar-compiler-pattern-generalization
sdar-compiler-artifact-generation
sdar-artifact-replay
sdar-artifact-simulation
sdar-artifact-shadow
sdar-artifact-revalidation
```

Worker 使用 at-least-once、PostgreSQL 幂等、BullMQ 可重建、Dead Letter、Lease 和 bounded retry。

## 9. 缓存

缓存 Active Artifact Index、Definition、Rule Model、Embedding 和 Dependency Validity。缓存键必须包含 Artifact Version、Active Pointer Version、Catalog Hash、Policy Hash 和 Tenant Scope。

## 10. 数据保留

永久保留 Activation、Approval、Promotion Validation、Counterexample、Safety Failure 和 Lineage。普通 Match Log 与成功 Execution 可按租户策略归档。


---

<!-- Source: 13_Open_Source_and_Paper_Mapping_V1.0.md -->

# SDAR v1.3 开源项目与论文方法映射 V1.0

> 本清单用于设计参考。进入实施前需要重新锁定仓库 commit、许可证、活跃状态和 API。

## 1. 经验与工作流归纳

### Agent Workflow Memory

用于历史轨迹抽象、参数与流程分离、Offline/Online Induction，以及 Abstract Workflow + Concrete Examples。对应 WorkflowPatternMiner 和 PlanTemplateCandidateGenerator。

### AutoFlow / AFlow

用于 Workflow 生成、Mutation、Candidate/Champion 和 Evaluation Dataset。对应 Template Candidate Optimization 与 Replay Comparison。

### EvoAgentX

用于 Workflow 生成、评估、演化和 Human-in-the-loop，适合作为 Offline Artifact Factory 的产品形态参考。

## 2. Process Mining

### PM4Py

用于 Event Log、Process Tree/Petri Net/BPMN、Variant Discovery 和 Conformance。对应 ExperienceTrace、ProcessVariantMiner 及 Fitness/Precision/Generalization。

建议只作为离线研究和算法验证工具，生产 Runtime 不引入 Python 权威。

### Imposing Rules in Process Discovery

将领域专家规则加入流程发现，避免算法发现业务上不允许的流程，适合“自动发现、人工确认固化”。

## 3. Case-Based Reasoning

### CBRKit

```text
Retrieve
→ Reuse
→ Revise
→ Retain
```

对应 Case Fingerprint、Hybrid Similarity、Case Adaptation 和 Case Feedback。

## 4. Fast Routing

### Semantic Router

用于 Embedding 路由、Threshold、Local Embedding 和无匹配回退。对应 Intent Route Artifact 和 Artifact Index Retrieval。

SDAR 仍需增加结构化条件、能力、Readiness 和 Policy。

## 5. Rule / Policy

### ZEN Engine

用于 JSON Decision Model、Decision Table、Node Binding 和低延迟业务规则。对应 DecisionRuleRuntime。

### Open Policy Agent

用于 Policy-as-Code、allow/deny、WebAssembly/REST 和安全治理。对应 Safety Policy Gate。

ZEN 负责业务决策；OPA 或现有 SDAR Policy 负责安全权限。

## 6. Model Routing

### RouteLLM

用于强弱模型路由、阈值校准和成本质量平衡。对应 Model Route Artifact 与 Model Cascade。

### FrugalGPT

用于模型级联、先低成本后升级和 Budget-aware Routing。

### DSPy

用于固定模型节点的 Prompt、Examples、Module 和 Assertions 优化。对应 ModelProgramArtifact 与离线 Prompt Optimization。

## 7. 正反经验

### ExpeL

用于 Experience Gathering、Insight Extraction、Similar Experience Retrieval 和 Evaluation。

### ReasoningBank

用于成功/失败轨迹、Positive/Negative Experience 和 Counterexample。对应 Artifact support/contradiction 与 Failure Boundary。

## 8. 采用方式

```text
生产在线：
TypeScript + PostgreSQL + BullMQ + LangGraph.js
+ 自研 Fast Gateway / Artifact Runtime

离线研究：
Process Mining / Workflow Search / DSPy 等可使用 Python 基线

禁止：
将 Python 工具直接变成生产状态权威
将论文实验指标直接作为上线阈值
将模型生成规则直接激活
```

## 9. 推荐 PoC

### PoC A

```text
10 个 Task Type
20 个人工 Plan Template
Semantic Match
+ Applicability
+ Validator
+ Cognitive Fallback
```

### PoC B

```text
v1.2.3 Episode
→ Event Log
→ Process Variant
→ Plan Template Candidate
→ Human Review
```

### PoC C

```text
Rule / Template
→ Strong Model Fallback
→ 统计 Token、延迟、成功率和回退率
```
