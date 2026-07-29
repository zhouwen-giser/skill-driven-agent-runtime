# EP-SDAR-V1.3-P09 — Decision Rule and Policy Runtime

## Purpose / Outcome

Deliver P09/G16: evaluate a P07-selected active `decision_rule` Artifact with a
bounded, deterministic, three-valued interpreter; resolve conflicts without
letting ranking override safety; and return advice, confirmation, denial,
fallback, bounded parameter suggestions, or a bounded plan-patch candidate to
the existing P08/formal planning authority. P09 never retrieves an Artifact,
executes a Skill/MCP/Provider operation, grants authorization, writes a formal
Outcome, changes the active pointer, or implements the Fast Gateway.

## Requirements Covered

- P09 AC-P09-001 through AC-P09-050.
- Frozen V1.1 contracts `RuleDecisionContext`, `RuleConditionResult`,
  `RuleDecisionResult`, `RuleConflictResolution`, `RulePlanPatchCandidate`, and
  `RuleRuntime`.
- Existing baseline constraints FR-LLM-004, FR-WF-001/003/006/007/010,
  FR-EXE-001/002, FR-GOAL-003/004/005, FR-EVAL-002/003, NFR-OBS-001/002, and
  NFR-MNT-001, interpreted through the v1.2.2/v1.2.3 authority ADRs.

## Context and Orientation

- Baseline HEAD is `830f775` on
  `feature/v1.3-sequential-implementation`; the worktree was clean at
  bootstrap and all P00-P08 recorded commits are ancestors.
- P00 is `READY_FULL`; P01's historical completion contract is
  `READY_FULL`; P02-P08 are `COMPLETED`, with no open blockers.
- The P09 package self-check passes 29/29. The V1.1 registry canonical hash,
  computed after omitting `registrySha256`, is
  `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`;
  all three consumed contract hashes match the package lock.
- P01 Domain owns immutable Artifact definitions. P02 PostgreSQL tables own
  Artifact execution/feedback authority. P06 owns active pointer, kill switch,
  lifecycle and revalidation. P07 owns retrieval/applicability/binding/current
  readiness selection evidence. P08 and the existing interactive planning
  session own formal plan validation, confirmation, Goal-version CAS and
  handoff.

## Architecture and Interfaces

- `packages/domain/src/compiler/decision-rule-runtime.ts` owns the frozen P09
  value contracts, restricted Rule DSL, operator catalog, three-valued
  evaluator, stable hashes, conflict ordering and bounded plan-patch data.
- `packages/application/src/compiler/decision-rule-runtime.ts` owns
  orchestration and thin read-only ports for current Rule state, policy,
  authorization, formal validation/handoff, durable usage and P06
  revalidation signals. It loads current facts twice and fails closed on any
  Rule/Pointer/Tenant/Goal/Plan/Policy/Catalog/Readiness/Kill-Switch drift.
- P01's frozen `DecisionRuleArtifactDefinition` is not changed. P09 consumes a
  strict `runtimeDsl` value inside the already-frozen bounded
  `DecisionOutput.parameters`; legacy P01 conditions map to the same P09 DSL
  with conservative defaults.
- PostgreSQL adapters reuse canonical `artifact_execution` and
  `artifact_feedback`. A P09-specific adapter may add idempotent/CAS behavior
  over those tables, but cannot create a second execution, feedback, Outcome,
  policy, or active-pointer authority. Redis remains unnecessary/wake-only.
- A plan patch is immutable candidate data. It may adjust only existing
  low-risk plan data under explicit bounds; it cannot change Goal objective,
  required criteria, scope, authorization, required effects, evidence,
  artifacts, human gates, or side-effect/replay guards. The existing
  `UserGoalPlanCandidateValidator` and interactive planning authority must
  accept it before any formal plan exists.

## Progress

- [x] 2026-07-30 Confirm repository root, branch, clean worktree, P00-P08
      Handoffs/ancestry, P09 package identity, registry/contracts, migration
      head, architecture baseline and P09 self-check.
- [x] 2026-07-30 Read the P09 package, original SRS requirements relevant to
      rules/planning/evolution, current architecture/domain/DoD, and accepted
      authority ADRs.
- [x] 2026-07-30 Implement frozen P09 Domain contracts, strict DSL/operator catalog,
      deterministic evaluator, stable hashing and conflict resolution.
- [x] 2026-07-30 Implement policy/authorization/stale gates, decision materialization,
      bounded parameter/plan-patch handling, formal-authority adapters,
      usage/outcome correlation and revalidation signaling.
- [x] 2026-07-30 Reuse P02 durable execution/feedback authority with
      idempotent/CAS behavior. P09 publishes internal application ports for P10
      composition and intentionally adds no Server/public request route.
- [x] 2026-07-30 Add 52 focused Unit and 4 Contract checks plus a real
      PostgreSQL integration test for execution/feedback/Outbox idempotency,
      concurrency, security and bounded 1k-rule conflict performance.
- [x] 2026-07-30 Run three code-freeze read-only review rounds. The first
      found a Domain `node:crypto` Major; the second found missing recursive
      JSON resource bounds; both were repaired. The final verdict is
      0 Blocking / 0 Major / 0 Minor.
- [ ] Run implementation gate, generate all P09 evidence, perform an
      independent read-only review and close every blocking/major finding.
- [ ] Run the complete `pnpm verify`, finalize Completion/Handoff/traceability,
      commit and push P09 before reading P10.

## Discoveries and Surprises

