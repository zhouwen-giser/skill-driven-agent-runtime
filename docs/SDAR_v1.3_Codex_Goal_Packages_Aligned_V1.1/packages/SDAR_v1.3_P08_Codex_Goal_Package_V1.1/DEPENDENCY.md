# P08 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01～P06

提供：

- Plan Template Artifact Domain；
- Artifact Repository / Usage / Feedback；
- Candidate Lineage / Static Validation；
- Replay / Shadow / Promotion Summary；
- Active Pointer / Kill Switch / Revalidation。

## P07

必须提供：

- Artifact Type = plan_template；
- Status = active；
- Artifact Ref / Version / Hash；
- Match / Rank；
- Applicability；
- Parameter Binding；
- Missing Parameters；
- Required Confirmation；
- Dependency Validation；
- Capability / Skill / Readiness；
- Policy；
- Reason Codes；
- Matcher / Policy Snapshot Hash。

## v1.2.2

提供：

- User Goal Contract；
- UserGoalPlan；
- Skill Goal DAG；
- Plan Validator；
- Skill Selection；
- Goal Version / Handoff Lock；
- UserGoalPlanController；
- Workflow；
- Outcome；
- Recovery；
- No Replay Side-effect。

## v1.2.3

提供：

- Interactive Goal Session；
- Interactive Planning Session；
- Plan Candidate / Patch；
- User Confirmation；
- Correction Facts；
- Interaction Episode；
- API / A2A / Console Evidence。

## 输出给 P09

- FormalRuntimeHandoffPort；
- GoalContextSnapshot；
- TemplateInstantiationInput / Result；
- MaterializedPlanCandidate；
- Existing Validator Adapter；
- Confirmation Adapter；
- Formal Handoff Result；
- Stale / Fallback / Deny Reason；
- Artifact Usage / Outcome Link；
- Runtime Snapshot Hash。
