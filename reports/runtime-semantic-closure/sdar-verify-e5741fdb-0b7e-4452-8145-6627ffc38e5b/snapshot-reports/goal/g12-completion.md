# G12 Goal Completion Report

## Summary

G12 implements one governed Knowledge Promotion framework for Planning Heuristics, Task Types and
Capability Patterns while retaining a separate target adapter for each knowledge kind. PostgreSQL is
the only lifecycle, evidence, evaluation and transition authority. The existing MemoryService stores
only rebuildable Active search summaries with exact authoritative revision references.

Every initial activation is manual. High-risk knowledge additionally requires replay, shadow,
explicit policy allow and human approval. A newer contradiction, increased user-rejection ratio,
Promotion policy change, Capability Catalog Hash change or exact Skill Version change moves affected
Active knowledge back to `validating` through version CAS, audit transition and Outbox evidence.
Promotion has no Skill publication dependency and cannot mutate the v1.2.2 Goal, Skill, Outcome,
Recovery or Provider Readiness authorities.

## Goal Contract Result

```text
completed
```

All affected implementation and verification gates are green. Meaningful implementation commit
`59f20f6cb4af22458d1aef018809791a998826b0` is pushed. Draft PR #9 remains Draft.

## Implementation

- Domain owns immutable Promotion evidence, replay/shadow reports, gate results, evaluations and
  Active projection snapshots with stable validation errors.
- `EvidenceThresholdEvaluator` applies kind-specific Goal/user/success/contradiction/replay/shadow
  thresholds. Manual approval is mandatory for every activation; high risk is fail-closed without all
  additional gates.
- `PlanningHeuristicPromotionTarget`, `TaskTypePromotionTarget` and
  `CapabilityPatternPromotionTarget` independently validate their target shapes. Capability Pattern
  activation requires exact current Skill Version mappings and stable effects/evidence, but cannot
  publish or mutate a Skill.
- Generic `DuplicateCandidateDetector`, `ReplayEvaluationRunner`, case runner contracts and
  `CorrectionDiffRecorder` are reusable by Promotion and Skill Evolution without merging their
  lifecycle targets.
- `KnowledgePromotionService` owns evaluate, reject, revalidate and deprecate orchestration. Candidate
  activation is a two-transition `candidate→validating→active` transaction; a failed evaluation
  returns to Candidate, and one Candidate revision can have only one terminal evaluation.
- `PostgresKnowledgePromotionRepository` aggregates real Goal Episode lineage, unique Goals/users,
  terminal success/failure, planning accept/reject decisions and support/contradiction evidence.
  Replay reads persisted outcome evidence and does not invoke tools or change authority.
- PostgreSQL advisory locks and version CAS protect exact knowledge revisions. Promotion of a newer
  revision deprecates the prior Active revision atomically. Revalidation locks the explicit Active
  revision even when a newer Candidate revision exists.
- A deterministic invalidation scan detects new contradiction evidence, a higher user-rejection
  ratio and Promotion policy drift. It runs after durable Reflection completion and at startup.
  G11's Catalog/Skill invalidator triggers the same Active projection reconciliation.
- `ActiveKnowledgeProjector` accepts only Active records. Its Memory adapter stores kind/id/revision,
  risk, summary and exact authoritative reference; startup reconciliation rebuilds missing projections
  and invalidates stale ones by comparing against PostgreSQL's complete Active set.
- Migration 0120 adds terminal-evaluation uniqueness, Active lookup/single-revision indexes and the
  `knowledge_promotion_assessment` model stage. Rollback refuses to discard Promotion state or an
  active route.
- Four CAS lifecycle endpoints are present in the 147-operation Management OpenAPI. Strict request
  schemas preserve existing HTTP error semantics; only Promotion CAS/terminal-evaluation conflicts
  map to 409.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G12-01 | verified | one service/evaluator plus three independent Promotion Target classes; focused unit validates target separation |
| AC-G12-02 | verified | Domain state machine, PostgreSQL advisory lock/version CAS, immutable transition rows and Outbox; real integration observes two activation transitions |
| AC-G12-03 | verified | repository aggregation and evaluation snapshot cover support/contradiction, users/goals, terminal outcomes, accept/reject, replay and shadow fields |
| AC-G12-04 | verified | focused high-risk test requires replay, shadow, human approval and policy allow; all initial activation also requires human approval |
| AC-G12-05 | verified | real PostgreSQL test adds a contradiction on Candidate revision 2 and CAS-transitions Active revision 1 to validating; policy drift query and G11 Catalog/Skill invalidation are covered |
| AC-G12-06 | verified | Candidate projection is rejected; deleted Active Memory is rebuilt; contradiction invalidation prunes the stale projection |
| AC-G12-07 | verified | no Skill publication/mutation port is injected; real promotion leaves `skill_version` count at zero |

