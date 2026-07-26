# EP-SDAR-V1.3-P01 — Runtime Artifact Domain Contract

Status: IN PROGRESS

Branch: `feature/v1.3-sequential-implementation`

Baseline: P00 `BaselineGateResult` is `READY_FULL`; accepted v1.2.3 baseline commit
`856f909d22c33e6e20d7e0a1cffc2f54c03b4477`.

## Purpose / Outcome

Implement P01/G01 as one atomic, domain-only increment. The observable result is a typed and
immutable Runtime Artifact aggregate with five frozen definition variants, deterministic condition
data, bounded applicability and dependency snapshots, an audited lifecycle transition function,
lineage and rebuildable runtime-binding records, Zod and JSON Schema validation, golden fixtures,
and an architecture check that prevents execution/runtime dependencies from entering the Artifact
Domain.

P01 does not persist, activate, execute, retrieve, or expose artifacts. Those concerns remain for
later packages.

## Requirements Covered

- P01 package V1.1, G01, and its Acceptance, Domain Contract, Frozen Interface Contract,
  Implementation, Test Plan, Evidence, and Handoff requirements.
- Frozen interfaces `CompiledArtifactType`, `CompiledArtifactStatus`, `CompiledArtifact`,
  `ArtifactApplicability`, `ArtifactDependencySnapshot`, `ConditionExpression`,
  `IntentRouteArtifactDefinition`, `PlanTemplateArtifactDefinition`, `SkillGoalNodeTemplate`,
  `DecisionRuleArtifactDefinition`, `DecisionOutput`, `CaseArtifactDefinition`,
  `ModelRouteArtifactDefinition`, `ArtifactLineage`, and `ArtifactRuntimeBinding`, all at version
  `1.1` and their registry-pinned schema hashes.
- Architecture invariants in `AGENTS.md`, `docs/02_ARCHITECTURE_BASELINE.md`, and accepted ADRs,
  especially ADR-001, ADR-002, ADR-004, ADR-007, ADR-020, and ADR-068.

## Context and Orientation

- `packages/domain/src/compiler/` will own the Artifact contracts, pure factories, deterministic
  canonicalization, lifecycle rules, and typed errors.
- `packages/schemas/src/artifact.ts` will own Zod validation. Zod is already pinned by the repository;
  no dependency is added.
- `schemas/v1.3/artifact-domain.schema.json` and its fixture will provide the portable JSON Schema
  contract; `packages/json-schema-adapter` remains the only AJV boundary.
- `scripts/check-artifact-architecture.mjs` will enforce the P01 dependency direction and will be
  invoked by the existing architecture gate.
- PostgreSQL, application orchestration, registry/active-pointer mutation, API, Console, LangGraph,
  MCP, A2A, Provider, queue, and Skill execution are outside P01.

## Architecture and Interfaces

| Concern                                                                          | Authoritative owner                          | Explicitly not authoritative          |
| -------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Artifact type, definition, applicability, dependency snapshot, status vocabulary | Domain                                       | schema adapter, database, runtime, UI |
| Artifact lifecycle transition legality                                           | Domain                                       | repository, HTTP handler, worker      |
| Zod/JSON Schema structural validation                                            | Schema boundary                              | durable state and lifecycle authority |
| Artifact lineage                                                                 | Domain data referenced by Artifact           | runtime binding, generated payload    |
| Runtime binding                                                                  | Rebuildable projection contract              | Artifact definition or active pointer |
| Execution                                                                        | Existing LangGraph runtime in later packages | Artifact Domain                       |

The top-level frozen fields are implemented without renaming. Nested types not assigned a separate
frozen interface are bounded pure-data contracts documented in ADR-116. `definition` is a
type-discriminated union validated against `artifactType`; it cannot contain functions, classes,
SDK objects, or arbitrary executable code.

Lifecycle objects are immutable snapshots. A transition creates a new snapshot and requires
validation and approval evidence before `active`; P01 does not write an active pointer.

## Progress

