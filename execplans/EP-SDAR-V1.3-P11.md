# EP-SDAR-V1.3-P11 — Case Template and Model Route Runtime

## Purpose / Outcome

Deliver P11/G19-G20 as two bounded Fast Gateway adapters. An active Case
Artifact may retrieve and safely adapt reusable structure into a P08 formal
planning candidate. An active Model Route Artifact may select a currently
ready provider/model and execute a bounded serial cascade. Neither adapter
becomes Goal, Plan, Artifact, provider-credential, policy, authorization or
execution authority.

## Frozen Baseline

- Branch: `feature/v1.3-sequential-implementation`.
- P10 closure HEAD: `2cb2dce`; worktree was clean at P11 bootstrap.
- P00 is `READY_FULL`; P01's historical completion value is `READY_FULL`;
  P02-P10 are closed predecessor inputs.
- P11 package self-check passes. Frozen registry hash:
  `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
- PostgreSQL/P02 rows remain Artifact and usage authority. Provider and
  credential authority remain in the existing model-provider runtime. Redis
  is wake/cache only.

## Requirements Covered

- AC-P11-001 through AC-P11-051.
- Frozen V1.1 CaseRetrievalInput, CaseMatch, CaseAdaptationInput,
  CaseAdaptationResult, CaseRuntime, ModelProfile, ModelRouteContext,
  ModelRouteDecision, ModelCascadeRun and ModelRouteRuntime contracts.
- Consumed P07 RuntimeExecutionDecision, P08 FormalPlanHandoffPort, P10
  FastGateway, CaseArtifactDefinition and ModelRouteArtifactDefinition.

## Context and Orientation

- P10 owns Gateway ordering, prechecks, fallback and durable decision evidence.
- P07 owns tenant-scoped active Artifact retrieval and applicability.
- P08 owns candidate validation, current-state rechecks and formal handoff.
- Existing provider registries and usage repositories own readiness, invocation
  and measured token/cost/outcome facts.

## Architecture and Interfaces

- Domain owns immutable Case and Model Route values, reason codes, canonical
  hashes, validation and bounded-state transitions.
- Application owns a type-keyed Gateway adapter registry, Case matching and
  adaptation, deterministic model routing and bounded cascade orchestration.
- PostgreSQL owns type-specific Case/Route projections, adaptation/cascade
  Runs, attempt/usage/lineage evidence and Outbox. P02 core rows remain the
  canonical Artifact authority.
- Server composition supplies current Artifact/provider/readiness/credential
  ports. The P10 Gateway core delegates through the registry without embedding
  P11 algorithms or changing fallback/precheck order.

## Progress

- [x] 2026-07-30 Bootstrap root/branch/clean tree, locate P11 by manifest
      packageId, read all P11 contracts and predecessor Handoffs, and run only
      the P11 package self-check.
- [x] Implement frozen Domain contracts and strict validation.
- [x] Implement Case retrieval, adaptation, lineage and P08 handoff.
- [x] Implement Model Profile, route selection and bounded cascade.
- [x] Add PostgreSQL authority, Outbox, management projections and composition.
- [x] Add focused Unit/Contract/Integration/E2E/security/performance tests.
- [x] Freeze implementation and perform independent read-only review phases.
- [x] Close all Blocking/Major findings and run clean exact-commit `pnpm verify`.
- [x] Generate P11 evidence and COMPLETED Completion/Handoff.
- [ ] Commit and push the closure before reading or implementing P12.

## Implementation Steps

1. Add the ten frozen Domain values, validation, canonical hashing and reason
   codes.
2. Add a generic type-keyed Gateway adapter registry while preserving P10
   prechecks, selection order, deadlines, cancellation and fallback semantics.
3. Add Case matching and bounded adaptation with tenant/version/freshness/
   failure-boundary/security gates and P08-only formal handoff.
4. Add Model Profile readiness and deterministic route selection with data
   classification, residency, capability and output-schema hard gates.
5. Add serial bounded cascade with attempt, retry/escalation, token, cost and
   deadline limits; invoke only through existing provider/credential ports.
6. Persist authoritative Run/attempt/usage/lineage and transactional Outbox
   facts; expose bounded secret-free management evidence.
7. Cover focused, real PostgreSQL/Redis and vertical E2E behavior, freeze code,
   review read-only, repair findings, then run the full gate.

## Validation

- Focused Domain/Application/Contract tests while implementing each adapter.
- Real PostgreSQL repository/Outbox/restart tests and Redis-loss/wake-only
  tests.
- Real Gateway-to-P07-to-P11-to-P08/provider integration and E2E tests.
- Security tests for tenant, PII, credentials, residency and prompt redaction.
- Final package self-check and clean exact-commit `pnpm verify`.

## Discoveries and Surprises

- The first focused route test exposed accidental lexical sorting of selected
  Profile refs. Selection order is semantic Cascade input, so the Domain now
  preserves order while rejecting duplicates.
- The first real Integration failure asserted the entire shared Artifact table
  was empty while another test legitimately populated it. The regression now
  checks only P11-owned Artifact identifiers.
- Real E2E exposed that database-owning files could run in parallel and delete
  one another's fixtures. The E2E project now matches Integration's
  `fileParallelism=false` isolation.
- Once isolated, E2E exposed PostgreSQL `23503`: the fixture supplied a Task ID
  without creating the authoritative Task row. The provider adapter correctly
  refused an orphan invocation; the fixture now omits the optional Task link.
- The first read-only review found that the per-step timeout was passed through
  but not enforced and that Case adaptation did not reject PII. `c62334a`
  added active abort and recursive privacy gates.
- The second read-only review found camelCase privacy-name bypasses and repeated
  nested scanning. `dc636e6` canonicalizes field names and performs one
  depth-bounded pass. The final review has 0 Blocking / 0 Major / 0 Minor.

## Decision Log

- P11 algorithms live behind application-owned adapters. The P10 Gateway gains
  only a generic registry seam and retains its frozen ordering and fallbacks.
- Case adaptation emits a candidate to P08; it never creates or confirms a
  formal Plan.
- Route selection treats unknown provider readiness as unavailable and cascade
  is serial and bounded in V1.1.

## Idempotence and Recovery

Case adaptation and cascade idempotency bind tenant, Artifact version and
canonical input hashes to one durable Run. Exact retries return terminal
evidence; mismatched reuse fails. PostgreSQL reconstructs authority after
restart. Redis loss can delay a wake but cannot create, complete or mutate a
Run.

## Artifacts and Evidence

Required evidence is generated under `reports/goal/v1.3-p11-*`, including
schemas, adaptation/handoff, cascade/budget/readiness/usage/security/
performance, acceptance, review, full verify, Completion and the standard
28-field Handoff.

## Outcomes and Retrospective

P11 is complete at accepted implementation `dc636e6`. Clean `pnpm verify`
passed in 275,223 ms with 1,097 Unit/Contract, 122 real PostgreSQL/Redis
Integration, 64 E2E and 26 migrations. All 51 acceptance criteria pass. The
final read-only review has 0 Blocking / 0 Major / 0 Minor. P11 introduced no
second Planner, Policy, Artifact, provider credential, Workflow or Outcome
authority. Closure commit and push are the only remaining P11 operations.
