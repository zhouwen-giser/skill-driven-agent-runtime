# EP-SDAR-V1.2.3 — Cognitive Planning Runtime

Status: ACTIVE — G00–G09 are pushed and real G07–G09 gates pass; G10 is next

Branch: `feature/v1.2.3-cognitive-planning-runtime`

Base `origin/main`: `10d9cb385a7d4ef87b69f2856d315573faafca9c`

## Purpose / Outcome

Upgrade the single-process TypeScript SDAR from v1.2.2 to v1.2.3 without replacing its Goal, Skill,
Outcome, Recovery, Business Events, or terminal authorities. The observable result is an online
Understand → Clarify → Confirm Goal → Plan → Human Patch/Confirm → v1.2.2 execution loop plus an
asynchronous Runtime Facts → Episode → Observation → Candidate → governed promotion → advisory reuse
loop. Experience remains optional and fail-open; only active knowledge may influence formal planning.

Completion requires G00–G17 implementation, tests, documentation, evidence, a meaningful pushed commit
for each Goal, and a continuously updated Draft PR. The PR may become Ready for Review only after G17's
clean-checkout release gates pass. This plan authorizes neither merge nor tag creation.

## Requirements Covered

- Task package `docs/SDAR_v1.2.3_Codex_Goal_Package_V1.0/`, including G00–G17 and AC-G00-01 through
  AC-G17-09.
- Master gates AC-MASTER-01 through AC-MASTER-05.
- Normative v1.2.3 requirement families FR-EX, FR-EO, FR-EP, FR-CS, FR-CE, FR-CC, FR-GT, FR-IG,
  FR-IP, FR-PR, FR-TI, FR-CI, FR-HL, FR-DB, FR-MR and NFR-001 through NFR-011.
- Existing repository baseline and traceability in `docs/01_REQUIREMENTS_BASELINE.md`,
  `docs/17_TRACEABILITY_MATRIX.md`, `docs/25_V1_2_2_USER_GOAL_RUNTIME_DESIGN.md`, and
  `docs/26_V1_2_2_TRACEABILITY.md` remain authoritative unless an accepted additive ADR says otherwise.

## Context and Orientation

- `packages/domain` owns immutable core types, factories, state transitions, reason/error codes and
  source references. It imports no SDK, database, queue, HTTP, model-provider, or UI types.
- `packages/application` owns cognitive orchestration and Ports. It cannot own durable truth or import
  SDK/database/queue implementation types.
- `packages/persistence-postgres` is the only durable cognitive/knowledge authority.
- `packages/runtime-redis` owns only reconstructable dispatch references and workers.
- `packages/langgraph-runtime` remains the only workflow execution runtime. Skill Goal DAGs and
  cognitive sessions are planning/state-machine data, not executable graph runtimes.
- `packages/a2a-adapter` and `packages/mcp-adapter` continue to isolate official protocol SDK types.
- `UserGoalPlanController` remains the sole User Goal/A2A terminal authority. v1.2.3 hands it only a
  confirmed Goal Contract and confirmed plan under `goalId + goalVersion`.
- v1.2.2 uses a guarded clean-slate baseline (`infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql`)
  with one marker. G00 must define the additive v1.2.3 migration contract without rewriting that file.

## Architecture and Authority Map

| Concern                                                          | Authoritative owner                           | Explicitly not authoritative                         |
| ---------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Cognitive schemas, state transitions, source/data classification | Domain                                        | model output, UI, SDK types                          |
| Understanding/session/promotion orchestration                    | Application                                   | PostgreSQL implementation, LangGraph internals       |
| Goal/plan execution and terminal state                           | v1.2.2 Application + `UserGoalPlanController` | Experience, Candidate knowledge, Workflow completion |
| Workflow execution                                               | LangGraph.js adapter/runtime                  | Skill Goal DAG, replay harness, queue worker         |
| Cognitive facts and knowledge lifecycle                          | PostgreSQL                                    | Redis, MemoryService, Console, files                 |
| Active search projection                                         | existing MemoryService                        | Candidate or complete knowledge authority            |
| Model invocation                                                 | existing SDAR Model Runtime                   | domain factories, repositories                       |
| Public capability representation                                 | activated hash-matched snapshot               | request-time LLM, live readiness, private experience |
| Current Provider/device readiness                                | existing v1.2.2 readiness authority           | capability summary, historical success               |

