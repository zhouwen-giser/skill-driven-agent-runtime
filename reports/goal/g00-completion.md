# G00 Goal Completion Report

## Summary

G00 freezes the v1.2.3 cognitive runtime vocabulary and authority boundaries without activating product
behavior. KD-01 through KD-20, source/data classification, immutable snapshots, state transitions,
stable errors/reasons, Application Ports, JSON Schema, golden fixtures, migration 0108, source locks and
architecture guards are implemented and verified while every v1.2.2 execution/terminal authority is
unchanged.

## Goal Contract Result

```text
completed
```

## Implementation

- ADR-111 through ADR-114 freeze planning, experience/knowledge, capability/session and migration
  authority decisions.
- `packages/domain/src/cognitive/` owns factories/validators and immutable contracts; external SDK,
  persistence and queue types do not cross the Domain boundary.
- `packages/application/src/cognitive/ports.ts` defines dependency-injected orchestration boundaries.
- `schemas/v1.2.3/cognitive-domain.schema.json` and its golden fixture validate the frozen wire shape.
- migration 0108 creates only additive cognitive skeleton tables/constraints/indexes; runtime migration
  application accepts only the exact baseline-prefix ledger and fails closed on gaps/rogue versions.
- six exact-commit design references are audited and excluded from the runtime SBOM dependency graph.

## Files / Interfaces / Tables / Events / APIs

- Required interfaces: `CognitiveDomainError`, `CognitiveRuntimeFeatureFlags`,
  `CognitiveDomainEvent`, `KnowledgeStatusTransition`, `CognitiveSourceRef`
- State families: Candidate/Validating/Active/Deprecated/Rejected; Declared/Observed/Validated;
  task/user/tenant/global_candidate scope; goal/planning session states
- Constants: ten model stages, frozen outbox event vocabulary, six queue names, correlation and schema
  version contracts
- Persistence: capability, understanding/session, outbox/job/episode/observation/reflection and separate
  Planning Heuristic/Task Type/Capability Pattern definition/evidence/promotion tables
- APIs/A2A/Console: none added in G00
- Activated behavior: none

## Validation

Final full gate (`pnpm verify`) on task-owned isolated PostgreSQL completed in 168,876 ms:

| Gate | Result | Duration |
| --- | ---: | ---: |
| static + unit/contract + build | passed; 104 files / 635 tests | 65,985 ms |
| migration fresh/idempotent/rollback/reapply/rogue ledger | passed | 19,562 ms |
| real PostgreSQL/Redis integration | 68/68 | 20,838 ms |
| real infrastructure E2E with deterministic local model/provider fixtures | 59/59 | 35,866 ms |
| infrastructure smoke | passed | 9,294 ms |
| server/Console smoke | passed | 17,331 ms |

Additional outputs: architecture 307 TypeScript files; A2A MUST 74/74; OpenAPI 124 operations; sources
27 pinned/no unpinned; SBOM/licenses 286 npm packages plus two external services; cognitive focused unit
5/5 and Schema contract 1/1.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G00-01 | verified | `reports/goal/baseline-report.md`; ancestor/base/branch/plan/sync state |
| AC-G00-02 | verified | ADR-111–114; Domain/schema/fixture; unit and contract tests |
| AC-G00-03 | verified | cognitive reverse-dependency/no-Python scan inside architecture gate |
| AC-G00-04 | verified | six intake reports; source lock, license ledger, NOTICE and SBOM gates |
| AC-G00-05 | verified | additive skeleton only; full v1.2.2 integration/E2E/build/smoke regression |

## Architecture Invariants

LangGraph remains the only workflow runtime. PostgreSQL remains durable authority; Redis remains
reconstructable. Model output remains candidate data and cannot commit authoritative state. Candidate
knowledge cannot enter formal planning or transition active without the frozen manual approval flag.
No second Agent, Workflow, Memory or Python runtime was introduced.

## Open-source Source Intake

Gemini CLI, AutoSkill, LangMem, ReMe, Agent Workflow Memory and ACE are exact-commit design/algorithm
references only. Five repositories have an exact LICENSE artifact; AutoSkill has no root license
artifact at the pinned commit and is therefore `UNCONFIRMED` and prohibited for copying. No new product
runtime dependency or copied source was added.

## Failures Encountered and Root Causes

1. Task-package self-check failed on Windows because `URL.pathname` produced the wrong filesystem path;
   fixed with `fileURLToPath`, manifest hash refreshed, self-check passed.
2. The initial baseline full gate consequently failed ESLint on that untracked script; fixed by using
   Node globals explicitly and rerun.
3. First G00 full gate reached E2E and failed one existing remote-lifecycle read with an empty collection;
   no assertion was weakened or test deleted, and the unchanged E2E gate then passed 59/59.
4. A subsequent full gate passed E2E but smoke correctly rejected the default historical 0001-0107
   database. It was not reset; the final full gate used a protected, isolated test database and passed.
5. Sandbox pnpm metadata and Docker pipe access failures were rerun with the required approved
   out-of-sandbox permissions; no dependency versions changed.

## Risks Closed / Remaining

G00 closes schema/authority/source/migration ambiguity. Remaining work is intentionally G01-G17:
repositories/services, behavior activation, management/A2A/Console integration, replay/shadow and release
hardening. The remote-lifecycle timing observation remains an honest non-blocking baseline test risk; it
did not reproduce on the unchanged suite or final complete gate.

## Exact Reproduction Commands

```powershell
node docs\SDAR_v1.2.3_Codex_Goal_Package_V1.0\scripts\self-check.mjs
node_modules\.bin\vitest.cmd run --project unit packages/domain/test/cognitive-domain.unit.test.ts
node_modules\.bin\vitest.cmd run --project contract packages/json-schema-adapter/test/cognitive-domain-schema.contract.test.ts
node scripts/check-architecture.mjs
node scripts/check-sources-lock.mjs
node scripts/generate-sbom.mjs --check
node scripts/verify-migration-path.mjs
$env:CI='true'; $env:SDAR_POSTGRES_URL='postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar_test_v123_full_gate'; pnpm.cmd verify
```

The final command requires an explicitly created/reset disposable database matching the guarded
`sdar_test_*` name rule. It must not target the operator's default `sdar` database.

## Commit, Push, Draft PR and Working Tree

- Implementation commit: `ffd979152ae45468f00e2cf673e97ed5fe32616c`
- Push: remote branch matched that SHA when Draft PR #8 was created
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR state: Draft; no merge or tag; Ready is forbidden until G17 passes
- Evidence is intentionally published in a subsequent non-amended G00 documentation commit.

## ExecPlan / sync-state Update

`execplans/EP-SDAR-V1.2.3.md`, `reports/goal/sync-state.json`, `PROJECT_STATUS.md`, CHANGELOG and
`docs/17_TRACEABILITY_MATRIX.md` mark G00 verified and make G01 the next Goal.

## Next Goal Handoff

G01 consumes the frozen catalog/source/snapshot contracts to build deterministic capability summaries.
It must use exact catalog revisions, canonical hashing and PostgreSQL activation; it must not consult
live Provider readiness or invoke a request-time LLM for summary truth.
