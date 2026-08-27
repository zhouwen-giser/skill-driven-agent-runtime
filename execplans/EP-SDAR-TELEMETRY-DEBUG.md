# SDAR Telemetry joint development integration

## Purpose / Outcome

Extend `pnpm ugv:debug` with the sibling sdar-telemetry-platform, external ClickHouse,
incremental-only Evidence/ProviderOps delivery, bounded diagnostic query federation and
real default-active domain projection. Preserve data, production defaults and the no-Task/no-Device
startup rule. User approved the complete plan on 2026-08-26.

## Requirements Covered

FR-A2A-001, FR-ADM-001, V141-EVIDENCE-PERSIST-001, V141-EVIDENCE-EXPORT-ACK-001,
V141-EVIDENCE-EXPORT-WIRE-001 and the user-approved joint-development scenarios.
Local acceptance IDs: SDT-DEBUG-001 orchestration; 002 incremental delivery; 003 query federation;
004 domain lifecycle/consumer; 005 scope/retention/failure safety.

## Context and Orientation

SDAR owns debug.sh, sanitized host environments and PostgreSQL Evidence delivery. SMPP Telemetry
owns ProviderOps WAL, independent target checkpoints and seven-day metrics/traces. SDAR Telemetry
owns Gateway WAL, canonical Evidence projections, domain mappings and Query/Admin APIs.
The external warehouse is configured at 192.168.1.7:8123. No external database reset is permitted.

## Architecture and Interfaces

- Optional Evidence `deliveryStart: retained | from_activation`; absent retains old semantics.
  Runtime PostgreSQL records a first-activation boundary under an insertion barrier, once per
  export ID. All send/ACK/backlog predicates share this range. Old records are never fake-ACKed.
- Existing sdar.evidence/v1 wire is unchanged. Internal ingest credentials remain required.
- New /v1/metrics, /v1/traces and /v1/traces/{traceId} delegate bounded reads to the fixed SMPP
  Query API. No arbitrary URL/SQL, duplicate ingestion or invented event/trace relationship.
- Domain configuration targets ACTIVE; real registration and schema/hash checks remain. A
  registered empty source can be ACTIVE/waiting_source. Missing registration is blocked, not
  fabricated. PostgreSQL owns lifecycle, fenced leases and checkpoints; CH holds derived facts.
- Scope domain reads by actual producer, tenant/project and persistent activation frontier;
  never scan another project's or pre-activation historical source rows.
- Development Query/Admin anonymous principal only; production auth remains the default.

## Progress

- [x] 2026-08-26 Read sources, user-approved plan and architecture/implementation skills.
- [x] 2026-08-26 Implement incremental Evidence; 8 isolated real-PG tests include repeated migrations and protected rollback.
- [x] 2026-08-26 Implement Query federation, domain lifecycle and real consumer; 183 component tests pass with real PG/test CH.
- [x] 2026-08-26 Extend generated config, independent SMPP routes, Compose and debug lifecycle; shell fault/route restart tests pass.
- [x] 2026-08-26 Run scoped gates, metadata/diagnostic smoke; update evidence/traceability. These are component gates, not completed live milestones.
- [ ] Supply real source registration and complete live activation/three-path incremental delivery/restart acceptance; full ExecPlan remains open.

## Discoveries and Surprises

- Existing Domain worker main starts only health/metrics, not a consumption loop.
- Existing Admin actions are queued but have no main-process lifecycle executor.
- Domain mappings consume Commander/NPC domain-source/v1, not SDAR Evidence or ProviderOps.
- Existing source reader defaults to 1970 and has no tenant/project filter; debug activation must
  not use this default on the shared warehouse.
- Existing Evidence exporter sends all unacknowledged rows and ACK checks all earlier rows;
  incremental mode therefore requires a formal range, not a launcher-side cursor edit.