Every new type/state must have one owner in this table or in a later accepted ADR before implementation.

## Goal Dependency Graph and Execution Order

```text
G00
├── G01 → G02
│   └── G03 → G04 → G05 → G06
└── G07 → G08 → G09 → G10/G11 → G12 → G13 → G14

G02 + G04 + G05 + G06 + G07 + G12 + G14 → G15
G03 + G05 + G08 + G12 + G14 → G16
G00–G16 → G17
```

The working order is G00, G01–G06, G07–G14, G15–G16, G17. Where dependencies allow parallel design,
the implementation still preserves Goal-specific commits and avoids overlapping high-conflict files.

## Progress

| Goal | Status      | Commit    | Tests                                                                             | Evidence                         | Blocker        | Next                                                           |
| ---- | ----------- | --------- | --------------------------------------------------------------------------------- | -------------------------------- | -------------- | -------------------------------------------------------------- |
| G00  | completed   | `ffd9791` | full `pnpm verify` passed: 635 unit/contract, 68 integration, 59 E2E, build/smoke | `reports/goal/g00-completion.md` | none           | hand off frozen contracts to G01                               |
| G01  | completed   | `820d78d` | full `pnpm verify`: 645 unit/contract, 70 integration, 60 E2E, build/smoke        | `reports/goal/g01-completion.md` | none           | hand off activated Summary to G02                              |
| G02  | completed   | `2ec8987` | full `pnpm verify`: 656 unit/contract, 71 integration, 61 E2E, build/smoke        | `reports/goal/g02-completion.md` | none           | hand off declared Summary to G03; preserve public Card for G15 |
| G03  | completed   | `05b4df4` | 663 unit/contract, 72 integration, 62 real E2E, migration/API/build gates         | `reports/goal/g03-completion.md` | none           | hand off immutable Understanding revisions to G04              |
| G04  | completed   | `d226bfb` | 667 unit/contract, 73 integration, 62 real E2E, migration/API/build gates         | `reports/goal/g04-completion.md` | none           | hand confirmed Goal Contract authority to G05                  |
| G05  | completed   | `02a367d` | 526 unit, 149 contract, 74 integration, 62 real E2E, migration/API/build gates    | `reports/goal/g05-completion.md` | none           | hand correction/interaction lineage to G06                     |
| G06  | completed   | `cade96f` | 529 unit, 150 contract, 75 integration, 62 real E2E, migration/API/build gates    | `reports/goal/g06-completion.md` | none           | hand correction/Episode lineage to G07/G10                     |
| G07  | completed   | `301606e` | 549 unit, 152 contract, 79 real integration, 62 real E2E, migration/build gates | `reports/goal/g07-completion.md` | none           | verified handoff to G08                                        |
| G08  | completed   | `2d600fc` | 549 unit, 152 contract, 79 real integration, 62 real E2E, migration/build gates | `reports/goal/g08-completion.md` | none           | verified handoff to G09                                        |
| G09  | completed   | `c8754fd` | 549 unit, 152 contract, 79 real integration, 62 real E2E, migration/build gates | `reports/goal/g09-completion.md` | none           | verified Candidate/Delta handoff to G10/G11                    |
| G10  | in_progress | —         | implementation next                                                             | —                                | none           | Task Type induction                                            |
| G11  | not_started | —         | —                                                                                 | —                                | G01/G09        | capability pattern/gap                                         |
| G12  | not_started | —         | —                                                                                 | —                                | G09/G10/G11    | knowledge promotion                                            |
| G13  | not_started | —         | —                                                                                 | —                                | G01/G12        | retrieval/progressive disclosure                               |
| G14  | not_started | —         | —                                                                                 | —                                | G05/G13        | experience-enriched planner/fallback                           |
| G15  | not_started | —         | —                                                                                 | —                                | dependency set | API/Console/A2A integration                                    |
| G16  | not_started | —         | —                                                                                 | —                                | dependency set | replay/shadow/evaluation                                       |
| G17  | not_started | —         | —                                                                                 | —                                | G00–G16        | hardening/release gates                                        |

## Discoveries and Surprises

