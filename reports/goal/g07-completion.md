# G07 Goal Completion Report

## Summary

G07 implementation is complete, pushed and verified against real PostgreSQL/Redis/A2A execution. The v1.2.2 terminal Outcome transaction now
atomically appends `user_goal.terminal_committed`; a PostgreSQL-authoritative outbox/job/lease path
builds one immutable Goal Experience Episode asynchronously, while BullMQ carries only rebuildable
job-id wakes. Missing Contract, current Plan, User Goal Judgment or terminal authority is rejected
instead of producing default Experience. Dead letters are inspectable and manually replayable.

## Goal Contract Result

```text
completed
```

The original platform-usage blocker is retained under Failed Attempts. It is now resolved: the
meaningful implementation commit `301606e479e72436ac79f80d496ee40dcae9a338` is present on the branch
and origin, and the combined G07–G09 real verification passes. The externally merged historical PR #8
was replaced by Draft PR #9 for continued work.

## Implementation

- The authoritative terminal repository appends the terminal outbox Fact in the same transaction as
  the v1.2.2 Outcome state. Experience remains advisory and post-commit.
- Eligibility requires the frozen Contract, current Plan, User Goal Judgment and
  `user_goal_plan_controller` terminal authority.
- The Episode builder assembles persisted Plan revisions, attempts, decisions, progress, recovery,
  event impacts and planning interactions; it creates stable hashes, completeness, immutable revisions
  and deterministic credential/private-reasoning/PII redaction.
- PostgreSQL owns dispatch, lease, attempt, exponential backoff, expired-lease recovery, idempotency,
  dead-letter and manual replay state. Episode creation atomically writes source lineage,
  `experience.episode_created` and the next `observe` job.
- BullMQ contains only `{ jobId }` wake messages. Startup and periodic reconcilers rebuild wakes from
  PostgreSQL after Redis loss or process restart.
- Management/OpenAPI expose Episode listing, dead-letter inspection and explicit actor-attributed
  replay. The Console links operational evidence. No model stage or dependency was added.
- Migration 0115 completes the G00 skeleton additively and refuses rollback when Experience data exists.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G07-01 | verified | terminal Outcome/outbox same transaction plus atomic-count real PostgreSQL assertion |
| AC-G07-02 | verified | real A2A terminal result is awaited before the asynchronously created Episode |
| AC-G07-03 | verified | duplicate delivery, immutable hash and handler idempotency pass with PostgreSQL |
| AC-G07-04 | verified | exact missing-fact reasons and no-Episode/dead-letter PostgreSQL assertion |
| AC-G07-05 | verified | PG lease/reconciler authority, expired-lease recovery and job-id-only Redis wake |
| AC-G07-06 | verified at unit | sensitive keys, inline credentials, Bearer values, URL userinfo, email and private reasoning excluded |
| AC-G07-07 | verified | dead-letter GET, actor-attributed replay POST and one-shot real integration |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| focused G07 unit | 10/10 | 2 files; retained Goal-focused evidence |
| focused API/schema contract | 52/52 | Management boundary regression included |
| full `pnpm test:unit` | 549/549 | 94 files; sandbox-external rerun after retained `listen EPERM` |
| full `pnpm test:contract` | 152/152 | 19 files; sandbox-external rerun after retained `listen/spawn EPERM` |
| full Prettier / ESLint / strict TypeScript | passed | all configured files; zero lint errors; `--noEmit` clean |
| architecture gate | passed | 372 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| management OpenAPI | passed | 141 operations |
| acceptance map / A2A baseline | passed | 18 mapped scenarios; HTTP-JSON MUST 74/74 baseline |
| production TypeScript + Console build | passed | Vite 29 modules; 286.34 kB JS bundle |
| migration path | passed | v1.2.2 baseline plus 10 additive migrations through 0117, rollback/reapply and rogue-ledger rejection |
| real PostgreSQL/Redis integration | 79/79 | 8 files; terminal authority, outbox, Episode, Observation and Reflection path |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files; no skipped item counted as a pass |
| commit / push | passed | `301606e479e72436ac79f80d496ee40dcae9a338` is branch/origin HEAD before G08 work |

## Failed Attempts and Root Cause

1. The test-first focused suite failed 4/4 because the G07 policy, builder, job service and publisher did
   not exist. The retained suite now passes 10/10.
2. An initial schema-contract path was incorrect and Vitest reported no files. The actual repository
   schema contract path passes.
3. A serial-contract attempt used unsupported Vitest 4 option `--minWorkers`; no tests started. The
   supported `--maxWorkers=1` command passes 151/151.
4. The first local build command used the Console working directory for the root TypeScript config and
   an incorrect Vite path. Correct root and Console-local commands both pass without product changes.
5. Prettier initially reported two test files; the locked formatter changed only those files and the
   full format gate now passes.
6. Pre-commit privacy review found that key-only redaction could retain credentials embedded in string
   values. Inline credential, Bearer, URL-userinfo and email redaction plus regressions were added.
7. Docker integration/E2E and one staging attempt were rejected by the platform approval service due
   the usage limit. No mock evidence or default-database reset occurred. The later authoritative
   repository state records the pushed G07 commit above; the blocker was resolved on 2026-07-26.
8. The first real integration run exposed PostgreSQL parameter inference defects in JSONB Outbox
   construction, duplicate Episode completion after an idempotent insert, and an incomplete test
   fixture that omitted v1.2.2 Contract/Plan/Judgment authority. Explicit text casts, persisted-Episode
   reuse and an authoritative fixture closed these defects; the unchanged real suite passes 79/79.

## Architecture, Privacy and Recovery

G07 adds no Agent, Planner, Workflow runtime, Memory authority or Python sidecar. It does not change
v1.2.2 Goal/Skill/Outcome/Recovery authority and does not synchronously call an observer in the terminal
path. No LLM stage is used. PostgreSQL remains the only job/Episode truth; Redis loss is recoverable.
Episode snapshots are immutable validated data and exclude sensitive key classes plus common inline
credential/PII forms. Private reasoning is neither requested nor persisted.

## Migration and Source Intake

0115 is additive to the byte-stable v1.2.2 baseline and passed its isolated real migration-path run
before the platform usage limit was reached. The implementation is original repository TypeScript and
does not copy or translate Gemini CLI code. No new dependency, Source Intake, license ledger, NOTICE,
lockfile or SBOM change is required.

## Commit, Push and Draft PR

- Implementation/evidence commit: `301606e479e72436ac79f80d496ee40dcae9a338`
- Push: present at `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft and contains G07–G09
- Merge/tag: not performed and not authorized

## G08 Handoff

G08 builds on the pushed and real-verified G07 interfaces, schema, migration,
`experience.episode_created` event and pending `observe` job. G17 will repeat the clean-checkout release
gate; no remaining G07-specific blocker is open.
