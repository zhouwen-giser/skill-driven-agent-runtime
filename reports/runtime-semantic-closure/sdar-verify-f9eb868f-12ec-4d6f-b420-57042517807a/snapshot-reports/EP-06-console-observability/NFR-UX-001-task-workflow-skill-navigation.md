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
- Current `pnpm test:integration` passes 2 files/36 tests, including exact PostgreSQL `planId`, `goalId`, and `skillId` filters.
- Current `pnpm test:e2e` passes 1 file/40 tests against PostgreSQL, Redis, loopback model, Mock MCP, A2A, management API, and LangGraph.
- Real in-app browser execution against `http://127.0.0.1:9998/console/` verified Task↔Workflow, Task↔Skill, Task↔MCP invocation, Task↔model invocation, Task↔Evaluation, Goal→Task inventory, and explicit Memory `task:` source→Task navigation. All target panels reloaded authoritative API records.
- Browser execution exposed an actual deployment defect: Vite emitted `/assets/...` while Express served the application under `/console/`. The production base is now `/console/`, and Server smoke fetches both the HTML and emitted bundle and asserts the trusted-intranet warning marker.
- `pnpm smoke:infra`, `pnpm smoke:server`, and unified `pnpm verify` passed; unit/contract is 54 files/242 tests.

The required one-click association paths are implemented and reproducibly exercised with real API/PostgreSQL data. NFR-UX-001 is **verified**.
