# NFR-UX-001 cross-object navigation increment

Date: 2026-07-13

## Delivered

- Task identity renders one-click links to its persisted `planId` and `selectedSkillId`.
- Workflow Plan lookup uses `GET /api/v1/tasks?planId=...&limit=1` to resolve the owning PostgreSQL Task and provides a reverse one-click link.
- App navigation carries only the selected identifier; target panels load authoritative API records. Skill focus is visually identified without copying Skill state.
- Task model/MCP evidence links to the exact Provider/model and MCP Server; Task links to Evaluation with its persisted selected Skill filter.
- MCP/model invocation `taskId`, Evaluation quality-trend `taskId`, and explicit Memory `task:` source references link back to the Task trace root.
- Goal identity provides an independent Task-history entry backed by `GET /api/v1/tasks?goalId=...`; the repository filters the persisted `agent_task.goal_id` column.

No relationship is inferred from time, names, or frontend state. ADR-066 remains authoritative.

## Verification

- 52 targeted Task/management/static-console tests passed for the first increment; the follow-up MCP/model/Evaluation/Memory navigation suite passed 45 tests; the Goal-history management/console suite passed within a 56-test targeted run.
- format, lint, strict typecheck, architecture, 102-operation OpenAPI drift, and production build passed.
- The PostgreSQL `planId` and `goalId` query assertions are implemented but unexecuted while Docker remains unavailable.

The required association paths are functionally implemented. NFR-UX-001 remains developing until real-browser API navigation is reproducibly verified.
