# NFR-UX-001 cross-object navigation increment

Date: 2026-07-13

## Delivered

- Task identity renders one-click links to its persisted `planId` and `selectedSkillId`.
- Workflow Plan lookup uses `GET /api/v1/tasks?planId=...&limit=1` to resolve the owning PostgreSQL Task and provides a reverse one-click link.
- App navigation carries only the selected identifier; target panels load authoritative API records. Skill focus is visually identified without copying Skill state.
- Task model/MCP evidence links to the exact Provider/model and MCP Server; Task links to Evaluation with its persisted selected Skill filter.
- MCP/model invocation `taskId`, Evaluation quality-trend `taskId`, and explicit Memory `task:` source references link back to the Task trace root.
- Goal identity provides an independent Task-history entry backed by `GET /api/v1/tasks?goalId=...`; the repository filters the persisted `agent_task.goal_id` column.
- Skill identity provides a reverse one-click entry backed by `GET /api/v1/tasks?skillId=...`; the repository filters persisted `agent_task.selected_skill_id` rather than frontend text.
- Task MCP evidence carries both `serverId` and `toolName`, so the destination focuses the exact Tool instead of only its Server.

No relationship is inferred from time, names, or frontend state. ADR-066 remains authoritative.

## Verification

- 52 targeted Task/management/static-console tests passed for the first increment; the follow-up MCP/model/Evaluation/Memory navigation suite passed 45 tests; the Goal-history management/console suite passed within a 56-test targeted run.
- The Skill/Tool correction passes strict typecheck and 3 files/59 tests. Its focused test executes the Skill-to-Task click callback and asserts the exact Skill identity, while SSR asserts exact Tool focus.
- Unified `pnpm verify` passes 54 files/241 tests, 165-file architecture enforcement, 102 management operations, migration/source/license gates, and production builds.
- format, lint, strict typecheck, architecture, 102-operation OpenAPI drift, and production build passed.
- The PostgreSQL `planId`, `goalId`, and `skillId` query assertions are implemented but the latest regression is unexecuted while Docker remains unavailable.

The required association paths are functionally implemented. NFR-UX-001 remains developing until real-browser API navigation is reproducibly verified.