- `registrySha256` is a canonical semantic hash with its own field omitted;
  the bundle separately records the byte-level JSON hash.
- P01 intentionally freezes a compact Rule definition. Its bounded
  `DecisionOutput.parameters` is the compatible extension seam for P09's
  strict runtime DSL; changing P01 operators or contract hashes is forbidden.
- P08 exposes a materialized-candidate admission seam backed by the existing
  validator, planning session and confirmed handoff. P09 can adapt to that
  seam without changing P08 authority.
- P02's execution repository is durable but its base `start`/`complete`
  methods intentionally use strict insert/CAS semantics. P09 needs an
  idempotent adapter over the same rows rather than a second table.
- The repository architecture gate prohibits Node imports in the compiler
  Domain. P09 now reuses the existing pure Domain canonical SHA-256 primitive.
- Windows sandbox access to Docker was initially denied. After explicit user
  authorization, the first real run exposed an `active` Golden fixture passed
  to P02 `saveCandidate`; the test now constructs a valid candidate projection
  and the real PostgreSQL/Redis rerun passes 114/114. Final `pnpm verify`
  remains pending on the implementation commit.

## Decision Log

1. Keep P09 rules deterministic pure data; no dynamic `eval`, generated
   JavaScript, model operator, arbitrary SQL/HTTP/file/memory access, or regular
   expression supplied directly by a Rule.
2. Treat policy and current authorization as higher authority than every Rule.
   Rule denial/confirmation may be more conservative than policy; Rule advice
   can never relax a deny/confirmation.
3. Represent unknown explicitly. Required unknown never matches; forbidden
   unknown never becomes safe; confirmation unknown requires confirmation;
   the Rule's validated unknown policy may only select no-match, fallback or
   confirmation.
4. Order conflicts by policy severity, deny, confirmation, scope specificity,
   explicit priority, active version and stable Rule ID. A score is never the
   sole resolver.
5. Reuse P02 `artifact_execution`/`artifact_feedback` for Rule usage,
   decision, formal-handoff and Outcome-link evidence. Revalidation is a P06
   trigger only.

## Implementation Steps

1. Add Domain P09 contracts, immutable factories, strict parser/bounds,
   operator metadata and deterministic condition evaluation.
2. Add stable conflict resolution, action mapping, low-risk parameter
   suggestion and bounded plan-patch creation/application.
3. Add Application current-state, policy, authorization, formal validator,
   planning handoff, usage and revalidation ports and service orchestration.
4. Add a PostgreSQL adapter over P02 core rows for idempotent Rule usage and
   Outcome/drift links; do not add a migration unless a demonstrable core-row
   limitation requires one.
5. Publish internal Application ports for P10 composition. P09 does not add a
   Server, HTTP/A2A/Console request entry point or Fast Gateway.
6. Add real PostgreSQL integration evidence and focused tests covering every
   Rule DSL, policy, conflict, stale, plan-patch, usage, drift, concurrency and
   security class.
7. Generate required machine reports, update traceability/status/changelog,
   run code-freeze read-only review, close findings, run full verification,
   finalize standard P10 Handoff, commit and push.

## Validation

- Focused during development:
  `pnpm exec vitest run packages/domain/test/decision-rule-runtime-p09.unit.test.ts
packages/application/test/decision-rule-runtime-p09.unit.test.ts`.
- Contract/security:
  focused P09 contract tests plus architecture checks for no `eval`, no direct
  Skill/MCP/Workflow/Outcome/active-pointer writes and no public route.
- Persistence/integration:
  real PostgreSQL tests against `artifact_execution`,
  `artifact_feedback`, outbox events, idempotent retries, concurrent CAS,
  restart and deletion behavior.
- Full gate: P09 self-check, `pnpm format:check`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test:unit`, `pnpm test:contract`,
  `pnpm test:integration`, `pnpm test:e2e`, `pnpm verify:migrations`,
  `pnpm verify:architecture`, `pnpm build`, local smoke and final
  `pnpm verify`.
- Evidence distinguishes real PostgreSQL/Redis/runtime observations from
  deterministic in-process simulations. No skipped tests or weakened
  assertions count as completion.

## Idempotence and Recovery

Evaluation, resolution, decision and patch IDs derive from immutable Rule,
runtime-snapshot and idempotency hashes. Exact retries return the same durable
record; a different payload under the same key conflicts. Goal/Plan/Rule/Policy
or readiness drift produces `discarded_stale` and no formal handoff. A failure
before formal handoff can safely retry; a committed planning handoff is
deduplicated by the existing planning session/CAS authority. Redis loss cannot
change Rule, usage, plan or Outcome authority.

## Artifacts and Evidence

Required reports live under `reports/goal/v1.3-p09-*`: Rule DSL schema,
operator catalog, evaluation, conflict resolution, policy authority,
plan-patch, usage/drift, security, performance, Completion, Review, acceptance
and standard P10 Handoff. `docs/17_TRACEABILITY_MATRIX.md`,
`PROJECT_STATUS.md`, `CHANGELOG.md` and this ExecPlan remain synchronized with
the verified implementation.

## Outcomes and Retrospective

Implementation and final read-only review are complete. Focused verification
passes (52 Unit, 4 Contract, 114 real Integration, typecheck, lint, format and
architecture); the full Docker-backed verification and evidence closure remain
pending. Completion still requires 50/50 acceptance, a passing clean full verification,
committed/pushed evidence and a standard P10 Handoff. P10 must not be read or
started before that push.
