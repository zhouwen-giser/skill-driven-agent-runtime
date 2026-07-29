# P11 Dependency Contract

## P00

必须：

```text
READY_FULL
```

## P01～P06

提供：

- Case / Model Route Artifact Domain；
- Repository / Usage / Audit；
- Candidate / Lineage；
- Replay / Validation；
- Active / Revalidation / Kill Switch。

## P07

提供：

- Active `case_template` / `model_route`；
- Match / Applicability；
- Parameter Binding；
- Dependency；
- Capability / Readiness；
- Policy；
- Reason Codes；
- Snapshot Hash。

## P08

提供：

- GoalContextSnapshot；
- Materialized Plan Candidate Contract；
- Existing Plan Validator；
- Planning Session；
- Formal Planner Handoff；
- Goal Version / CAS；
- Usage / Outcome Link。

## P10

提供：

- FastGateway Adapter Registry；
- GatewayRequestContext；
- Deadline / Cancellation；
- Circuit / Bulkhead；
- GatewayDecision / Result；
- Formal Correlation；
- Feedback Envelope；
- Feature Flags；
- SLO。

## Existing Model Runtime

提供：

- Provider Registry；
- Credential Authority；
- Model Invocation；
- Model Invocation Audit；
- Output Schema；
- Rate / Retry；
- Token / Cost；
- Provider Readiness；
- Error Envelope。

## 输出给 P12

- CaseTemplateRuntime Port；
- CaseRun / Adaptation / Handoff Evidence；
- ModelRouteRuntime Port；
- ModelProfile / Route / Cascade Evidence；
- Usage / Token / Cost / Outcome；
- Drift / Revalidation；
- Reason Codes；
- Management Query Ports；
- Feature Flags。
