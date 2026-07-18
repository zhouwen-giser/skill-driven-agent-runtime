# SDAR v1.2 Phase 8 — Provider Readiness and Task Type Binding

Date: 2026-07-17

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `460d39d8bd2e7d8d1033e452ac70924e22033a65`

Feature SHA: `978d56f9a7c651fd704b3e5adda714ad06a5308d`

## Result

The production Skill selection chain now resolves a Task Type by exact, case-sensitive registered MCP
operation name, filters enabled Provider candidates by required/preferred/forbidden policy and
deterministic attributes, then calls the existing V1.1 availability reader. Candidate summaries retain
Provider/operation identity, risk, validity, earliest start, every returned window, reservation,
possible effects, disposition and stable reason codes. The selected candidate enters the immutable
usage-candidate snapshot before the existing model decider.

The catalog derives hard attributes only from validated `McpTaskOperationSemantics`. Tool enhancement
text and model output are not certification authority. Required Providers never fall back. Preferred
fallback requires `adaptive.allowPreferredProviderFallback`; forbidden and attribute-ineligible
Providers are removed before readiness. `available`, `restricted`, `disabled` and Provider uncertainty
map to `ready`, `restricted`, `unavailable` and `unknown`. Expired evidence, malformed restricted hints
and invalid guaranteed reservations become `unknown`.

Usage-aware assessment is always wired when Skill selection is enabled. When V1.1 Task metadata is off,
the existing registry returns no Task candidates and native bindings fail closed. The Skill snapshot
does not store live resource state. The V1.1 exact-argument check immediately before invocation remains
the final readiness authority. ADR-104 records these authority decisions.

## Persistence Defect Found by the Vertical

The first real vertical reached planning but failed when the strict PostgreSQL composition snapshot
schema rejected the additive `selectedSkill.usageSpecification`. The boundary now admits exactly that
optional field, and `snapshotSkillCompositionContext` revalidates the complete Usage domain contract.
The repository suite proves both valid native Usage round-trip and corrupted `apiVersion` rejection.

## Verification

- `pnpm typecheck` and focused ESLint passed.
- Readiness, usage and selection unit suites: 3 files, 23/23.
- `apps/server/test/remote-task-runtime.integration.test.ts`: 8/8 with real PostgreSQL/Redis; exact
  candidate discovery and the metadata-disabled empty catalog are covered.
- `packages/persistence-postgres/test/repositories.integration.test.ts`: 56/56 with real PostgreSQL;
  native Usage plan-snapshot round-trip and malformed contract rejection are covered.
- `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts`: 48/48 with real Server,
  PostgreSQL/Redis and loopback MCP. The required Provider receives `checkAvailability` for binding
  `vertical-task` before planning/confirmation, and the existing remote Task path completes.
- Repository-wide format, lint and strict typecheck passed; architecture boundaries verified 248
  TypeScript source files.

No test was skipped or weakened. No placeholder response, executable model output, dynamic code,
secret, migration or parallel Provider state was added. Provider business behavior in the loopback E2E
is deterministic simulation; external production Provider interoperability remains unverified.

## Next

Phase 9 compiles the selected guidance/template/procedure Usage decision into the existing Workflow
planning and validator authority and adds deterministic plan-compliance checks. The Draft PR remains
Draft and must not be merged.
