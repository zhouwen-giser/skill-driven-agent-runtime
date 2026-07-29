# P04 Contract Alignment V1.1

- Package: `P04`
- Goals: `G07, G08`
- Registry: V1.2 immutable delta over V1.1
- Registry SHA-256: `8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`
- Consumes: WorkflowPattern, CompiledArtifact, PlanTemplateArtifactDefinition
- Produces: FusedPattern, GeneralizedPattern, CandidateStaticValidationResult
- Next: `P05`

## Mandatory naming

All contract names, fields, table names, events, queues and feature flags are frozen by `CONTRACT-LOCK.json`. Local aliases are forbidden in executable code and Handoff. Internal implementation types may exist only when explicitly mapped to a frozen contract and must not cross the package boundary.

## Core persistence authority

Runtime records use `artifact_execution`; runtime feedback uses `artifact_feedback`; match decisions use `artifact_match_log`; validation/shadow use `artifact_validation_run`. Type-specific tables are allowed only as non-authoritative child projections with foreign keys and must be declared in the completion report.
