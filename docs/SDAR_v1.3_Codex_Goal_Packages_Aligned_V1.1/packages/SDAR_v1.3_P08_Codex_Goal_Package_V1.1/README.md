# SDAR v1.3 P08 Codex Goal Package V1.1

## 任务定位

```text
P08：Plan Template Runtime 与 Formal Planner Handoff
原子 Goal：G15
阶段：Online Runtime
```

P08 接收 P07 已完成检索与适用性判定的 Active Plan Template Artifact，将模板安全实例化为 Plan Candidate，并交给现有 v1.2.2/v1.2.3 正式规划权威完成校验、确认、版本锁和正式提交。

```text
P07 Eligible Plan Template
→ Template Instantiation
→ Bounded Adaptation
→ Goal / Criterion Coverage
→ Existing Plan Validator
→ Existing Planning Session / Handoff
→ Formal UserGoalPlan Authority
```

本任务包不重复携带 v1.3 总体设计材料。

## 执行基线

```text
未来 v1.2.3 完成并冻结后的最新 origin/main
+
P01～P07 已合入
+
P00 = READY_FULL
```

## 执行模型

```text
Model: GPT-5.6 Sol
Reasoning: Medium
Implementation Agent: 1
Review: 独立只读 Review Pass
```

## P08 主要交付

- TemplateRuntime Port；
- TemplateInstantiationInput / Result；
- Goal Context Freeze；
- Parameter Materialization；
- Skill Goal DAG Materialization；
- Capability Requirement Preservation；
- Completion Contract Materialization；
- Evidence / Artifact Requirement Materialization；
- Bounded Adaptation；
- Recovery Branch Materialization；
- Formal Plan Validator 复用；
- Goal / Plan Version Lock；
- Existing Planning Session / Handoff；
- Idempotency / CAS；
- Fallback / Confirmation；
- Template Usage / Outcome Correlation；
- P09 Handoff。

## 不属于 P08

```text
Fast Gateway Request Routing
Intent Routing
Decision Rule Runtime
Case Runtime
Model Cascade
Artifact Retrieval / Ranking
Artifact Approval / Activation
Skill Selection 固化
Skill / MCP 直接执行
第二套 Planner / Workflow
```
