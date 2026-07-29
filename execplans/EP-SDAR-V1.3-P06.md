# EP-SDAR-V1.3-P06 — Shadow, Promotion, and Governance

## Purpose / Outcome

Deliver P06 G11/G12: a PostgreSQL-authoritative, non-blocking Shadow and
human-governed promotion path for immutable P02 compiled Artifacts. P06 stops
before P07: it has no Fast Gateway, retrieval, online applicability or Artifact
execution path.

## Frozen Baseline

- P00–P04R are read-only evidence inputs.
- P05 handoff is `COMPLETED`; P06 consumes immutable Result/Counterexample
  facts without recomputing or modifying them.
- P02 remains the only Artifact/Pointer/Approval/Validation/Outbox authority.
- Baseline HEAD: `aa060f318b77a375f20f32fbdea1629ac5511b55`.

## Progress

- [x] Confirm package/branch/baseline and run P06 self-check.
- [x] Add exact six P06 Domain contracts, factories, errors, exports and
  canonical hashing without a Domain runtime adapter.
- [x] Add migration 0130, PostgreSQL projections, P02 parent lifecycle
  mirroring, promotion/approval/activation/revalidation governance.
- [x] Add non-blocking Shadow service, Redis wake-only workers and Server/
  Management composition.
- [x] Add P05 -> P06 -> P02 integration and safety regressions.
- [x] Complete independent read-only review and close all Blocking/Major.
- [x] Run final isolated `pnpm verify`, update Completion/Handoff/evidence and
  create local implementation commit `70647a0`.

## Decisions

1. Artifact/formal correlation is explicit at Shadow enrollment; P06 never
   selects an Artifact for an incoming formal request.
2. Candidate projection is compiled from immutable P02 definition. Formal
   projection is evidence only; neither can produce physical effects.
3. Promotion coverage is reconstructed in PostgreSQL from P05 replay Cases and
   P06 formal evidence. It is not an operator-provided field.
4. Critical safety triggers create/bind a P02 revalidation Run atomically. A
   missing P05 source becomes a durable failed/dead-letter Run.
5. Full verification uses `sdar_v122_p06_smoke`, a guarded isolated v1.2.2
   database. The pre-existing `/sdar` ledger was preserved.

## Changed Files

- Domain/Application: `artifact-shadow-governance.ts`, Shadow runtime,
  promotion governance and regression tests.
- Persistence/Runtime: migration 0130, P06 repository, P05 revalidation
  compatibility, BullMQ wake-only workers and Server composition.
- Operator API: promotion approval/activation/revalidation endpoints and
  OpenAPI schema.
- Evidence: P06 reports, handoff, review, status, traceability and verification
  reports.

## Migrations

`0130_v13_artifact_shadow_governance` is additive. The isolated migration path
verified clean baseline, idempotency, rollback/reapply and rogue-ledger
rejection through all 23 post-baseline migrations.

## Focused Tests

- P06 focused: 5 files / 24 tests passed.
- Full unit+contract: 146 files / 941 tests passed.
- P05/P06 isolated integration: 14 files / 110 tests passed.
- E2E: 2 files / 62 tests passed.

## Full Verify

`pnpm verify` passed against the operator-managed local PostgreSQL/Redis pair
with `sdar_v122_p06_smoke` as the protected clean-baseline smoke database.
`reports/verification/summary.json` records seven passed stages.

The first full invocation timed out inside nested `verify-full.mjs`; direct
replay exposed and fixed the Domain runtime import. The final rerun passed.

## Review Findings

Independent review final result: 0 Blocking / 0 Major / 0 Minor. The review
requested explicit integration assertions for P02 lease clearing and persisted
active validation summary; both assertions are included in the final 110-test
integration pass.

## P07 Handoff

`reports/goal/v1.3-p06-handoff.json` is complete. P07 may consume only active,
dependency-valid P02 Artifacts. No P07 implementation was started.

## Outcomes

P06 is complete with PostgreSQL as the durable source of truth and Redis only
as a wake mechanism. The next package remains P07 and is out of scope.
