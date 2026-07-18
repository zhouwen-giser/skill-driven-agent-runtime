# ADR-102: Reuse V1.1 Provider Readiness and Continuation Authorities

## Status

Accepted on 2026-07-17.

## Context

V1.1 already owns MCP Task discovery, availability/timing, readiness, Provider observations, remote
bindings, external-wait continuation, input, cancellation, reconciliation and restart behavior. V1.2
Skills express Task Type demand and Provider policy but must not duplicate live resource state.

## Decision

- Phase 8 implements `SkillTaskReadinessPort` as a read-only adapter over the existing
  `McpTaskOperationCatalog` and `TaskAvailabilityBatchReader`. It directly consumes the Domain-owned
  `TaskAvailabilityCheckRequest`, `TaskAvailabilityReadResult`, `TaskAvailabilityCheckResult`,
  `TaskExecutionTiming`, availability-window and reservation types; it does not clone their enums.
- The Phase 4 mock remains explicitly test-only until that adapter exists. Its projection maps
  `available → ready`, `restricted → restricted`, `disabled → unavailable` and `unknown → unknown`;
  transport/protocol/capability uncertainty never becomes available.
- Phase 8 preserves Provider ID/operation candidates, `validUntil`, earliest/multiple windows,
  reservation mode/reference, risk and possible-effect evidence needed for policy decisions.
- Required Provider unavailability is a hard block. Preferred fallback requires Skill permission;
  forbidden is always filtered. Guaranteed readiness requires a valid Provider reservation reference.
- Immediately before invocation, the existing V1.1 readiness service repeats the exact-argument check.
  Skill-level readiness cannot reserve resources or override that result.
- Remote execution reuses `RemoteTaskBinding`, persisted frontier continuation, input/cancel/reconcile,
  Provider terminal state and startup recovery exactly as implemented in V1.1. No Skill-specific queue,
  polling loop, external-wait state machine or retry policy is admitted.

## Consequences

Phase 4/5 abstractions are aligned to final V1.1 Domain/Application boundaries while production wiring
remains correctly deferred to Phase 8/10. Provider authority and one-runtime semantics are preserved.

## Rejected Alternatives

- Copy V1.1 availability enums into Skill code: creates divergent truth.
- Cache live resource state in a Skill version: makes declarative packages operational authority.
- Resume remote work through a new Skill runtime: duplicates continuation and recovery behavior.