- [x] 2026-07-26 P01 package self-check passed for 21 files and frozen registry hash
      `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
- [x] 2026-07-26 Verified P00 handoff fields/version/schema hash, baseline ancestry, origin baseline,
      migration head 0124, and zero baseline blockers.
- [x] 2026-07-26 Defined P01 authority boundaries and nested-contract decisions in ADR-116.
- [x] 2026-07-26 Implemented domain contracts, factories, canonicalization, and lifecycle transitions.
- [x] 2026-07-26 Implemented Zod/JSON Schema contracts and five-definition golden fixture.
- [x] 2026-07-26 Added unit, contract, and architecture regression tests.
- [x] 2026-07-26 Passed focused validation and the complete working-tree `pnpm verify` gate: 775
      unit/contract, 84 integration, 62 E2E, build and smoke.
- [x] 2026-07-26 First independent read-only review rejected readiness: two blocking and two major
      findings identified downstream PlanTemplate incompatibility, Domain/Zod/AJV drift, direct
      activation bypass and missing nested enum guards.
- [x] 2026-07-26 Closed the implementation findings by aligning the exact shared-design/P04 nested
      shapes, adding AJV recursive-bound keywords, enforcing direct activation evidence and nested
      enums, and expanding lifecycle/cross-validator regressions to 20/20 focused tests.
- [x] 2026-07-26 Post-remediation complete working-tree gate passed: 785 unit/contract, 84
      integration, 62 E2E, architecture, A2A, OpenAPI, Replay, migrations, build and both smokes.
- [x] 2026-07-26 New independent read-only re-review accepted the remediated tree with zero
      blocking/major findings; its one documentation-only minor finding is closed below.
- [ ] Commit, run the clean-commit full gate, finalize Handoff/status, and push Draft PR #12.

## Discoveries and Surprises

- 2026-07-26: The repository has no existing `packages/schemas` workspace package, but the root
  workspace includes `packages/*` source directly and already pins Zod. A source-only schema module
  can therefore be added without changing dependency resolution or adding a package manifest.
- 2026-07-26: The frozen registry fixes the top-level fields and enum values but intentionally leaves
  several nested shapes to the design compendium. ADR-116 records the smallest bounded pure-data
  interpretation so active definitions never depend on unconstrained `unknown`.
- 2026-07-26: P01's lifecycle sentence is a lifecycle spine rather than a single mandatory path for
  every terminal state. The accepted transition table preserves the spine and permits reviewed
  rejection/archival from the states where those outcomes are meaningful.
- 2026-07-26: The first full bootstrap found 25 strict lint findings in new files; resolving them
  strengthened runtime-unknown validation and introduced no `any`, skip, assertion weakening or
  schema relaxation.
- 2026-07-26: The inherited process environment temporarily overrode the repository's healthy
  PostgreSQL port with an expired port, and the operator database intentionally retains the historical
  migration ledger. The passing gate explicitly used the existing clean-baseline isolation database;
  no operator data was reset.
- 2026-07-26: Independent review compared P01 with its authoritative downstream P04 consumer and
  found that the first nested PlanTemplate interpretation was structurally incompatible despite
  matching the frozen top-level hash. The nested contracts now follow the shared design compendium
  and P04 consumer verbatim where specified.
- 2026-07-26: Standard recursive JSON Schema cannot express whole-tree and Plan graph semantic
  bounds. The existing isolated AJV adapter now owns five strict SDAR keywords; negative tests prove
  Domain, Zod, and AJV agree on depth, condition complexity, uniqueness, graph/cross-reference,
  boolean and applicability boundaries.

## Decision Log

- 2026-07-26: Use `packages/domain/src/compiler/` as the domain location because the P01
  implementation design names it and it avoids creating a second artifact authority.
- 2026-07-26: Keep Zod outside Domain and AJV in the existing JSON Schema adapter boundary.
- 2026-07-26: Treat `ArtifactRuntimeBinding` as immutable, rebuildable projection data; it does not
  prove activation and cannot mutate an Artifact.
- 2026-07-26: Enforce bounded JSON values (depth, object members, array members, string length) in
  factories and schemas instead of accepting `Record<string, unknown>` in active content.
- 2026-07-26: Add no persistence, active pointer, Skill call, MCP call, workflow execution, API, or UI
  code in P01.
- 2026-07-26: Treat the first independent review as a rejected readiness decision and require a new
  independent re-review after remediation; do not reuse or overwrite the rejected evidence.

## Implementation Steps

1. Add `contracts.ts`, `errors.ts`, `validation.ts`, `factory.ts`, `lifecycle.ts`, and `index.ts`
   under `packages/domain/src/compiler/`, then export the module from Domain.
2. Implement the five definition variants and all frozen companion interfaces with exact top-level
   fields and pinned interface metadata.
3. Implement bounded recursive condition/JSON validation, domain factories, deep immutability,
   artifact-type/definition matching, canonical serialization, and status transition guards.
4. Add Zod schemas under `packages/schemas/src/`, the draft-2020-12 JSON Schema and golden fixture
   under `schemas/v1.3/`.
5. Add Domain unit tests, Zod/AJV contract tests, and the artifact architecture check.
6. Run formatting, lint, typecheck, focused tests, architecture checks, then full verification.
7. Publish reproducible evidence and the exact standard handoff; request independent review before
   completing the atomic P01 commit.

## Validation

Focused gates:

```text
pnpm exec vitest run packages/domain/test/artifact-domain.unit.test.ts
pnpm exec vitest run packages/json-schema-adapter/test/artifact-domain-schema.contract.test.ts
node scripts/check-artifact-architecture.mjs
pnpm typecheck
```

Package and repository gates:

```text
pnpm format:check
pnpm lint
pnpm test:unit
pnpm test:contract
SDAR_REUSE_EXISTING_INFRA=true pnpm verify
```

Expected evidence: all five definitions accepted in the golden fixture; unknown properties,
definition/type mismatches, invalid conditions, invalid lifecycle transitions, active transitions
without validation/approval, unbounded JSON, and prohibited imports are rejected.

## Idempotence and Recovery

Factories and validators are side-effect free and safe to rerun. P01 creates no migration or
external state. A failed validation leaves only ordinary working-tree edits; restore by fixing the
specific failing increment, not by resetting user work. Generated evidence is derived from commands
and may be regenerated. No clean-up may target repository-wide or unresolved paths.

## Artifacts and Evidence

- `adr/ADR-116-runtime-artifact-domain-authority.md`
- `schemas/v1.3/artifact-domain.schema.json`
- `schemas/v1.3/fixtures/artifact-domain.golden.json`
- `reports/v1.3-orchestration/p01-verification-summary.{json,md}`
- `reports/goal/v1.3-p01-{completion,review}.md`
- `reports/goal/v1.3-p01-handoff.json`
- `docs/17_TRACEABILITY_MATRIX.md`
- `PROJECT_STATUS.md`
- `CHANGELOG.md`

## Outcomes and Retrospective

The Runtime Artifact Domain, five portable definition variants, lifecycle, lineage, runtime binding,
schema boundary and architecture guard are implemented without persistence or execution scope.
Initial independent review rejected two blocking and two major defects; remediation aligned P04
nested contracts and validator/lifecycle boundaries. A new independent review accepted the final
working tree with zero blocking/major findings. The full working-tree gate passes 785 unit/contract,
84 integration and 62 E2E tests plus architecture, protocol, migration, Replay, build and smoke.
Only the meaningful implementation commit, clean-commit verification, final SHA bookkeeping and
Draft PR push remain.
