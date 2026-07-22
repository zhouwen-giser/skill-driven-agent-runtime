# G01 Compatibility Removal Checkpoint

Status: implementation checkpoint; G01 remains open until the old terminal authority is replaced by
the G05 `UserGoalPlanController`.

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

## Open G01 item

`WorkflowControllerService` still owns the pre-v1.2.2 runtime terminal repository. It must not be
deleted without a replacement because that would leave A2A tasks without an authority. G05 will move
the transaction behind `UserGoalPlanController`, update the architecture gate and close G01.
