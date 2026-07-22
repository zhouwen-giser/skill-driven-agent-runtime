# G03 Goal Completion Report

## Summary

G03 adds bounded Generic Task Understanding in front of the existing v1.2.2 Goal path only for
ambiguous requests. Explicit requests retain the prior path. Ambiguous requests are interpreted through
the existing audited Model Runtime, validated by a strict Zod/JSON Schema boundary, deterministically
checked for missing dimensions and capability availability, and saved as immutable PostgreSQL
revisions before any Goal or plan is created. High-risk authorization cannot be supplied by an
assumption, prompt-injected text remains an untrusted data field, and blocking gaps stop at the existing
A2A `INPUT_REQUIRED` boundary.

## Goal Contract Result

```text
completed
```

## Implementation

- `CognitiveEntryRouter` conservatively separates concrete requests from underspecified generic tasks.
  Explicit requests do not invoke Task Understanding.
- `GenericTaskUnderstandingService` consumes the active G01 Capability Summary, a deployment-owned
  static Task Type index and optional low-risk preferences. It produces Task Type candidates,
  capability requirements, constraints, known/missing dimensions and bounded assumptions.
- Model output is strict structured data with at most two Application attempts. The instruction is JSON
  with `policy` separated from `untrustedUserRequest` and untrusted conversation fields.
- The deterministic safety layer removes authorization/confirmation assumptions, classifies blocking,
  conditional and non-blocking dimensions, verifies Task Type references and public capability
  availability, and assigns one of the frozen G00 dispositions:
  `clarification_required`, `confirmation_required`, `contract_candidate` or `rejected`.
- `ModelRuntimeService.generateStructuredWithAudit` returns the identity of the already-persisted model
  invocation; the Understanding row carries that foreign key plus policy version, state hash and source
  refs. No private model reasoning is stored.
- migration 0111 extends the existing skeleton and `stage_model_route` without changing the byte-stable
  v1.2.2 baseline. `PostgresTaskUnderstandingRepository` uses an advisory transaction lock, expected
  revision CAS, state-hash idempotency, dimension rows and atomic `task.understanding_created` outbox.
- Server composition is deployment-opt-in through Task Type fixtures. Ambiguous Task preparation saves
  Understanding before requesting input; rejected capability requirements fail closed. Goal, Skill,
  Outcome, Recovery and terminal authorities remain unchanged.
- Management API/OpenAPI expose current and revision-history reads. The Task Console loads both as
  evidence alongside model invocations.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G03-01 | verified | router/service unit and real A2A ambiguous-request E2E enter persisted Understanding |
| AC-G03-02 | verified | explicit concrete router/unit path bypasses unnecessary Understanding and retains existing Goal path |
| AC-G03-03 | verified | 12 dimension kinds, three severities, JSON Schema golden fixture and deterministic classification unit |
| AC-G03-04 | verified | high-risk side-effect authorization assumption is removed and disposition is `confirmation_required` |
| AC-G03-05 | verified | strict Zod output, bounded two-attempt test, revision/CAS integration, source/policy/model/hash persistence |
| AC-G03-06 | verified | prompt-injection unit plus real E2E keep injected text only in the untrusted request field |

## Validation

| Command / gate | Result | Duration |
| --- | ---: | ---: |
| `npm run format:check` | passed | 10.9 s final run |
| local ESLint + strict TypeScript | passed | included in 64.7 s affected static/unit/build run |
| `vitest run --project unit --project contract` | 663/663 | 9.82 s test duration |
| Task Understanding focused unit | 4/4 | 0.998 s |
| Management API focused contract | 47/47 | 1.57 s |
| cognitive JSON Schema contract | 1/1 | 3.73 s command |
| `node scripts/check-architecture.mjs` | 323 TypeScript sources; no reverse dependency or Python runtime | passed |
| `node scripts/check-management-openapi.mjs` | 130 operations | passed |
| `node scripts/verify-migration-path.mjs` | 0108-0111 fresh/idempotent/rollback/reapply/rogue rejection | 14.4 s |
| `node scripts/test-integration.mjs` | 72/72 real PostgreSQL/Redis | 21.2 s command |
| `node scripts/test-e2e.mjs` final rerun | 62/62 real Server/PostgreSQL/Redis/A2A | 38.4 s command |
| production TypeScript + Console Vite build | passed | 16.5 s affected build |

The G03 minimum affected gates are green. The G17-only clean-checkout `pnpm verify`, A2A MUST TCK,
release smoke, replay/shadow, security/capacity and exact-publication audit have not been claimed here.

## Failed Attempts and Root Cause

1. The retained test-first run failed 3/3 because `CognitiveEntryRouter` and
   `GenericTaskUnderstandingService` did not exist. The same tests now pass.
2. The first local `pnpm exec` attempt entered pnpm's non-TTY dependency-state check and then hit the
   sandboxed registry. Existing locked local binaries were used; dependencies and lockfile were not
   changed.
3. The first final E2E run passed all product behavior but reported 1/62 failed because the test
   expected an absent JSON property as `goalId: undefined`. The assertion now independently verifies
   `phase=awaiting_user_input` and absence of `goalId`; the full unchanged product suite passes 62/62.
4. One initial lint pass found an unnecessary fallback on the required Summary revision. The test
   fixture was made truthful and the fallback removed; final lint is green.

## Architecture and Safety Review

G03 adds no Agent, Workflow, Memory, Skill authority, Python sidecar or runtime dependency. LangGraph.js
remains the only workflow runtime. Task Types are deployment-owned recognition aids and cannot replace
the original request. Model output is a candidate validated and normalized by deterministic
Application code; it cannot directly write Goal state. PostgreSQL is the sole Understanding/outbox
authority, while Redis continues to hold only reconstructable task dispatch references.

The G00 four-state disposition contract governs. The design document's descriptive
`ready_for_contract` maps to `contract_candidate`; an unavailable required capability maps to the
frozen `rejected` state with the missing requirement retained, rather than introducing alternate
terminal meanings.

## Migration / Restart / Concurrency Semantics

Migration 0111 refuses non-empty unreleased Understanding data, adds the model invocation foreign key,
extends the complete dimension check and adds the existing Model Runtime stage. Down migration refuses
Understanding rows or a configured Task Understanding route. Each save serializes by Task, checks the
expected current revision, treats an existing `(task_id,state_hash)` as idempotent, inserts dimensions
and outbox atomically, and reloads strictly validated JSON after restart.

## Source Intake

The implementation is original repository code using the already-approved Zod, PostgreSQL and Model
Runtime boundaries. It copies or translates no Claude Code or LangMem source, adds no dependency and
requires no new Source Intake, license ledger or SBOM component.

## Commit, Push and Draft PR

- Implementation commit: `05b4df45e6f3ce3fe84ccb0418e2e8cf32190f60`
- Push: `origin/feature/v1.2.3-cognitive-planning-runtime` includes the implementation commit
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/8>
- PR remains Draft; no merge or tag is authorized
- Evidence synchronization is published as a subsequent non-amended commit

All migration/integration/E2E databases were isolated and removed by their harnesses. The default
operator `sdar` database was not reset or modified. PostgreSQL/Redis containers were stopped without
deleting operator volumes.

## Next Goal Handoff

G04 should reuse `TaskUnderstandingRepository` revisions and the existing `goal_deliberation` input
boundary to build a CAS/idempotency-backed interactive Goal session. A clarification answer must create
a new Understanding/candidate revision; it must not mutate the original snapshot or hand an
unconfirmed candidate to the v1.2.2 Goal authority.
