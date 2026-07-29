# P10 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01～P06

提供：

- Artifact Domain / Repository；
- Validation / Promotion；
- Active Pointer；
- Kill Switch；
- Usage / Feedback / Revalidation。

## P07

提供：

- Retrieval / Applicability Port；
- RuntimeExecutionDecision；
- Parameter Binding；
- Dependency；
- Capability / Readiness；
- Policy；
- Reason Codes；
- Snapshot Hash。

## P08

提供：

- TemplateRuntime Port；
- TemplateInstantiationResult；
- Formal Planner Handoff；
- Goal Version / CAS；
- Fallback / Confirmation；
- Usage / Outcome。

## P09

提供：

- RuleRuntime Port；
- RuleDecision；
- Conflict Resolution；
- Policy / Authorization；
- Plan Patch Handoff；
- Fallback / Confirmation / Deny；
- Usage / Drift。

## v1.2.3

提供：

- Existing Request Entry；
- Interaction / Goal / Planning；
- Cognitive Runtime；
- Formal API / A2A / SSE；
- Error / Outcome Envelope。

## v1.2.2

提供：

- UserGoalPlanController；
- Workflow；
- Attempt；
- Outcome；
- Recovery；
- Formal terminal authority。

## 输出给 P11

- FastGateway Port；
- GatewayRequestContext；
- Stage / Deadline Contract；
- GatewayDecision；
- GatewayResult；
- Adapter Registry；
- Feedback Envelope；
- Usage / Outcome Correlation；
- Drift / Revalidation；
- Reason Codes；
- SLO / Capacity；
- Feature Flags；
- Fallback Contract。
