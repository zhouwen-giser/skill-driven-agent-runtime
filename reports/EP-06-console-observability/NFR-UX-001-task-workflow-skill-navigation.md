# NFR-UX-001 cross-object navigation increment

Date: 2026-07-13

## Delivered

- Task identity renders one-click links to its persisted `planId` and `selectedSkillId`.
- Workflow Plan lookup uses `GET /api/v1/tasks?planId=...&limit=1` to resolve the owning PostgreSQL Task and provides a reverse one-click link.
- App navigation carries only the selected identifier; target panels load authoritative API records. Skill focus is visually identified without copying Skill state.
- Task model/MCP evidence links to the exact Provider/model and MCP Server; Task links to Evaluation with its persisted selected Skill filter.
- MCP/model invocation `taskId`, Evaluation quality-trend `taskId`, and explicit Memory `task:` source references link back to the Task trace root.

No relationship is inferred from time, names, or frontend state. ADR-066 remains authoritative.

## Verification

- 52 targeted Task/management/static-console tests passed for the first increment; the follow-up MCP/model/Evaluation/Memory navigation suite passed 45 tests.
- format, lint, strict typecheck, architecture, 102-operation OpenAPI drift, and production build passed.
- The PostgreSQL `planId` query assertion is implemented but unexecuted while Docker remains unavailable.

NFR-UX-001 remains developing until the independent Goal association entry and real-browser API navigation are covered.
