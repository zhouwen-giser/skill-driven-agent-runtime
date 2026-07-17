# SDAR v1.2 Phase 6 — V1.1 Main Integration Baseline and Shared-contract Freeze

- Dependency class: `V11-MAIN-BASELINE-DEPENDENT`
- Phase input SHA: `389d43d04c5c133791a789dec1c4e7417d65d625`
- `origin/main`: `667146a3639eefdfed9b89c2417c08e1ac50e9a9`
- Resulting SHA: pending publication
- Merge: not required; main was already an ancestor
- Gate: OPEN

## Baseline and contract freeze

Phase 6 fetched current main and proved both the v1.1 final submitted SHA is in main and main is in the
v1.2 branch. The branch entered 0 behind / 14 ahead, so an empty merge would add false integration
history and was not created.

The regenerated repository, symbol and overlap maps identify final V1.1 readiness, Provider,
continuation, Workflow and persistence authorities. ADR-097 through ADR-103 freeze exact versioned usage,
three-mode execution, normative authority, shared recursive budgets, package import authority, direct
reuse of V1.1 readiness/continuation and the minimal execution-record boundary. ADR high-water is now
103. Migration high-water remains 0104; 0105 is allocated to Phase 7 usage/import persistence and 0106
to Phase 11 execution records. No migration is added in this documentation/contract phase.

The Phase 4 `SkillTaskReadinessPort` remains a clearly marked mock projection. ADR-102 aligns its future
production adapter directly to the existing `McpTaskOperationCatalog`, `TaskAvailabilityBatchReader`
and exact V1.1 Domain availability/timing/reservation types. Phase 5 already uses the existing
`SkillGraphRepository`, `SkillRepository` and `SkillCompositionPlanner`; it adds no parallel Port or
graph. Actual Provider wiring remains Phase 8 work.

## Verification

Full self-managed post-main-sync `pnpm verify` passed in 141,005 ms:

- 80 unit/contract files and 542 tests;
- 9 real PostgreSQL/Redis integration files and 80 tests;
- 2 real PostgreSQL/Redis/model/MCP E2E files and 49 tests;
- 246 TypeScript source files passed architecture enforcement;
- A2A MUST 74/74, 110 Management OpenAPI operations, 18 baseline and 16 MCP Tasks acceptance
  scenarios;
- 68 migration pairs, production Server/Console builds, infrastructure smoke and Server/Console smoke.

The ignored operator `.env` was isolated with an EXIT trap for the self-managed run and restored
unchanged. Model/Provider business behavior remains classified deterministic simulation; local
PostgreSQL/Redis/protocol paths are real.

## Limitations and next step

This phase publishes decisions and regenerated evidence only. It does not claim persisted Skill usage,
real Provider readiness, Workflow compilation or execution records. Phase 7 implements migration 0105
through the existing Registry, Management API/OpenAPI and Console surface.

## Publication

The report commit and remote SHA are pending; an immediate follow-up will record publication without
amend, rebase or force-push.
