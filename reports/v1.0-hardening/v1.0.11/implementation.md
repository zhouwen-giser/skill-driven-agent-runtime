# v1.0.11 Implementation

Date: 2026-07-16

ADR-082 adds a domain-owned complete MCP Tool execution-semantics model. An available validated
MCP discovery declaration is authoritative, a complete administrator override is retained and
used only when discovery provides no declaration, and all remaining Tools receive the conservative
`default_unknown` snapshot. LLM Tool Enhancement remains descriptive and is never consulted by
the authority resolver.

The official MCP 1.29.0 adapter translates `execution.taskSupport`, explicit read-only/destructive
annotations, and the exact `_meta["io.sdar/tool-execution-semantics"]` extension into the
protocol-neutral application port. No SDK type crosses the adapter boundary.

Planning metadata carries effective semantics. Migration 0063 persists declared/admin/effective
Tool values, the call-time snapshot on every MCP Invocation, and the Planner-time snapshot on every
immutable Workflow plan and attempt. Confirmed repair planning cannot replace that snapshot. The
management API and Console expose Tool values and administrator input; the plan confirmation UI
renders the immutable Planner snapshot and Skill Tool Policy renders current registered semantics.

This increment adds no MCP Task binding, remote Task polling, device state authority, or device
conflict control.

Feature commit/tag: pending / `v1.0.11`.
