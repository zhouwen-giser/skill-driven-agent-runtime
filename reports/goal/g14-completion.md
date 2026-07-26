# G14 Goal Completion Report

## Summary

G14 adds a governed decorator around the existing `UserGoalPlanningService`; it does not replace or
commit through a second planner. The decorator obtains G13 Active-only Task Type, Capability Pattern
and Planning Heuristic context, then runs the same bounded structured planner and complete
`UserGoalPlan` validation path.

The frozen injection modes are distinct: `off` calls only the base planner; `shadow` retains the base
candidate and records only the shadow hash/impact; `advisory` may select a valid enriched candidate but
forces manual confirmation; and the frozen active spelling `active_low_risk` accepts only low-risk
knowledge. Repository failure, timeout, conflict, empty/low-confidence context, non-low active
knowledge and invalid enriched output all fail open to one base-planner invocation without experience.

Planning Session, formal Plan Candidate and exact knowledge-usage rows are saved in one PostgreSQL
transaction. The same Session CAS transaction records accept/reject/patch/cancel feedback, and the
existing sole runtime-terminal transaction links the final Outcome. Experience never changes the
user Contract, safety policy, current Skill/readiness checks, execution runtime or
`UserGoalPlanController` terminal authority.

## Goal Contract Result

```text
completed
```

All G14 affected gates are green. Implementation commit
`1bd52dd2fc2f1a98ee7da92c37e7c2e4c3b744cd` is pushed. Draft PR #9 remains Draft.

## Implementation

- `ExperienceEnrichedUserGoalPlanningService.plan` decorates only
  `UserGoalPlanningService.generateCandidate`; base planning remains independently callable.
- `PlanningExperienceContextBuilder.build` derives a scoped query from the immutable Goal and passes
  the exact Task/user, Catalog Hash and Promotion policy to G13's Active-only retriever.
- `PlanningKnowledgeRetriever.prepare` separates read-only context preparation from durable usage
  reservation. The existing `retrieve` method preserves G13's immediate reservation contract.
- `BasePlannerFallbackPolicy.shouldFallback` has stable reasons for repository failure, timeout,
  contradiction, low confidence, non-low active knowledge and invalid enriched planning.
- Enriched instructions label experience as advisory data and repeat immutable Contract, safety,
  later readiness and terminal authorities. Model output still passes the existing strict Zod response
  schema and deterministic full-plan validator.
- `InteractivePlanningSessionService` allocates Session/Candidate identities before retrieval, records
  governed knowledge source references and hands only a confirmed candidate through the existing G05
  `ConfirmedPlanHandoff`.
- `ExperienceUsageRepository.saveWithPlanCandidate` is implemented by the existing PostgreSQL
  Interactive Planning repository so Session, Candidate, usage rows, validation and
  `planning.knowledge_used` Outbox events share one transaction.
- Usage feedback is updated inside the existing version-CAS action transaction. The existing runtime
  terminal repository atomically binds every usage for the exact Goal version to its final Outcome.
- Migration 0122 adds factory/schema-validated affected Skill Goal IDs, feedback constraints and
  candidate/outcome indexes. Its down path refuses to discard any usage evidence.
- The Server composition root uses the frozen default `shadow` mode and permits deployment-owned
  `off`, `shadow`, `advisory` or `active_low_risk` configuration without a new API, model stage,
  runtime dependency or workflow engine.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G14-01 | verified | decorator unit proves `off` calls only the unchanged base planner; formal commit remains G05 confirmed handoff |
| AC-G14-02 | verified | unit covers distinct off, shadow, advisory and frozen `active_low_risk` behavior; shadow cannot replace the base candidate and advisory requires manual confirmation |
| AC-G14-03 | verified | table-driven unit covers repository failure, timeout, conflict and low confidence with exactly one base call |
| AC-G14-04 | verified | invalid enriched candidate triggers one no-context base invocation; total decorator calls are bounded to enriched plus one base |
| AC-G14-05 | verified | real base-planner unit proves advisory context cannot change Contract, safety/readiness/terminal authority; full validator and unchanged E2E remain green |
| AC-G14-06 | verified | real PostgreSQL test links Candidate, affected Skill Goals, validation and accepted action, rolls back a bad binding atomically, and terminal commit binds final Outcome |

## Validation

