# P02 Implementation V1.1

## G02
Implement canonical tables and `ArtifactRepository`, `ArtifactValidationRepository`, `ArtifactExecutionRepository`; verify fresh/rollback/reapply, CAS race and JSON bounds.

## G03
Implement `ArtifactRegistryService`, Level-0/1 active projections, canonical events/queues, startup rebuild, cache invalidation and unified feature flags.

## G04
Implement `OperatorIdentityPort`, `ArtifactGovernancePort` security boundary, RBAC, reason, idempotency, expectedVersion and audit. Approval and activation remain separate; production fail-closed without identity provider.

Do not implement G12 Promotion policy; do not attach Runtime to request entry.
