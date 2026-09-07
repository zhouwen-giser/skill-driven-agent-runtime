# FR-ADM-006 Task-Correlated Trace Evidence

## Implemented increment

- Task lookup displays Task, context, Goal/version, selected Skill/version, Plan, phase, and Task error identity.
- Explicit associated requests retrieve Task runtime events, Goal and patches, Plan and latest Workflow trace, processed results, input inference, quality report, implicit feedback, evolution records, model invocations, and MCP invocations.
- Model and MCP queries use persisted `task_id`; Workflow lookup follows persisted `planId`; no timestamp/name correlation is performed.
- LangGraph LLM/MCP nodes pass their execution ID through the runtime port. The composition root resolves the persisted instance and Task-by-Plan, then supplies Task/context identity to the existing invocation audits.
- Confirm, reject, and revise actions use the existing Task lifecycle boundary.
- Unavailable in-progress artifacts remain visible as per-resource errors rather than static placeholders.

## Verification

- Targeted unit suite covers model/MCP task filters, plan trace, and server-rendered Task console without fabricated records.
- Management contract tests cover Task-event, task-filtered model/MCP, and Plan-trace endpoints.
- OpenAPI drift gate covers 99 management operations.
- Strict typecheck, lint, format, architecture, and production console build pass.

## Pending

- Real PostgreSQL assertions are implemented for event/model/MCP/Plan queries but cannot be rerun while local Docker container start remains hung.
- Latest browser repetition and migration-0052 extended correlation remain open for NFR-OBS-001/NFR-UX-001.

## Acceptance reconciliation — 2026-07-13

FR-ADM-006 is verified. Historical real EP-04/05 A2A/PostgreSQL/LangGraph/MCP/model flows retrieve Task/context/Goal, model and MCP calls, ordered runtime events, processed results, five-component evaluation, and persisted error states. Current Task/workflow/management/Console regression passes 4 files/69 tests and directly covers identifier navigation, bounded filters, and read-only refresh; unified `pnpm verify` passes 54 files/241 tests. Migration 0052's extra Plan-confirmation/Goal-Patch fields remain an NFR-OBS-001 enhancement, not a missing FR-ADM-006 query class.
