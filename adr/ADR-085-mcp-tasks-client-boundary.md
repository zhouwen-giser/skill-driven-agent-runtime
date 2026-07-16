# ADR-085: MCP Tasks Client Boundary

## Status

Accepted on 2026-07-16.

## Context

SDAR uses `@modelcontextprotocol/sdk@1.29.0` for Streamable HTTP. Its high-level experimental Tasks client implements the older 2025-11-25 core draft (`tasks/result` and `tasks/list`) and does not implement the v1.1-required `tasks/update`. The official `io.modelcontextprotocol/tasks` extension supplies `tasks/get`, `tasks/update` and `tasks/cancel`, but its repository is untagged and targets the evolving 2026 protocol family.

Using those SDK experimental models in the domain would bind SDAR to the wrong contract. Adding another runtime/client library would create competing transport ownership and an unreviewed dependency.

## Decision

- Keep exact dependency `@modelcontextprotocol/sdk@1.29.0` and its stable v1 Streamable HTTP transport.
- Pin the official extension repository commit and schema blobs in `third_party/sources.lock.yaml`.
- `packages/mcp-adapter` uses the SDK's low-level validated request API for extension methods and maps all wire types to domain-neutral adapter results.
- Core and application code never imports SDK or extension schema types.
- The adapter requires capability negotiation and rejects unknown discriminators, malformed payloads, missing Task headers and unsupported methods.
- No upstream code is copied in Phase 0. Any later schema adaptation retains Apache-2.0 attribution and is checked by contract/source gates.

## Consequences

SDAR can implement the required official extension without adopting the SDK's incompatible legacy Tasks surface. The adapter bears an explicit maintenance obligation: every source-pin change requires OSS Intake, schema diff review, contract tests and an ADR update.

## Rejected Alternatives

- SDK `experimental.tasks`: wrong method/result contract.
- SDK main/v2 beta upgrade: unnecessary transport and compatibility risk.
- Executing hand-built requests from application/domain code: leaks protocol authority across the adapter boundary.
