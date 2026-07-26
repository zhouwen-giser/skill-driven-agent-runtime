# G16 Goal Completion Report

## Summary

G16 adds a side-effect-free Planning Replay and Shadow evaluation path to the existing governed
Knowledge Promotion service. Immutable Replay datasets preserve request, world summary, accepted
Contract/Plan, corrections, Outcome, exact catalog hash, source hash and Candidate knowledge context.
The deterministic split reserves the final one-third (at least one case) as `promotion_test`; only that
holdout is used for Baseline/Champion/Candidate verdicts.

The production runtime is deliberately conservative. It reads complete PostgreSQL Goal Experience
Episodes already referenced by Candidate evidence, uses the current active Capability Summary hash,
and produces neutral comparisons through `NoPhysicalProvider`. It never invokes a Provider, MCP Tool
or device. A real evaluator can be supplied through the Application port, but every result must carry
a zero-call receipt and pass Domain validation. Fewer than three complete cases yields an
`incubating` report and keeps the Knowledge revision in `candidate`.

## Goal Contract Result

```text
completed
```

Implementation commit `265f865dfefecf6e2e2a3d5f8d70de6516029bee` is complete. Draft PR #9
must remain Draft until G17.

## Implementation

- `PlanningReplayDatasetBuilder.build` creates deterministic immutable cases for Understanding,
  Contract, Plan, Injection, Task Type Recognition and Capability Gap dimensions.
- Metrics cover missing dimensions, coverage, correction/patch count, attempt count, recovery count,
  risk, tokens, latency and hard failures.
- `ShadowPlanningService.compare` evaluates only `promotion_test` cases and emits
  `improved | neutral | regressed | invalid | unsafe`.
- `NoPhysicalProvider.assertNoSideEffects` rejects any Provider, MCP, device or non-`none` receipt.
- `PromotionReportGenerator.generate` records partition IDs, comparisons, deterministic hashes,
  sample/holdout/non-regression/failure/side-effect gates and final `incubating | passed | failed`.
- `ReplayPromotionEvidenceService` gives the existing Promotion service one idempotent report for
  both replay and shadow evidence. Concurrent requests share one in-flight generation.
- `PostgresPlanningReplayDatasetSource` resolves only evidence-linked immutable Episodes and the
  current Capability Summary hash. Incomplete Episodes are excluded rather than guessed.
- `PostgresPromotionProvenanceReportRepository` stores one report per exact Knowledge
  kind/ID/revision. Migration 0124 is audit/evaluation evidence only and refuses lossy rollback.
- The old generic replay count is replaced at the runtime composition root; no second Planner,
  workflow runtime, model stage, API or Domain event is introduced.
- Reports cannot directly activate Knowledge. `KnowledgePromotionService` explicitly treats an
  incubating Replay report as a failed Promotion transition and returns the revision to `candidate`.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G16-01 | verified | dataset unit and generated artifact preserve request/world/Contract/Plan/corrections/Outcome/catalog/knowledge/source |
| AC-G16-02 | verified | deterministic 6-case unit proves 4/2 disjoint split; fixture report proves 2/1 split and hash stability |
| AC-G16-03 | verified | Baseline/Champion/Candidate unit covers all five verdicts and rejects hard-failure regression |
| AC-G16-04 | verified | formal Task state remains unchanged in unit; unchanged 62/62 real A2A E2E passes |
| AC-G16-05 | verified | zero-call receipt gate, forbidden MCP-call regression and generated report verifier |
| AC-G16-06 | verified | deterministic artifact, report hash verifier and real PostgreSQL idempotent persisted report |
| AC-G16-07 | verified | empty/two-case reports incubate; service-level test proves threshold-qualified Knowledge stays Candidate |

## Validation

