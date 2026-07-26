# G09 Goal Completion Report

## Summary

G09 product implementation is complete, committed, pushed and real-verified. The PostgreSQL-authoritative Reflector
evaluates immutable Observation/Episode evidence as helpful, harmful or neutral, preserves positive
and negative lineage, and asks the Curator only for one of the six frozen Knowledge Delta operations.
Identity combines a de-instantiated canonical fingerprint, lexical overlap, semantic similarity,
deliverable and recent-intent boundaries; low confidence creates a separate Candidate. Every result
remains Candidate-only and outside the formal Planner until the later G12 promotion authority.

## Goal Contract Result

```text
completed
```

The original external blocker is retained under Failed Attempts. It is resolved: implementation commit
`c8754fdddf9173dcc4f29609d548cade0b3bcc81` is pushed, migration 0117 and the real
PostgreSQL/Redis/A2A vertical pass, and replacement Draft PR #9 carries continued G07–G17 work.

## Implementation

- `ExperienceReflectorService` claims PostgreSQL jobs, batches at most 100 compatible Observations
  within a seven-day tenant/goal-pattern/capability/task-type group and enforces a 512 KiB input limit.
- Strict Zod Reflector output links helpful/harmful/neutral impacts and Candidate drafts to exact
  Observation statements, Episodes and Outcomes. Invalid structured output persists a deterministic
  no-op; operational failure retries/dead-letters without changing source evidence.
- `KnowledgeIdentityService` first uses a de-instantiated SHA-256 fingerprint, then exact deliverable
  and recent-intent boundaries, weighted lexical overlap and an injected semantic similarity Port.
  Device/location/date instance terms are removed from the fingerprint; low-confidence identity never
  merges.
- `KnowledgeCuratorService` permits only `CREATE_REVISION`, `SUGGEST_MERGE`,
  `SUGGEST_SUPERSEDE`, `ADD_EVIDENCE`, `ADD_CONTRADICTION` and `NO_CHANGE`. Unknown relation targets,
  malformed JSON, empty/illegal deltas and deterministic validation failures become `NO_CHANGE`.
- `KnowledgeDeltaValidator` requires source lineage, Candidate status, operation-specific targets and
  polarity. Neither model output nor repository code can create Active Knowledge.
- `PostgresReflectionRepository` transactionally persists Reflection, Delta, Candidate revision,
  copied-forward positive/negative evidence, merge/supersede lineage and the required outbox events.
  Repeated delivery is idempotent and Redis carries only rebuildable job-id wakes.
- Migration 0117 completes the G00 Reflection skeleton, adds generic Delta and Candidate-lineage
  records, and enables the audited `experience_reflection` model stage. Management/OpenAPI expose
  `GET /api/v1/experience/reflections`; Console and A2A evidence links are wired.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G09-01 | verified | Reflector persists source/model-linked impact and Candidate-only Delta |
| AC-G09-02 | verified at unit | same reusable job matches after device/location/date de-instantiation; different deliverable/intent separates |
| AC-G09-03 | verified at unit | low semantic confidence creates new knowledge and exact fingerprints avoid a semantic call |
| AC-G09-04 | verified at unit | illegal JSON, illegal operation and unknown merge target deterministically no-op |
| AC-G09-05 | verified at domain/unit | both positive and negative evidence retain Observation/Episode/Outcome lineage |
| AC-G09-06 | verified | fingerprint, duplicate lookup and merge/supersede lineage persist transactionally |
| AC-G09-07 | verified | idempotent reflection, invalid-output continuation and operational retry/dead-letter preserve sources |

## Validation

