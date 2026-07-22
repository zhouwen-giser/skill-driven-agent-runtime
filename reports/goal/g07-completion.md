# G07 Goal Completion Report

## Summary

G07 implementation is complete in the working tree. The v1.2.2 terminal Outcome transaction now
atomically appends `user_goal.terminal_committed`; a PostgreSQL-authoritative outbox/job/lease path
builds one immutable Goal Experience Episode asynchronously, while BullMQ carries only rebuildable
job-id wakes. Missing Contract, current Plan, User Goal Judgment or terminal authority is rejected
instead of producing default Experience. Dead letters are inspectable and manually replayable.

## Goal Contract Result

```text
blocked_external_gate_and_commit
```

The G07 completion contract permits tests to be honestly blocked with evidence, but it also requires a
meaningful pushed commit. Docker-backed integration/E2E execution and `.git` writes were both rejected
before execution by the Codex automatic approval service because the account usage limit was reached
(retry time reported as 2026-07-29 01:43). The implementation is therefore not claimed completed or
published. Draft PR #8 is not claimed to contain G07.

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
| AC-G07-01 | implemented; real integration authored | terminal Outcome/outbox same transaction plus atomic-count integration assertion |
| AC-G07-02 | implemented; real E2E authored | terminal A2A result is awaited before polling the asynchronously created Episode |
| AC-G07-03 | implemented; unit verified | duplicate delivery, immutable hash and handler idempotency; PostgreSQL integration authored |
| AC-G07-04 | verified at unit; integration authored | exact missing-fact reasons and no-Episode/dead-letter PostgreSQL assertion |
| AC-G07-05 | implemented; unit verified | PG lease/reconciler authority and job-id-only Redis wake; expired-lease integration authored |
| AC-G07-06 | verified at unit | sensitive keys, inline credentials, Bearer values, URL userinfo, email and private reasoning excluded |
| AC-G07-07 | implemented; contract verified | dead-letter GET and actor-attributed replay POST; one-shot replay integration authored |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| focused G07 unit | 10/10 | 2 files; final 2.28 s Vitest duration |
| focused API/schema contract | 52/52 | 2 files; 3.70 s Vitest duration |
| full `vitest run --project unit` | 533/533 | 92 files; final 8.75 s Vitest duration |
| serial `vitest run --project contract --maxWorkers=1` | 151/151 | 19 files; 18.29 s Vitest duration |
| full Prettier / ESLint / strict TypeScript | passed | all configured files; zero lint errors; `--noEmit` clean |
| architecture gate | passed | 354 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| management OpenAPI | passed | 139 operations |
| acceptance map / A2A baseline | passed | 18 mapped scenarios; HTTP-JSON MUST 74/74 baseline |
| production TypeScript + Console build | passed | Vite 29 modules; 286.34 kB JS bundle |
| migration path | passed before quota rejection | disposable PostgreSQL 17 + pgvector; 0108-0115 full migration checks |
| real PostgreSQL/Redis integration | blocked before start | Docker approval rejected due account usage limit |
| real Server/PostgreSQL/Redis/A2A E2E | blocked before start | same external approval limit; authored G07 slice remains unclaimed |
| `git add` / commit / push | blocked before start | `.git` write approval rejected by the same usage limit |

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
7. Docker integration/E2E and later `.git` staging were rejected by the platform approval service due
   the usage limit. No bypass, mock evidence, default-database reset or alternate `.git` write occurred.

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

- Implementation commit: blocked before staging; none created
- Push: not performed
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8> remains Draft at G00-G06
- Merge/tag: not performed and not authorized

## Provisional G08 Handoff

G08 may build locally on the present G07 interfaces, schema, migration, `experience.episode_created`
event and pending `observe` job. G07 must return to real integration/E2E, meaningful commit, push and PR
update when the external approval limit permits. Until then G07 is blocked, not completed.
