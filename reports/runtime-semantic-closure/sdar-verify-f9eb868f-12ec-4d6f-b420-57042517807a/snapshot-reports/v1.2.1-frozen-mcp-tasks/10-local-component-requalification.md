# SDAR v1.2.1 Phase 10 Local Component Conformance and v1.2 Requalification

Status: **COMPONENT CONFORMANT WITH BASELINE HOST AND CLEANUP LIMITATIONS**

The one-process Server now composes the Frozen subscription runtime instead of exposing only a reconnect
placeholder. Frozen invocation authority comes from the persisted discovery and Tool profile snapshot.
Task creation is admitted and then immediately reconciled through `tasks/get`; admission, polling,
Notification and reconnect reconciliation share PostgreSQL Runtime Revision authority, terminal control
events and the existing serialized continuation path. Later polling and Notification results are both
validated against the persisted Tool output schema.

The local Frozen Mock Provider is explicit and cannot be substituted for the Legacy Provider. It supports
discovery, Request Meta and routing headers, Tool task behavior/output schemas, Availability, flat Tasks,
MRTR, cancel Ack, Notification, Runtime/Provider revisions, Evidence A and deterministic embodied Tool
outcomes. Notification interests are re-authorized at send time. Its producer queue is bounded and fails
closed on overflow; the client also rejects an incomplete SSE event beyond its 1 MiB receive bound.

## Requalification

`embodied.move_to` passed guidance, template and procedure modes; synchronous and remote Task outcomes;
restricted pre-call readiness; input, cancellation, restart and Notification paths; Evidence A hard-gate
matching; and the zero-duplicate-`tools/call` assertions. `embodied.area_patrol` passed exact child version,
dynamic slot, parent/child execution tree, parallel remote child continuation, degraded projection,
evidence aggregation and Poll/Notification convergence. Its input/cancel/restart behavior continues through
the same protocol-neutral Workflow state machines now exercised behind the Frozen lifecycle adapter.

The historical Legacy v1.1 Handler remains explicit. The operator-managed acceptance mode re-ran the old
16-scenario report against real PostgreSQL/Redis without starting or stopping the existing Compose project.
The report verifier records all 16 scenarios passed with real/simulated classifications.

## Verification

| Gate | Result |
| --- | --- |
| eight focused Frozen contract files | passed 54/54 |
| `pnpm test:unit` | passed 78 files, 480 tests |
| `pnpm test:contract` | 166/167 passed; only Windows symlink creation failed with `EPERM` |
| operator-managed integration | passed 9 files, 84 tests against PostgreSQL 55443 and Redis relay 56379 |
| operator-managed E2E | passed 2 files, 60 tests |
| `SDAR_ACCEPTANCE_USE_EXISTING_INFRA=true pnpm demo:acceptance` | passed build, Provider 14/14, unit 480, integration 84, E2E 60 and 16/16 v1.1 scenarios |
| frozen migration 0107 verifier | passed empty/upgrade/idempotent/rollback/reapply/backfill/unsafe rollback/gap paths |
| frozen protocol package | passed 11 locks, 9 valid and 12 invalid fixtures |
| Management OpenAPI / baseline acceptance | passed 122 operations / 18 scenarios |
| architecture / format / lint / typecheck / build | passed; architecture covers 285 TypeScript source files |

The symlink failure occurs while the test fixture asks Windows to create a link, before product code runs;
all other 166 contracts pass. Phase 12 subsequently replaced the privileged Windows file-link fixture with
an equivalent directory-junction assertion and removed the isolated `sdar-codex-phase9` stack on 2026-07-22;
the final full gate passes all 168 contracts. Phase 10 makes only local component-conformance claims. It does
not claim interoperability with `sdar-mcp-tasks-provider-runtime`; that is the external component gate and
real HTTP certification owned by Phase 11.
