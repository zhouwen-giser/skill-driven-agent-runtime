# EP-SDAR-V1.2.3 — Cognitive Planning Runtime

Status: ACTIVE — G01 implementation/gates are complete locally; publication evidence is pending

Branch: `feature/v1.2.3-cognitive-planning-runtime`

Base `origin/main`: `35cb9277396e0316b1c6b8aac57e6fa69a8a29df`

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

| Concern | Authoritative owner | Explicitly not authoritative |
| --- | --- | --- |
| Cognitive schemas, state transitions, source/data classification | Domain | model output, UI, SDK types |
| Understanding/session/promotion orchestration | Application | PostgreSQL implementation, LangGraph internals |
| Goal/plan execution and terminal state | v1.2.2 Application + `UserGoalPlanController` | Experience, Candidate knowledge, Workflow completion |
| Workflow execution | LangGraph.js adapter/runtime | Skill Goal DAG, replay harness, queue worker |
| Cognitive facts and knowledge lifecycle | PostgreSQL | Redis, MemoryService, Console, files |
| Active search projection | existing MemoryService | Candidate or complete knowledge authority |
| Model invocation | existing SDAR Model Runtime | domain factories, repositories |
| Public capability representation | activated hash-matched snapshot | request-time LLM, live readiness, private experience |
| Current Provider/device readiness | existing v1.2.2 readiness authority | capability summary, historical success |

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

| Goal | Status | Commit | Tests | Evidence | Blocker | Next |
| --- | --- | --- | --- | --- | --- | --- |
| G00 | completed | `ffd9791` | full `pnpm verify` passed: 635 unit/contract, 68 integration, 59 E2E, build/smoke | `reports/goal/g00-completion.md` | none | hand off frozen contracts to G01 |
| G01 | in_progress | pending immutable commit | full `pnpm verify`: 645 unit/contract, 70 integration, 60 E2E, build/smoke | `reports/goal/g01-completion.md` | none | commit/push/update Draft PR, then G02 |
| G02 | not_started | — | — | — | G01 | public snapshot/A2A projection |
| G03 | not_started | — | — | — | G00/G01 | generic task understanding |
| G04 | not_started | — | — | — | G03 | interactive Goal session |
| G05 | not_started | — | — | — | G01/G04 | interactive planning/patch |
| G06 | not_started | — | — | — | G04/G05 | correction facts/interaction episode |
| G07 | not_started | — | — | — | G00 | outbox/job/Goal episode |
| G08 | not_started | — | — | — | G07 | observer/typed extractors |
| G09 | not_started | — | — | — | G08 | reflector/identity/curator |
| G10 | not_started | — | — | — | G06/G09 | Task Type induction |
| G11 | not_started | — | — | — | G01/G09 | capability pattern/gap |
| G12 | not_started | — | — | — | G09/G10/G11 | knowledge promotion |
| G13 | not_started | — | — | — | G01/G12 | retrieval/progressive disclosure |
| G14 | not_started | — | — | — | G05/G13 | experience-enriched planner/fallback |
| G15 | not_started | — | — | — | dependency set | API/Console/A2A integration |
| G16 | not_started | — | — | — | dependency set | replay/shadow/evaluation |
| G17 | not_started | — | — | — | G00–G16 | hardening/release gates |

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

## Migration / API / Console Status

- Migration: additive 0108 skeleton and exact-prefix ledger are implemented; fresh apply, idempotency,
  rollback/reapply, guarded reset and rogue-ledger rejection pass on real PostgreSQL.
- OpenAPI: existing management schema has 124 operations in the v1.2.2 acceptance record; no v1.2.3
  operation has been added yet.
- A2A: existing applicable MUST result is 74/74 in v1.2.2 acceptance; no v1.2.3 projection change yet.
- Console: existing React console is authoritative only as an operational projection; no G15 UI yet.

## Branch / HEAD / Main / Draft PR

- Branch: `feature/v1.2.3-cognitive-planning-runtime`
- Base main: `35cb9277396e0316b1c6b8aac57e6fa69a8a29df`
- Current implementation HEAD: `ffd979152ae45468f00e2cf673e97ed5fe32616c`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>

## Changed Files

- G00 implementation commit `ffd9791`: task package, ADR-111–114, cognitive Domain/Application
  contracts, JSON Schema/fixture, migration 0108, source intake/locks, architecture gate and generated
  license/SBOM evidence.
- G00 evidence commit: this living plan, sync-state, baseline/completion reports, status/traceability and
  changelog synchronization.
- G01 implementation/evidence candidate: deterministic builders/service, migration 0109, PostgreSQL
  repository/outbox projection, Server/API/OpenAPI wiring, unit/contract/integration/E2E tests and
  `reports/goal/g01-completion.md`.

## Open Blockers

None. The package self-check is platform-safe and passing. The default operator database's historical
ledger is preserved and is not a blocker because all destructive verification uses guarded disposable
database names. G01 has no implementation blocker; only its normal immutable commit/push/PR publication
step remains.

## Next Execution Step

Create and push the immutable G01 implementation commit, record its exact SHA in this plan/sync state,
update Draft PR #8 without changing Draft status, then start G02 public privacy-filtered/A2A projection
from the activated Hash-matched Summary.

## Outcomes and Retrospective

G00 completed without activating cognitive behavior. G01 now provides deterministic Capability Summary
behavior with real PostgreSQL/API/runtime evidence and no Provider/readiness or model authority. Its
final full gate passes 645 unit/contract, 70 integration and 60 E2E tests plus migration/OpenAPI/build
and both smokes in 166,839 ms; publication evidence is the remaining G01 step. The disposable gate
database was deleted and the default local `sdar` volume remains protected historical operator data.
G02–G17 remain open.
