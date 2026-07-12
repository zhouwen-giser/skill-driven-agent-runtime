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
- Full bidirectional navigation, session inventory, live refresh, and real browser E2E remain open. FR-ADM-006 and NFR-OBS-001 stay developing.