- 2026-07-23: `origin/main` already equals and contains the required ancestor `35cb927...`; the task
  package is the only untracked input at start.
- 2026-07-23: repository convention is root `execplans/` and root `adr/`, not the task package's
  preferred `docs/execplans/` and `docs/adr/`; this plan preserves repository convention.
- 2026-07-23: the task package self-check uses `new URL(import.meta.url).pathname`, which resolves the
  Windows drive pathname incorrectly and reports all files missing. Package hashes will be checked by a
  platform-safe independent command; the immutable input package will not be silently rewritten.
- 2026-07-23: v1.2.2 intentionally replaced the historical forward migration chain with one guarded
  clean-slate baseline marker. v1.2.3 must add a monotonic post-baseline migration ledger without
  altering the v1.2.2 baseline checksum.
- 2026-07-23: the task package's `Best_Implementation_Design` contains an earlier ten-KD numbering,
  while `Overall_Design`, Frozen Decisions and G00 define the final KD-01–KD-20 list. Frozen Decisions
  and the Overall Design list govern; the discrepancy will be recorded in the G00 ADR register.
- 2026-07-23: the supplied Windows self-check defect was fixed with `fileURLToPath`; the new script
  digest is recorded in the package manifest and the complete 50-file/18-Goal check passes.
- 2026-07-23: the first complete G00 gate observed a non-reproducing existing remote-lifecycle read
  timing failure; the unchanged E2E suite then passed 59/59. A later smoke failure revealed that the
  default operator `sdar` volume retains the historical 0001-0107 ledger. It was not reset; final
  evidence used and removed an isolated `sdar_test_v123_full_gate` database.
- 2026-07-23: G01 can reuse `PostgresSkillRepository.saveVersionAndSetCurrent` as the single catalog
  mutation boundary. Emitting `skill.catalog_changed` in that transaction covers enable/disable,
  version, Usage/visibility/composition and Outcome changes without a parallel registry.
- 2026-07-23: the first G01 E2E run reproduced the existing remote-lifecycle observation race while the
  new Capability Summary case passed. The unchanged suite rerun passed 60/60; no timing or assertion was
  weakened.
- 2026-07-23: the first complete G01 gate reproduced that race and exposed its exact test defect: the
  polling Schema accepted an empty lifecycle collection and stopped before the subsequent length check.
  Requiring one item strengthens the original contract; independent E2E and the complete gate pass.
- 2026-07-23: G02's first E2E run exposed a real projection gap: Skill mutation returned before the
  periodic projector, while the new fail-closed Card reader rejected the stale hash. The mutation path
  now waits for one serialized durable projection attempt; transient catalog races retry and failed
  publication leaves the source event pending.
- 2026-07-23: the reusable A2A TCK temporary Python and Git caches were independently corrupt. Both
  were replaced from the official frozen source; commit `5996b79...` then passed HTTP-JSON MUST 74/74.
- 2026-07-23: the first G03 E2E product path passed, but the test represented an absent JSON `goalId`
  as `goalId: undefined`. JSON omits the property; the corrected assertion separately verifies
  `awaiting_user_input` and property absence. The full rerun passes 62/62.
- 2026-07-23: G03 can return the existing persisted Model Runtime invocation identity without adding a
  second model audit service. Understanding stores that foreign key after strict structured validation.
- 2026-07-23: G05's first architecture run correctly rejected a cognitive Domain import of the
  v1.2.2 User Goal domain. The candidate snapshot is now generic cognitive data and Application alone
  binds it to `UserGoalPlan`, preserving the no-reverse-dependency invariant.
- 2026-07-23: the default-parallel combined test command exposed the pre-existing 5 ms frozen MCP
  notification timing test once; its isolated run and the complete serial contract suite pass without
  weakening assertions. Final unit, integration and E2E suites also pass independently.
- 2026-07-23: G06's test-first suite failed before the correction factory/service/projector existed.
  The first integration rerun also exposed an assertion that confused an absent optional JSON property
  with an `undefined` property. The implemented product path and corrected assertion pass 75/75.
- 2026-07-23: the local Vitest 4 CLI supports `--maxWorkers` but not `--minWorkers`; the invalid command
  started no tests. The supported serial command passes the complete contract suite 150/150.
