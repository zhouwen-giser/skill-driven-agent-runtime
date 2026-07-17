# ADR-095: Remote Task lifecycle management boundary

## Status

Accepted on 2026-07-17.

## Context

FR-MCPT-014 requires operators to inspect and act on the complete remote MCP Task lifecycle. The management surface must not become a second state machine, expose credentials or model-private reasoning, treat a cancellation acknowledgement as a Provider terminal state, or introduce an authentication model that conflicts with the trusted-intranet V1 baseline.

## Decision

- PostgreSQL remains the only lifecycle query authority. A persistence adapter joins the existing binding, observation, control, protocol-attempt, continuation, input and cancellation records into a protocol-neutral read projection; Management and React consume that projection without owning lifecycle state.
- The projection is rooted at the local Agent Task and preserves Task, context, Goal/version, plan, Workflow instance/node run, Skill/version, MCP invocation and Provider Task correlations. Display values are bounded and sanitized; credentials, claim tokens, stack traces and private model reasoning are excluded.
- Manual refresh is one production polling attempt guarded by the binding's expected version. It is not an automatic retry and cannot bypass PostgreSQL CAS or context serialization.
- Manual cancellation uses the existing durable cooperative cancellation service with a caller-provided idempotency key. A protocol acknowledgement remains separate from the later Provider `cancelled`, `completed` or `failed` observation.
- Remote input continues through the existing Task `provide_input` boundary and exact `tasks/update(inputResponses)` adapter. Management does not create a parallel input channel or re-enter Goal formulation/planning.
- The API and Console continuously display the trusted-intranet/no-authentication, possible-side-effect, Provider-authority, cancellation-uncertainty and non-recovery warnings required by the accepted V1 risk posture.
- Official MCP types remain inside the MCP adapter, PostgreSQL types inside persistence/Server composition, BullMQ types inside runtime-redis, and A2A types inside the A2A adapter. Test-support wrappers preserve the same boundaries in composed restart acceptance.

## Consequences

Operators obtain a complete, actionable lifecycle view without changing protocol ownership or adding another execution runtime. Refresh and cancel can change external/local state, so they remain explicit bounded operations with durable attempts and visible uncertainty. V1 still has no authentication and must not be exposed publicly.

Phase 6 verifies this decision with management contract and Console tests, 110-operation OpenAPI drift checking, the full Skill-to-A2A remote Task E2E, real PostgreSQL/Redis restart and parallel/child continuation tests, and the machine-readable 16-scenario acceptance report.
