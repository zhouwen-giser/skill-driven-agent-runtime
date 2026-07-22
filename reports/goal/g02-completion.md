# G02 Goal Completion Report

## Summary

G02 publishes a PostgreSQL-authoritative Public Capability Card from the activated, exact-hash G01
Summary. A strict allowlist removes internal/runtime/private data, deterministic narrative remains
available when the optional display-only model stage fails, enabled public Skills are projected into
A2A, and Agent Card requests read only the activated snapshot. Management API, OpenAPI and the React
Console expose the same durable record without creating a second capability authority.

## Goal Contract Result

```text
completed
```

## Implementation

- `PublicCapabilityProjectionPolicy` admits only public identity, domain, description, declared
  effects/evidence/artifacts/modes/task types and two stable public limitation codes. Context,
  composition, exact internal references, Tool/Provider/credential/Workflow data, readiness, user data,
  private Experience, failure statistics and live resources are excluded.
- `CapabilityCardPublisher` recomputes the exact enabled-Skill catalog Hash, consumes only the matching
  active Summary, generates a stable deterministic description and treats the strict
  `capability_narrative` result as display text only. Failure, malformed/prohibited output and model
  absence use deterministic fallback.
- migration 0110 and `PostgresCapabilityCardRepository` provide the unique
  `(catalog_hash,generation_policy_version)` key, active pointer, Summary binding, advisory lock, CAS,
  restart-safe reads and transactional `capability.card_published` outbox evidence.
- Skill catalog mutations await the serialized Summary-to-Card projection attempt. Hash races retry;
  infrastructure failures remain durable pending events and A2A fails closed instead of serving a stale
  Card.
- `A2AAgentCardBuilder` retains enabled public Skill id/name/description/tags/media modes and adds the
  optional `io.sdar/capabilityProfile` extension. Request-time Card reads do not invoke a model.
- Management API/OpenAPI expose `GET /api/v1/capabilities/card` and
  `POST /api/v1/capabilities/card/rebuild`; the operational Console reads and rebuilds the real snapshot.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G02-01 | verified | allowlist/privacy unit plus public/internal Skill real E2E |
| AC-G02-02 | verified | model success, unavailable and prohibited-output deterministic fallback unit tests |
| AC-G02-03 | verified | 0110 migration and real PostgreSQL idempotency/concurrency/Summary-binding integration |
| AC-G02-04 | verified | A2A snapshot builder contract, extension and public Skill E2E |
| AC-G02-05 | verified | snapshot-only endpoint, failed-ack retry unit, transactional outbox and 61/61 E2E |
| AC-G02-06 | verified | 128-operation OpenAPI, Console contract/build, A2A MUST 74/74 and unified gate |

## Validation

| Command / gate | Result | Duration |
| --- | ---: | ---: |
| local Prettier/Lint/typecheck | passed | final unified static stage included below |
| `vitest run --project unit` | 510/510 | 16.65 s affected full run |
| `vitest run --project contract` unchanged rerun | 146/146 | 4.44 s |
| `node scripts/verify-migration-path.mjs` | 0108/0109/0110 fresh, idempotent, rollback/reapply, rogue-ledger rejection | 14.1 s affected run |
| `node scripts/test-integration.mjs` | 71/71 real PostgreSQL/Redis | 23.7 s affected command |
| `node scripts/test-e2e.mjs` consistency-fix rerun | 61/61 real Server/PostgreSQL/Redis | 47.3 s |
| `node scripts/check-management-openapi.mjs` | 128 operations | passed |
| Console local `tsc -b` + `vite build` | passed | 3.2 s |
| locked A2A HTTP-JSON MUST TCK | 74/74 applicable, 161 skipped, zero failures | 39.98 s pytest |
| isolated `pnpm verify` on `2ec8987` | all six stages passed | 159,967 ms |

The unified gate proves 656 unit+contract tests, 71 integration tests, 61 E2E tests, 318 TypeScript
architecture sources, A2A MUST 74/74, 128 OpenAPI operations, 27 exact source pins, protocol/package,
license/SBOM, migration, production build, infrastructure smoke and Server/Console smoke. Its report
honestly records a dirty working tree because the just-generated locked TCK evidence files were present;
all product implementation files matched commit `2ec8987117e112eeb50e0d5fac7ecca612301358`.

## Failed Attempts and Root Cause

1. The test-first run failed 3/3 because `PublicCapabilityProjectionPolicy` and
   `CapabilityCardPublisher` did not exist. The retained tests now pass.
2. `pnpm exec prettier` twice entered pnpm's non-TTY dependency-state check and attempted a blocked
   registry metadata read. Existing pinned local binaries were used; no dependency or lockfile changed.
3. The first G02 E2E run passed 54/61. Skill writes returned before the 250 ms projector ran, while the
   new Card read correctly rejected the now hash-mismatched old snapshot. The mutation boundary now
   awaits the serialized durable projection attempt, `afterRebuild` publishes the exact rebuilt view and
   transient catalog races retry. The unchanged suite then passed 61/61.
4. The first full contract run had one unrelated Frozen MCP notification timing result (`expected 0`,
   `actual 1`). No assertion or product path changed; the unchanged rerun passed 146/146 and the unified
   gate passed all 656 unit+contract tests.
5. The standalone TCK initially stopped before tests because both the reusable temporary `uv-venv` pip
   launcher and cached TCK Git metadata were corrupt. The two damaged temporary directories were moved,
   the official TCK was cloned again and checked out at frozen commit `5996b79...`, and MUST passed 74/74.
   The temporary damaged backups were then deleted.

## Architecture and Privacy Review

LangGraph remains the sole workflow runtime. G02 adds no Agent, Skill, Workflow, Memory or Python
runtime. PostgreSQL is the Card/outbox authority; Redis holds no Card state. The existing Skill Usage
visibility and G01 Summary remain the only inputs. The model can supply display text only and cannot
alter profile facts, Skills, hashes, status or active pointers. A2A, API and Console are projections.

## Migration / Restart / Concurrency Semantics

The Card key is `(catalog_hash,generation_policy_version)`. A transaction-scoped advisory lock validates
the exact active Summary, serializes activation, enforces expected revision, supersedes the old pointer
and writes the outbox event atomically. Same-key activation returns the existing row. A restart reloads
the active hash/policy-bound snapshot. Failed dependent publication leaves `skill.catalog_changed`
pending. Down migration refuses non-empty unreleased Card data.

## Source Intake

G02 adapts only the repository's existing A2A Agent Card builder and official SDK boundary. It copies no
external source, adds no dependency and requires no new Source Intake, license ledger or SBOM component.

## Commit, Push and Draft PR

- Implementation commit: `2ec8987117e112eeb50e0d5fac7ecca612301358`
- Push: `origin/feature/v1.2.3-cognitive-planning-runtime` matches the implementation SHA
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR remains Draft; no merge or tag is authorized
- Evidence synchronization is published as a subsequent non-amended commit

The disposable `sdar_test_v123_g02_gate` database was deleted after the successful unified gate. The
default operator `sdar` database was not reset or modified. PostgreSQL/Redis containers were stopped
without deleting their volumes.

## Next Goal Handoff

G03 may consume G01's declared Capability Summary for bounded task understanding, but it must not use
the Public Card as planning authority. Preserve the G02 allowlist, snapshot-only A2A path and existing
v1.2.2 Goal/Skill/Outcome/Recovery authorities.
