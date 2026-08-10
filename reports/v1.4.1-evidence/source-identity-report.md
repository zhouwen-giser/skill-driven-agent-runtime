# Phase 1 Source Identity Report

## Identity rule

Every planned stable record ID has the tuple:

```text
source system / source table-or-aggregate / source record identity /
source revision-or-canonical-hash / schema name / schema version
```

Transport sequence, capture time, delivery attempt, retry time, and sink ACK state are excluded.
Phase 2 will freeze the exact canonical JSON and lower-case SHA-256 encoding; this inventory freezes
which authoritative fields feed that algorithm.

## Identity classes

1. **Immutable primary-key fact.** The primary key plus canonical source-row hash is the revision.
   Examples: `mcp_invocation.invocation_id`, `control_audit_event.audit_id`, and
   `artifact_feedback.feedback_id`.
2. **Explicit versioned fact.** The aggregate ID plus version/revision is the identity, with a
   persisted checksum/hash where present. Examples: configuration, capability, exposure, Agent
   Card, readiness, and dataset revisions.
3. **Mutable aggregate snapshot.** A lock version/generation/status timestamp plus canonical row
   hash distinguishes revisions. The projector cannot overwrite an earlier canonical revision.
4. **Structured persisted subrecord.** Parent identity plus a schema-required child ID/key and the
   parent source hash identify trace events, activities, process variants, dependencies, recovery
   patterns, and replay metric results. Missing child identity is a projection issue, not a guessed
   ordinal.
5. **Control event.** `event_id` is stable; `aggregate_revision` and payload hash detect replay
   conflicts. `sequence` is a cursor only and never part of the canonical stable ID.

## Cursor rules

- Cursors are scoped per source family and partition. No global cursor is valid.
- Runtime rows use stable source timestamp plus source identity as a deterministic tie-break unless
  a table provides a stronger monotonic version.
- Control Node Events use their sequence for acquisition, then enforce non-regressing aggregate
  revision and stable event ID/payload hash.
- A checkpoint advances in the same Runtime transaction as all canonical outbox rows derived from
  the acquired source unit.
- A partial batch or mapper failure cannot advance beyond the first unprojected source identity.

## Identity defects closed by policy

- Summary-only `runtime_event` rows are not used to reconstruct structured evidence.
- No fact is sourced solely from a prompt, hidden model reasoning, log message, test report, or
  Redis wake payload.
- No mutable row without a version is treated as one forever-stable fact; canonical row hash makes
  each observed revision explicit until the source gains a native revision.
- A structured JSON child without its required ID/key fails projection instead of receiving an
  array ordinal or random UUID.

The exact per-record source identities, revision rules, timestamps, cursors, references, and
redaction/artifact policies are in `source-to-evidence-matrix.csv` and its JSON twin.