- 2026-07-23: pnpm's build-time dependency status check needs `CI=true` in this non-TTY Windows run.
  The unchanged build then passed with approved registry access and did not change dependencies.
- 2026-07-23: the authoritative branch/origin state now contains G07 commit `301606e` even though its
  earlier report captured a rejected staging attempt. G07 therefore meets its meaningful pushed-commit
  contract; the unexecuted real integration/E2E gates remain a separate G17 blocker.
- 2026-07-23: G08's first test-first suite failed 4/4 before the extractor factory existed. The final
  implementation passes 6/6 focused, 539/539 unit and 151/151 contract tests. Review also found and
  closed an output-side injection/redaction gap before evidence publication.
- 2026-07-23: a top-level pnpm gate attempted registry metadata/dependency repair and refused the
  non-TTY modules purge. Locked local binaries passed the equivalent non-install format, lint,
  typecheck, unit, contract and build gates without changing dependencies.
- 2026-07-23: G09's test-first suite failed 4/4 before Reflector/Identity/Curator constructors existed.
  Final focused tests pass 16/16. Review then found that raw instance terms were still part of the
  canonical fingerprint; removing them makes distinct device/location/date instances share the
  intended reusable-job fingerprint without weakening deliverable or recent-intent boundaries.
- 2026-07-23: a Console build invoked from the repository root failed before compilation because Vite
  could not resolve `index.html`. The same locked binary invoked from `apps/console` passes; this is
  retained as command failure evidence rather than a product failure.
- 2026-07-23: the direct root build compiler emitted 378 adjacent untracked JavaScript outputs. Every
  target was verified inside the repository with a matching TypeScript/TSX source, but platform
  approval rejected exact cleanup before execution. Further Vitest evidence is paused because imports
  ending in `.js` could select stale generated output instead of the TypeScript working tree.
- 2026-07-26: PR #8 had been merged externally at G00–G06. The feature branch merged the current
  `origin/main` normally, preserved G07–G09, pushed the merge commit, and opened replacement Draft PR
  #9. No force-push, merge, tag or direct `main` mutation was performed.
- 2026-07-26: real PostgreSQL integration exposed previously masked G07–G09 defects: untyped text
  parameters inside JSONB constructors, duplicate Episode delivery after an idempotent insert, and a
  terminal fixture missing the v1.2.2 Contract/Plan/Judgment authority chain. The production SQL,
  idempotent completion path and authoritative fixture were fixed without weakening assertions.
- 2026-07-26: E2E then exposed a Management API enum drift: `experience_reflection` existed in Domain,
  Application, runtime and migration state but not the HTTP boundary schema. A contract regression now
  keeps the route configurable.
- 2026-07-26: the first migration rerun used stale `dist/` output and correctly failed marker
  comparison. A production build followed by the identical command passed all ten additive migrations,
  idempotency, rollback/reapply, guarded reset and rogue-ledger rejection.
- 2026-07-26: the task package's two CSV hashes represented pre-checkout line endings while
  `.gitattributes` normalizes them to LF. The checksum manifest now records the committed bytes and the
  complete 50-file/18-Goal self-check passes.

## Decision Log

- 2026-07-23: use the exact user-requested branch `feature/v1.2.3-cognitive-planning-runtime`; no branch
  mapping is necessary.
- 2026-07-23: preserve the v1.2.2 clean baseline SQL byte-for-byte and extend it through ordered,
  reversible v1.2.3 migrations. Existing non-empty databases outside the accepted marker set continue
  to fail closed.
- 2026-07-23: group KD-01–KD-20 into cohesive accepted ADRs plus a complete KD→ADR register rather than
  creating twenty near-empty ADR files.
- 2026-07-23: direct source copying is not planned in G00. Six new repositories are design/algorithm
  references at exact commits; any later direct Gemini TypeScript port requires a separate source intake.
- 2026-07-23: G01 hashes the complete exact enabled Skill declaration under a versioned deterministic
  policy, but projects only declared capability fields. Provider readiness, device state, observed
  success and model narrative are excluded from Summary authority.
- 2026-07-23: one transaction-scoped PostgreSQL advisory lock plus the unique
  `(catalog_hash,generation_policy_version)` key owns Summary activation. The catalog event is marked
  consumed only after rebuild succeeds; retry remains safe after restart.