| Command / gate | Result | Evidence |
| --- | ---: | --- |
| focused G12/G16 regression | 15/15 | 2 files; dataset, verdict, side-effect, hard-failure, persistence and incubation coverage |
| `pnpm test:unit` | 604/604 | 104 files, 12.82 s |
| `pnpm test:contract` | 157/157 | 19 files, 5.79 s |
| real PostgreSQL/Redis integration | 84/84 | 8 files, 15.42 s; retrieval P95 4.575 ms ≤ 500 ms |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files, 31.92 s |
| `pnpm verify:cognitive-replay` | passed | fixture report hash/serialization stable; 1 holdout passed, 0 failed, 0 physical calls |
| `pnpm verify:migrations` | passed | 17 additive migrations; fresh/idempotent/rollback/reapply/reset/rogue-ledger gates |
| Prettier / ESLint / strict TypeScript | passed | zero final errors |
| `pnpm verify:architecture` | passed | 423 TypeScript sources; 20 Domain and 61 Application cognitive files; no Python runtime |
| Management OpenAPI | 152/152 | unchanged; G16 adds no API |
| A2A baseline | MUST 74/74 | frozen official TCK commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` |
| frozen protocol / acceptance map | passed | 11 MCP and 23 Business Events sources; existing 18 classified scenarios |
| sources / licenses / SBOM | passed | 27 exact source pins; 286 npm packages and 2 services |
| production build | passed | strict server build plus Console Vite production bundle |

The complete `pnpm verify` and release-environment clean-checkout/rollout/security/capacity gates remain
reserved for G17.

## Failed Attempts and Root Cause

1. The first direct repository integration invocation reused the protected operator database and
   failed before tests with `SDAR_V123_MIGRATION_LEDGER_INVALID`; 60 tests were skipped. The standard
   integration harness created its dedicated database and passed 84/84 without touching operator data.
2. The first sandbox Unit run had 5 localhost `listen EPERM` failures; the same suite with permitted
   localhost access passed 604/604.
3. The first sandbox Contract run had 78 localhost/child-process `EPERM` failures; the unchanged
   permitted run passed 157/157.
4. Initial typecheck rejected an optional `catalogHash: undefined` test object under
   `exactOptionalPropertyTypes`. The fixture now omits the property exactly as production JSON does.
5. Initial formatting identified four new/changed TypeScript files. Prettier applied mechanical
   formatting and the final format gate passes.
6. Final service review found that an `incubating` report could still satisfy the older count-based
   evaluator and activate a Candidate. Promotion now requires a non-incubating report, with a
   service-level regression proving the Candidate remains inactive.
7. An empty replay source originally lost the active catalog hash and threw instead of producing an
   incubating report. The source now resolves the current catalog independently; empty dataset and
   report hashes are reproducible.

No failed test was deleted, skipped or weakened.

## Architecture, Authority and Source Intake

The architecture guardian confirms one TypeScript modular monolith and the sole LangGraph execution
runtime. Replay is an Application evaluation harness, not a workflow runtime or formal Planner.
PostgreSQL `promotion_provenance_report` is immutable audit/evaluation evidence; existing Knowledge
tables and governed transitions remain authority. No report writes Active Knowledge, production
Memory, Skill, Task, Outcome or Recovery.

AutoSkill, ACE and AWM remain exact-commit design references registered by G00. G16 uses only the
measurable behavior-level ideas: a three-case fixture produces disjoint 2-case development and 1-case
promotion sets, and repeated generation is byte-identical. No upstream source, prompt or data structure
was copied or translated. AutoSkill source/long-prompt copying remains prohibited because its locked
commit has no confirmed license. No dependency, lockfile, NOTICE, license ledger or SBOM change is
required.

The fixture's one `improved` verdict is a deterministic regression check, not production efficacy or
shadow-rollout evidence. The real PostgreSQL production evaluator is conservative/neutral by default.

## Commit, Push and Draft PR

- Primary G16 implementation: `265f865dfefecf6e2e2a3d5f8d70de6516029bee`
- Evidence commit: pending this report/traceability synchronization
- Push: pending evidence commit
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag/Ready transition: not performed and not authorized before G17

## ExecPlan / sync-state Update

`execplans/EP-SDAR-V1.2.3.md`, `reports/goal/sync-state.json`, `PROJECT_STATUS.md`, `CHANGELOG.md`,
`docs/17_TRACEABILITY_MATRIX.md`, `docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md` and
`docs/27_V1_2_3_COGNITIVE_RUNTIME_DESIGN.md` record the G16 result and G17 handoff.

## G17 Handoff

G17 receives the complete G00–G16 implementation, reproducible Replay report, side-effect gate,
persisted Promotion provenance and seventeen-migration v1.2.3 chain through 0124. It must run the
clean-checkout full release gate, recovery/security/privacy/capacity/retention checks and frozen
rollout sequence. Draft PR #9 may become Ready for Review only after every AC-G17 and Master gate is
verified; it still must not be merged or tagged.
