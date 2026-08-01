# EP-SDAR-V1.3-P08 — Plan Template Runtime and Formal Planner Handoff

## Purpose / Outcome

Deliver P08/G15: transform a P07-eligible, active `plan_template` Artifact
into a non-authoritative materialized plan candidate, validate it through the
existing formal planner boundary, and hand it to the existing planning session
and `UserGoalPlan` authority. The result is auditable, idempotent and stale
safe. P08 never accepts a public request, retrieves/ranks Artifacts, executes a
Skill/MCP/Provider call, creates a second validator/planner, or starts P09.

## Requirements Covered

- P08 AC-P08-001 through AC-P08-048; frozen V1.1 P08 contracts
  `TemplateInstantiationInput`, `GoalContextSnapshot`,
  `UserGoalPlanCandidate`, `TemplateInstantiationResult`,
  `FormalPlanHandoffResult`, `TemplateRuntime`, and `FormalPlanHandoffPort`.
- G15 active-plan-template instantiation, bounded adaptation, existing formal
  validation/confirmation, goal-version handoff, usage/outcome correlation and
  P09 handoff.

## Context and Orientation

- Baseline HEAD is `fe41d60` on `feature/v1.3-sequential-implementation`;
  `origin/main` is an ancestor and the worktree is clean.
- P00 is `READY_FULL`; P01–P07 Handoffs are present and P07 is `COMPLETED`.
  P07 supplies an internal `RuntimeExecutionDecision`; P02 PostgreSQL retains
  Artifact/active-pointer/execution/feedback authority; P06 owns lifecycle and
  kill-switch authority; v1.2.2/v1.2.3 retain Goal, confirmation, plan and
  workflow authority.
- The P08 package self-check passed on 2026-07-29. Its frozen registry lock is
  V1.1 / `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.

## Architecture and Interfaces

- Domain owns immutable P08 contract values, materialization and bounded
  adaptation checks. Application owns orchestration and ports. PostgreSQL owns
  durable execution/feedback records; Redis may only wake/rebuild projections.
- New P08 code must adapt the existing Plan Validator, Interactive Planning
  Session, Goal Version lock and UserGoalPlan authority. It must not copy their
  state machines or rules.
- Every P08 handoff performs a current-state recheck: active pointer, Artifact
  hash/version, Goal version, policy/catalog/readiness pins, dependency pins
  and kill switch. Any mismatch is stale/fallback/confirmation, never a commit.
- Template nodes retain capability/effect/criterion/evidence/artifact/
  constraint data without pinning an exact Skill, Provider or MCP tool.

## Progress

- [x] 2026-07-29 Confirm repository, branch, origin/main ancestry, P00–P07
      Handoff status, P08 registry lock and P08 self-check.
- [x] Map the existing formal Goal/Plan Validator/Planning Session/Controller
      ports and add only the `startWithMaterializedCandidate` adapter seam.
- [x] Implement frozen Domain contracts and bounded materialization/adaptation,
      DAG, recovery, coverage, parameter and double-current-state guards.
- [x] Use P02 `ArtifactExecutionRepository` parent execution/feedback records;
      idempotency derives stable P08 identities and no new migration or second
      persistence authority is required.
- [x] Compose the internal runtime behind a deployment-owned state reader; add
      no public/gateway/execution entry point.
- [x] Add focused P08/runtime/formal-planning regression coverage and preserve
      the repository's real PostgreSQL/Redis integration and E2E gates.
- [x] Complete code-freeze read-only review, 48/48 acceptance evidence, final
      `pnpm verify`, standard P09 Handoff, local commits and push without
      starting P09.

## Discoveries and Surprises

- P07 is deliberately internal and returns a non-executable decision; P08 must
  consume it as a snapshot and revalidate against current P02/P06/formal state.
- P06 and P05 Handoffs use registry V1.2 after P04R, while the P07/P08 package
  contracts are explicitly frozen at V1.1. P08 will preserve the P08 lock and
  map only its named consumed contracts.

## Decision Log

1. Reuse, rather than reimplement, v1.2.2/v1.2.3 formal validation,
   confirmation, goal-version locking and UserGoalPlan creation.
2. Represent the template product as a candidate until the existing formal
   authority accepts it; a P08 record cannot become a formal plan by itself.
3. Reuse P02 `artifact_execution` and `artifact_feedback` parent records for
   P08 usage correlation. No P08 child table is needed, and no second execution
   or outcome authority is created.
4. Treat all cached P07 values as evidence snapshots, not current authority;
   recheck twice and discard stale results.

## Implementation Steps

1. Inspect exact current formal planning APIs, data contracts, persistence and
   tests; select adapter seams without changing frozen P07 semantics.
2. Add pure P08 Domain values/factories/hashes and strict materialization,
   DAG/coverage, parameter, adaptation and recovery guards.
3. Add application ports/services for current-state recheck, existing validator,
   confirmation/session, formal handoff and usage/outcome correlation.
4. Record instantiation and feedback through the existing P02 execution port;
   use stable idempotency-derived IDs and existing session/goal locking rather
   than duplicating a transaction or outbox authority.
5. Wire only internal composition and add contract tests proving the absence of
   public route, Fast Gateway and direct Skill/MCP/Workflow calls.
6. Add a real P07→P08→existing-formal-authority integration path and failure,
   stale, concurrency, deletion and performance evidence.
7. Update reports, traceability, status, changelog, standard Handoff and run
   independent read-only review and full verification.

## Validation

- Start with targeted Domain/Application tests, then the repository's isolated
  PostgreSQL/Redis integration and existing planning/confirmation E2E tests.
- Run package self-check, format, lint, typecheck, unit, contract, integration,
  E2E, migration, architecture, build and final `pnpm verify` with an isolated
  database. Keep first failures, causes and reruns in Completion.
- Verify that no test weakens assertions or uses a fake formal-plan authority
  for the vertical integration proof.

## Idempotence and Recovery

Instantiation and formal handoff use immutable hashes, idempotency keys and
existing expected-version/CAS checks. Partial failure cannot leave a formal
plan; stale/deactivated/policy-changed inputs are discarded. Redis loss never
changes P02 or formal-plan authority. The isolated smoke checks create and drop
their own database, avoiding the operator database's historical state.

## Artifacts and Evidence

P08 evidence will be written under `reports/goal/v1.3-p08-*`, including all
machine-readable files required by `EVIDENCE.md`, Completion, Review,
acceptance JSON and the standard P09 Handoff. The traceability matrix, status,
changelog and this living ExecPlan will be updated as milestones close.

## Outcomes and Retrospective

P08 is complete at `3883786` plus the closure documentation commit. The final
dirty-tree `pnpm verify` passed in 254,312 ms with 958 unit/contract tests,
real integration, 62 E2E tests, migration, architecture, protocol, build and
both isolated smoke stages. First failures were strict JSON indexing,
formatting, and stale local smoke database assumptions; each was reproduced,
fixed and rerun without resetting the operator database. P09 is explicitly
out of scope; only its standard P08 handoff is emitted.