- 2026-07-23: G02 uses a strict positive public allowlist over the active Summary. Optional model output
  may replace only the display description after strict schema/prohibited-content checks; profile facts,
  A2A Skills, binding hashes and activation remain deterministic Application/PostgreSQL authority.
- 2026-07-23: Public Card activation reuses the Summary generation-policy key, validates the exact
  active Summary inside the Card transaction and emits `capability.card_published`. A2A requests read
  only this active snapshot and never invoke the narrative model.
- 2026-07-23: G03 preserves G00's four authoritative dispositions. Design shorthand
  `ready_for_contract` maps to `contract_candidate`; an unavailable required capability is retained in
  the revision and maps to `rejected`, rather than creating another terminal state.
- 2026-07-23: Task Understanding is enabled only when deployment-owned Task Type fixtures are supplied.
  This keeps the additive runtime compatible while G10 later provides governed active Task Types.
- 2026-07-23: G05 splits existing planning into candidate generation and formal commit. Only
  `ConfirmedPlanHandoff`, protected by a dedicated `goalId + goalVersion` advisory lock, may call the
  formal commit boundary; legacy `plan()` continues to compose both for unchanged v1.2.2 callers.
- 2026-07-23: candidate revisions are session-local immutable review data. They retain formal plan
  revision 1 and never pretend an unpersisted candidate is a persisted `sourcePlanId`.
- 2026-07-23: G06 corrections and Episodes are immutable evidence, never Goal/Plan/Outcome authority.
  Only explicit accepted low-risk user preferences may project into the existing Memory service;
  task, tenant, global-candidate, safety and degradation corrections cannot auto-promote.
- 2026-07-23: Memory projection scope is additive and fail-closed: callers without a user id retrieve
  only global Memory, while callers with a user id retrieve global plus that exact user. Deletion
  invalidates the rebuildable projection without deleting immutable correction evidence.
- 2026-07-23: G08 uses twelve independent schema-owning extractors behind one Application pipeline.
  Previous Observations are bounded immutable context and may produce only suggestions; neither model
  output nor Candidate data can mutate authority or enter the Planner.
- 2026-07-23: Observation persistence atomically emits `experience.observation_completed` and a
  PostgreSQL `reflect` job for G09. Redis is only a job-id wake transport and is fully reconstructible.
- 2026-07-23: G09 persists only Candidate revisions and generic immutable Deltas. The Curator's six
  operations are deterministic suggestions; Active state remains impossible until G12 promotion.
  Identity is de-instantiated before hashing, then bounded by exact deliverable/recent intent plus
  conservative lexical/semantic thresholds. Unknown relation targets and low confidence never merge.

## Implementation Steps

1. G00: verify package hashes and current baseline; map repository symbols and authorities; accept the
   KD register/ADRs; add cognitive domain factories, states, errors, constants and application Ports;
   add schema golden fixtures, additive DDL/migration contract, source/license records and architecture
   guards; run focused gates plus full baseline verification; publish G00 evidence, commit, push and
   create the Draft PR.
2. G01–G02: implement deterministic catalog snapshots, stable canonical hashing, summary activation,
   progressive index/detail and privacy-filtered public/A2A snapshots.
3. G03–G06: implement bounded structured understanding, immutable CAS-backed Goal/Plan sessions,
   validated structured patches, confirmed-only v1.2.2 handoff and correction/interaction facts.
4. G07–G11: implement PostgreSQL-authoritative outbox/jobs/episodes, typed observation, candidate-only
   reflection, Task Type and Capability Pattern induction while keeping online execution non-blocking.
5. G12–G14: implement common audited promotion with separate targets, active-only search projection,
   bounded hybrid retrieval, progressive disclosure and decorator-style planner fallback.
6. G15–G16: expose audited APIs/Console/A2A interactions and build side-effect-free replay/shadow
   datasets, metrics and provenance reports.
7. G17: integrate v1.2.3 verification, recovery/security/capacity/retention/rollout tests, exact-commit
   clean-checkout audit and release report; update Draft PR to Ready only if every gate is green.

## Validation

For every Goal run the smallest affected tests first, then format check, lint, strict typecheck, unit,
contract, relevant PostgreSQL/Redis integration, relevant E2E and production build. Record commands,
durations, failures and evidence classification in `reports/goal/gNN-completion.md`.

