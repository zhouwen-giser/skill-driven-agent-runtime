# ADR-008: A2A task projection and follow-up actions

- Status: Accepted
- Date: 2026-07-11

## Context

The official A2A JavaScript SDK owns wire types and requires a `TaskStore`, while SDAR requires its richer Task lifecycle to remain domain-owned and persisted in PostgreSQL. A2A also models confirmation, supplementary input, pause and resume as later messages on an existing Task rather than as SDAR-specific protocol methods.

Using the SDK Task as the system of record would leak protocol types into the domain and create a second lifecycle. Adding custom HTTP methods would reduce A2A client compatibility and diverge from the requirement that confirmation be accepted through A2A follow-up messages.

## Decision

1. `agent_task` and the domain state machine are authoritative. `external_task_projection` stores a rebuildable A2A JSON projection only.
2. The official SDK `TaskStore` is implemented inside `packages/a2a-adapter` and reads/writes that projection through an application-owned, protocol-neutral repository port.
3. The single-process composition root lives in `apps/server`; adapters do not directly compose other infrastructure adapters.
4. A2A follow-up messages identify a whitelisted operation using metadata key `sdar_action`. The initial vocabulary is `confirm_plan`, `reject_plan`, `revise_plan`, `provide_input`, `pause`, and `resume`.
5. Unknown or missing action values on an existing Task are rejected at the A2A boundary. They are never interpreted as executable code or arbitrary commands.
6. The A2A executor maps the validated action to an application command. All transition validation, persistence and audit events occur through the domain/application lifecycle.
7. A2A clients receive only official TaskState values. Internal phases and waiting reasons are exposed as readable status messages.

## Consequences

- A2A SDK upgrades remain isolated to the adapter and projection mapping.
- Management API commands added in EP-04 must call the same application lifecycle operations, not mutate the projection.
- Projection rows may be discarded and rebuilt from authoritative records once complete message/event replay is available.
- `sdar_action` is an SDAR extension carried in standard A2A metadata; it must be documented for clients and covered by contract tests.
- Full pause interruption, long-pause replanning and final result production remain EP-04/EP-03 responsibilities; this ADR does not treat the EP-01 lifecycle skeleton as their implementation.

## Rejected alternatives

- Using the SDK TaskStore as the domain database: rejected because it creates a protocol-owned lifecycle and leaks SDK models across the adapter boundary.
- Custom confirmation/pause HTTP endpoints in the A2A adapter: rejected because follow-up A2A messages already provide a compatible extension point.
- Inferring actions from unrestricted natural language: rejected because it is nondeterministic and would bypass validated command semantics.
