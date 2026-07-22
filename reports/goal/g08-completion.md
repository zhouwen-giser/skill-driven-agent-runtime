# G08 Goal Completion Report

## Summary

G08 product implementation is complete in the working tree. A PostgreSQL-authoritative asynchronous
Observer consumes source-linked Goal Experience Episodes through a rebuildable BullMQ wake, partitions
Contract/Plan/Attempt/Outcome/Recovery/Correction evidence and runs exactly twelve independently
validated typed extractors. Observations distinguish fact, inference, candidate lesson, uncertainty
and contradiction; insufficient evidence is a no-op, untrusted text remains inert, and failed
extraction never changes the original Goal/Episode.

## Goal Contract Result

```text
blocked_external_integration_and_commit
```

The implementation, local tests, documentation and reproducible non-Docker evidence are complete.
Migration 0116, real PostgreSQL/Redis integration and real Server/A2A E2E are authored but cannot be
executed because the Codex automatic approval service rejects Docker access at the account usage limit.
The G08 staging attempt was likewise rejected before execution (retry reported as 2026-07-29 01:43),
so no G08 commit/push is claimed and Draft PR #8 does not yet contain G08.

## Implementation

- `ExperienceExtractor<T>` exposes an independent Zod schema, partition needs and fast/reasoning tier.
  Twelve default extractors cover goal pattern, task type signal, decomposition, dependency, criterion,
  evidence, artifact, capability, failure, recovery, no progress and human correction.
- `ExperienceExtractorPipeline` enforces an eight-Episode batch, 512 KiB byte budget, 128 Ki-token
  approximation and three prior Observations before any model call. Existing Observations are bounded
  context and can produce only change suggestions, never in-place mutation.
- Model input nests Episode content under explicit inert-data policy. Both input and model output clean
  role/directive injection, credentials, Bearer tokens, URL userinfo and email; Zod, enum, length and
  source-reference allowlists run before Domain factories accept data.
- A single invalid extractor is stored as `failed` while valid siblings remain. Evidence-absent
  extractors return `no_op`; total extractor failure retries and dead-letters the observe job without
  writing an Observation or changing the source Episode.
- `PostgresObservationRepository.save` validates every source Episode, serializes by primary Episode,
  provides immutable hash/revision idempotency and atomically saves Observation, statements,
  extraction results, model invocation lineage, `experience.observation_completed` and the G09
  `reflect` job.
- Migration 0116 completes the G00 Observation skeleton and `experience_observation` Model stage with
  guarded empty-data apply/rollback. Redis carries only `{jobId}`; startup/periodic reconciliation
  reconstructs wakes from PostgreSQL.
- Management/OpenAPI expose `GET /api/v1/experience/observations`; Console links Observation evidence
  and exposes the new model stage. No Candidate enters a Planner and no new dependency/runtime exists.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G08-01 | implemented; real integration authored | Observation save requires source Episodes and model invocation FKs; PG round-trip authored |
| AC-G08-02 | verified at unit | twelve per-kind literal Zod/JSON schemas; one invalid dependency result leaves eleven completed |
| AC-G08-03 | verified at unit/schema | all five statement classes pass Domain, fixture and pipeline assertions |
| AC-G08-04 | verified at unit | recovery/human-correction without evidence no-op before any related model call |
| AC-G08-05 | verified at unit | transcript directives are inert; input/output injection and secret/PII strings are cleaned |
| AC-G08-06 | verified at unit; real E2E authored | total failure dead-letters without Observation/source mutation; terminal-then-Observation slice authored |
| AC-G08-07 | verified at unit | nine Episodes and 600 KiB input fail before model invocation |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| test-first focused G08 suite | failed 4/4, then passed 6/6 | initial missing extractor factory retained as failure history; final Vitest 3.73 s |
| focused Management API contract | 51/51 | one file; Vitest 1.88 s |
| full `vitest run --project unit` | 539/539 | 93 files; 12.59 s |
| serial `vitest run --project contract --maxWorkers=1` | 151/151 | 19 files; 14.77 s |
| full Prettier / ESLint / strict TypeScript | passed | format 8.3 s; lint 36.9 s; typecheck clean |
| architecture gate | passed | 362 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| management OpenAPI | passed | 140 operations |
| acceptance / sources / protocol | passed | 18 mapped scenarios; 27 pinned sources; frozen package verified |
| A2A HTTP-JSON MUST baseline | passed | 74/74, TCK commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` |
| production TypeScript + Console build | passed | root build 11.3 s; Vite 29 modules, 286.53 kB JS |
| migration 0116 | blocked before start | additive up/down authored; Docker approval unavailable |
| real PostgreSQL/Redis integration | blocked before start | source/model/outbox/reflect-job round-trip authored but unexecuted |
| real Server/PostgreSQL/Redis/A2A E2E | blocked before start | terminal Episode to asynchronous Observation slice authored but unexecuted |
| `git add` / commit / push | blocked before start | platform approval usage limit; no staging occurred |

## Failed Attempts and Root Cause

1. The test-first suite failed 4/4 because the default typed extractor factory did not exist. The
   retained tests now pass 6/6 after the Domain/Application implementation.
2. A full `pnpm` gate did not enter tests: pnpm attempted a registry metadata fetch, then refused a
   non-TTY modules purge. Locked local binaries were used for equivalent non-install checks; no
   dependency or lockfile changed.
3. The first full ESLint pass found two unused type imports in the new extractor module. They were
   removed; full lint then passed.
4. Pre-commit review found that injection cleaning covered untrusted input but not model-produced
   summaries. Output directive/role/credential/PII sanitation and a regression were added.
5. Docker-backed gates and the G08 staging attempt were rejected before execution by the external
   approval usage limit. No bypass, mock evidence, default `sdar` reset or alternate Git write occurred.

## Architecture, Privacy and Authority

G08 adds no Agent, Planner, Workflow runtime, Memory authority or Python sidecar. LangGraph remains the
only execution runtime. Observations and suggestions are evidence data, not active knowledge; the
model cannot write Goal/Plan/Outcome/Recovery authority or invoke tools. Source refs and model
invocation refs are mandatory for persisted extracted statements, private reasoning is neither
requested nor saved, and Observer failure occurs only after the v1.2.2 terminal transaction.

## Migration and Source Intake

0116 is additive to the byte-stable v1.2.2 baseline and guarded against unreleased Observation data;
its real migration path is unverified due the external Docker blocker. The implementation is original
repository TypeScript informed only by already locked design references. No LangMem or Gemini source
was copied/translated, and no dependency, lockfile, license ledger, NOTICE or SBOM change is required.

## Commit, Push and Draft PR

- Implementation commit: blocked before staging; none created
- Push: not performed
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8> remains Draft at G00-G07
- Merge/tag: not performed and not authorized

## Provisional G09 Handoff

G09 may build locally on immutable Observation, Extraction, source/model lineage,
`experience.observation_completed` and the pending PostgreSQL `reflect` job. G08 must return to real
migration/integration/E2E, meaningful commit, push and PR update when approval becomes available. Until
then G08 is blocked, not completed, and G09 work remains provisional.
