# P08 Contract Alignment V1.1

- Package: `P08`
- Goals: `G15`
- Registry SHA-256: `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`
- Consumes: RuntimeExecutionDecision, PlanTemplateArtifactDefinition, ParameterBindingResult
- Produces: TemplateInstantiationInput, GoalContextSnapshot, UserGoalPlanCandidate, TemplateInstantiationResult, FormalPlanHandoffResult, TemplateRuntime, FormalPlanHandoffPort
- Next: `P09`

## Mandatory naming

All contract names, fields, table names, events, queues and feature flags are frozen by `CONTRACT-LOCK.json`. Local aliases are forbidden in executable code and Handoff. Internal implementation types may exist only when explicitly mapped to a frozen contract and must not cross the package boundary.

## Core persistence authority

Runtime records use `artifact_execution`; runtime feedback uses `artifact_feedback`; match decisions use `artifact_match_log`; validation/shadow use `artifact_validation_run`. Type-specific tables are allowed only as non-authoritative child projections with foreign keys and must be declared in the completion report.