G00 minimum focused gates:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm verify:architecture
pnpm verify:migrations
pnpm verify:sources
pnpm verify:licenses
pnpm build
```

G17 clean-checkout gates include `pnpm install --frozen-lockfile`, `pnpm verify`, A2A MUST TCK,
OpenAPI, Architecture, Migrations, Sources, Licenses, SBOM, Replay/Shadow, Security/Capacity,
infrastructure smoke and Server/Console smoke. Real, deterministic/simulated and unverified evidence
must remain separately labelled.

## Idempotence and Recovery

- Domain factories and schema validation are pure and repeatable.
- Repository writes use immutable revisions, unique idempotency keys and expected-version CAS.
- PostgreSQL is job/outbox authority; Redis loss triggers reconstruction rather than data promotion.
- Migration application is ordered, transactional and idempotent; gaps or unexpected ledgers fail
  closed. Down migrations are used only on explicitly named disposable databases after backup guidance.
- No Goal lock contains model, MCP, HTTP or queue calls.
- A failed Experience/Observer/Retriever/Model path falls back or dead-letters without modifying the
  original v1.2.2 Goal result.
- Failed tests and external blockers are appended to reports and never erased or converted to passes.

## Artifacts and Evidence

- Master state: this file and `reports/goal/sync-state.json`.
- Per-Goal evidence: `reports/goal/g00-completion.md` through `g17-completion.md`.
- Source intake: `reports/source-intake/` and the existing repository ledger/NOTICE/SBOM files.
- Replay/release: `reports/v1.2.3-replay/` and `reports/v1.2.3-release/`.
- Traceability: additive v1.2.3 mapping in repository docs, synchronized with implementation/tests.

## Source Intake

G00 exact-commit LICENSE/NOTICE validation is complete for Gemini CLI, AutoSkill, LangMem, ReMe, Agent
Workflow Memory and ACE. All are `design_reference`/`algorithm_reference`; AutoSkill has no root license
artifact at its pin, remains `UNCONFIRMED`, and is prohibited for source copying. No new product runtime
dependency was added.

G06 uses original repository code and existing approved dependencies. Gemini Auto Memory and Claude
Auto Memory remain concept-only references; no source was copied or translated, so no new Source
Intake, license ledger, lockfile, NOTICE or SBOM change is required.

G07 likewise uses original TypeScript over the existing PostgreSQL, BullMQ and Zod dependencies. No
Gemini CLI source was copied or translated and no Source Intake or dependency metadata changed.

G08 uses original repository TypeScript and the existing Zod, PostgreSQL and BullMQ dependencies.
LangMem typed extraction/consolidation and Gemini evidence-only/no-op/redaction remain concept-level
references only; no source was copied or translated, so no Source Intake or dependency metadata changed.

G09 likewise uses original repository TypeScript and existing dependencies. ACE Reflector/Curator,
AutoSkill Identity/Merge and LangMem change sets remain exact-commit concept references only; no source
was copied or translated, so no Source Intake or dependency metadata changed.

## Migration / API / Console Status

- Migration: additive 0108–0117 ledger is implemented. The isolated real PostgreSQL 17 + pgvector
  migration path passed fresh apply, idempotency, rollback/reapply, guarded reset and rogue-ledger
  rejection through 0115 before the platform approval quota was reached. Migrations 0116 and 0117 are
  authored but have not run against real PostgreSQL.
- OpenAPI: 141 management operations include Capability, Understanding, Goal/Plan review, Experience
  Episode/Observation/Reflection/dead-letter reads and explicit replay.
- A2A: the Agent Card remains snapshot-only; Task `io.sdar/interaction` projects Goal and Plan review
  boundaries. The real path captures four correction Facts, scoped preference deletion and unique
  Episode hashes while remaining `INPUT_REQUIRED` until explicit confirmation.
- Console: the Task panel operates the real Planning Session DAG, validation, diff, hints and actions
  and links Correction/Episode/Observation/Reflection evidence. It remains a projection over
  PostgreSQL/Application authority; broader G15 integration remains open.

## Branch / HEAD / Main / Draft PR

- Branch: `feature/v1.2.3-cognitive-planning-runtime`
- Base main: `10d9cb385a7d4ef87b69f2856d315573faafca9c`
- Current pushed HEAD before the G07–G09 verification-fix commit:
  `1b5ab838beffda524ea54377dc1ace2984122548`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9>

## Changed Files

- G00 implementation commit `ffd9791`: task package, ADR-111–114, cognitive Domain/Application
  contracts, JSON Schema/fixture, migration 0108, source intake/locks, architecture gate and generated
  license/SBOM evidence.
- G00 evidence commit: this living plan, sync-state, baseline/completion reports, status/traceability and
  changelog synchronization.
- G01 implementation/evidence candidate: deterministic builders/service, migration 0109, PostgreSQL
  repository/outbox projection, Server/API/OpenAPI wiring, unit/contract/integration/E2E tests and
  `reports/goal/g01-completion.md`.
- G02 implementation `2ec8987`: allowlisted Public Card Domain/Application/PostgreSQL/A2A path,
  migration 0110, API/OpenAPI/Console, serialized catalog projection and focused/full evidence.
- G03 implementation `05b4df4`: bounded Understanding Domain/Application/Model Runtime/PostgreSQL
  path, migration 0111, Task entry routing, API/OpenAPI/Console and real A2A evidence.
- G04 implementation `d226bfb`: Interactive Goal Domain/Application/PostgreSQL state machine,
  migration 0112, immutable clarification revisions, candidate review/diff, Goal handoff,
  API/OpenAPI/Console and A2A interaction metadata.
- G05 implementation `02a367d`: Interactive Planning Domain/Application/PostgreSQL state machine,
  migration 0113, strict audited patch compiler, seven-check validator, confirmed-only plan handoff,
  API/OpenAPI/Console and real A2A evidence.
- G06 implementation `cade96f`: immutable correction/Episode Domain/Application/PostgreSQL path,
  migration 0114, scoped low-risk Memory projection/deletion, API/OpenAPI/Console and real A2A evidence.
- G07 implementation `301606e`: transactional terminal outbox, PG-authoritative job/Episode lifecycle,
  migration 0115, rebuildable BullMQ wakes, API/OpenAPI/Console and authored real integration/A2A
  evidence.
- G08 implementation `2d600fc`: Observation Domain/Application/PostgreSQL path, twelve typed extractors,
  migration 0116, separate rebuildable BullMQ wakes, Model stage, API/OpenAPI/Console and real
  integration/A2A evidence.
- G09 implementation `c8754fd`: Reflection/Knowledge Delta Domain, Reflector/Identity/Curator Application path,
  Candidate/evidence/lineage PostgreSQL transaction, migration 0117, rebuildable BullMQ wakes,
  Reflection Model stage/API/OpenAPI/Console and real integration/A2A evidence.

## Open Blockers

None for G00–G09. The former platform approval and worktree-hygiene blockers are retained in the Goal
reports and were resolved before the real 79-integration/62-E2E verification. G10–G17 remain ordinary
unfinished work, not blockers.

## Next Execution Step

Commit and push the verified G07–G09 closure fixes/evidence, update Draft PR #9 without changing Draft
status, then implement G10 against the committed G06 correction and G09 Candidate/Delta contracts.

## Outcomes and Retrospective

G00 completed without activating cognitive behavior. G01 provides the deterministic declared Summary.
G02 adds an allowlisted, hash-bound Public Card without Provider/readiness/model authority. G03 routes
ambiguous requests through bounded structured Understanding. G04 persists interactive Goal review;
G05 adds immutable Plan review/patch validation and hands only a confirmed candidate to the existing
v1.2.2 formal plan authority. G06 now records immutable correction and Episode evidence with scoped,
low-risk-only Memory projection. Its affected gates pass 529 unit, 150 contract, 75 integration and 62
E2E tests plus migration/OpenAPI/architecture/build. Implementation `cade96f` is pushed. Disposable
test databases were deleted and the default local `sdar` volume remains protected historical operator
data. G07–G09 are pushed and their combined closure passes 549 unit, 152 contract, 79 real integration,
62 real E2E, 141 OpenAPI operations, 372-source architecture, A2A MUST 74/74, production build and
ten migrations through 0117. Real verification found and closed SQL parameter, Episode idempotency,
terminal-fixture and Management API enum defects without weakening assertions. G10–G17 remain open.
