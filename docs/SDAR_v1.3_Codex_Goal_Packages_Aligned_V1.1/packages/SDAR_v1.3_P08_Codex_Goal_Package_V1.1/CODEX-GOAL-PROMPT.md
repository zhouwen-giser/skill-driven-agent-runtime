# Codex Goal Prompt：执行 SDAR v1.3 P08

你正在执行 SDAR v1.3 十四个正式任务包中的 P08。

## 配置

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Mode: Goal
Package: P08
Repository: zhouwen-giser/skill-driven-agent-runtime
```

## 唯一目标

实现 Active Plan Template Artifact 的安全实例化与正式规划权威交接。模板只负责生成 Plan Candidate，正式 Plan 的确认、Goal Version Lock、UserGoalPlan 创建和终态权威仍由现有 v1.2.2/v1.2.3 路径负责。

## 开始前必须读取

1. 本任务包全部 Markdown；
2. P00～P07 Handoff；
3. P01 Plan Template Artifact Domain；
4. P02 Artifact Repository / Usage / Feedback；
5. P04 PlanTemplateCandidate Contract；
6. P06 Active / Revalidating / Kill Switch；
7. P07 Retrieval / Applicability / Parameter Binding / Capability / Readiness / Policy；
8. v1.2.2 User Goal、Plan Validator、Skill Goal DAG、UserGoalPlanController、Workflow、Outcome、Recovery；
9. v1.2.3 Interactive Goal、Interactive Planning、Correction、Goal Version Handoff；
10. 当前 Idempotency、CAS、Outbox、Telemetry、A2A 与 Console Evidence。

## 强制执行顺序

```text
Baseline
→ Handoff Validation
→ Runtime Contract
→ Goal Context Freeze
→ Active / Dependency Recheck
→ Parameter Materialization
→ Node / DAG Materialization
→ Completion Contract
→ Evidence / Artifact Requirements
→ Bounded Adaptation
→ Recovery Branch
→ Existing Plan Validator
→ Planning Session / Confirmation
→ Goal-Version Handoff
→ Idempotency / CAS
→ Usage / Outcome Correlation
→ Tests
→ Evidence
→ Read-only Review
→ Commit / Push / Draft PR
```

## 必须实现

- TemplateRuntime Port；
- TemplateInstantiationInput；
- TemplateInstantiationResult；
- GoalContextSnapshot；
- Active Artifact Recheck；
- Artifact Hash / Pointer / Policy / Catalog / Readiness Recheck；
- Parameter Materialization；
- Node Objective Materialization；
- Capability Requirement Preservation；
- Skill Goal DAG Materialization；
- Completion Contract Materialization；
- Criterion Coverage；
- Evidence / Artifact Requirement；
- Recovery Branch Materialization；
- Bounded Adaptation；
- Existing Plan Validator Adapter；
- Existing Planning Session Adapter；
- User Confirmation / Policy Confirmation；
- Goal Version / Plan Version Lock；
- Formal Handoff Idempotency；
- Artifact Usage Record；
- Formal Outcome Correlation；
- Fallback / Require Confirmation；
- Stale Result Discard；
- P09 Handoff。

## 禁止实现

- Fast Gateway Orchestrator；
- 正式 Request 入口改造；
- Intent Route Runtime；
- Decision Rule Runtime；
- Case Runtime；
- Model Cascade；
- Artifact Retrieval / Ranking；
- Approval / Activation；
- Exact Skill / Provider / MCP 固化到 Artifact；
- 直接创建 Skill Attempt；
- 直接启动 Workflow；
- 直接调用 Skill / MCP；
- 第二套 Plan Validator；
- 第二套 UserGoalPlan Authority；
- 模型默认 Goal / Scope / Criterion / Authorization / Safety。

## 核心判断

P08 可以通过现有正式接口创建或提交 UserGoalPlan，但必须满足：

```text
confirmed Goal Contract
current Goal Version
active Artifact
current Artifact Hash
current Policy / Catalog / Readiness
existing Plan Validator passed
existing Planning Authority accepted
idempotency / CAS passed
```

任何失败都必须回退、要求确认或返回正式规划路径。

## 完成后

交付 P09 Handoff。P09 可以复用 P08 的 Runtime Handoff 和正式权威接口，但不得让 Decision Rule 绕过 P08/P08 所依赖的正式 Plan Authority。
