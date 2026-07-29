# EP-SDAR-V1.3-P07 — Active Artifact Retrieval and Applicability

## Purpose / Outcome

Deliver P07/G13-G14: PostgreSQL-authoritative retrieval of only P06-active
Artifacts and a deterministic, fail-closed applicability decision for a
future P08 template consumer. This package indexes, retrieves, ranks,
checks and audits candidates; it neither accepts a public request nor creates
Goals, Plans, Attempts, Skill/MCP calls, or a Fast Gateway.

## Requirements Covered

- P07 AC-P07-001..048 and frozen contracts `ArtifactIndexEntry`,
  `ArtifactMatchScore`, `ArtifactMatch`, `ArtifactApplicabilityResult`,
  `ParameterBindingResult`, `DependencyValidationResult`,
  `CapabilityReadinessResult`, `RuntimeExecutionDecision`, and
  `FastGatewayPath`.
- G13: active index, progressive exact/structured/semantic retrieval,
  deterministic ranking, ambiguity and cache invalidation.
- G14: conditions, trusted parameter binding, dependency/capability/readiness/
  policy gates, OOD decision and durable audit.

## Context and Orientation

- P00 is `READY_FULL`; P01–P06 Handoffs are complete and are read-only
  predecessor evidence. P02 remains the Artifact/active-pointer/outbox
  authority. P06 remains the activation/kill-switch authority.
- Baseline HEAD is `9b2e07d` on
  `feature/v1.3-sequential-implementation`; P06 implementation `70647a0` is
  an ancestor.
- The P07 package self-check passed on 2026-07-29. Its frozen registry lock is
  V1.1 / `d7b1d971…a7ff4cbb`.

## Architecture and Interfaces

- Domain owns pure P07 values and deterministic condition/score/binding
  functions. Application owns orchestration and ports. PostgreSQL persists
  authoritative match decisions; Redis is a rebuildable wake/cache projection.
- `ArtifactRepository.findActiveIndex()` and `getDefinition()` remain the only
  source of artifact/pointer state. Projection hits are revalidated against
  active PostgreSQL candidates before a decision is emitted.
- Current internal capability, Skill candidate, provider readiness and policy
  ports are supplied to the application service. Public Agent Card disclosure,
  replay/shadow history and model suggestions never prove current readiness.
- P07 adds no HTTP route, LangGraph graph, provider/MCP execution, lifecycle
  mutation or P08 runtime behavior.

## Progress

- [x] 2026-07-29 Confirm repository, branch, P00–P06 status/ancestry, frozen
      contract lock and P07 self-check.
  - [x] Implement exact P07 Domain contracts, pure retrieval/applicability
      semantics and reason-code boundary.
  - [x] Implement PostgreSQL active projection/query, durable match audit and
        rebuildable P02 projection invalidation.
  - [x] Implement application retrieval, progressive loading, ranking, hard
      gates and P08 decision handoff.
  - [x] Add unit/contract/integration/security/performance evidence.
  - [x] Complete independent read-only review and close every Blocking/Major.
  - [ ] Run the complete isolated verification gate, publish reports/Handoff,
        commit and push without starting P08.

## Discoveries and Surprises

- P02 already exposes a narrow active-index projection. Its cache is
  rebuildable, but it lacks P07 retrieval fields and cannot itself decide
  applicability; P07 must extend the port without creating a second Artifact
  authority.
- The raw registry-file SHA is a file hash, whereas the frozen registry SHA in
  the package lock is the package's canonical registry identifier. The
  package self-check validates the latter successfully.

## Decision Log

1. Extend the P02 query projection from immutable P01 definition fields rather
   than add an Artifact alias table or let Redis own index truth.
2. A score determines presentation order only. Any failed gate emits a
   non-eligible disposition with stable reason codes.
3. Candidate parameter values retain source/trust/confidence. Critical
   parameters cannot be filled by a model candidate or unscoped preference.
  4. Dependency mismatch writes a P06-compatible revalidation trigger but never
     changes lifecycle status from P07.
  5. P07 requests revalidation only through P06's atomic scheduler. Tenant
     Artifacts use the tenant's current promotion-holdout dataset; global
     Artifacts use the exact dataset ID, version and hash from their latest
     eligible passed replay evidence. P06/P02 persists the worker-consumable
     Run, Trigger and Outbox together.
  6. The P02 active-index cache is acceleration only. P07 filters Level-0 data
     before reading an immutable definition and rechecks authoritative active
     status before returning a candidate.

## Implementation Steps

1. Add P07 pure Domain types, canonical hashing and condition/parameter
   evaluators, then focused unit tests.
2. Extend P02 repository/projection and add migration `0131` for durable P07
   projection/audit records with rollback coverage.
3. Add retrieval and applicability application services with explicit runtime
   capability/readiness/policy ports and cache invalidation adapters.
4. Compose only internal services; prove no HTTP/Fast-Gateway/P08 execution
   entry is added.
5. Add real PostgreSQL/Redis integration evidence, performance measurements,
   reports, traceability, status and a standard P08 Handoff.

## Validation

- Focused P07 unit/contract tests first, then real PostgreSQL/Redis P07
  integration and no-execution E2E boundary tests.
- Final clean isolated database gate: `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, test suites, migrations, architecture, build and
  `pnpm verify`.
- An independent, read-only review must report zero open Blocking/Major
  findings before Completion.

## Idempotence and Recovery

Migration 0131 is additive with a paired down migration. Match-decision and
revalidation writes use idempotency keys. Cache eviction or Redis loss only
forces PostgreSQL reload/rebuild. Verification uses a guarded isolated P07
database, never the operator `/sdar` database.

## Artifacts and Evidence

P07 reports will live under `reports/goal/v1.3-p07-*`, with the completion,
review, acceptance JSON, performance/security reports and standard Handoff.
The implementation references will be recorded in the Handoff's
`packageOutputs` only under frozen contract names.

## Outcomes and Retrospective

  Implementation and independent review are complete. Final full verification,
  evidence and handoff remain. P08 has not been started and is excluded from
  this plan.
