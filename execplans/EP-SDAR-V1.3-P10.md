# EP-SDAR-V1.3-P10 — Fast Gateway and Artifact Runtime Feedback

## Purpose / Outcome

Deliver P10/G17-G18 as a thin, bounded request-path orchestrator. The Gateway
freezes trusted request facts, runs prechecks, delegates Artifact selection to
P07, Rule evaluation to P09, Template materialization/formal handoff to P08,
and otherwise returns to the existing cognitive runtime. It records durable
route, stage, formal-correlation, feedback and drift evidence without becoming
a Goal, Plan, Outcome, Artifact, policy, authorization or execution authority.

## Frozen Baseline

- Branch: `feature/v1.3-sequential-implementation`.
- P09 closure HEAD: `a8a0d28`; the worktree was clean at P10 bootstrap.
- P00 is `READY_FULL`; P01's historical completion value is `READY_FULL`;
  P02-P09 are `COMPLETED` and their recorded implementation commits are
  immutable predecessor inputs.
- P10 package self-check passes. The frozen V1.1 registry hash is
  `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
- P02 PostgreSQL rows remain Artifact execution/feedback authority. P06 owns
  activation, kill switches and revalidation. Redis is wake/cache only.

## Requirements Covered

- AC-P10-001 through AC-P10-052.
- Frozen V1.1 `RuntimeRequestContext`, `FastGateway`,
  `GatewayDecisionRecord`, and `GatewayFeedbackEnvelope`.
- Consumed P07 `RuntimeExecutionDecision`, P08 `TemplateRuntime`, P09
  `RuleRuntime`, and existing `FormalPlanHandoffPort`.

## Architecture and Interfaces

- Domain owns immutable frozen request/decision/feedback values, stable hashes,
  stage state transitions and reason-code catalogs.
- Application owns precheck, deadline budgeting, cancellation, per-adapter
  bulkheads/circuits, load shedding, P07/P09/P08 delegation, cognitive fallback
  and outcome/drift correlation.
- PostgreSQL owns Gateway request/decision/feedback/idempotency evidence and
  transactional Outbox. P02 Artifact execution/feedback rows remain the
  canonical per-Artifact usage authority.
- `PlanPreparationProcessor` receives an optional feature-gated Gateway entry
  port. Disabled mode executes the existing v1.2.3 path byte-for-byte; enabled
  fallback returns to that same path. Deny never falls back and confirmation
  always enters existing formal interaction.

## Progress

- [x] 2026-07-30 Bootstrap root/branch/clean tree, locate P10 by manifest
      packageId, read all package contracts and Handoffs, run only P10
      self-check, and map P07/P08/P09/current request entry.
- [x] Implement frozen Domain values and deterministic state/hash validation.
- [x] Implement Gateway orchestration, budgets, cancellation and resilience.
- [x] Add PostgreSQL evidence/Outbox and P02 usage-feedback correlation.
- [x] Connect the feature-gated Task/A2A/Server path with compatibility tests.
- [x] Add Unit, Contract, real PostgreSQL/Redis Integration and E2E tests.
- [x] Run an independent code-freeze read-only review and close all
      Blocking/Major findings.
- [x] Run clean exact-commit `pnpm verify`, generate P10 evidence,
      Completion/Handoff, commit and push before reading P11.

## Implementation Steps

1. Add P10 Domain contracts, validation, canonical hashing and reason codes.
2. Add a thin `FastGatewayService` with explicit P07/P09/P08/fallback ports.
3. Add deadline reserves, adapter timeouts, cancellation, late-result discard,
   bounded bulkheads, tenant/adapter circuits and load shedding.
4. Add PostgreSQL Gateway evidence with idempotent request decisions,
   transactional Outbox, feedback/outcome links and P06 drift signals.
5. Add the optional request-entry hook and Server composition; preserve the
   disabled and fallback paths.
6. Cover deny/confirmation/no-match/stale/timeout/cancel/concurrency/restart/
   Redis-loss/tenant/security/performance behavior with focused tests.
7. Freeze implementation, perform read-only review, repair findings, rerun
   focused and full gates, then finalize evidence and Handoff.

## Validation

- Focused Domain/Application/Contract tests during implementation.
- Real PostgreSQL migration/repository/Outbox and Redis-loss/wake-only tests.
- Real A2A/API/SSE path tests proving unchanged formal Task/Goal semantics.
- Final package self-check and repository `pnpm verify` on a clean exact
  implementation commit.

## Discoveries and Decisions

- P08 is intentionally unavailable unless the deployment supplies current
  formal state. P10 must treat an unavailable adapter as a bounded fallback,
  never synthesize a Goal/Plan.
- The existing request path creates the Task before asynchronous preparation.
  The Gateway hook therefore belongs at preparation entry, where denial can
  terminate and fallback can continue without duplicating the parser or A2A
  response envelope.
- Frozen external field names remain authoritative even where package prose
  uses internal `GatewayRequestContext` aliases.
- The initial global load-shed location could bypass authority prechecks.
  It now runs only after Auth, Tenant, Authorization, Policy and Kill Switch.
- Caller-generated feedback IDs are required for durable exact retry.
- Gateway evidence is a bounded read-only Management API/Console projection;
  it excludes request text, credentials and private reasoning.
- The repository OpenAPI drift gate correctly caught the new projection before
  release evidence was accepted.

## Idempotence and Recovery

Request idempotency binds the canonical `RuntimeRequestContext` hash to one
Gateway decision. Exact retries return the stored record; mismatched retries
fail. Stage results arriving after deadline/cancellation are discarded and
cannot submit a formal handoff. PostgreSQL reconstructs all authority after
restart; Redis loss can only delay a wake.

## Evidence and Outcomes

All required reports live under `reports/goal/v1.3-p10-*`. All 52 acceptance
items pass; final read-only review is 0 Blocking / 0 Major / 1 Minor / 4
Accepted. Clean `pnpm verify` passed on
`3361ff84de6310a48543a0b72475e64fc547f668` in 263,433 ms with 1,069
Unit/Contract, 119 Integration, 63 E2E and 25 migrations. The 28-field P11
Handoff is `COMPLETED`. P11 remained unread through P10 evidence generation.
