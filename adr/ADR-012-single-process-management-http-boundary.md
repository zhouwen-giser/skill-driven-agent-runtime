# ADR-012: Single-process Management HTTP Boundary

## Status

Accepted on 2026-07-11.

## Context

The operational console requires real management APIs while A2A routing remains owned by the official SDK adapter. V1 requires one process and no authentication, with explicit trusted-intranet warnings.

## Decision

- The composition root starts an independent management HTTP listener in the same Node.js process as A2A and the Worker.
- `packages/management-api` owns Express and Zod HTTP DTOs. Core modules do not import Express types.
- Routes call SkillRegistry and McpRegistry services and never mutate projections directly.
- Every response carries `X-SDAR-Security-Warning: trusted-intranet-only-no-auth`; health output repeats the risk.
- MCP lists never include encrypted credentials. Unexpected errors become generic 500 envelopes without driver messages.
- `schemas/management-api.openapi.yaml` documents the initial API; contract and real e2e tests verify it.

## Consequences

The separate listener isolates A2A SDK routing while preserving the single-process invariant. Authentication, authorization, and tenant isolation remain intentionally absent. The future console must display the risk warning.