- SDAR untracked historical acceptance reports are unrelated and must remain untouched.
- Repeated Runtime startup exposed a missing 0174 migration ledger entry; added up/down version
  tracking and real-PG first/repeat/down-up/unsafe-down regression before any live Runtime apply.
- Current external canonical Evidence table was absent. Applied only the existing reviewed,
  SHA-pinned additive 014 migration; metadata recheck passes 58 columns and ten mapping contracts.
- SMPP Source Mapping wire remains v4; only routing policy becomes v2. Changing the wire version
  would reject startup. New route is false for acceptAllMappings and applies only to new WAL snapshots.
- User clarification during implementation: Commander and NPC both consume SDAR data and require
  projections into their own namespaces. Existing code has only SDAR -> sdar_core and application
  domain-source -> sdar_embodied; registering application producers does not implement the missing
  SDAR -> Commander/NPC layer. The originally approved ten-mapping scope is therefore insufficient.

## Decision Log

2026-08-26: implement the approved dev-only active profile without modifying production defaults,
without a second business runtime and without a legacy telemetry relay. See ADR-143.
Incremental means newly enqueued records after activation, including subsequently arriving records;
old semantic references may remain incomplete. No completeness claim is inferred from ACTIVE.

2026-08-26 scope correction: the user explicitly deferred SDAR Evidence -> Commander/NPC;
leave that layer empty in this delivery. Do not disguise SDAR as a Commander/NPC producer or
synthesize HMI approval, blackboard, physical verification or application-specific facts.
The existing Commander/NPC -> embodied path remains in scope and requires real registered inputs.

## Implementation Steps

1. Add PostgreSQL activation range and API/domain validation; preserve legacy defaults and tests.
2. Implement fixed-upstream diagnostic federation and trusted-development API composition.
3. Persist domain lifecycle/actions/frontier and wire existing reader/mapper/writer under leases.
4. Generate private cross-project config, start/migrate services, bootstrap formal APIs and status.
5. Run focused unit/contract/integration plus typecheck/build/static gates; smoke read-only business
   paths. Record waiting-source or configuration blockers instead of generating fake observations.

## Validation

Required cases: old vs new records, concurrent append/activation, restart and revision idempotence,
ACK ownership/partial ACK, no historical ACK or scan; ACTIVE-empty vs unregistered vs drift vs
write failure; producer and tenant scope; lease loss/retry/target dedupe; anonymous dev vs production
auth; bounded query upstream errors; start/restart NO/YES, data retention, no Grafana/Task/Device.
Record exact commands/results in reports/sdar-telemetry-debug/verification.md. Whole-project gates
that fail on an unchanged baseline must be disclosed, never disguised as passing.

Results: SDAR 62 targeted + 87 HTTP + 8 real-PG tests; SDAR Telemetry 183 tests; SMPP Telemetry 70.
SDAR/SDAR-Telemetry typecheck/build and scoped static checks pass; SMPP full strict tsc retains
450 baseline diagnostics. Real diagnostic federation and external schema checks pass. No live
source activation or new business-data delivery is claimed. See the report for exact commands.

## Idempotence and Recovery

First-writer private configuration/credentials and durable activation ranges survive restart.
Apply only reviewed additive migrations; no down -v or database resets. Fail before a newly started
SDAR enters YES. Runtime telemetry degradation never retries business actions. Resume durable
consumer checkpoints; do not reset them to obtain a passing smoke result.

## Artifacts and Evidence

Code in the three repositories, isolated tests, ADR-143, joint-development docs, private state under
the debug directory and a redacted verification report. Never commit credentials or raw env.

## Outcomes and Retrospective

Implementation is ready for real source configuration; SDAR -> Commander/NPC is explicitly deferred.
No live activation, business Task, device call or production/debug service restart performed.
The approved additive external Evidence table was created, without modifying historical data.
Live acceptance remains blocked on real producer registration; no fixture or synthetic observation
was used to bypass that boundary. This plan is not marked complete.
