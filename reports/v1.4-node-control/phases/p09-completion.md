# P09 Completion Report

## Goal

Bind an accepted Task to an immutable, exact Capability/Exposure contract and preserve every
replan, Skill replacement, Provider failover and recovery as an append-only execution attempt.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `bf7fef973183ccff6c96e7c37afe137b9f1d4b77`
- implementationSha: `39298c3798d6a14447b7a01e30eae0d3b13ae5f8`
- evidenceSha: `5a82b5e159a92a47e86f4064a61803d47f284754`

## Implementation

- Added deeply immutable `TaskCapabilityBinding` and append-only
  `TaskCapabilityExecutionAttempt` Domain models with canonical SHA-256 identity.
- Explicit A2A `io.sdar/requestedCapability` metadata now requires exact Exposure version and
  request identity. Ordinary A2A Tasks remain compatible; explicit requests fail closed if
  Capability admission is not composed.
- Runtime resolves only the active Agent Card Exposure against a current available/degraded
  Readiness snapshot, validates requester policy and input schema, and freezes Capability,
  Exposure, input, success, evidence, constraints, implementation and secret-free Provider policy.
- Task, initial generic attempt, immutable Binding, initial Capability Attempt and `task.created`
  event commit in one Runtime PostgreSQL transaction. A failed write rolls the complete unit back.
- Replan, replacement, recovery and real controlled Model Provider fallback append new attempts and
  supersede the preceding non-terminal attempt without changing the Binding.
- Terminal completion requires structured output satisfying every frozen success criterion,
  evidence requirement and authorization/safety constraint. Ordinary non-Capability Task terminal
  behavior remains unchanged.
- Added frozen public/internal Binding reads through a read-only Runtime-Control adapter; Control
  cannot import or invoke the Runtime write repository.

## Acceptance

| P09 criterion | Result | Evidence |
|---|---|---|
| Task/Binding/initial transition atomic | passed | forced Runtime-event FK failure leaves zero Task and Binding rows |
| Immutable complete snapshot | passed | real Provider policy content and MCP refs plus SQLSTATE 55000 mutation rejection |
| Admission guard | passed | active exact Exposure, current Readiness, requester and Ajv input checks |
| Attempt history | passed | initial/replan/provider_failover/recovery history with superseded predecessors |
| Workflow Complete is insufficient | passed | missing criteria/evidence/policy evidence rejects terminal success |
| Existing Task compatibility | passed | explicit no-downgrade and ordinary terminal no-op regressions |
| Authority isolation | passed | Runtime write repository; Runtime-Control read-only query; architecture gate |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 4 files, 42 tests |
| focused real PostgreSQL Integration | passed | 1 file, 1 vertical acceptance test |
| aggregate Integration | passed | 25 files, 138 tests |
| architecture / frozen contract | passed | 623 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| migration verification | passed | 32 additive Runtime migrations through `0139`; Control through `0007` |
| `pnpm verify` | passed in 346,117 ms | 927 Unit + 22 performance, 215 Contract, 138 Integration, 72 E2E; build and all smokes |

The accepted report is `reports/verification/summary.json` with SHA-256
`8f91f336165e3a1fbcd61434c1a49e6a31949cf4d808a1486cb9e838b9a24488`.

## Real / simulated / unverified

PostgreSQL transactions, both migration ledgers, A2A mapping, authenticated HTTP reads, immutable
database triggers, readiness/admission resolution and attempt history are real local evidence.
Capability, Skill, MCP and Provider rows are deterministic fixtures; no physical Provider operation
was invoked. Multi-node contention is unverified and not claimed.

## Review and failed attempts

The read-only review closed 1 Blocking, 3 Major and 2 Minor findings. Final verdict is 0 Blocking,
0 Major and 0 Minor. Failed attempts are retained in
`failed-attempts/p09-task-capability-binding.md`.

## Handoff

P09 is `COMPLETED` locally. P10 may adapt Skill, Plan Template and Artifact management surfaces but
must not mutate the frozen Binding or introduce a second execution/Artifact authority.
