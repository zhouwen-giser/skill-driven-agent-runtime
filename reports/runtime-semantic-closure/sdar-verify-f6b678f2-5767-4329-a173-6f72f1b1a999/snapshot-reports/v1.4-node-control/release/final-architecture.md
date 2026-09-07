# SDAR v1.4 Final Architecture

SDAR v1.4 is a single-node backend increment around the existing modular-monolith Runtime. It does
not add a second Agent or Workflow runtime. LangGraph.js remains the only executable graph engine.

## Process and dependency boundaries

- `apps/node-control-api` and `apps/node-control-worker` compose Node Control Application services.
- Node Control Domain and Application packages do not import Express, PostgreSQL, Redis, A2A, MCP or
  LangGraph implementation types.
- Runtime adapters expose authenticated internal control contracts; Node Control never writes
  Runtime business tables.
- Official A2A/MCP SDKs remain isolated behind existing adapters.

## Data boundaries

- Control PostgreSQL owns Node Profile, desired configuration, Provider/Binding/Capability/Exposure
  governance, Control ManagementOperation/Audit and the single organization Node Event stream.
- Runtime PostgreSQL owns Task, Workflow, Active/LKG, live Capability readiness, Task binding and
  execution/telemetry delivery facts.
- Redis/BullMQ owns only rebuildable wake, queue and scheduling state.

## Deliberate exclusions

There is no formal v1.4 Console frontend, hierarchical organization control plane, multi-node
orchestrator, telemetry query/ClickHouse proxy, second event stream or production HA subsystem.
