# G15 Goal Completion Report

## Summary

G15 completes the operational Management API, Console and A2A integration over the existing
v1.2.3 cognitive authority chain. `CognitiveManagementController` applies optional authentication
and one durable action gate to every cognitive write. `InteractiveActionRouter.route` resumes the
current Planning Session before Goal clarification using the exact observed version, while
`A2AInteractionProjection.toInputRequired` exposes only routing metadata at the standard
`INPUT_REQUIRED` boundary.

The default deployment remains the authoritative V1 trusted-intranet/no-auth mode. ADR-115 adds an
optional deployment bearer token without claiming that a request-supplied actor is authenticated in
default mode. Migration 0123 persists audit/idempotency claims but is not business authority:
Session, Knowledge, Capability and Experience tables continue to own their state.

## Goal Contract Result

```text
completed
```

Implementation commit `d77794a2620362bc4f59f2021283d61a164b5139` is complete. Draft PR #9
must remain Draft until G17.

## Implementation

- `CognitiveManagementController` requires actor, displayable reason, expected version and
  idempotency key for Goal/Planning actions, Knowledge lifecycle changes, Capability rebuilds and
  Experience dead-letter replay.
- `TrustedIntranetCognitiveManagementAuthorizer` preserves V1 behavior.
  `BearerCognitiveManagementAuthorizer` is enabled only by
  `SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN`, compares SHA-256 digests in constant time and authenticates
  before any audit claim or business mutation.
- `CognitiveManagementActionGate` claims a durable request before invocation. Exact completed retries
  return the stored display result, changed-key reuse conflicts, and pending/failed claims never
  replay automatically after restart. Recursive private-reasoning fields are rejected.
- Migration `0123_v123_cognitive_management_audit` adds only the constrained action-audit table. Its
  rollback refuses to discard records.
- Summary/Card rebuilds compare the supplied version against the active revision in Application and
  again under the repository advisory lock. Version 0 means no active snapshot. An unreplayed
  dead letter has version 0 and the existing repository lock preserves one-shot replay.
- Management reads now include exact Summary/Card snapshots, exact Episodes, Planning Heuristics and
  cognitive action audit in addition to the existing Understanding, Session, Experience and governed
  Knowledge APIs.
- The Task Console retains real Understanding, Goal Contract diff and Plan DAG/validation review.
  Cognitive Governance adds real Experience, Knowledge, Task Type, Capability Pattern and audit
  inventory plus governed Knowledge actions and dead-letter replay. Capability rebuilds use the same
  strict write envelope.
- No Console route can directly mutate Provider state, final Outcome or the active execution Plan.
- A2A public metadata contains only kind, session identity/type, expected version, question identity
  when applicable and allowed actions. Candidate Contract/Plan, Understanding internals, Provider
  facts and Outcome evidence remain on trusted Management reads.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G15-01 | verified | bearer-before-mutation controller contract; durable claim/retry/conflict/private-reasoning unit and real PostgreSQL evidence |
| AC-G15-02 | verified | operational Task and Cognitive Governance Console SSR contract, production build and 152-operation real API schema |
| AC-G15-03 | verified | router unit plus unchanged real A2A input-required → answer/confirm/patch continuation E2E |
| AC-G15-04 | verified | route review, architecture gate and v1.2.2 terminal-authority E2E; no Provider/Outcome/Active Plan mutation |
| AC-G15-05 | verified | strict OpenAPI request schemas and Management contracts; exact-ID, Heuristic and audit reads |
| AC-G15-06 | verified | minimal A2A projection unit and Public Card privacy regressions exclude internal Candidate/Understanding data |

## Validation

