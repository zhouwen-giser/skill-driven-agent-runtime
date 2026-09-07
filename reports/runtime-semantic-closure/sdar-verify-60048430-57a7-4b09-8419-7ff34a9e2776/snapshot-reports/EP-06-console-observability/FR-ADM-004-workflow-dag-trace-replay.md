# FR-ADM-004 Workflow DAG, Trace, and Replay Evidence

## Acceptance result

Verified. The exact acceptance requires a Task to remain replayable from Plan through execution
trace while the console supports DAG display, visual editing, DSL editing/validation, confirmation,
node state, and execution replay. Historical EP-03 real PostgreSQL/Redis/model/MCP/LangGraph gates
prove immutable administrator DAG revision, confirmation, execution, Workflow instances, and ordered
node events. The current console and management regression closes the presentation and read-model
surface without introducing a second runtime.

## Implemented increment

- Plan lookup renders the persisted validated WorkflowDefinition as repository-owned React DAG nodes and edges.
- Repository-owned visual controls edit node names, entry/exit markers, and edge topology/outcomes as canonical JSON data while preserving type-specific node configuration.
- The JSON DSL editor submits only data to `/api/v1/workflows/validate`; it cannot compile or execute source code.
- Administrator edits call the existing immutable revision service with `format=dag`, create a new Plan/version, supersede the source, and return to `awaiting_confirmation`.
- Plan confirmation uses the existing confirmation endpoint; no Tool call is triggered by validation or editing.
- Instance lookup returns the PostgreSQL instance snapshot and ordered displayable `WorkflowNodeEvent` records.
- The replay control progressively applies persisted node events to the DAG and timeline; terminal result/error evidence remains separate from hidden model reasoning.

## Boundaries preserved

- Domain owns WorkflowDefinition, node/edge kinds, WorkflowInstance, and WorkflowNodeEvent.
- Application owns validation, immutable revision, confirmation, and trace assembly.
- PostgreSQL remains authoritative for plans, instances, and node events.
- React owns only editor text, selected identifiers, and replay position; it is not an execution runtime.
- Running instances are never modified by the editor. A revision always creates a new plan outside LangGraph.

## Verified evidence

- Historical `reports/EP-03-workflow-planner-runtime/langgraph-compiler-execution-increment.md`: 17 real PostgreSQL integration tests and 15 same-process PostgreSQL/Redis/model/real-MCP E2E tests passed, including persisted Workflow instances, ordered node events, confirmation isolation, and LangGraph execution.
- Historical `reports/EP-03-workflow-planner-runtime/plan-revision-increment.md`: real PostgreSQL transaction, management HTTP, Redis-backed A2A, local structured model, and LangGraph E2E proved administrator DAG validation, immutable revision, fresh confirmation, and execution.
- `pnpm exec vitest run apps/console/src/console.unit.test.tsx packages/application/test/workflow-revision.unit.test.ts packages/application/test/workflow-execution.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts` — 4 files and 63 tests pass. The visual-editor regression executes data edits and proves type-specific configuration is preserved.
- `pnpm verify` — 54 files and 242 tests pass, plus format, lint, strict typecheck, 165-file architecture enforcement, A2A 1.0.1 compatibility, 102-operation OpenAPI drift, 52 migration pairs, SBOM/licenses, and production backend/console builds.

## Verification classification

- Real: historical production PostgreSQL/Redis/management HTTP/model/MCP/LangGraph revision, confirmation, execution, and ordered event persistence.
- Deterministic current regression: visual editor transformations, restricted DSL boundary, immutable revision/confirmation service, ordered trace projection, replay rendering, and production build.
- Not rerun: the latest PostgreSQL list-event assertion and end-to-end real-API browser interaction because local Docker services remain unavailable. These remain EP-06/release-level repetition gaps and are not represented as current real evidence.
