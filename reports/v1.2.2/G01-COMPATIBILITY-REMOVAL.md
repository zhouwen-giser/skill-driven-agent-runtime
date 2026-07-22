# G01 Compatibility Removal Checkpoint

Status: **completed**. The former terminal-authority handoff is closed by the G05
`UserGoalPlanController` implementation.

## Removed product paths

- Removed the historical MCP transport router, generic streamable client, Task bridge/mock, availability
  contract and their old acceptance/migration scripts.
- MCP registration, discovery, Tool metadata, task readiness, Workflow DSL, persistence, Management API
  and Console now accept only the Frozen MCP Tasks V1 contract.
- Removed automatic Skill Usage projection; every selectable/composable Skill must own native Usage data.
- Removed management mode switching, duplicate endpoints and generic credential/health operations.
- Added an architecture gate over current `apps/`, `packages/` and `schemas/` sources for removed product
  symbols. Historical ADR/release/migration evidence remains outside this current-product gate.

## Verification at this checkpoint

- `pnpm format:check`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: 93 files / 587 tests passed.
- `pnpm test:integration`: 8 files / 63 tests passed on disposable PostgreSQL databases.
- `pnpm verify:architecture`: passed.

## Terminal authority closure

`WorkflowControllerService` now emits `WorkflowExecutionOutcome` and delegates terminal adjudication.
`UserGoalPlanController` is the only application owner of the atomic User Goal/A2A terminal commit;
the architecture and layered-outcome tests verify the boundary.
