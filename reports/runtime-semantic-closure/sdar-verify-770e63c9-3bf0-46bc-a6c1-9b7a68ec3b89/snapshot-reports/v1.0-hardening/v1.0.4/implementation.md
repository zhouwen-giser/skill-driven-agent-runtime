# v1.0.4 Implementation

Date: 2026-07-15

## Outcome

Simulation and historical replay now carry immutable domain-owned execution context through LangGraph MCP, Subworkflow and `skill_call` boundaries. Skill Evolution derives stable identities from the formalization candidate plus case or historical experience. Live execution uses an explicit live default and sends no isolation Header.

`McpRegistryService` rejects reserved credential Header names case-insensitively, sanitizes legacy decrypted credentials, and writes canonical `X-SDAR-Execution-Mode` and `X-SDAR-Simulation-Id` values last. The official transport receives both the final Header set and typed context; invocation audit stores execution mode/ID without credential material.

ADR-075 records the authority and propagation decision. SDAR provides wire metadata only; the MCP Server remains responsible for compatible simulation/replay behavior.

## Migration

`0056_mcp_execution_mode` adds constrained `execution_mode` and `simulation_id` columns plus an audit index. The rollback drops the non-live association fields and must be preceded by an audit export when that evidence matters.
