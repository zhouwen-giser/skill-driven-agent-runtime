# v1.0.5 Changed Files

## Runtime and domain

- Transitive confirmation evaluator and composition-root wiring
- Skill-call confirmation lifecycle and exact parent/child linkage
- Task/A2A pause projection and LangGraph checkpoint resume

## Persistence and design

- Migration `0057_nested_skill_confirmation` up/down
- ADR-076 and storage-schema updates

## Tests and evidence

- Confirmation-policy, pause/resume, rejection, cancellation and version-drift unit/E2E tests
- PostgreSQL lifecycle and migration-path verification
- Changelog, status, ExecPlan, traceability and release reports
