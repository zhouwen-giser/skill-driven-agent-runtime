# P05 Independent Read-only Review

Review scope: P05 implementation commits `df02cdf`, `a6a5e0f`, `a2fd316` and `f409911`; frozen
MCP/SMPP authority design; Domain/Application/HTTP adapter/PostgreSQL composition; migration;
focused tests and full verification evidence. Every review pass was read-only. Repairs were made
only after ending the applicable review pass, followed by affected-gate reruns.

## Blocking

None.

## Major

None open. Five Major findings were closed before acceptance:

- Refresh could reactivate suspended/removed Bindings. The lifecycle now rejects terminal refresh
  and invalid terminal transitions while preserving exact idempotent replay.
- A second unchanged observation of a drifted Catalog could implicitly approve it. Every refresh now
  compares against the last approved active checksum, so repeated drift remains degraded.
- Concurrent different binding IDs could claim one localServerId because only binding identity was
  locked. A localServerId advisory lock serializes the uniqueness check and insert.
- The initial endpoint allowlist did not prevent automatic cross-authority HTTP redirects. The
  production Catalog client now uses manual redirects and fails closed before following one.
- The first retention fixture proved only that an Agent Task row survived. The accepted test now
  creates a real Runtime `remote_task_binding`, queries it and obtains its poll-control lease after
  the Control Binding is removed.

## Minor

None open. One Minor finding was closed: Tool entries are sorted by exact name before hashing, so a
non-semantic list reorder does not create false Catalog drift.

## Accepted

- Registry Snapshot rows remain a candidate directory and cannot create a selectable Binding.
- Explicit Direct and exact-lineage SMPP imports both require real `server/discover` and
  `tools/list`; SDK/wire types do not cross into Node Control Domain.
- Catalog fingerprints cover protocol/server metadata, names, descriptions, input/output schemas,
  protocol mode, execution semantics and Task profiles. Drift and expired Availability fail closed
  for new selection.
- Suspend/remove append immutable revisions, cannot reactivate through refresh, and leave historical
  Binding revisions plus Runtime Remote Task authority intact.
- Only SecretRefs are persisted. Initial and redirected endpoints are allowlisted, credentials are
  not exposed in public results/audit, and Telemetry is not an accepted origin.
- PostgreSQL is the sole Control authority. Redis owns no Binding, Catalog, Availability or command
  result, and Control product code never writes Runtime business tables.

Verdict: 0 Blocking, 0 Major, 0 Minor; P05 is acceptable for evidence publication.
