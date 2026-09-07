# FR-A2A-012 Draft Management Reconciliation

Date: 2026-07-13

## Result

Verified. The EP-01 trace row was stale after the later source-governed publication increment. A2A create/update intent persists only a PostgreSQL Skill draft. Management can read that draft, and the dynamic Agent Card does not expose it before the dedicated management publication path succeeds.

## Evidence

- `packages/application/test/task-service.unit.test.ts` proves draft persistence precedes Task queueing.
- `packages/application/test/skill-authoring.unit.test.ts` rejects generic `a2a_draft` authoring and publishes only a persisted draft with publisher and SkillVersion evidence.
- `packages/persistence-postgres/test/repositories.integration.test.ts` proves draft round-trip and the constrained publication transition.
- `packages/management-api/test/http-endpoint.contract.test.ts` covers draft read and publication endpoints.
- `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` submits a real A2A draft request, reads it through management, proves Agent Card absence, rejects the generic authoring bypass, publishes through the dedicated route, and then observes the Skill in Agent Card.
- Historical full gate recorded by `reports/EP-05-memory-evaluation-evolution/FR-EVO-008-source-publication-policy.md`: 136 unit, 29 integration, 39 contract, 35 E2E, build and local smoke passed.
- Current deterministic regression: eight affected unit/contract files participated in a 69-test run; all passed. Current unified `pnpm verify` also passes with 54 files/240 tests.

## Classification

- Real historical evidence: A2A, PostgreSQL, management HTTP, formal Skill registry, and dynamic Agent Card.
- Simulated external semantics: local structured authoring model response.
- Unverified by design: publisher identity authenticity under the no-auth trusted-intranet baseline.

No current Docker rerun is claimed. The status is verified because the exact original acceptance behavior has reproducible implementation/tests and a recorded successful real gate; the current Docker outage is not evidence that the completed behavior regressed.
