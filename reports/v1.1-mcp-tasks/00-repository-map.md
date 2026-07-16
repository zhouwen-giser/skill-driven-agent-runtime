# v1.1 MCP Tasks Repository Map

| Area | Current authority | v1.1 role |
| --- | --- | --- |
| `packages/domain/src/mcp.ts` | MCP Server, Tool, invocation domain | add extension-neutral task/availability/timing models |
| `packages/domain/src/workflow.ts` | immutable DSL/node/instance models | add external-wait state/result only; keep `mcp_tool` |
| `packages/domain/src/task-input.ts` | durable input request/response | add `remote_task` source/link without new planning |
| `packages/application/src/ports.ts` | repositories, transport and executor ports | add Tasks client/repository/scheduler/continuation ports |
| `packages/application/src/mcp-registry.ts` | registration/discovery/call/audit | normalize immediate/error/remote union and create binding path |
| `packages/application/src/workflow-validator.ts` | restricted DSL and live Tool validation | plan-time Task semantics/availability guard |
| `packages/application/src/workflow-controller.ts` | immutable rounds and input continuation | remote control continuation without replan |
| `packages/mcp-adapter/src/streamable-http-adapter.ts` | official SDK Streamable HTTP isolation | low-level pinned extension methods/headers/schema mapping |
| `packages/langgraph-runtime/src/workflow-compiler.ts` | sole Workflow compilation/execution | return waiting signal and continue persisted frontier |
| `packages/persistence-postgres/src/repositories.ts` | PostgreSQL system-of-record adapters | binding/observation/control/snapshot repositories |
| `infra/postgres/migrations/` | forward migration chain through 0056 | reserved 0100+ after migration-order guard |
| `packages/runtime-redis/src/bullmq-context-queue.ts` | same-context attempts=1 dispatch | add separate idempotent delayed remote poll scheduler |
| `apps/server/src/runtime.ts` | one-process composition/startup recovery | wire poller/reconciler; narrow waiting-external exemption |
| `packages/management-api` | trusted-intranet real management API | remote task read/actions and OpenAPI |
| `apps/console` | real operational React Console | availability/binding/observation/input/cancel UX |
| `tests/mock-mcp` / A2A E2E fixtures | official-SDK loopback evidence | deterministic Task-capable Provider scenarios |

## Invariants checked before implementation

- No MCP Tasks domain models, transport methods, binding store, poller, reconciler, continuation snapshot, API or Console surface currently exists.
- `McpRegistryService.call()` currently awaits one synchronous adapter result and must not keep a long-lived Promise.
- `skill_call`/subworkflow child instances have separate lineage; remote binding belongs to the child instance.
- PostgreSQL `runtime_event` contains display summaries, not an exact remote event authority.
- BullMQ queue jobs already use `attempts: 1` and Worker `maxStalledCount: 0`; remote polling must preserve one-attempt execution while tolerating duplicate scheduling through database idempotence.
- Startup `failInterruptedExecutions()` currently fails running/paused execution globally. Only persisted `waiting_external` may be excluded.
- Migration loader uses a numeric high-water mark; ADR-089 governs reserved 0100+ usage.