## Validation

| Command / gate | Result | Evidence |
| --- | ---: | --- |
| test-first G12 unit | failed 6/6, then passed 8/8 | missing framework symbols were the retained initial failure |
| full `pnpm test:unit` | 568/568 | 97 files; sandbox-external loopback run |
| full `pnpm test:contract` | 155/155 | 19 files; includes 55 Management operations tests |
| real PostgreSQL/Redis integration | 82/82 | 8 files; real evidence, CAS, contradiction invalidation and projection rebuild |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files; existing authoritative execution and HTTP semantics preserved |
| migration path | passed | v1.2.2 baseline plus 13 additive migrations; idempotency, rollback/reapply, guarded reset and rogue-ledger rejection |
| Prettier / ESLint / strict TypeScript | passed | all configured files; zero errors |
| architecture | passed | 397 TypeScript sources; 18 Domain/48 Application cognitive files; no Python runtime |
| Management OpenAPI | passed | 147 operations |
| A2A baseline | MUST 74/74 | pinned HTTP-JSON TCK baseline |
| sources / licenses / SBOM | passed | 27 pinned sources; 286 npm packages + 2 services; unchanged dependency set |
| production build / Server smoke | passed | strict TypeScript, Console Vite build, Agent Card, Console and no-auth warning |

## Failed Attempts and Root Cause

1. The test-first suite failed 6/6 because Promotion Domain objects, evaluator, targets, replay,
   projector and service did not exist. The final focused suite passes 8/8.
2. Early strict TypeScript and ESLint runs found incomplete error unions, duplicate kind fields,
   Task Type status validation in the wrong factory, redundant literal checks and optional-chain
   style defects. The owning boundaries were corrected without weakening validation.
3. A direct integration attempt reached the operator `sdar` database, whose preserved historical
   migration ledger is intentionally incompatible with the v1.2.3 clean baseline. It was not reset;
   the isolated standard runner passed.
4. The first isolated integration used repeated test transition IDs. A globally monotonic fixture
   sequence fixed the test data while retaining the production uniqueness and assertions.
5. `pnpm verify:openapi` does not exist. The repository's exact
   `pnpm verify:management-openapi` command passed 147 operations.
6. Full Unit/Contract sandbox attempts failed only on local `listen EPERM` and `spawnSync EPERM`.
   Approved sandbox-external reruns passed 568/568 and 155/155 without code or assertion changes.
7. The first G12 E2E run exposed a real regression: a broad `_CONFLICT→409` rule changed the frozen
   Skill Import conflict from 400 to 409. The mapping is now restricted to Promotion CAS/evaluation
   conflicts, a Management contract regression was added, and E2E passes 62/62.
8. The first smoke attempt used stale `.env` port 54329 and was sandbox-blocked. Final smoke used an
   exact temporary database on the operator-managed 55432 service, passed, and the temporary database
   was deleted without touching the operator `sdar` database.
9. Final review found that invalidating Active revision 1 after Candidate revision 2 appeared would
   otherwise lock the latest row and fail CAS. Transition lookup now locks the explicit Active
   revision; the real revision-2 contradiction integration passes.

## Architecture and Authority

The architecture guardian confirms one TypeScript modular monolith and the sole LangGraph workflow
runtime. Domain models import no PostgreSQL, Memory, HTTP, SDK or model types. PostgreSQL is the only
durable knowledge authority; Memory is an Active-only, deletion-safe search projection. Redis remains
ephemeral. Model output is inert validated data and never commits status. Candidate knowledge cannot
enter the Planner, invoke tools, assert Readiness or publish a Skill.

## Migration and Source Intake

0120 is additive to the byte-stable v1.2.2 baseline and guarded against destructive rollback.
Implementation is original repository TypeScript using only already locked conceptual references.
No code was copied or translated, no runtime dependency was added, and no Source Intake, lockfile,
license, NOTICE or SBOM update is required.

## Commit, Push and Draft PR

- Meaningful G12 implementation: `59f20f6cb4af22458d1aef018809791a998826b0`
- Push: published to `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag: not performed and not authorized

## G13 Handoff

G13 receives three PostgreSQL-governed Active knowledge kinds plus rebuildable Memory projection
references. Retrieval must resolve every projection back to the exact authoritative Active revision,
apply scope/risk/progressive-disclosure rules and exclude Candidate/validating/deprecated/rejected
records. It must not treat Memory text as authority or allow knowledge to bypass G05 confirmation,
current Skill compatibility, Provider Readiness or the v1.2.2 execution path.
