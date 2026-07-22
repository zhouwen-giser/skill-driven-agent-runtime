# EP-SDAR-V1.2.3 — Cognitive Planning Runtime

Status: ACTIVE — repository/task-package audit and G00 are in progress

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
| G00 | in_progress | — | baseline pending | `reports/goal/g00-completion.md` pending | none | freeze ADR/domain/schema/source/migration contracts |
| G01 | not_started | — | — | — | G00 | deterministic capability summary |
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

Pending G00 exact-commit LICENSE/NOTICE validation for Gemini CLI, AutoSkill, LangMem, ReMe, Agent
Workflow Memory and ACE. Initial classification is `design_reference`/`algorithm_reference`; AutoSkill
source copying remains prohibited. No new product runtime dependency is approved by this plan.

## Migration / API / Console Status

- Migration: v1.2.2 clean baseline identified; additive v1.2.3 ledger design pending G00.
- OpenAPI: existing management schema has 124 operations in the v1.2.2 acceptance record; no v1.2.3
  operation has been added yet.
- A2A: existing applicable MUST result is 74/74 in v1.2.2 acceptance; no v1.2.3 projection change yet.
- Console: existing React console is authoritative only as an operational projection; no G15 UI yet.

## Branch / HEAD / Main / Draft PR

- Branch: `feature/v1.2.3-cognitive-planning-runtime`
- Base main: `35cb9277396e0316b1c6b8aac57e6fa69a8a29df`
- Current HEAD: `35cb9277396e0316b1c6b8aac57e6fa69a8a29df`
- Draft PR: not created; must be created immediately after the pushed G00 commit.

## Changed Files

- `execplans/EP-SDAR-V1.2.3.md`
- `reports/goal/sync-state.json`
- user-supplied untracked task package under `docs/SDAR_v1.2.3_Codex_Goal_Package_V1.0/`

## Open Blockers

None. The task-package Windows self-check defect has a safe independent hash-verification path and does
not block G00.

## Next Execution Step

Finish the platform-safe task-package integrity check and current `pnpm verify` baseline, then implement
the G00 ADR/domain/schema/migration/source/architecture slice and its reproducible evidence.

## Outcomes and Retrospective

Not yet complete. Update this section at every Goal boundary with delivered behavior, evidence,
remaining gaps and effects on later Goals.
