# G04 Goal Completion Report

## Summary

G04 implements a restart-safe Interactive Goal Session from the immutable G03 Task Understanding
through user-reviewed Goal Contract confirmation. PostgreSQL owns sessions, turns, candidates, CAS,
idempotency and outbox evidence. Model output remains a validated candidate: only an explicit
`accept` transitions it to `confirmed`, creates the existing v1.2.2 Goal authority and then enters the
existing Planner. Unconfirmed candidates never reach planning.

## Goal Contract Result

```text
completed
```

## Implementation

- `MissingDimensionQuestionService` deterministically prioritizes authorization-sensitive and blocking
  gaps, binds each turn to Understanding revision, dimension, criterion and blocking reason, and never
  repeats a dimension already answered in the session ledger.
- `InteractiveGoalSessionService` implements `understand -> goal_review -> confirmed` plus reject,
  cancel and budget-exhausted terminal paths. It supports answer, accept, patch, reject,
  restart-understanding and cancel with expected-version CAS and idempotency keys.
- A clarification uses the audited `task_clarification` stage, treats the answer as untrusted data and
  creates a new immutable G03 Understanding revision with an explicit prior-Understanding source ref.
- Candidate generation uses strict Zod/JSON Schema and at most two Application attempts through the
  audited `goal_contract_generation` stage. User patches override the prior candidate and carry a
  deterministic field diff.
- Migration 0112 extends the predeclared G00 tables with elapsed budget, turn binding, candidate diff
  and model invocation FK, and adds both Model Runtime stages. The down migration refuses live session
  data or configured routes.
- `PostgresInteractiveGoalRepository` uses transaction-scoped advisory locks, expected-version updates,
  unique idempotency keys and atomic outbox writes. Concurrent accepts produce one applied result and
  one conflict carrying the latest snapshot; replaying the winning key is a no-op.
- Management API/OpenAPI expose Goal Session read/actions. The Task Console renders the real session
  and can apply actor-attributed CAS actions. A2A `getTask`/follow-up projections expose
  `io.sdar/interaction` while retaining the normal `INPUT_REQUIRED` state.
- Task preparation uses the existing `goal_deliberation` input boundary. A confirmed contract is first
  committed through the existing Goal service, then the existing User Goal Plan/Skill/Workflow path;
  explicit non-generic tasks retain the v1.2.2 behavior.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G04-01 | verified | Domain/Application unit and real A2A E2E cover UNDERSTAND to GOAL_REVIEW to confirmed Goal/Plan boundary |
| AC-G04-02 | verified | question service skips an already answered target and selects the remaining blocking criterion |
| AC-G04-03 | verified | immutable Understanding revision 1/2 and prior source lineage verified in real E2E |
| AC-G04-04 | verified | strict candidate schema, two-attempt bound, deterministic patch diff and user precedence unit |
| AC-G04-05 | verified | real PostgreSQL concurrent CAS, duplicate idempotency and outbox integration test |
| AC-G04-06 | verified | A2A `INPUT_REQUIRED` plus `io.sdar/interaction`, API/OpenAPI and operational Console; 62/62 E2E |

## Validation

| Command / gate | Result | Duration |
| --- | ---: | ---: |
| `npm.cmd run format:check` | passed | 12.0 s final run |
| local ESLint | passed | 32.9 s final run |
| strict TypeScript | passed | included in final static/build run |
| `vitest run --project unit --project contract` | 667/667 | 10.36 s test duration |
| `node scripts/check-architecture.mjs` | 329 TypeScript sources; six v1.2.2 authorities; no Python product runtime | passed |
| `node scripts/check-management-openapi.mjs` | 132 operations | passed |
| `node scripts/verify-acceptance-map.mjs` | 18 existing acceptance scenarios | passed |
| `node scripts/test-integration.mjs` | 73/73 real PostgreSQL/Redis | 11.06 s test duration |
| `node scripts/verify-migration-path.mjs` | 0108-0112 fresh/idempotent/rollback/reapply/rogue rejection | passed |
| `node scripts/test-e2e.mjs` final rerun | 62/62 real Server/PostgreSQL/Redis/A2A | 26.98 s command duration |
| production TypeScript + Console Vite build | passed | final affected build |

The complete clean-checkout `pnpm verify`, A2A MUST TCK, release smoke, replay/shadow,
security/capacity and exact-publication audit remain reserved for G17 and are not claimed here.

## Failed Attempts and Root Cause

1. The retained test-first G04 run failed 3/3 because the question, candidate and session services did
   not yet exist. The final focused tests pass.
2. The first formatting command used `pnpm exec`; pnpm attempted a non-TTY dependency-state refresh and
   sandboxed registry access. Existing locked local binaries were used without changing dependencies.
3. The first complete E2E run was 61/62 because the test expected a follow-up's immediate `WORKING`
   acknowledgement to be the later `INPUT_REQUIRED` boundary. It now polls authoritative `getTask`.
4. The second complete E2E run was 61/62 because the test asserted an exact three-item source array;
   the real revision correctly also carried Capability Summary lineage. The regression now requires
   the prior Understanding ref without excluding additional authoritative sources.
5. The first combined static run exposed six lint/style findings. They were fixed and format, lint,
   typecheck, tests and build were rerun independently so later successes could not mask a failure.

## Architecture, Safety and Recovery

G04 adds no second Agent, Workflow, Memory or Goal authority, no Python runtime and no product
dependency. LangGraph.js remains the only workflow runtime. LLM output is strict candidate data and
cannot write Goal state. Confirmation is actor-attributed deterministic Application code. Session
snapshots, turns, candidates, model identities and outbox records reload from PostgreSQL after restart;
Redis contains no unrecoverable Goal Session authority. Clarification/contract rounds and elapsed time
are bounded, and terminal sessions reject further actions.

## Migration and Source Intake

0112 is additive to the byte-stable v1.2.2 baseline and refuses unsafe rollback with live data or new
stage routes. Its full rollback/reapply path passed on disposable databases. The implementation is
original repository code using already-approved Zod/PostgreSQL/Model Runtime boundaries. It copies or
translates no Claude Code source, adds no dependency and requires no Source Intake, license-ledger or
SBOM change.

## Commit, Push and Draft PR

- Implementation commit: `d226bfb2e87da622f9711199ea93c1dcba38a3a0`
- Push: `origin/feature/v1.2.3-cognitive-planning-runtime` includes the implementation commit
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR remains Draft; no merge or tag is authorized

All migration/integration/E2E databases were isolated and removed. The default operator `sdar`
database was not reset or modified. PostgreSQL/Redis containers were stopped without deleting operator
volumes.

## Next Goal Handoff

G05 must bind its interactive planning session to the confirmed G04 candidate and reuse the existing
Planner/Workflow authority. It must preserve the G04 CAS/idempotency conventions, compile patches into
a fresh immutable plan candidate and never mutate a running workflow instance.
