# ADR-144: Passive Benchmark and Provider closure debug

Status: Accepted (user-approved 2026-08-26)

## Decision

Extend the explicitly selected trusted-intranet debug composition with Benchmark.
Production defaults are unchanged. Passive mode disallows active Run creation and
dispatch; it does not control SDAR's independently authorized physical side-effect gate.
Frozen registry metadata is initialized idempotently; missing executable rules stays
blocked, never a score of zero or a fabricated evaluation.

Runtime PostgreSQL remains the remote-task authority. Canonical Binding Evidence
exports credential-safe identity from the task's immutable authority snapshot, not
current registration. Additional observation scope is not login or tenant isolation.
Historical records/hashes are not relabeled or rewritten.

Benchmark PostgreSQL owns its immutable first ingestion boundary, exact source scope,
registry, jobs and checkpoints. Telemetry Control PostgreSQL owns Provider closure
work, leases and checkpoints. ClickHouse holds immutable result snapshots; manifest
publication follows all details and consumers pin one snapshot. Provider origin/trace
hints cannot replace binding identity or establish task/physical success.

The production Provider v2 adapter truthfully identifies Canonical Binding Evidence
as its input and the frozen Runtime snapshot as the underlying authority. It does not
invent fields to impersonate the old wide `sdar_core.remote_task_binding` projection.
RC2 and v1 contracts remain intact; the v2 extension is explicitly versioned and
validated on both producer and consumer sides.

## Supersession and consequences

Supersedes ADR-143's generic startup blocking on missing Commander/NPC configuration:
that optional layer now reports waiting configuration without claiming ACTIVE.
Schema/contract drift still blocks its affected pipeline. No second workflow runtime,
new business state owner, synthetic source, historical backfill or Task dispatch is
introduced. Deployment owns DDL/grants; Benchmark business processes read facts and
only Projector may write the frozen Benchmark meta/mart allowlist.

External warehouse access uses two dedicated identities. Both receive SELECT only
on the frozen Evidence, Domain, ProviderOps, Benchmark relations and the exact
dependencies of ordinary ClickHouse views. Only Projector receives INSERT, and only
on the 40 tables exported by `WRITABLE_PROJECTION_TABLES`. Wildcards, database-wide
grants, roles, grant option, DDL, UPDATE and DELETE are prohibited. Credentials live
only in the private debug state and are never mounted into unrelated roles.

Global frozen registry metadata and scoped observation data are different
authorities. Benchmark meta projection uses `global/global`; episode reads use the
persisted debug tenant/project/environment/origin boundary. Service availability,
source data readiness and formal scoring eligibility are independent signals: an
HTTP-ready passive service may report `waiting_source`, and lack of executable rules
must remain a scoring blocker rather than a zero or synthetic score.

The debug-only scope-defect recovery is deliberately narrower than a generic DLQ
retry. It accepts one fixed error fingerprint and five frozen meta source types,
cross-checks Dead Letter and Outbox identity, validates every payload through the
production global mapper, requeues transactionally, and resolves rather than deletes
the original audit rows. Any unrelated unresolved failure remains fail closed.
