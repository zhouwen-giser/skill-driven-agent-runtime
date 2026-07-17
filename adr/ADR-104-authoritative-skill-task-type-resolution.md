# ADR-104: Authoritative Skill Task Type Resolution

## Status

Accepted on 2026-07-17.

## Context

Phase 8 must resolve a Skill Task Type to registered Provider operations and enforce required,
preferred, forbidden and attribute policies without inventing a capability ontology or trusting
LLM-generated Tool enhancement text. The supplied design does not define another authoritative Task
Type registry or Provider certification store.

## Decision

- A Skill Task Type matches the registered MCP operation name exactly. Matching is case-sensitive and
  does not use fuzzy text, descriptions, enhancement tags or model output.
- The existing `serverId` remains Provider identity. Only enabled Servers and operations with validated
  V1.1 `McpTaskOperationSemantics` are candidates.
- Candidate attributes are a deterministic projection of that exact semantics snapshot: Task
  execution/availability/cancellation kinds plus scheduling, max-elapsed and observation support.
  Required attributes use exact set inclusion. An unknown certification or attribute has no evidence,
  filters the candidate out and fails closed.
- The Phase 8 adapter reads candidates through a narrow catalog Port and reads live readiness through
  the existing `TaskAvailabilityBatchReader`. Its summaries reuse Domain-owned V1.1 risk, windows,
  possible-effect and reservation types.
- Required Providers cannot fall back. Preferred Providers fall back only when the Skill adaptive
  contract explicitly permits it. Forbidden Providers are removed before any readiness decision.
- Expired results, malformed restricted hints, Provider errors and guaranteed reservations without a
  non-empty reference become `unknown`, never `ready`. The existing V1.1 exact-argument
  pre-invocation guard remains final authority.
- Usage-aware selection is always wired when Skill selection is enabled. If V1.1 Task metadata is not
  enabled, the existing catalog returns no Task candidates, so native bindings fail closed instead of
  bypassing readiness; legacy and native Skills without bindings remain compatible.

## Consequences

The implementation is deployable without a parallel registry, schema migration or mutable Provider
state inside Skill. A future authoritative certification source requires a new reviewed contract and
migration; it cannot be inferred from enhancement tags.

## Rejected Alternatives

- LLM Tool tags as hard attributes: model-generated metadata is not Provider or administrator
  authority.
- Fuzzy Task Type matching: may select an undeclared side-effecting operation.
- Persist readiness on `SkillVersion`: turns live Provider state into stale package authority.
- Add a second Provider registry: duplicates existing MCP Server/Tool identity.
