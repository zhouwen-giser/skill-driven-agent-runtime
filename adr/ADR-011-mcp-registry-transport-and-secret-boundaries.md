# ADR-011: MCP Registry, Transport, and Secret Boundaries

## Status

Accepted on 2026-07-11; amended on 2026-08-12 to separate credential-envelope recovery from normal validated rotation.

## Context

EP-02 requires runtime registration of remote MCP Servers, manual Tool refresh, shared encrypted credentials, and calls validated against the current original Tool schema. SDK types and plaintext credentials must not leak into the domain or PostgreSQL.

## Decision

- Domain owns protocol-neutral `McpServer` and `McpTool`; application owns registry and invocation orchestration.
- V1 accepts only HTTP/HTTPS Streamable HTTP endpoints; stdio, Resources, and Prompts are absent.
- Official MCP SDK 1.29.0 remains isolated in `packages/mcp-adapter`.
- Registration discovers once; explicit refresh atomically replaces PostgreSQL Tool definitions.
- Invocation reloads the current Tool and validates against its untouched original input schema before network I/O.
- Credential headers use AES-256-GCM with a 32-byte base64 environment master key. Only IV/tag/ciphertext envelopes are persisted.
- The same composition-owned cipher serves MCP and Model credentials; service/repository interfaces carry only authenticated ciphertext envelopes, while plaintext exists only for the immediate outbound transport call.
- MCP draft-07 and SDAR 2020-12 JSON Schema dialects are explicitly supported; unknown dialects are rejected.
- Removed or schema-changed Tools atomically produce persistent warnings for affected current enabled SkillVersions without disabling them.
- Every attempted remote call persists arguments, displayable result or stable error summary, status, task/context correlation, timestamps and duration. Schema-rejected inputs are not represented as remote calls.
- Administrators can edit validated enhancement metadata independently of the untouched original input schema; refresh preserves enhancement for Tools that retain their names.
- Credential rotation first validates the new registration headers with an MCP ping, then encrypts the replacement and disconnects the old credential session. Remote health pings do not rediscover Tools and persist enabled/unreachable status.
- Recovery from an unreadable historical credential envelope is a distinct, explicit management operation. It validates only the replacement header shape, encrypts the operator-supplied replacement with the current composition-owned cipher, and atomically replaces the stored envelope without reading or decrypting the previous value, discovering Tools, or contacting the Provider. A subsequent explicit refresh remains the authority that validates Provider connectivity and catalog compatibility. Reserved SDAR execution headers are rejected in both paths.

## Consequences

PostgreSQL remains authoritative and SDK upgrades stay isolated. The recovery operation deliberately cannot prove the replacement credential against the Provider; operators must follow it with refresh, and a failed refresh leaves the existing frozen catalog intact. V1 intentionally provides no idempotency key or duplicate-call suppression. Management endpoints/console, LLM-generated metadata, and LLM failure decisions remain outstanding.

## Evidence

- `packages/application/test/mcp-registry.unit.test.ts`
- `packages/application/test/frozen-mcp-registry.unit.test.ts`
- `packages/crypto-adapter/test/aes-gcm-secret-cipher.unit.test.ts`
- `packages/mcp-adapter/test/streamable-http.contract.test.ts`
- `packages/persistence-postgres/test/repositories.integration.test.ts`
- `packages/management-api/test/http-endpoint.contract.test.ts`
- `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts`