| Command / gate | Result | Duration/evidence |
| --- | ---: | --- |
| test-first router/projection suite | failed as expected, then passed | required classes were absent; original assertions retained |
| focused G15 regression | 102/102 | 7 files, 1.74 s in final permitted localhost run |
| `pnpm test:unit` | 597/597 | 103 files, 8.38 s |
| `pnpm test:contract` | 157/157 | 19 files, 2.65 s |
| real PostgreSQL/Redis integration | 84/84 | 8 files, 15.25 s; retrieval P95 2.902 ms ≤ 500 ms |
| real Server/PostgreSQL/Redis/A2A E2E | 62/62 | 2 files, 33.36 s |
| `pnpm verify:migrations` | passed | 16 additive migrations; fresh/idempotent/rollback/reapply/reset/rogue-ledger gates |
| Prettier / ESLint / strict TypeScript | passed | zero final errors |
| `pnpm verify:architecture` | passed | 419 TypeScript sources; 19 Domain and 60 Application cognitive files; no Python runtime |
| A2A baseline | MUST 74/74 | frozen official TCK report at commit `5996b79f9cefa6fc390980e383e358a66fb9e49e` |
| Management OpenAPI | 152/152 | operation/schema drift verifier |
| sources / protocol / licenses / SBOM | passed | 27 locked sources, frozen protocol, 286 npm packages and 2 services |
| production build | passed | strict server build plus Console Vite production bundle |
| isolated Server/Console smoke | passed | Agent Card, Console bundle and trusted-intranet warning; disposable database removed |

The complete `pnpm verify` remains deliberately reserved for G17 as required by the Goal package.

## Failed Attempts and Root Cause

1. Test-first router/projection tests failed because `InteractiveActionRouter` and
   `A2AInteractionProjection` did not yet exist. The same tests pass against the product path.
2. The first E2E run after strict write schemas failed two Capability rebuild requests that still sent
   empty bodies. The tests now supply the frozen actor/reason/version/idempotency envelope.
3. Local sandbox runs of HTTP contract and business-event fixtures failed with
   `listen EPERM 127.0.0.1`; identical permitted-localhost runs passed 157/157 contract and 597/597
   unit tests. No product assertion was weakened.
4. A broad `_VERSION_CONFLICT → 409` mapping changed the frozen Skill Import conflict from 400. The
   mapping is now restricted to the three new cognitive CAS errors, and the full contract passes.
5. `pnpm verify:migration-path` was an incorrect script name. The documented
   `pnpm verify:migrations` command passed after a sandbox loopback denial was rerun with local
   PostgreSQL access.
6. Prettier initially identified four changed UI/A2A files; `pnpm format` corrected them and the final
   format check passes.
7. The first production Console build found that `cognitive-governance` was omitted from the narrowed
   generic Lookup exclusion, making its config possibly undefined. The route union now reflects the
   dedicated panel, and build/lint/typecheck pass.
8. Final review found Capability/dead-letter envelopes recorded `expectedVersion` without enforcing
   it. Application plus locked repository CAS and a stale-dead-letter 409 regression close the gap.
9. The first disposable-smoke database helper lost a `$1` placeholder to shell expansion and made no
   database change. A literal exact-name check created only `sdar_v123_g15_smoke`; smoke passed and
   that database was removed.

## Architecture, Authority and Source Intake

The architecture guardian confirms one TypeScript modular monolith and the sole LangGraph workflow
runtime. G15 adds no model stage, Domain event, workflow runtime or core authority table. The
management audit is evidence only; public A2A and Console projections cannot commit formal state
outside existing Application services.

All implementation is original repository TypeScript using existing locked dependencies. No source
was copied or translated, no product dependency was added, and no Source Intake, lockfile, license,
NOTICE or SBOM update is required.

## Commit, Push and Draft PR

- Primary G15 implementation: `d77794a2620362bc4f59f2021283d61a164b5139`
- Evidence commit: `9d66eab`
- Push: implementation and evidence are published to
  `origin/feature/v1.2.3-cognitive-planning-runtime`
- Draft PR: <https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9> remains Draft
- Merge/tag/Ready transition: not performed and not authorized before G17

## G16 Handoff

G16 receives the read-only shadow hashes, governed Knowledge usage lineage, immutable accepted
Contract/Plan/corrections/Outcome evidence and complete operational audit. Its Replay Dataset,
Baseline/Champion/Candidate comparison, metrics and Promotion provenance must remain side-effect-free,
must use `NoPhysicalProvider`, must split `mutate_dev` from `promotion_test`, and must not write
production Active Knowledge or formal planning state.
