# G06 Goal Completion Report

## Summary

G06 records immutable, actor-attributed corrections to Understanding, Goal Contract and Plan review
without changing those authorities. Each correction preserves before/instruction/structured-patch/
after/validation evidence, normalized type and scope, and is folded into a deterministic Interaction
Episode snapshot. A terminal Outcome or later counterexample appends a new Episode revision rather
than mutating prior history.

## Goal Contract Result

```text
completed
```

## Implementation

- Domain factories validate and freeze `PlanningCorrectionFact` and `PlanningInteractionEpisode`,
  including bounded user instructions, normalized correction types/scopes, stable content hashes,
  source lineage, completeness and induction fingerprints.
- `PlanningCorrectionService` provides transaction-backed idempotent recording, duplicate recovery,
  task interaction reads, terminal Outcome revisions and user-projection deletion. Duplicate retries
  re-attempt the idempotent low-risk projection without creating another authoritative Fact.
- `PlanningInteractionEpisodeBuilder` rebuilds a complete task snapshot from persisted Understanding,
  Goal and Plan review history, corrections and optional final Outcome/counterexamples. PostgreSQL
  stores immutable revisions and de-duplicates by Episode hash.
- G04 and G05 user answers, patches, accept/reject/cancel actions emit correction/interaction evidence.
  Terminal runtime outcomes append a new Episode revision through a fail-open observation hook; the
  existing v1.2.2 Goal/Plan/Outcome controller remains authoritative.
- `PlanningPreferenceProjector` admits only explicit, accepted, user-scoped low-risk preferences into
  the existing Memory projection. Task, tenant and `global_candidate` corrections do not promote;
  safety/degradation corrections are forbidden. Memory reads now enforce global-or-exact-user scope.
- Migration 0114 completes the frozen correction/episode tables, adds scoped Memory projection fields,
  atomic `planning.correction_recorded` outbox evidence, indexes and guarded rollback.
- Management/OpenAPI expose task interactions and user preference deletion. The Task Console links
  correction/Episode evidence; the real A2A path exercises Goal/Plan corrections, projection and
  deletion without treating the interaction metadata as authority.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G06-01 | verified | immutable Understanding/Contract/Plan before-instruction-patch-after-validation snapshots in unit, integration and real A2A E2E |
| AC-G06-02 | verified | normalized correction type/scope factories plus exact task/user/tenant PostgreSQL queries |
| AC-G06-03 | verified | task and `global_candidate` corrections never enter Memory; no automatic cross-user/global promotion |
| AC-G06-04 | verified | final Outcome/counterexample produces a new hash/revision while the prior Episode remains byte-stable |
| AC-G06-05 | verified | accepted explicit user preference allowlist; safety/degradation classes rejected from projection |
| AC-G06-06 | verified | exact tenant boundary tests, global-or-exact-user Memory reads and propagated user deletion |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| `npm.cmd run format:check` | passed | final affected-tree run, 11.5 s |
| local ESLint | passed | zero warnings/errors, 35.3 s |
| strict TypeScript `--noEmit` | passed | final static run, 13.2 s |
| `vitest run --project unit` | 529/529 | 91 files; 8.37 s Vitest duration |
| `vitest run --project contract --maxWorkers=1` | 150/150 | 19 files; 17.02 s Vitest duration |
| `node scripts/check-architecture.mjs` | passed | 344 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| `node scripts/check-management-openapi.mjs` | passed | 136 operations |
| `node scripts/test-integration.mjs` | 75/75 | eight real PostgreSQL/Redis files; 14.79 s Vitest duration |
| `node scripts/verify-migration-path.mjs` | passed | 0108-0114 fresh/idempotent/rollback/reapply/guarded-reset/rogue-ledger |
| `node scripts/test-e2e.mjs` | 62/62 | two real Server/PostgreSQL/Redis/A2A files; 29.02 s Vitest duration |
| `CI=true npm.cmd run build` | passed | production TypeScript plus Console Vite bundle, 14.1 s |

The complete clean-checkout `pnpm verify`, A2A MUST TCK, release smoke, replay/shadow,
security/capacity and exact-publication audit remain reserved for G17 and are not claimed here.

## Failed Attempts and Root Cause

1. The retained test-first G06 run failed 3/3 because the correction factory, service and projector did
   not yet exist. The same focused suite passes 3/3 after implementation.
2. The first full integration run passed 74/75; the failing assertion expected an absent optional JSON
   field as `outcomeRef: undefined`. The assertion now verifies actual property absence and the rerun
   passes 75/75 without weakening product behavior.
3. The first format check identified 14 affected files. The locked repository Prettier formatted only
   those files and the final full format gate passes.
4. The first ESLint run found 18 type-narrowing, Promise-stub and redundant-conversion violations.
   Product/test code was corrected without rule disables; final ESLint passes with zero warnings.
5. The first serial contract command included unsupported Vitest 4 option `--minWorkers`; no tests
   started. The supported `--maxWorkers=1` command then passed 150/150.
6. The first production build completed TypeScript but pnpm's dependency-state check aborted because
   the sandbox had no TTY/registry access. Re-running the unchanged build with `CI=true` and approved
   network access passed; no dependency, lockfile or product-runtime change was made.

## Architecture, Privacy and Recovery

G06 adds no second Agent, Planner, Workflow, Memory service or Python runtime. Corrections and Episodes
are evidence, not Goal/Plan/Outcome authority; LLM output never writes them directly and no private
reasoning is stored. PostgreSQL owns immutable Fact/Episode truth and transactional outbox evidence.
The projection is rebuildable, scoped, deletable and never allows one user's correction to leak into
another user's retrieval. Observation failures cannot break the v1.2.2 execution authority.

## Migration and Source Intake

0114 is additive to the byte-stable v1.2.2 baseline and passed rollback/reapply on disposable real
PostgreSQL 17 + pgvector. The implementation is original repository code using existing approved
dependencies and copies or translates no Gemini, Claude Code, Codex or other external source. No
Source Intake, dependency, license ledger, lockfile, NOTICE or SBOM change is required.

## Commit, Push and Draft PR

- Implementation commit: `cade96f4c26637ec2b6412a276fffa3e27fed4c3`
- Push: `origin/feature/v1.2.3-cognitive-planning-runtime` includes the implementation commit
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR remains Draft; no merge or tag is authorized

All disposable G06 PostgreSQL/Redis containers were stopped and removed. The default operator `sdar`
database and its volumes were not reset or modified.

## Next Goal Handoff

G07 can consume `planning.correction_recorded` and the immutable task/Goal/Plan interaction lineage as
source evidence for durable Experience outbox/jobs and Goal Episodes. It must preserve correction
scope, source hashes and user deletion boundaries while keeping online execution non-blocking.
