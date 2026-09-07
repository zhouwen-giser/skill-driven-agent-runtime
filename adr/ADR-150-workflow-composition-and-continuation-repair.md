# ADR-150: Workflow composition and continuation repair

## Status

Accepted on 2026-09-07 following authorization to execute `execplans/EP-RUNTIME-SEMANTIC-CLOSURE.md`.
Implementation is incremental: route uniqueness, bounded supersteps and normative Skill failure choices
are implemented with focused regressions. Composition/continuation/child lifecycle changes remain pending;
acceptance of this decision does not certify those implementations or supersede the independent budget baseline.

## Context

The current audit reproduces incorrect conditional/parallel joins, premature success, recursion-limit
failures, ineffective fail-fast policy and an unrecoverable confirmation after external continuation.
Production subworkflow execution bypasses persisted child execution. The repair must retain one
LangGraph runtime, immutable definitions and the ordinary process-loss failure policy.

## Decision

- Domain owns serializable control-flow analysis, branch/iteration identities and execution outcomes.
  Validator and Compiler consume the same analysis. LangGraph alone schedules nodes; synthetic gates
  are compiler details, never Application-managed runnable jobs.
- A parallel join waits for each activated branch of the same fork invocation, not every static incoming
  predecessor. A conditional route satisfies only its chosen path. Arrival identity includes the fork
  node-run ID, branch ID and arriving node-run ID, so later loop iterations cannot reuse earlier arrivals.
- Version execution semantics. New parallel nodes require `joinNodeId` and
  `mergeStrategy: reject_conflicts`, as required by the original SRS. Preserve branch output provenance
  and reject conflicting writes to the same output slot. Legacy graphs permit only provably equivalent
  successor conversion; new graphs must pass unique convergence and branch ownership checks. Ambiguous joins, unbounded cycles and invalid
  routes return actionable planning errors. Bounded recovery and loop edges remain supported.
- Success requires a valid selected terminal path, no unresolved activated branch/wait/confirmation and
  the declared output obligations. It does not require every alternative exit or an unconditional result
  node: legacy definitions may use a non-result node as an exit.
- Loop iterations are scoped to each activation: outer 3 and inner 2 execute the inner action 6 times.
  Reset the current iteration on reentry, never accumulated calls or budget usage. Historical snapshots
  retain their original semantics and hashes.
- Derive a conservative recursive region-based superstep bound from the validated graph, loop/recovery bounds and compiler gate
  overhead. Use checked arithmetic and a configurable system complexity ceiling. Pass the resulting limit
  to initial execution, human resume and external continuation; preserve business budgets independently.
- Normative Skill failure policy restricts the model's available error-recovery choices. Generic handler
  strategy remains advisory within its existing semantics; `fail_fast` cannot continue. Cancellation and
  budget exhaustion cannot be caught as recoverable business errors.
- A process-local execution session retains the actual compiled graph, actual thread ID, runtime context,
  meter and control signal. A paused continuation retains that session; resuming uses the same graph and
  thread. Durable external-wait handoff and terminal/error cleanup release it idempotently.
- Independently persisted child graphs enter through the pinned Core public `runWithConfig` API,
  isolating SDK implicit parent checkpoint namespaces. Application authority and signals remain explicit;
  this uses the existing sole runtime and adds no dependency or copied SDK source.
- Add `paused` to the existing continuation-attempt outcome as an invocation handoff to human waiting,
  not a Workflow or A2A terminal state. Persist and project the same transition throughout the existing
  Application/Repository paths. No new Task state machine is introduced.
- Ordinary subworkflow and skill_call share a persisted child-execution link with
  `UNIQUE(parent_instance_id, parent_node_run_id)` and a separate child-instance reference. The child ID
  is not part of the idempotency key: concurrent reentry of one parent run must not create two children.
  A later loop iteration has a new node-run ID and may create a new child. Skill-specific selection/planning/version records remain in the
  Skill service. Ordinary subworkflows are not represented as fake Skills. Only one owner writes each
  child lifecycle fact; existing Skill rows reference or derive their projections from the common link.
- A changed child Skill version invalidates its prior proposal and requires parent replanning outside the
  frozen node run. It cannot allocate a replacement child under the same `(parent_instance_id, parent_node_run_id)`.
  Legacy Skill records without a provable node-run remain readable but cannot be guessed as the current call.
- A domain-owned child outcome explicitly distinguishes completed, paused/confirmation, external wait,
  failed and canceled. No nonterminal child can become a completed parent node by returning undefined.
- Preserve ADR-023's independent child limits and one parent call-cost reservation. Resolve child limits
  from its actual confirmed definition/Skill policies; reuse consumed usage across waits and confirmation.
  Propagate caller cancellation and remaining active-time deadline. The repair does not introduce a new
  all-descendants aggregate quota or reinterpret accounted units as provider billing.
- Caller AbortSignal reaches the existing ModelRuntime and provider transport, composed with provider
  timeout. A caller cancel/deadline prevents further retry/failover. Pause interruption must enter the
  existing resumable node-boundary semantics; an interrupted call is not recorded as successful.

## Compatibility and migration

Add a versioned continuation representation for branch-scoped joins; keep a validated reader for 1.0.
Old snapshots/hashes are immutable. Only uniquely reconstructable old branch evidence may produce a
new successor; ambiguity must fail closed and require a new plan without redispatching prior effects.
Additive migrations widen snapshot/attempt checks and add common child lineage. Migration numbers are
allocated against the current ledger at implementation time, after 0178 or any later existing entry.
The existing static `(parent_instance_id, parent_node_id)` Skill-call primary key and repository/confirmation
lookups must migrate together to node-run-aware identity. Historical calls without provable node-run
lineage retain a legacy identity; they are not assigned to a guessed later iteration.

Provide a read-only active-snapshot compatibility report before upgrades. A down migration refuses to
remove referenced new lineage or reinterpret new snapshots. Ordinary running/paused checkpoints still
fail on process loss; only the existing PostgreSQL external-wait recovery contract survives restart.

## Validation

Cross-products cover conditional/parallel/loop/recovery, remote waits in both completion orders,
duplicate/stale observations, repeated fork iterations, external-wait then human/child confirmation,
Goal Patch, pause/cancel and process loss. Real PostgreSQL/Redis with local cancellable Model/MCP servers
must verify status, parent-child lineage, budget, exact dispatch counts and no replay. Under the revised user-approved development scope, focused regressions close implementation batches;
one full reuse gate is required at the development acceptance point. Release acceptance remains deferred.

## Rejected alternatives

Static all-predecessor joins; arbitrarily huge recursion limits; only adding a compiled Map entry;
replaying from START; silently changing independent child budgets; persisting live LangGraph objects;
and a second Application scheduler are rejected.

Shared analysis treats singular handler goto as a structural edge. A finite forward handoff is legal; a backedge outside a declared bounded loop is rejected by cycle analysis. Explicit MCP recoveryOptions retain their existing bounded-attempt and handled-node constraints; this change does not invent retries for ordinary recoverable Skill composition. Deterministic newly generated Skill Usage definitions declare execution semantics 2.0.
