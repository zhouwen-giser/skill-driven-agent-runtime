# ADR-081: Official MCP v2 Beta Client for the Extension Era

## Status

Accepted on 2026-07-16. This ADR supersedes only the client-version decision in ADR-076; ADR-076's adapter isolation, pinned extension contract and fail-closed validation decisions remain in force.

## Context

The Phase 1 compatibility Spike proved that `@modelcontextprotocol/sdk@1.29.0` negotiates protocol versions through `2025-11-25`. The official `io.modelcontextprotocol/tasks` contract explicitly forbids treating that legacy protocol as extension-enabled. Its client capability is per request, and its Streamable HTTP task operations require the extension-era method/header contract. Calling those methods through the v1 client's low-level request API would therefore create a wire shape that is not standards-compliant.

The official TypeScript SDK now publishes split v2 beta packages. `@modelcontextprotocol/client@2.0.0-beta.4` supports automatic modern discovery with legacy fallback. Its annotated package tag resolves to commit `e81758caed29f6568ce8873f7f9a3bd65b017d9c`. The package remains beta, and its current modern protocol fixture is `2026-07-28`, while the frozen extension draft describes `2026-06-30`. The SDK does not implement the Tasks extension itself.

Executable Spike evidence found two beta limitations beyond the absence of high-level methods. Its modern result codec rejects `resultType: "task"` before an explicit consumer Schema runs, and its era registry treats `tasks/get` and `tasks/cancel` as removed legacy-core methods. The official Streamable HTTP transport also derives `Mcp-Name` from `params.name`, not the extension's `params.taskId`.

## Decision

- Add exact production dependency `@modelcontextprotocol/client@2.0.0-beta.4` behind `packages/mcp-adapter`; do not use a range.
- Configure version negotiation in automatic mode. A legacy MCP Server continues to work through the official fallback path, but Tasks are disabled for that connection.
- Continue using the exact `@modelcontextprotocol/sdk@1.29.0` only for the existing official legacy loopback Server fixture during the staged migration. It is not a second production client and has no Tasks authority.
- Keep the frozen `modelcontextprotocol/ext-tasks` schemas as the Tasks wire authority. The adapter owns locally validated request/result schemas and maps them to SDAR-owned DTOs. Neither v1 nor v2 SDK objects cross the adapter boundary.
- Add one narrowly scoped compatibility bridge inside `packages/mcp-adapter`: use collision-resistant internal method aliases at the Client boundary, map them to the exact official method names immediately before the official transport sends, and wrap only raw Task-discriminator responses in an internal nonce-marked complete envelope before the beta codec. The explicit frozen Schema unwraps and validates the original Task object. No alias or wrapper appears on the wire or crosses the adapter API.
- Supply `Mcp-Name` from the already validated `params.taskId` through the official transport's injected fetch seam after its standard Headers are built. The body and public method remain unchanged, and loopback tests assert exact Header/body equality.
- Accept a Task result only when the negotiated Server capabilities advertise `io.modelcontextprotocol/tasks`. Reject Task results on a legacy connection, undeclared extension, unknown discriminator, malformed task identifier/status/result or schema revision mismatch.
- Treat `tasks/update` and `tasks/cancel` as acknowledgements. Only a subsequent authoritative `tasks/get` observation proves state.
- Contract-test the exact beta package and frozen extension combination. Do not claim compatibility with untested SDK beta or protocol revisions.
- Any beta upgrade, removal of the legacy fixture package or change to the extension pin requires a source diff, updated OSS Intake and an ADR amendment.

## Consequences

SDAR can negotiate the official extension era without fabricating Tasks on a legacy protocol. The production transport remains the official SDK transport isolated behind one MCP adapter, and LangGraph.js remains the only Workflow Runtime. The compatibility bridge is temporary adapter debt that must be deleted when the official Client registers SEP-2663; its exact wire and fail-closed behavior is contract-tested. The exact beta pin adds upgrade and interoperability risk; the protocol-revision record and loopback contract suite make that risk visible and reproducible.

## Rejected Alternatives

- Send extension methods through SDK 1.29.0: its negotiated protocol cannot enable the extension.
- Reimplement modern discovery/session transport by hand: duplicates official SDK authority and increases protocol risk.
- Patch or fork the SDK beta: creates an unpublished production fork and a larger maintenance/license surface than the isolated bridge.
- Import extension or SDK types into application/domain modules: violates the adapter boundary and creates a second source of truth.
- Wait for stable v2: would block the required v1.1 vertical increment despite an exact official beta and contract-testable path.
