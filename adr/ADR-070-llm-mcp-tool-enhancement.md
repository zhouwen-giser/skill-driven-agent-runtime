# ADR-070: LLM-Generated MCP Tool Enhancement

## Status

Accepted on 2026-07-13.

## Context

FR-MCP-008 requires every discovered Tool to receive six editable metadata categories from an LLM at registration time and requires that metadata to participate in planning. The registry previously validated, persisted, and exposed manually edited enhancement data, but initial registration left it empty and Workflow planning saw only Skill Tool references.

## Decision

- Add `tool_enhancement` as a fixed Model Runtime stage with its own configured Provider route and published Prompt. There is no static fallback and no alternate Provider fallback.
- Keep `McpToolEnhancer` application-owned. `StructuredMcpToolEnhancer` sends Tool identity, description, and original input schema as untrusted data to the existing structured Model Runtime and accepts only the strict six-field schema.
- Registration enhances every Tool before the Server/Tool set is persisted. A model/schema failure fails the registration atomically.
- Manual edits remain authoritative across refresh for the same Tool name. Newly discovered Tools are enhanced; existing enhancements are not silently regenerated.
- Workflow planning receives each selected Skill Tool's enhancement plus the original input schema and an explicit `original_mcp_input_schema` authority marker. Enhancement data may guide planning but never changes invocation validation.
- Migration 0053 extends the model-stage route constraint. Server startup must apply every forward migration; the static Compose/migration gate rejects any migration file omitted from the runtime list or lacking a rollback pair.

## Consequences

Operators must configure and publish the `tool_enhancement` stage before registering a new MCP Server. Refresh remains available without a model call when every discovered Tool already has preserved metadata, but adding a Tool requires the stage. Rolling migration 0053 back deletes the `tool_enhancement` route before restoring the previous constraint; Provider and Prompt records remain intact.
