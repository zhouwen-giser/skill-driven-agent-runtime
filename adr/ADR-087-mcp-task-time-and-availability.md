# ADR-087: MCP Task Availability and Time Semantics

## Status

Accepted on 2026-07-16.

## Context

A Provider can advertise Task operations yet restrict when a Task may start. Forecast availability, accepted reservation, Provider reachability, protocol TTL and business maximum elapsed time are different facts. Collapsing them would let an LLM bypass a deterministic safety boundary or falsely report a Provider-side terminal state.

## Decision

- Store separate operation capability, availability snapshot, execution-time contract and observation timestamps.
- Availability is checked at planning and refreshed immediately before Tool invocation. Unknown, expired or contradictory data fails closed for restricted execution.
- The LLM may select only from system-generated permitted actions and produces a schema-constrained risk decision. A deterministic guard makes the final allow/replan/wait/reject decision.
- `immediate` and `scheduled` starts are explicit. `earliestStartAt`, `latestStartAt`, forecast confidence and optional reservation identity remain distinct.
- `maxElapsedMs` is a Provider-enforced business wall-clock contract. SDAR stores its request/result evidence but does not run the business timer or fabricate its terminal outcome. `ttlMs` is protocol/resource lifetime and cannot substitute for it.
- Provider unreachability causes bounded observation retry and warning, not a business timeout. Provider-reported missed-start and maximum-elapsed outcomes are distinct structured business results.

## Consequences

Plans and the Console can explain why a restricted Task is allowed, deferred or rejected. Provider contract tests must control time deterministically and cover boundary equality, stale snapshots, clock skew, unreachable Providers and late observations; SDAR tests must prove it never substitutes its own timer outcome.

## Rejected Alternatives

- Trust discovery metadata until execution ends: availability changes over time.
- Let the LLM decide without a guard: violates restricted execution and confirmation invariants.
- Reuse BullMQ job TTL as business timeout: infrastructure expiration does not express Provider/task semantics.
