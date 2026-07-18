# SDAR v1.2 Phase 10 — Existing Runtime/Graph Integration

Date: 2026-07-17

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `764ec026564d31845273724ce1a29df4e0b5b675`

Feature SHA: `efb03e8893f037d2bca1ca2803422431711b5660`

## Result

The existing top-level Task preparation path now loads the exact persisted Skill-selection candidate,
recomputes bounded Usage composition and mode interpretation, and passes the resulting immutable
`SkillUsagePlanPolicy` into the existing `WorkflowPlannerService`. Guidance continues through the
bounded model path; template and procedure continue through the deterministic first candidate; all
paths use the existing Validator, outer Workflow Plan confirmation and LangGraph compiler.

The validated policy is stored as non-executable data on the immutable `WorkflowDefinition`. Domain
revalidates it on every PostgreSQL read. Existing bounded repair, ordinary replan, input continuation,
natural-language/admin revision and Goal Patch inherit the same authority, while confirmation-required
repairs and every invalidating revision/Goal Patch require a fresh outer plan confirmation.

Legacy Skills with no v1.2 composition declaration preserve the existing exact Skill Graph admission
path. Native fixed/slot composition remains closed to its resolved exact decisions. The compatibility
path fixed a real persistence defect: the old Skill-selection mapper stripped `usageSummary` and
`usageCandidate`; strict nested schemas now preserve and validate both.

Phase 10 also removed duplicate in-graph confirmation. ADR-105 keeps one authoritative outer Workflow
Plan confirmation and the complete policy as review data. ADR-106 promotes the already-merged
`0100..0105` migrations into the default released chain, preserving the disposable isolated-profile
guard, rollback guards and ledger-gap fail-closed behavior. No second Runtime, graph, confirmation
state machine, Registry or Provider state was introduced.

## Verification

Exact feature commit `efb03e8` was verified from a clean worktree against a disposable bootstrap
database; `reports/verification/summary.{md,json}` records `dirty=false` and a 106,796 ms pass.

- Static/build gate: format, lint, strict typecheck, 82 unit/contract files with 556/556 tests,
  251-source architecture, A2A MUST 74/74, 114 OpenAPI operations, 18 baseline acceptance scenarios,
  source/license/SBOM checks and production Server/Console build passed.
- Migration gate: released empty and historical upgrade, `0064→0105`, rollback/reapply,
  isolated-profile guard and ledger-gap fail-closed passed across 69 migration pairs.
- Real PostgreSQL/Redis integration: 9 files, 81/81.
- Real local A2A/model/MCP E2E: 2 files, 50/50, including independent nested Skill confirmation.
- Infrastructure smoke and production Server/Console smoke passed.

The operator-owned `sdar` volume has a historical `0064,0105` ledger gap. The new runner correctly
rejected it; the volume was not modified. Verification used a separately named bootstrap database,
removed it afterward, and stopped the repository PostgreSQL/Redis containers without deleting volumes.

## Remaining Scope

Phase 11 adds the persistent Skill Execution Record and minimal telemetry. Required capability-slot
choice resolution and the formal `embodied.area_patrol` recursive vertical remain Phase 12–13
acceptance work. Draft PR #5 remains Draft and is not merged.
