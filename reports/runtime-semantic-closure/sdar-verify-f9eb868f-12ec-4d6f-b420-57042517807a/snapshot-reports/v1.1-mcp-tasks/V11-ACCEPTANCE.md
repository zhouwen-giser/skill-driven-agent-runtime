# V1.1 MCP Tasks Acceptance

- Status: **passed**
- Generated: 2026-07-19T04:31:12.861Z
- Commit: `c979feb7a5ddd56cefcf126a763c370e626170fd` (dirty working tree)

| Scenario | Result | Classification | Evidence |
| --- | --- | --- | --- |
| AC-MCPT-01 synchronous Tool regression | passed | simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`packages/mcp-adapter/test/streamable-http.contract.test.ts` |
| AC-MCPT-02 Task negotiation and creation | passed | real, simulated | `packages/mcp-adapter/test/streamable-http.contract.test.ts`<br>`packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` |
| AC-MCPT-03 Provider without Tasks | passed | simulated | `packages/mcp-adapter/test/streamable-http.contract.test.ts`<br>`packages/application/test/mcp-task-readiness.e2e.test.ts` |
| AC-MCPT-04 working to completed continuation | passed | real, simulated | `apps/server/test/remote-task-runtime.integration.test.ts`<br>`packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` |
| AC-MCPT-05 pause and resume observation | passed | simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`packages/application/test/remote-task-polling.unit.test.ts` |
| AC-MCPT-06 input required | passed | real, simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`apps/server/test/remote-task-runtime.integration.test.ts` |
| AC-MCPT-07 cooperative cancellation acknowledged | passed | real, simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`apps/server/test/remote-task-runtime.integration.test.ts` |
| AC-MCPT-08 cancellation Provider unreachable | passed | simulated | `packages/application/test/remote-task-cancellation.unit.test.ts` |
| AC-MCPT-09 restricted operation accepted | passed | real, simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`packages/application/test/mcp-task-readiness.e2e.test.ts`<br>`packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` |
| AC-MCPT-10 admission rejected | passed | simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`packages/langgraph-runtime/test/workflow-compiler.unit.test.ts` |
| AC-MCPT-11 scheduled start window missed | passed | simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`packages/domain/test/provider-business-outcome.unit.test.ts` |
| AC-MCPT-12 maximum elapsed deadline reached | passed | simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`packages/langgraph-runtime/test/workflow-compiler.unit.test.ts` |
| AC-MCPT-13 Provider unreachable and recovery | passed | real, simulated | `packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts`<br>`apps/server/test/remote-task-runtime.integration.test.ts` |
| AC-MCPT-14 process and Redis restart | passed | real, simulated | `apps/server/test/server-runtime-restart.integration.test.ts`<br>`packages/persistence-postgres/test/workflow-continuation.integration.test.ts` |
| AC-MCPT-15 parallel and child waits | passed | real, simulated | `apps/server/test/remote-task-composition.integration.test.ts`<br>`packages/langgraph-runtime/test/workflow-compiler.unit.test.ts` |
| AC-MCPT-16 Goal Patch and late remote events | passed | real, simulated | `packages/persistence-postgres/test/repositories.integration.test.ts`<br>`packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts` |

## Commands

| Gate | Command | Result |
| --- | --- | --- |
| production-build | `pnpm build` | passed |
| mcp-tasks-sixteen-scenario-contract | `pnpm exec vitest run --project contract packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts` | passed |
| acceptance-unit-evidence | `pnpm test:unit` | passed |
| postgres-redis-integration-including-restart | `pnpm test:integration` | passed |
| full-e2e | `pnpm test:e2e` | passed |
