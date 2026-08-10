# Phase 12 Completion

- Phase: 12
- Goal: required vertical scenarios and failure injection
- Base SHA: `0868821`
- Scenario result: 44/44 passed
- Evidence dimensions: 10/10 mapped for every scenario
- Direct tests: 42 passed across 25 shared Vitest suite processes
- Runtime PostgreSQL: `127.0.0.1:55484/sdar_v122_integration_gate`
- Control PostgreSQL: `127.0.0.1:55484/sdar_control_v14_integration_gate`
- Redis: `127.0.0.1:56384`
- HTTP: real local Node Control API and programmable Evidence receiver
- Registry: 100 total / 95 Required / 5 diagnostic / 100 durable projection
- Registry hash: `sha256:2bc75460820a778830bc1c787afa74a4f71571b9658b8dd496b495e528c85567`
- Independent Review: Blocking 0 / Major 0 / Minor 0 / Accepted
- Full verify: not rerun by explicit user direction; the single final repository-wide gate remains
  scheduled for Phase 14
- Blockers: none for Phase 12 implementation or handoff
- Next phase: adversarial, security, performance and architecture hardening

## Evidence model

The Phase 12 runner treats a scenario as a compositional vertical, not as one oversized test. Each
of the 44 scenarios records exact evidence for all ten required dimensions:

- the scenario-specific Unit, Contract, Integration or E2E test proves the Source Fact behavior;
- the family-specific real PostgreSQL projector vertical proves Outbox, stable ID, payload hash,
  sequence and references for the scenario's exact Catalog record types;
- the real Control/Runtime PostgreSQL, Redis and HTTP vertical proves delivery and receiver ACK;
- the Manifest state-machine test proves incomplete, degraded and complete states; and
- the outage/High-Watermark verticals prove the Evidence path does not mutate business authority.

`scripts/run-v141-evidence-e2e.mjs` verifies all referenced tests passed, all record types exist in
the current Registry and all Matrix rows are `implemented_and_verified`. The report-only mode may
only rematerialize a report when every expected suite and test name already exists with status
`passed`; it never converts a missing or failed result into success.

## Scenario groups

- Runtime / Skill: 10/10
- MCP Tasks: 10/10
- Capability / Experience: 7/7
- Node Control: 6/6
- Export / Manifest: 11/11

The authoritative machine-readable result is
`reports/v1.4.1-evidence/phase-12-e2e.json`.

## First-failure and repair evidence

The runner preserves failing Vitest JSON under `failed-attempts/12-*.json`. The consolidated
failure chain is `failed-attempts/phase-12-first-failures.md`. The repairs were narrow and retained
the original assertions:

- repository Redis ports became environment-configurable rather than assuming `56379`;
- the procedure mapping was changed to a self-contained scenario instead of depending on a prior
  test's imported Skill;
- Node Event pagination now orders the numeric PostgreSQL sequence before exposing it as text;
- P11's active export policy is explicitly installed by tests that call `EvidenceStore.pending`;
- unrequeued DLQ rows are no longer counted as deliverable pending records in stale assertions; and
- the Manifest test changes its authority snapshot hash when the quality-issue set changes.

## Independent read-only review

The first review found one Major reporting defect: three family profiles had real business and
projection evidence but attributed delivery, ACK and Manifest dimensions to projector tests that
did not prove them. The implementation phase added explicit per-dimension provenance using the
already-passed shared delivery/ACK and Manifest verticals. A second read-only review found:

- Blocking: none.
- Major: none.
- Minor: none.
- Accepted: 44 scenario identities, 10 dimensions per scenario, 42 direct passed tests, 25 shared
  suites, no missing passed-test reference, no unknown Catalog type and no unverified Matrix row.

Phase 12 is closed for implementation and handoff. Phase 13 may start; the final repository-wide
verification remains intentionally deferred to Phase 14.
