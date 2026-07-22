# G01 Goal Completion Report

## Summary

G01 implements the deterministic Runtime Capability Summary Builder on the frozen G00 contracts. Exact
enabled Skill versions are canonicalized without model calls, aggregated into declared Capability
details and limitations, activated idempotently in PostgreSQL, rebuilt from Skill catalog events and
served through the real Management API. Live Provider/device readiness is deliberately absent.

## Goal Contract Result

```text
completed locally; publication evidence pending the immutable implementation commit
```

## Implementation

- `CapabilityCatalogSnapshotBuilder` produces canonical JSON and an order-independent SHA-256 catalog
  hash from the complete exact Skill declaration.
- `CapabilitySummaryBuilder` aggregates Capability, Domain, Effect, Evidence, Artifact, Context, Mode,
  Task Type and Composition plus structured missing-Outcome/internal/confirmation/non-composable/empty
  catalog limitations.
- `CapabilityIndexBuilder` provides bounded Level-0 entries and Level-1 detail lookup; exact Skill
  version references remain the Level-2 handoff to the existing Skill Selection authority.
- `CapabilitySummaryService` rejects stale Hash/Policy snapshots, caches active matches and rebuilds
  deterministically. The catalog projector acknowledges change events only after a successful rebuild.
- migration 0109 and `PostgresCapabilitySummaryRepository` provide transactional idempotency, one active
  pointer, CAS, restart-safe reads and `capability.summary_built` outbox evidence.
- Skill repository writes emit `skill.catalog_changed` in the same transaction. Server composition
  performs startup rebuild and bounded retry projection.
- Management API and OpenAPI expose `GET /api/v1/capabilities/summary` and
  `POST /api/v1/capabilities/rebuild`.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G01-01 | verified | canonical snapshot/property/permutation and exact declaration Hash tests |
| AC-G01-02 | verified | aggregation/limitation unit tests and Provider/readiness exclusion assertion |
| AC-G01-03 | verified | migration 0109 plus real PostgreSQL concurrent same-Hash activation test |
| AC-G01-04 | verified | transactional catalog event, projector unit and real enable/disable E2E |
| AC-G01-05 | verified | bounded Index/Detail, stale-hash and cached P95 below 50 ms tests |
| AC-G01-06 | verified | API contract/OpenAPI, full affected gates and production build |

## Validation

| Command / gate | Result | Duration |
| --- | ---: | ---: |
| `npm run format:check`; `npm run lint`; `npm run typecheck` | passed | 49.0 s combined |
| `npm run test:unit` | 501/501 | 7.76 s Vitest |
| `npm run test:contract` | 144/144 | 3.87 s Vitest |
| `node scripts/verify-migration-path.mjs` | 0108/0109 fresh, idempotent, rollback/reapply, rogue-ledger rejection | 15.2 s |
| `node scripts/test-integration.mjs` | 70/70 real PostgreSQL/Redis | 22.1 s command; 12.38 s Vitest |
| `node scripts/test-e2e.mjs` unchanged rerun | 60/60 real Server/PostgreSQL/Redis | 34.1 s |
| `node scripts/check-management-openapi.mjs` | 126 operations | passed |
| `tsc -p tsconfig.build.json`; Console `vite build` | passed | 11.4 s + 3.6 s |
| isolated `pnpm verify` after poll-fix | all six stages passed | 166,839 ms |

Focused evidence includes 14 Domain/Application unit tests, 45 Management API contract tests, the
cognitive JSON Schema contract and real Repository/HTTP paths. The final full gate additionally proves
313-source architecture, A2A MUST 74/74, 27 exact source pins, protocol/package/license/SBOM checks,
production build and both infrastructure and Server/Console smoke stages.

## Failed Attempts and Root Cause

1. The required test-first run failed 5/5 with `CapabilitySummaryBuilder is not a constructor` before
   implementation existed. The tests were retained and now pass.
2. A formatting command through `pnpm exec` triggered pnpm's non-TTY metadata/install check and a
   blocked registry read. Existing pinned local binaries were used; no dependency changed.
3. The first affected E2E run failed the pre-existing remote-task lifecycle timing assertion with an
   empty collection; the new Capability Summary case passed and the unchanged rerun passed 60/60. The
   first complete gate reproduced the same failure. Root cause was the test polling Schema accepting an
   empty `items` array and exiting before its later length assertion. The Schema was strengthened to
   require exactly one lifecycle record before polling stops; independent E2E and the complete gate then
   passed 60/60 without weakening the product assertion.

## Architecture and Authority Review

LangGraph remains the only workflow runtime. PostgreSQL is the durable Summary/outbox authority; Redis
has no Summary state. G01 reuses `SkillRepository`, `SkillVersion`, Usage and Outcome contracts and adds
no parallel Skill/Agent/Workflow/Memory authority. Model output cannot write the Summary. Candidate
knowledge, private experience and current Provider readiness are not inputs.

## Migration / Restart / Concurrency Semantics

The idempotency key is `(catalog_hash, generation_policy_version)`. A PostgreSQL transaction-scoped
advisory lock serializes activation; a same-key contender returns the already activated row, while a
different stale CAS fails. Summary items, limitations, active pointer and built event commit together.
The active snapshot is reloadable after process restart and catalog events remain pending until rebuild
succeeds. Down migration refuses non-empty unreleased Summary data.

## Source Intake

G01 applies the already approved progressive-disclosure design idea but copies no external source and
adds no dependency. No new Source Intake Report, license ledger entry or SBOM component is required.

## Commit, Push and Draft PR

- Implementation commit: pending immutable commit creation
- Push: pending
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR must remain Draft; no merge or tag is authorized

The disposable `sdar_test_v123_g01_gate` database used by the final full gate was deleted after the
successful run. The default operator `sdar` database was not reset or modified.

## Next Goal Handoff

G02 must consume only the activated Hash-matched Summary, apply the explicit public allowlist/privacy
filter and project the public Capability Card/A2A surface. It must not rebuild from live Provider state
or expose internal limitations/source metadata.
