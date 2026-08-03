# P12 Completion Report

## Goal

Expose the frozen organization-facing single-node profile and durable Node Event stream while
preserving Control/Runtime authority boundaries and treating events only as change hints.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `e96f26b3ef6e37522261e64f6890e2729892335f`
- implementationSha: `7eb5b83ce042244e6d70eb928ad5d456121f4ebf`
- fullVerifyCandidateSha: `a787cbf0130a74b894b88aba6706782b654c59ff`
- evidenceSha: `PENDING_EVIDENCE_COMMIT`

## Implementation

- Added immutable Node Profile revision history, draft/validate/publish commands, opaque ETags,
  idempotency receipts, ManagementOperation and Audit persistence in Control PostgreSQL migration
  `0008`.
- Added the exact 20-event frozen catalog, append-only Control event outbox, Event ID/aggregate
  revision/correlation metadata and durable `Last-Event-ID` recovery. SSE is a wake/change hint;
  every consumer recovers authoritative state through GET.
- Projected Control changes through database triggers and bridged only the two Runtime-owned facts
  required by P12 (`node.capability.readiness_changed` and `node.task.capability_bound`) through a
  durable source cursor. Redis owns neither event nor cursor authority.
- Added organization service-principal RBAC for the frozen read profile, with separate constant-time
  bearer validation. Configuration, LLM, SMPP, MCP, Skill/PlanTemplate internals, telemetry
  internals, Audit and all writes remain forbidden.
- Added safe TaskSummary list/detail projections from Runtime PostgreSQL. Request text, user identity,
  workflow internals and LangGraph state are never returned; conditional Task controls are explicitly
  disabled.
- Added real Control/Runtime PostgreSQL acceptance coverage for Profile publication, idempotent
  replay, Runtime event bridging, SSE reconnect/refetch, health limitations and organization Task
  reads.

## Acceptance

| P12 criterion | Result | Evidence |
|---|---|---|
| Minimal Profile/Version/Health without Runtime DB or LangGraph internals | passed | public contract and real dual-database vertical |
| Capability, readiness, A2A and configuration summary remain bounded | passed | frozen route profile, existing authoritative GETs and forbidden organization configuration reads |
| Event ID/revision/correlation and reconnect recovery | passed | migration `0008`, Runtime migration `0143`, SSE contract and real Last-Event-ID/refetch vertical |
| Organization RBAC and stable API profile | passed | separate bearer identity; positive allowlist and forbidden Audit/write contract cases |
| No organization tree, multi-node orchestration or Console BFF | passed | architecture/read-only review; no Console or orchestration production changes |
| No page-specific DTO | passed | frozen NodeProfile, NodeEventEnvelope and TaskSummary schema fixtures |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit/Contract | passed | 3 files, 9 tests |
| real PostgreSQL/Redis Integration | passed | 30 files, 149 tests |
| formatting/lint/typecheck/architecture/build | passed | 644 TypeScript sources; frozen contract 76 files / 28 schemas / 111 operations / 20 events / 7 fixtures |
| migration verification | passed | 36 additive Runtime migrations through `0143`; 8 Control migrations with `0008` rollback/reapply coverage |
| `pnpm verify` | passed in 617,519 ms | 937 Unit + 22 performance, 220 Contract, 149 Integration, 72 E2E; build and all smokes |

The accepted exact-commit report is `reports/verification/summary.json` for
`a787cbf0130a74b894b88aba6706782b654c59ff`, with SHA-256
`46751c8746147618f80ac090503bf639693682e2abfa3ced1bf1778f20ab679a` and
`dirty=false`.

## Real / simulated / unverified

Control and Runtime PostgreSQL migrations, Profile governance, TaskSummary reads, event persistence,
SSE reconnect, authoritative GET recovery, Redis reachability and process smokes are real local
evidence. Organization hierarchy, multi-node orchestration and conditional Task control were not
implemented and are not claimed. Live Runtime reachability is not probed by the Profile health
projection; it reports explicit `degraded` status instead of claiming false health.

## Review and failed attempts

The read-only Review closed 3 Major and 2 Minor findings; final verdict is 0 Blocking, 0 Major and
0 Minor. All retained failures, causes and reruns are recorded in
`failed-attempts/p12-organization-profile-events.md`.

## Handoff

P12 is `COMPLETED` locally. P13 may implement only security, recovery, operations and upgrade
hardening. It must preserve the single event stream, organization allowlist and the independent
Control/Runtime PostgreSQL authorities.
