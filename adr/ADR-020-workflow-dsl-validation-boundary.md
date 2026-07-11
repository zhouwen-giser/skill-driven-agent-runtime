# ADR-020: Workflow DSL and validation boundary

## Status

Accepted on 2026-07-12.

## Decision

- Domain owns serializable WorkflowDefinition, ten whitelisted node kinds, edges, and a recursive restricted expression AST.
- `schemas/workflow-dsl.schema.json` is the authoritative draft-2020-12 shape and contains no executable source fields.
- Application parses untrusted LLM/admin JSON strictly and rejects unknown nodes and properties.
- Validation covers unique IDs, references, entry/exits, reachability, condition branches, loop bounds 1..100, current MCP Tool argument Schema, and current enabled Skill input Schema.
- Validation is read-only: it cannot compile, execute, call a Tool, mutate a running graph, or interpret source code.

## Consequences

Only validated data may enter future persistence/compiler stages. DSL support does not yet claim LangGraph execution coverage for every node.
