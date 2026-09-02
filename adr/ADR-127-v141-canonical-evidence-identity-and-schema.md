# ADR-127: v1.4.1 Canonical Evidence Identity and Schema

- Status: Accepted
- Date: 2026-08-04
- Scope: `sdar.evidence/v1` Domain and external contract

## Context

Evaluation evidence must survive replay, process restart, duplicate projection, and at-least-once
delivery without creating a second business authority. Random IDs, transport sequences, capture
timestamps, or retries would make an unchanged source snapshot appear to be different evidence.
Unbounded or generic payload schemas would also permit secrets, hidden reasoning, and incompatible
records to enter the formal chain.

## Decision

1. The only contract version is `sdar.evidence/v1`; schema version 1 uses JSON Schema Draft
   2020-12.
2. Stable record identity is lower-case SHA-256 over canonical JSON of this ordered tuple:

   ```text
   sourceSystem, sourceTable, sourceRecordId, sourceRevision-or-immutable-hash,
   schemaName, schemaVersion
   ```

   Its wire form is `evidence_<64 lowercase hex>`.

3. Canonical JSON sorts object keys, preserves array order, normalizes negative zero to zero, and
   rejects cycles, non-plain objects, undefined/non-JSON values, non-finite numbers, excessive
   depth, excessive size, and forbidden sensitive/private-reasoning field names.
4. `payloadHash` is `sha256:<64 lowercase hex>` over only the canonical payload. Evidence sequence,
   capture time, delivery attempt, retry, and ACK state are excluded.
5. Same stable ID with a different payload hash is a hard conflict, never an update or duplicate.
6. Every catalog record type has its own non-placeholder schema with a record-type
   constant, family/source constants, record-specific required payload fields, compatibility class,
   maximum inline bytes, redaction policy, artifact policy, and reproducible schema hash.
   The 2026-08-31 backward-compatible Consumer Sync extension raises the frozen registry from 100
   to 105 records (100 Required and five Diagnostic) by adding five MCP Task admission/reconciliation
   relation records without changing existing record schema versions.
7. Required references are unique and bounded. Oversized structured content crosses the boundary
   by `ArtifactRef`; credential/secret references may be opaque refs, but inline material is rejected.
8. Catalog lookup and enum handling fail closed. Mappers use the catalog-backed envelope factory,
   which derives schema/source/delivery policy instead of accepting arbitrary strings.

## Consequences

Reprojection of the same source revision is idempotent across processes and delivery retries. Schema
drift is detectable before deployment and at ingestion. Adding optional fields under the frozen
maximums is backward-compatible; changing required fields, identity inputs, meaning, or redaction
policy is breaking and requires a new schema version.

## Rejected alternatives

- Random UUID per projection: rejected because replay would create different evidence.
- Outbox sequence in identity/hash: rejected because transport state is not business evidence.
- One generic `{}` payload schema: rejected because it is unverifiable and unsafe.
- Hash of `JSON.stringify` insertion order: rejected because equivalent objects can differ by key
  order.
- Inline credentials or private reasoning with downstream redaction: rejected because unsafe data
  must never enter the canonical outbox.
