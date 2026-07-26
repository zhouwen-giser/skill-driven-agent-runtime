# G08 Goal Completion Report

## Summary

G08 product implementation is complete, committed, pushed and real-verified. A PostgreSQL-authoritative asynchronous
Observer consumes source-linked Goal Experience Episodes through a rebuildable BullMQ wake, partitions
Contract/Plan/Attempt/Outcome/Recovery/Correction evidence and runs exactly twelve independently
validated typed extractors. Observations distinguish fact, inference, candidate lesson, uncertainty
and contradiction; insufficient evidence is a no-op, untrusted text remains inert, and failed
extraction never changes the original Goal/Episode.

## Goal Contract Result

```text
completed
```

The original platform-usage blocker and rejected staging attempt are retained below. They are resolved:
implementation commit `2d600fc0f4686c6537f4de0ca5ab490a782e02a3` is pushed, migration 0116 is
covered by the through-0117 migration gate, and the combined real Integration/E2E paths pass. Continued
work is published in Draft PR #9 because historical PR #8 was merged externally.

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
| AC-G08-01 | verified | Observation save requires source Episodes and model invocation FKs; real PG round-trip |
| AC-G08-02 | verified at unit | twelve per-kind literal Zod/JSON schemas; one invalid dependency result leaves eleven completed |
| AC-G08-03 | verified at unit/schema | all five statement classes pass Domain, fixture and pipeline assertions |
| AC-G08-04 | verified at unit | recovery/human-correction without evidence no-op before any related model call |
| AC-G08-05 | verified at unit | transcript directives are inert; input/output injection and secret/PII strings are cleaned |
| AC-G08-06 | verified | total failure dead-letters without source mutation; real terminal-to-Observation slice |
| AC-G08-07 | verified at unit | nine Episodes and 600 KiB input fail before model invocation |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| test-first focused G08 suite | failed 4/4, then passed 6/6 | initial missing extractor factory retained as failure history; final Vitest 3.73 s |
| focused Management API contract | passed | route/read contracts included in full contract gate |
| full `pnpm test:unit` | 549/549 | 94 files |
| full `pnpm test:contract` | 152/152 | 19 files |
| full Prettier / ESLint / strict TypeScript | passed | format 8.3 s; lint 36.9 s; typecheck clean |
| architecture gate | passed | 372 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| management OpenAPI | passed | 141 operations |
| acceptance / sources / protocol | passed | 18 mapped scenarios; 27 pinned sources; frozen package verified |
| A2A HTTP-JSON MUST baseline | passed | 74/74, TCK commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` |
| production TypeScript + Console build | passed | root build 11.3 s; Vite 29 modules, 286.53 kB JS |
| migration 0116 | passed | covered by the ten-migration 0108–0117 rollback/reapply gate |
| real PostgreSQL/Redis integration | 79/79 | source/model/outbox/reflect-job round-trip verified |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | terminal Episode to asynchronous Observation verified |
| `git add` / commit / push | passed | `2d600fc0f4686c6537f4de0ca5ab490a782e02a3` is on origin |

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
   The blocker was resolved on 2026-07-26 and the real suites now pass.
6. The first real round-trip exposed PostgreSQL JSONB parameter inference in the Observation Outbox;
   explicit boundary casts fixed the production query and the unchanged integration assertions pass.

## Architecture, Privacy and Authority

G08 adds no Agent, Planner, Workflow runtime, Memory authority or Python sidecar. LangGraph remains the
only execution runtime. Observations and suggestions are evidence data, not active knowledge; the
model cannot write Goal/Plan/Outcome/Recovery authority or invoke tools. Source refs and model
invocation refs are mandatory for persisted extracted statements, private reasoning is neither
requested nor saved, and Observer failure occurs only after the v1.2.2 terminal transaction.

## Migration and Source Intake

0116 is additive to the byte-stable v1.2.2 baseline and guarded against unreleased Observation data;
its real migration path passes through 0117. The implementation is original
repository TypeScript informed only by already locked design references. No LangMem or Gemini source
was copied/translated, and no dependency, lockfile, license ledger, NOTICE or SBOM change is required.

## Commit, Push and Draft PR

- Implementation commit: `2d600fc0f4686c6537f4de0ca5ab490a782e02a3`
- Push: present at `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag: not performed and not authorized

## Provisional G09 Handoff

G09 builds on immutable Observation, Extraction, source/model lineage,
`experience.observation_completed` and the pending PostgreSQL `reflect` job. These contracts are now
committed, pushed and verified; no G08-specific blocker remains.