| Command / gate | Result | Evidence / duration |
| --- | ---: | --- |
| test-first focused G09 suite | failed 4/4, then passed 16/16 | initial missing constructors retained; two files, final 2.04 s |
| full `pnpm test:unit` | 549/549 | 94 files |
| full `pnpm test:contract` | 152/152 | 19 files; includes reflection-route regression |
| full Prettier / ESLint / strict TypeScript | passed | 19.8 s / 60.2 s / clean |
| architecture gate | passed | 372 TypeScript sources; six v1.2.2 authorities; no Python product runtime |
| management OpenAPI | passed | 141 operations |
| acceptance / sources / protocol | passed | 18 mapped scenarios; 27 pinned sources; frozen package verified |
| A2A HTTP-JSON MUST baseline | passed | 74/74, TCK commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` |
| licenses / SBOM | passed | Apache-2.0 metadata; 286 npm packages and 2 services |
| production TypeScript + Console build | passed | root build; Vite 29 modules, 286.70 kB JS |
| migration 0117 | passed | ten additive migrations, idempotency, rollback/reapply, guarded reset and rogue rejection |
| real PostgreSQL/Redis integration | 79/79 | Candidate/evidence/lineage/outbox round-trip verified |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | terminal-to-Episode-to-Observation-to-Reflection slice verified |
| `git add` / commit / push | passed | `c8754fdddf9173dcc4f29609d548cade0b3bcc81` is on origin |

## Failed Attempts and Root Cause

1. The test-first suite failed 4/4 because Reflector, Identity, Curator and validator constructors did
   not exist. The retained suite now passes after the product implementation.
2. Review found that raw instance terms were included in the canonical identity fingerprint even
   though the job text was de-instantiated. The raw terms were removed and a regression proves P-17
   in Shanghai and P-22 in Beijing share a reusable-job fingerprint.
3. The top-level `pnpm` wrapper attempted registry metadata/dependency repair and refused a non-TTY
   modules purge. Locked local binaries ran the equivalent gates offline; no dependency changed.
4. One Console build attempt ran Vite from the repository root and could not find `index.html`. The
   correct `apps/console` working directory passed the unchanged production build.
5. Docker-backed gates and Git staging remain rejected before execution by the external approval
   usage limit. No bypass, mock evidence, default `sdar` reset or alternate Git write occurred. The
   blocker was resolved on 2026-07-26.
6. Invoking the root build compiler directly emitted 378 adjacent untracked `.js` files. A read-only
   audit proved every file is inside the repository and has a matching `.ts`/`.tsx` source, but the
   platform rejected their exact cleanup before execution. They are not product changes and must be
   removed before further Vitest evidence, because `.js` imports could otherwise resolve stale output.
7. The first real verification exposed JSONB parameter inference in Reflection Outbox SQL and the E2E
   then exposed a missing `experience_reflection` Management API stage enum. Explicit SQL casts and a
   new HTTP contract regression closed both without changing the Domain or weakening assertions.

## Architecture, Privacy and Authority

G09 adds no Agent, Workflow runtime, Memory authority or Python sidecar. Reflection and Delta records
are immutable evidence, Candidate records cannot enter formal planning, and Active state is rejected
by Domain/Application validation. The model sees bounded source evidence, emits schema-constrained
data and never writes authoritative state. Private reasoning is neither requested nor persisted.

## Migration and Source Intake

0117 is additive to the byte-stable v1.2.2 baseline and guarded against rollback with Reflection data;
its real migration path passes. The implementation is
original repository TypeScript. ACE, AutoSkill and LangMem remain exact-commit concept references;
no source was copied or translated, and no dependency, lockfile, license ledger, NOTICE or SBOM change
is required.

## Commit, Push and Draft PR

- Implementation commit: `c8754fdddf9173dcc4f29609d548cade0b3bcc81`
- Push: present at `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Worktree hygiene: clean before the current verified bug-fix/evidence changes
- Merge/tag: not performed and not authorized

## Provisional G10/G11 Handoff

G10 and G11 build on committed, pushed and verified immutable Reflection, Candidate identity/evidence,
generic Delta and candidate lineage. Candidate remains excluded from formal planning until G12
promotion; downstream work is no longer provisional on G09.
