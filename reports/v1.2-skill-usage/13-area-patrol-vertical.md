# SDAR v1.2 Phase 13 — `embodied.area_patrol` Recursive Acceptance

Date: 2026-07-18

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `f9ba66021d033ff6a5f99468d736471361bcf8cd`

Feature SHA: `83753db49960f0d0354b699ea017005220e5892d`

## Result

The formal `embodied.area_patrol` package now executes through the existing Skill selection, bounded
Usage composition, Workflow planning/validation/outer confirmation, LangGraph and V1.1 MCP Task
continuation authorities. The parent freezes the current exact `embodied.move_to` dependency and one
deployment-selected exact inspection Skill before planning. Native child planning preserves the same
immutable Goal contract and Usage policy, while legacy children retain their compatible guidance path.

Parent and child Skill execution records now expose exact versions, parent execution identity,
Workflow/remote Task references and terminal outcomes. A Provider-declared degraded patrol remains a
distinct `degraded` execution result with explicit missing effects/evidence; it is not overwritten by
the achieved Goal projection. Optional/degraded handlers continue deterministically, recoverable
handlers retain their declared target, and a nested LangGraph confirmation interrupt can no longer be
misclassified as a child failure.

The optional deployment slot resolver remains fail-closed by default. Exact child authority is loaded
from the immutable parent Usage policy, and execution rejects version drift if that version is no
longer current and enabled. The mock Provider adds deterministic complete, degraded and
missing-evidence patrol outcomes plus synchronous inspection without introducing a second Runtime or
Provider-state authority.

## Twenty-Scenario Matrix

| # | Scenario | Result | Reproducible evidence |
| -: | --- | --- | --- |
| 1 | single-resource whole area | Passed | real A2A vertical patrols one admitted resource/boundary and completes with coverage, trajectory and anomaly evidence |
| 2 | multi-resource parallel partitions | Passed | remote-composition integration preserves two independent bindings and their join |
| 3 | fixed `move_to` dependency | Passed | real A2A vertical freezes exact `embodied.move_to@3`, pauses for its confirmation and invokes `embodied.move` first |
| 4 | dynamic capability slot | Passed | deployment slot resolver freezes the selected exact inspection Skill and invokes it with the mapped area |
| 5 | default depth 3 | Passed | bounded composition unit and recursive vertical remain inside the shared default budget |
| 6 | exceed hard maximum 5 | Passed | invalid `maxDepth: 6` is rejected with `SKILL_USAGE_SPEC_INVALID` |
| 7 | cycle | Passed | composition cycle regression remains fail-closed |
| 8 | child `fail_fast` | Passed | policy projection and structural compliance retain terminal parent failure semantics |
| 9 | recoverable replacement | Passed | recoverable move dependency preserves its continuation target; nested confirmation resumes instead of entering its error handler |
| 10 | optional failure | Passed | compiled optional handler has an explicit continuation edge and preserves optional policy semantics |
| 11 | degraded one-subarea failure | Passed | real A2A degraded vertical returns missing subregion/effect/evidence and a distinct degraded execution status |
| 12 | Provider-window reschedule | Passed | V1.1 readiness window/reschedule acceptance remains green and is reused unchanged |
| 13 | two remote child Tasks independent | Passed | remote-composition integration observes two independent remote Task bindings |
| 14 | parallel join waits | Passed | the same integration and compiler regressions prove the join waits for both external continuations |
| 15 | child `input_required` | Passed | V1.1 remote input continuation integration remains green through the shared child authority |
| 16 | cancel parent | Passed | cancellation integration preserves cooperative Provider observation and terminal parent cancellation |
| 17 | restart during external wait | Passed | Server restart integration resumes persisted external waiting without replaying `tools/call` |
| 18 | incomplete coverage/evidence | Passed | Provider contract emits terminal success without evidence metadata; evidence presence remains explicit and non-inferred |
| 19 | complete parent-child execution tree | Passed | real A2A vertical exposes one root plus exact move/inspection child execution records and outcome references |
| 20 | different contexts produce legal distinct plans | Passed | composition unit resolves two compatible exact slot choices into two different frozen compliant plans |

The matrix combines real Server/A2A/PostgreSQL/Redis/LangGraph verticals with focused unit, contract
and integration evidence at the layer that owns each invariant. Existing V1.1 continuation,
input/cancel/restart tests are reused rather than duplicating their state machines.

## Verification

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` passed; the complete
  unit/contract result was 84 files and 569/569 tests.
- `node scripts/check-architecture.mjs` verified 256 TypeScript source files.
- Real local PostgreSQL/Redis A2A/Server/LangGraph/MCP E2E passed 59/59 across two files, including
  recursive complete and degraded patrols.
- The complete integration project passed 82/82 across nine files against an explicitly bootstrapped,
  isolated database. The first attempt correctly rejected the operator volume's known migration-ledger
  gap before repository assertions; the operator database was not changed.
- `node scripts/verify-migration-path.mjs` passed from an empty database and historical 0049 baseline.
- The production Server smoke passed Agent Card, Console bundle and trusted-intranet Management API
  checks against a separate disposable database.
- Focused Provider/composition/compiler regressions passed 53/53. No test was skipped in any successful
  command.

The two explicitly named disposable Phase 13 databases were deleted after verification. Repository
containers were stopped with volumes preserved. The ignored operator `.env`, operator-owned `sdar`
database and external provider-runtime PostgreSQL were unchanged.

## Remaining Scope

Phase 14 retains the mandatory adversarial/fix pass and complete `pnpm verify`. Phase 15 retains every
final acceptance, documentation, audit, remote-parity and Ready-for-Review gate. Draft PR #5 remains
Draft and is not merged. External production MCP Tasks Provider interoperability remains unverified.
