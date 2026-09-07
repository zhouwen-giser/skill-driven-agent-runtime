# Global Skill and child Workflow increment

Date: 2026-07-12

## Requirements

- FR-SKL-008: formal Skills are global across users.
- FR-SKL-010: `skill_call` creates an independent child Workflow.
- FR-SKL-011: execution resolves and records the current effective SkillVersion.

## Reproducible evidence

- Unit: `packages/application/test/skill-call-workflow.unit.test.ts` proves current-version resolution, deterministic child planning, independent execution, and evaluation recording.
- Integration: `packages/persistence-postgres/test/repositories.integration.test.ts` applies migration 0034 and proves parent/child instance linkage, actual version, status, and evaluation replay in PostgreSQL.
- E2E: `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` upgrades a Skill after parent planning and proves execution uses version 2, produces a separate LangGraph child WorkflowInstance, and stores the evaluation relation. A second scenario proves two different `user_id` values retrieve and bind the same formal Skill.

## Verification classification

- Real local: PostgreSQL, official A2A SDK, management HTTP, Model Runtime audit, and LangGraph.js parent/child execution.
- Simulated boundary: the external model is a deterministic local HTTP loopback.
- Unverified: no production or external shared service was used.

## Full gate

Format, lint, typecheck, architecture, 120 unit tests, 29 integration tests, 35 contract tests, 32 E2E tests, production build, and local server smoke all passed.
