# P04 Independent Read-only Review

Review scope: P04 implementation `11d13d08d3d72d76cabb4b85fce8cac0967478d3`, frozen SMPP/MCP
authority design, Node Control API contracts, Domain/Application/HTTP adapter/PostgreSQL/Worker
composition, migrations, focused tests and full verification evidence. Each review pass was
read-only; the single repair was performed afterward in the main implementation phase and all
affected gates were rerun.

## Blocking

None.

## Major

None open. One Major finding was closed before acceptance:

- Candidate persistence retained Snapshot revision and checksum, but the candidate-directory API
  projection omitted that Registry lineage. The directory entry now carries `registryRevision`,
  `registryChecksum`, `registryEtag` and `registryValidUntil` while retaining `catalogRevision`.
  The real multi-source PostgreSQL/API test verifies the exact values.

## Minor

None.

## Accepted

- Registry remains a Provider candidate directory only. Candidate types and persistence contain no
  Tool Schema, Task Profile, live health or Availability authority; P05 import and live
  `server/discover + tools/list` remain downstream.
- Stable identity is exactly Source + external Provider + external Server. Identical external IDs
  across two Sources remain isolated, and Registry/Catalog lineage survives the public projection.
- Snapshot validation is deterministic and bounded. Checksum mismatch, expiry, rollback and
  same-revision drift are visible failures and cannot replace the active pointer or candidate LKG.
- Source revisions are monotonic and atomically activated with one active revision per Source. A
  failed newer draft cannot hide the prior active revision, and idempotency is rechecked under the
  per-Source advisory lock.
- `allow_unexpired` preserves an unexpired LKG during outage; `deny_when_unavailable` fails closed.
  TTL is bounded by both local policy and external expiry.
- HTTP refresh uses conditional ETag and always fetches authoritative Latest. Poll/Watch and Worker
  cycles are hints only; Redis owns no Snapshot or candidate authority.
- Credential material is resolved only from an opaque SecretRef at the HTTP adapter boundary and is
  excluded from responses, operations and audit. The full-history secret scan has zero findings.
- A Registry outage does not write Runtime business tables or alter an already executing Task.

Verdict: 0 Blocking, 0 Major, 0 Minor; P04 is acceptable for evidence publication.
