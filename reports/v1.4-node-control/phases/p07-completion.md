# P07 Completion Report

## Goal

Make Runtime the sole writer of auditable `CapabilityReadinessSnapshot` facts while allowing the
Control Plane to read snapshots and request recomputation through frozen public and internal
interfaces.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `e4e5114760c1c1f356455d44b0cb31ad457ca548`
- implementationSha: `be9d01d7f6773f4d07fa26a7ab0de54c9fd7a0c2`
- evidenceSha: `PENDING_EVIDENCE_COMMIT`

## Implementation

- Runtime Application computes `available`, `degraded`, `unavailable`, and `suspended` from the
  exact published Definition, active implementation Bindings, Skill/Plan Template catalogs,
  provider availability, model routes, policy evidence, maintenance state, and kill switch.
- Safety degradation is immediate. Improving or lateral transitions observe a durable minimum
  stability window, while every snapshot carries an expiry and is eligible for scheduled Runtime
  recomputation.
- Runtime PostgreSQL migration `0137_v14_capability_readiness` persists immutable append-only
  snapshots, full evaluation inputs, hashes, candidate stability state, command receipts, and
  status-change Outbox events. Restart recovery reads the latest persisted snapshot and input.
- Control exposes the frozen read/evaluate API and authenticated Runtime evaluation endpoint. It
  requests Runtime evaluation but never owns or writes readiness tables.
- Catalog and policy hashes derive from the exact dependencies used by the evaluation; the snapshot
  hash covers the complete emitted snapshot and is returned as the GET ETag.

## Acceptance

| P07 criterion | Result | Evidence |
|---|---|---|
| Runtime-only readiness authority | passed | Runtime repository owns the snapshot; Control database absence is asserted |
| Full dependency input | passed | Definition, Bindings, Skill/Template, MCP Catalog/TTL, Model Route, policy, maintenance, kill switch |
| Availability expiry | passed | stale MCP provider changes `available` to `unavailable` with an explicit reason |
| Flapping control | passed | immediate safety downgrade and stability-window recovery unit regressions |
| Event-driven and scheduled recomputation | passed | authenticated Runtime endpoint plus bounded expiry scheduler |
| Durable recovery | passed | API restart returns the byte-equivalent persisted snapshot |
| Hash/freshness audit | passed | dependency/snapshot SHA-256 and evaluated/valid-until timestamps persist |
| Outbox | passed | one readiness-changed event per actual status transition |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 1 file, 2 tests |
| focused real PostgreSQL Integration | passed | 1 file, 1 vertical acceptance test |
| official aggregate Integration | passed | 25 files, 138 tests |
| architecture / frozen contract | passed | 611 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| migration verification | passed | 30 additive Runtime migrations through `0137`, rollback/reapply and checksum drift protection |
| `pnpm verify` | passed in 404,300 ms | 916+22 Unit, 214 Contract, 138 Integration, 72 E2E; build and all smokes |

The accepted report is `reports/verification/summary.json` with SHA-256
`be8146caa45026f0ee878e5c521e1fbb1fa37de90332be8a47b9999b6bcc547d`.

## Real / simulated / unverified

Control and Runtime PostgreSQL, migrations, exact Skill/MCP/Model facts, HTTP authentication,
idempotency, SQL immutability, Outbox and process restart are real local evidence. The provider
endpoint and model are catalog fixtures and were not invoked. Production scale, multi-node
coordination and external Provider uptime are unverified and not claimed. P08 has not started.

## Review and failed attempts

Four read-only review passes closed five Major and two Minor findings. The final verdict is 0
Blocking, 0 Major and 0 Minor. Environment failures are retained in
`failed-attempts/p07-runtime-readiness.md`.

## Handoff

P07 is `COMPLETED` locally. P08 may project only published, current Capability definitions and
Runtime-authored readiness snapshots into A2A metadata; it must not create a competing readiness
writer or modify the frozen Runtime evaluation boundary.
