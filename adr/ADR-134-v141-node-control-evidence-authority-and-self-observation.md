# ADR-134: Preserve Node Control Evidence Authority and Bound Export Self-observation

## Status

Accepted on 2026-08-10.

## Context

Phase 9 projects 21 Node Control governance record types into Canonical Evidence. Most facts are
owned by Control PostgreSQL, while export delivery and receiver responses occur in Runtime. The
existing Catalog pointed health at a `node.health.changed` outbox event that no producer wrote,
spelled the Capability readiness event incorrectly, selected Plan Template audit actions with the
wrong separator, and treated mutable `evidence_export_state` as delivery and ACK history. Those
sources cannot reconstruct the required facts after reconnect or audit a retry.

Exporting delivery Evidence also observes the Evidence exporter itself. Without a machine-readable
generation boundary, a delivery record could create another delivery record indefinitely.

## Decision

Control PostgreSQL remains the sole authority for Node Profile, health, configuration, provider,
route, SMPP, MCP binding, Skill, Plan Template, Capability, A2A, Agent Card, operation, audit and
frozen Node Event facts. Runtime has read/project authority only. Redis may wake work but owns none
of these records.

Health is an append-only `sdar_control.node_health_observation` fact containing a stable
`observation_id`, exact Node health payload, `observed_at` and generation zero. Its successful
Control transaction also emits `node.health.changed`. A health observation is never reconstructed
from an event payload alone. Capability readiness selects the exact frozen event type
`node.capability.readiness_changed` and joins its causative `management_operation.result` so the
Evidence payload contains the real exact-version readiness snapshot. Skill governance selects
`skill.*`; Plan Template governance selects `plan-template.*`.

Runtime export history uses two append-only ledgers. `evidence_export_batch` is inserted before a
send attempt with a new `batch_id`, positive `attempt_no`, exact sequence range, record count and
batch hash. Its only delivery status is `attempted`; it is never updated to pretend that an attempt
proves delivery. Every retry inserts a new batch. `evidence_export_ack` appends the receiver
response bound to that batch and hash. Its disposition is `accepted`, `partial` or `rejected`.
Only an accepted or partial in-range ACK may advance mutable acknowledged state. A rejected ACK is
retained with an error code and cannot advance that state. All outbox and acknowledged sequences
cross TypeScript and JSON boundaries as canonical unsigned decimal strings without leading zeroes.

`node_control.telemetry_configuration` is the immutable publication snapshot for one Control
configuration revision. Its source identity is `configuration_id:revision` and its source revision
is that positive Control revision; the checksum remains in the payload as the content-integrity
proof. The observation ledger records that logical snapshot once rather than replaying later
apply-status mutations under the same identity. Delivery points to this exact revision and ACK
points to its exact delivery batch. Neither record points backward to mutable
`evidence_export_state`; Phase 10 derives Export Status from the immutable ledgers and current state.

`CanonicalEvidenceEnvelope.observationGeneration` is optional and restricted to `0 | 1`; omission
means zero. Source/business facts are generation zero. When a batch contains any generation-zero
record, its batch and ACK ledger projections are generation one. A batch containing only
generation-one records is still exported, but it cannot create child batch or ACK observations.
Values above one are rejected by the Domain constructor and JSON Schema. Telemetry delivery and
ACK Evidence require an explicit top-level generation of one.

Projection resumes from independent source checkpoints and the Control Last-Event-ID cursor. After
loss or reconnect, the projector reconciles event identity with authoritative GET/Control tables,
never decreases aggregate revision, and reports a conflict when one Event ID has another payload
hash. Checkpoints advance only after the corresponding Evidence or durable issue is committed.
Every Control authority read requires the non-public service principal
`service:node-control-evidence-projector:<nodeId>`, the dedicated
`node_control.evidence.read` permission, `global_authority` scope and access to the three frozen
data classifications. This identity is constructed only by the internal Node Control composition;
an Organization, viewer, operator, security or user API principal cannot be substituted and no
HTTP route exposes the projector. The global scope is intentional for this single Control
authority and does not grant write access. Tenant, project and organization identifiers from an
authority row are preserved in the Evidence scope and any mapper conflict fails closed.
Credentials, secrets, private reasoning, Physical Command and Physical Feedback facts are
excluded.

An Evidence reference is mandatory only when the authority persists an exact immutable identity
and revision. Generic Node Events retain their causation and resource identity in payload because
their producers have different causal authorities. Direct MCP bindings, Model Routes without a
frozen Provider revision, draft Configuration/Profile revisions and non-paired Operation/Audit
facts do not invent references by selecting the latest or nearest row.

## Consequences

- All 21 `node_control.*` Catalog payloads have explicit required-field schemas and closed authority
  vocabularies; generic name inference cannot silently accept a required Phase 9 field.
- The Phase 9 Control migration must add the immutable health authority and producer transaction.
  The Runtime migration must add immutable batch and ACK ledgers; mutable export state remains only
  a current-state projection.
- The Runtime source/projector must map bare Control SHA-256 columns to canonical
  `sha256:<lowercase-hex>` Evidence hashes and must not expose credential references.
- Recovery and replay are idempotent by immutable source identity, revision, batch ID, ACK ID and
  payload hash. Duplicate identity with different content is a blocking conflict.
- Delivery telemetry is auditable without recursive self-observation or falsely claiming that a
  pre-send attempt was received.
