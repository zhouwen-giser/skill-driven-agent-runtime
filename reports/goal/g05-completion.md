# G05 Goal Completion Report

## Summary

G05 implements a restart-safe Interactive Planning Session between the confirmed G04 Goal Contract
and the existing v1.2.2 User Goal Planner/Validator authority. The base planner produces an immutable
candidate rather than a formal plan. Users can inspect, patch, reject, cancel or explicitly confirm
that candidate. Only `ConfirmedPlanHandoff` may commit it, under a dedicated `goalId + goalVersion`
lock, into the existing v1.2.2 plan and execution path.

## Goal Contract Result

```text
completed
```

## Implementation

- Domain factories own PLAN_REVIEW sessions, turns, immutable candidate revisions, validation
  results, confirmation policies, risk classification, diffs and stable cognitive error codes without
  importing User Goal domain types.
- `UserGoalPlanningService` now separates non-authoritative `generateCandidate` from authoritative
  `commitCandidate`; the existing `plan` operation composes both for unchanged v1.2.2 callers.
- `InteractivePlanPatchService` converts untrusted natural language through the audited
  `interactive_plan_patch` Model Runtime stage into a strict Zod-validated patch. It supports add,
  remove and update Skill Goals, dependencies, priority, parallel group and confirmation policy with
  at most two attempts and a 3000 ms per-call cap.
- Every revision reruns DAG, bounds, criterion coverage, capability shape, policy, side-effect and
  no-replay validation. High-risk plans remain reviewable but always require manual confirmation.
- `InteractivePlanningSessionService` applies CAS/idempotent actions, elapsed/round budgets and
  restart recovery. Accept is the only promotion action; crash replay re-enters the idempotent handoff
  instead of creating a second formal plan.
- Migration 0113 completes the predeclared G00 planning tables, binds audited patch invocations and
  adds atomic `plan.candidate_created`, `plan.revised` and `plan.confirmed` outbox evidence. Unsafe
  rollback with live sessions or configured stage routes is rejected.
- Management API/OpenAPI expose planning-session read/actions. The operational Task Console renders
  the DAG, validation checks, diff, Experience hints and planning metadata. A2A exposes the same
  review boundary through `io.sdar/interaction` while remaining `INPUT_REQUIRED`.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G05-01 | verified | PLAN_REVIEW state machine and base-planner candidate path in focused unit and real A2A E2E |
| AC-G05-02 | verified | strict structured patch compiler covers Skill Goal, dependency, priority, parallel and policy operations |
| AC-G05-03 | verified | seven deterministic validation checks reject cyclic/orphan/out-of-bounds/coverage-invalid candidates |
| AC-G05-04 | verified | immutable candidate revisions, plan diff, Experience hints and audited model identity persist across restart |
| AC-G05-05 | verified | unconfirmed real E2E creates no formal User Goal Plan, Skill Attempt or MCP invocation; accept alone hands off |
| AC-G05-06 | verified | real PostgreSQL CAS/idempotency/outbox/restart tests and dedicated `goalId + goalVersion` advisory lock |
| AC-G05-07 | verified | 134-operation OpenAPI, operational Console, A2A interaction projection and three audited patches with P95 <= 3000 ms |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| `npm.cmd run format:check` | passed | final affected-tree run |
| local ESLint | passed | final affected-tree run |
| strict TypeScript `--noEmit` | passed | final static run |
| `vitest run --project unit` | 526/526 | 90 files; Vitest output retained in the Codex run |
| `vitest run --project contract --maxWorkers=1` | 149/149 | 19 files; serial full contract gate |
| `node scripts/check-architecture.mjs` | passed | 338 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| `node scripts/check-management-openapi.mjs` | passed | 134 operations |
| `node scripts/test-integration.mjs` | 74/74 | eight real PostgreSQL/Redis integration files |
| `node scripts/verify-migration-path.mjs` | passed | 0108-0113 fresh/idempotent/rollback/reapply/guarded-reset/rogue-ledger |
| `node scripts/test-e2e.mjs` | 62/62 | two real Server/PostgreSQL/Redis/A2A files |
| production TypeScript + Console Vite build | passed | Console bundle built successfully |

The wrappers did not persist separate wall-clock log files for every final command; exact assertions,
fixtures and reproducible commands are in the cited test files and this report does not invent missing
timings. The complete clean-checkout `pnpm verify`, A2A MUST TCK, release smoke, replay/shadow,
security/capacity and exact-publication audit remain reserved for G17 and are not claimed here.

## Failed Attempts and Root Cause

1. The retained test-first run failed because the validator/session/patch services did not yet exist;
   the resulting focused regression suite passes after implementation.
2. `pnpm exec` attempted a non-TTY dependency refresh and sandboxed network access. The locked local
   binaries were used without modifying dependencies.
3. PostgreSQL 16 rejected the repository migration harness setting `transaction_timeout`; a plain
   PostgreSQL 17 image then lacked pgvector. Final migration/integration evidence used an isolated
   PostgreSQL 17 + pgvector image matching repository requirements.
4. The first real patch E2E used the Goal id as the model-audit Task id and violated the audit foreign
   key. The product now carries the real Task id and stable `compile_interactive_plan_patch` operation.
5. The architecture gate initially rejected a cognitive Domain import of the v1.2.2 User Goal domain.
   The candidate snapshot became generic Domain data and Application now performs the typed binding.
6. The default-parallel combined unit/contract run was 673/674 because the pre-existing frozen MCP
   5 ms notification timing test observed one notification instead of zero. Its isolated run passed;
   the complete contract suite then passed 149/149 with `--maxWorkers=1`. No assertion was weakened.
7. The first full E2E run was 51/62 because the shared model fixture applied the new inspection-only
   capability response to unrelated cases. The fixture was scoped to the G05 case; final E2E is 62/62.

## Architecture, Safety and Recovery

G05 adds no second Agent, Workflow, Memory, Planner or Python runtime and no product dependency.
LangGraph.js remains the only workflow runtime. Candidate data cannot execute or mutate authority,
and model output is schema-validated before deterministic Application validation. Candidate revisions
never use an unpersisted candidate as a formal `sourcePlanId`; the existing formal plan revision and
v1.2.2 completion authority remain unchanged. PostgreSQL owns session/turn/candidate/outbox recovery;
Redis holds no unrecoverable planning truth.

## Migration and Source Intake

0113 is additive to the byte-stable v1.2.2 baseline and passed rollback/reapply on disposable real
PostgreSQL. The implementation is original repository code using existing approved dependencies and
copies or translates no Claude Code or Codex source. No Source Intake, license ledger, lockfile, NOTICE
or SBOM change is required.

## Commit, Push and Draft PR

- Implementation commit: `02a367d85903f29a1147116c4af2952ab32716db`
- Push: `origin/feature/v1.2.3-cognitive-planning-runtime` includes the implementation commit
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR remains Draft; no merge or tag is authorized

All disposable G05 PostgreSQL/Redis containers were stopped and removed. The default operator `sdar`
database and its volumes were not reset or modified.

## Next Goal Handoff

G06 can consume actor-attributed Goal/Plan patches, rejects and corrections plus the G03/G04/G05
immutable source lineage. It must emit correction facts and interaction episodes without making those
facts, Experience or model output a Goal/Plan authority.