| Command / gate | Result | Evidence |
| --- | ---: | --- |
| test-first G14 unit | failed 9/9, then passed | initial required decorator/fallback symbols were absent; assertions were retained |
| final G14 + cognitive Schema | 12/12 | 11 G14 tests plus strict Golden Schema contract |
| related focused unit | 29/29 | G14, G13 retrieval, G05 interactive planning and base planner authority |
| full `pnpm test:unit` | 587/587 | 99 files; final rerun after Domain/Schema closure |
| full `pnpm test:contract` | 155/155 | 19 files |
| real PostgreSQL/Redis integration | 83/83 | 8 files; atomic save/action/rollback/final-Outcome linkage and unchanged retrieval |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files; v1.2.2 execution and terminal authority unchanged |
| migration path | passed | v1.2.2 baseline plus 15 additive migrations; idempotency, rollback/reapply, guarded reset and rogue-ledger rejection |
| Prettier / ESLint / strict TypeScript | passed | all configured files; zero errors |
| architecture | passed | 411 TypeScript sources; 19 Domain/58 Application cognitive files; no Python runtime |
| Management OpenAPI | passed | unchanged 147 operations; G14 adds no endpoint |
| production build / isolated Server smoke | passed | strict TypeScript, Console Vite build, Agent Card, Console and trusted-intranet management warning |

The final real retrieval performance event remained below the frozen G13 budget:

```json
{"event":"planning.knowledge_retrieval.p95","samples":20,"p95Ms":5.813,"targetMs":500}
```

## Failed Attempts and Root Cause

1. The test-first suite failed 9/9 because the G14 decorator and fallback policy did not exist. The
   completed suite retains the same mode/fallback assertions and adds malformed feedback rejection.
2. The first full unit run produced one unchanged timing-test failure: a 250 ms notification wait
   observed four reads rather than the maximum three under concurrent scheduling. The isolated test
   immediately passed 8/8 with three reads, and two later complete runs passed 586/586 then 587/587;
   no assertion or product code was changed.
3. Early lint found a shorthand timer rejection and a non-`Error` Promise rejection. The timeout
   adapter now uses a block callback and normalizes unknown rejection values.
4. Direct integration against stopped historical port 54329 failed with `ECONNREFUSED`. A read-only
   check of 55432 showed its operator database has an incompatible pre-clean-slate ledger, so it was
   not reset or migrated. The standard runner created and deleted only its dedicated integration
   database and passed 83/83.
5. The first Server smoke was mistakenly pointed at that protected operator database and correctly
   failed `SDAR_V123_MIGRATION_LEDGER_INVALID`. No write occurred. A separately named empty
   `sdar_v123_g14_smoke` database passed and was deleted immediately afterward.
6. Final review found fallback usage was incorrectly attributing base Skill Goals even though the
   retrieved knowledge did not affect them. Fallback rows now retain the exact fallback reason with an
   empty affected-goal list; enriched and shadow rows alone record the plan they influenced.
7. Final schema review found the frozen Golden usage record had not yet exposed the G14 feedback
   fields. Domain validation, JSON Schema, Golden fixture, migration constraints and regression tests
   now agree.

## Architecture, Authority and Source Intake

The architecture guardian confirms one TypeScript modular monolith and the sole LangGraph workflow
runtime. The decorator creates data candidates only; it cannot execute tools, publish Skills, change
Provider readiness or commit Goal/Outcome state. PostgreSQL remains the usage authority, and the
G05/v1.2.2 confirmation and terminal boundaries remain unchanged.

Implementation is original repository TypeScript using existing locked dependencies. Mastra/Codex/
Claude ideas remain conceptual references only. No source was copied or translated, no product runtime
dependency was added, and no Source Intake, lockfile, license, NOTICE or SBOM change is required.

## Commit, Push and Draft PR

- Primary G14 implementation: `1bd52dd2fc2f1a98ee7da92c37e7c2e4c3b744cd`
- Push: published to `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag: not performed and not authorized

## G15/G16 Handoff

G15 receives persisted injection mode, fallback, exact Active knowledge references, affected Skill
Goal IDs, validator result, user action and final Outcome linkage. It may expose credential-free
operational projections but must not add an authority or allow the Console/A2A client to select
Candidate knowledge directly.

G16 receives read-only shadow hashes and usage provenance plus the unchanged base candidate. Its
Replay/Shadow harness must produce independently labelled evaluation evidence and may not turn a
shadow result into a formal plan or a Promotion report without the existing governed gates.
