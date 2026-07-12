# FR-ADM-004 Workflow DAG, Trace, and Replay Evidence

## Implemented increment

- Plan lookup renders the persisted validated WorkflowDefinition as repository-owned React DAG nodes and edges.
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

- `pnpm test:unit -- --run apps/console/src/console.unit.test.tsx packages/application/test/workflow-execution.unit.test.ts` — 11 tests pass across console accessibility/static-record checks and Workflow trace behavior.
- `pnpm test:contract -- --run packages/management-api/test/http-endpoint.contract.test.ts` — 30 tests pass, including ordered instance trace response.
- `pnpm --dir apps/console build`, lint, typecheck, and the 96-operation OpenAPI drift gate pass.

## Pending evidence

- The PostgreSQL integration assertion for ordered node-event reads is implemented but has not been rerun after this change because local Docker Compose remains unable to start the stopped test containers.
- Real UI E2E and live polling/streaming across Task, model, MCP, and node records remain open; this report does not claim FR-ADM-004 complete.

