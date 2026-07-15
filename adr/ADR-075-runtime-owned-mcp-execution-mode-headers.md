# ADR-075: Runtime-owned MCP Execution-mode Headers

## Status

Accepted on 2026-07-15.

## Context

Skill Evolution simulations and historical Workflow replay previously called the same MCP transport as live execution without a wire-level distinction. An MCP Server therefore could not tell a validation call from an operator-confirmed live call. The runtime must mark non-live traffic without assuming that SDAR itself can suppress a device side effect.

Execution mode crosses the domain, LangGraph, child Workflow, Skill-call, MCP registry, transport and audit boundaries. A process-global flag would be unsafe under concurrent live and simulated Workflows, while allowing configured credential Headers to select the mode would give management data authority over runtime isolation.

## Decision

- The domain owns immutable `RuntimeExecutionContext` data with modes `live`, `simulation` and `historical-replay`. Non-live contexts require a non-empty stable `simulationId`; live contexts cannot carry one.
- `WorkflowExecutor` and LangGraph runtime contexts carry this value explicitly. MCP, nested Subworkflow and `skill_call` ports receive the same context, and paused execution preserves it for resume.
- Skill Evolution derives stable identities from candidate/case and candidate/historical-experience identities. Random Workflow execution IDs do not determine the wire identity.
- `McpRegistryService` owns the reserved `X-SDAR-Execution-Mode` and `X-SDAR-Simulation-Id` Headers. Credential configuration with either name is rejected case-insensitively. Decrypted legacy credentials are stripped of reserved names, then the runtime writes canonical non-live Headers last. Live calls send neither Header.
- The transport receives the final sanitized Header set plus the typed context. Different Header sets use isolated official-SDK clients/sessions.
- Migration 0056 records `execution_mode` and optional `simulation_id` on each invocation. Arguments, result, status and mode remain auditable; credential values never enter invocation or management logs.

## Consequences

MCP Servers can implement their own simulation/replay-safe behavior using explicit wire metadata. The runtime does not claim to block device operations; an incompatible MCP Server remains an external safety risk that operators must assess.

Header-isolated clients create multiple MCP sessions for the same endpoint. The real loopback Mock MCP therefore implements official session-ID routing and tests concurrent live/non-live sessions. Live behavior and existing credential forwarding remain unchanged.
