# ADR-158: Governed TaskBusiness mutations on the original admitted Task

Status: Accepted (local implementation scope, 2026-10-10).

The frozen TaskBusiness protocol exposes non-firing RequiredInput responses and running navigation
Interventions. Original RemoteTaskInputService sends before recording the first intent, while the
original governed-control confirmation is scoped to a Tool invocation. Neither permits an always-true
mutation callback or a second Task execution mechanism.

Reuse original trusted principal, GovernedControlManagementService/ConfirmationService and the native
governed_control_confirmation table. A narrow server-owned authority reader derives the immutable
business intent from the original Task/Capability/Skill/plan/Provider authority. Its arguments hash
covers the entire business command. A receipt for the original Tool arguments cannot authorize it.

Mutations additionally require an explicit published Capability constraint
`task_business_mutation_policy` and matching Skill runtime policy. Existing published versions grant
no implicit business mutation permission. This is an additive internal policy, not a SMPP wire field,
authentication system, baseline change or automatic Source/Provider/Skill successor publication.
Only `continue_observation` accept content, content-free decline/cancel, and navigation.adjust_plan
are in scope. Weapon and independent lock operations remain denied.

Store immutable intent and state-transition facts as tagged native remote_task_observation records
under the original binding lock, like ADR-157. Lock original Goal, Task and binding at the final
boundary, rederive native authority, recheck the exact current request/Intervention, consume the
original one-use confirmation and append dispatching in one PostgreSQL transaction before the
transport sends. A lease expiry grants read reconciliation only; it never grants another send.
No new table, SDK, workflow runtime, private upstream write or universal exactly-once claim.

RemoteTaskInputService retains its native input link/attempt and continuation path; a supported
TaskBusiness request routes through this journal, with no fallback to the legacy plain sender.
Navigation uses the same original Task through a management control entry while it is running.
Runtime acknowledgement is accepted evidence; matching business objects establish application.
Navigation requires its exact commandId and adopted route. RequiredInput has no client commandId
wire field: preserve its correlation limitation, and keep lost-ack causation uncertain even if a
matching original request is now fulfilled. Reconciliation is bounded, read-only and restart-safe.

When an optional Provider deadline is absent, the local intent expires after ten minutes.
This is a local review limit and does not invent a Provider deadline. A present deadline
is respected exactly; every send still rechecks the current request and its original authority.

Cancellation/Goal patch before the claim prevents sending. A command that wins the boundary may
already be in flight; later cancellation cannot withdraw a packet. Pending/uncertain commands fence
old-version write takeover in the rollback preflight. Selected site operations remain NOT_RUN.

Validation: AC-019–030 and AC-039–044 require real native PostgreSQL, authority-negative zero-wire,
single-sender/cancel/crash races and both formal Registry/Skill/Task isolated E2Es. Implementation
or this ADR alone is not acceptance evidence.
