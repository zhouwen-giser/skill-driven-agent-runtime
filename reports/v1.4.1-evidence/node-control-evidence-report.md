# Node Control Evidence Report

## Status

Phase 9 Node Control implementation and independent Review are `COMPLETED`. All 21
`node_control.*` Catalog records are implemented and verified. The generated registry remains
100 records, split into 95 Required and five diagnostic records. The five `evidence.*` records
remain `source_confirmed` for Phase 10; they are not represented as implemented by Phase 9.

This report does not claim that the Phase 9 full `pnpm verify` passed. The first full attempt
stopped at lint, and the listed findings were repaired. The second attempt passed all 1,058 Unit
and performance assertions, then stopped on one stale positive Contract fixture. The repaired
focused Evidence Schema Contract passed 10/10 directly. Per the user's instruction to stop
repeating intermediate whole-repository gates, the next complete `pnpm verify` is deferred to the
single Phase 14 final gate.

## Authority and projection path

Control PostgreSQL remains the sole authority for Profile, Health, Configuration, Apply ACK/LKG,
provider/route/binding governance, Skill and Plan Template governance, Capability/Readiness, A2A,
Agent Card, Management Operation, Audit, Node Event and the published Evidence Export
Configuration snapshot. Control migration `0009_canonical_evidence_authority` adds an immutable
observation ledger and health observations without granting Runtime any Control write authority.

Runtime migration `0146_v14_evidence_export_observation_ledger` owns the immutable delivery batch
and receiver ACK ledgers. Runtime PostgreSQL remains the Evidence Outbox/checkpoint/export
authority; Redis is wake-only and the external sink is never business authority. A fixed internal
service principal with `node_control.evidence.read`, `global_authority` and `node_local` scope is
required for Control reads. Public Organization, Viewer, Operator, Security and user principals
cannot substitute for that identity.

The composed path is:

```text
Control configuration revision
-> Runtime apply
-> Control ACK/LKG and frozen Node Events
-> privileged Control source + Runtime telemetry-ledger source
-> NodeControlEvidenceProjector
-> Runtime Evidence Outbox/checkpoint/issues
-> bounded single-flight exporter
-> mock sdar.evidence/v1 sink ACK
```

## Semantics closed

- Node Event recovery honors `Last-Event-ID` only for event partitions while non-event authority
  cursors remain independent.
- Same Event ID with a different payload hash fails with a stable conflict; aggregate revisions
  cannot regress.
- Repeated mutable Control snapshots retain exact source identity and use numeric authority order,
  never lexicographic bigint text order.
- Configuration Apply ACK references the exact published Configuration snapshot; LKG references
  the exact Apply ACK. Delivery references the immutable published Telemetry Configuration and ACK
  references the exact delivery batch.
- Delivery and ACK observations are generation 1. A pure generation-1 export creates no child
  batch/ACK observation, so generation 2 cannot occur.
- Credential and secret locators are recursively removed from projected Configuration payloads;
  tenant, project, organization and data-classification boundaries fail closed.
- Health authority and its Node Event commit atomically. Parallel source partitions use durable
  poison isolation and cannot advance a failed partition checkpoint.
- The Server exporter is single-flight and drains at most 32 successful partitions per tick,
  stopping on empty work or the first failed delivery to avoid both one-partition-per-second
  starvation and retry storms.

## Evidence

- Generated Registry: 100 total, 95 Required, five diagnostic.
- Generated source matrix: 95 `implemented_and_verified`, five `source_confirmed`.
- Node Control family: 21/21 implemented and verified.
- Evidence family: 0/5 implemented; 5/5 source-confirmed for Phase 10.
- Real PostgreSQL/Redis/HTTP vertical: 1/1 passed, including configuration publish, Runtime apply,
  ACK/LKG, Node Event, both projectors, Outbox, sink ACK, exact refs, generation boundary and
  credential redaction.
- Focused Evidence Schema Contract after fixture repair: 10/10 passed.
- Independent read-only Review: Blocking 0, Major 0, Minor 0, Accepted.

## Full-gate history

1. First `pnpm verify` attempt stopped at lint. The exact unused-variable and array-style findings
   were repaired without changing behavior.
2. Second attempt passed format, lint, typecheck and 1,058 Unit/performance assertions. Contract
   then failed because the positive Skill-governance fixture used a generic action that did not
   match the frozen `skill.*` schema.
3. The fixture was repaired and the direct affected Contract suite passed 10/10.
4. No third intermediate full-gate run was performed. The user explicitly directed the work to
   avoid repeated full verification and run one final complete `pnpm verify` at Phase 14.

Phase 9 implementation and handoff are complete. Release-level full verification remains pending
and is not reported as passed.
