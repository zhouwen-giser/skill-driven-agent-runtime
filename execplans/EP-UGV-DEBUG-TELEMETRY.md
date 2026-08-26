# UGV debug / SMPP / Telemetry integration

## Purpose / Outcome

Implement the user-approved complete development stack behind `pnpm ugv:debug`, without Grafana.
Business/management/debug interfaces are anonymous and LAN-bound in this explicit development
profile only. ProviderOps events, metrics and spans are queryable; metrics/spans expire after seven
days. No startup or smoke operation submits an A2A Task or calls a Device tool.

## Requirements Covered

FR-A2A-001, FR-ADM-001 and the 2026-08-26 user-approved joint-development acceptance scenarios.
This is deployment/observability work, not a new SDAR business authority or workflow runtime.

## Context and Orientation

SDAR owns `deploy/ugv-agent-profile-simulation/debug.sh` and host process supervision. SMPP already
exports OTLP via its observability adapter. The sibling smpp-telemetry-platform owns Collector,
Processor WAL, ClickHouse schemas and Query API. Existing acceptance scripts include destructive
clean-start behavior and MUST NOT be reused as the development start sequence.

## Architecture and Interfaces

- Start/restart default YES; explicit NO remains available. Stop preserves all data.
- Source truth remains each project's PostgreSQL. Telemetry only observes.
- ProviderOps keeps synchronous WAL ACK. Metrics/traces use pinned Collector ClickHouse exporter
  with persistent queue, independent retry and migration-owned tables.
- Public LAN endpoints have development-only trusted identities. Internal machine credentials,
  confirmation, schema and physical execution policies remain intact.
- Query API adds `/api/v1/metrics`, `/api/v1/traces`, `/api/v1/traces/{traceId}`.

## Progress

- [x] 2026-08-26 Read current deployment, telemetry and authority boundaries; user approved plan.
- [x] Implement telemetry storage/query and isolated development Compose configuration.
- [x] Implement development authentication/public URL and complete startup orchestration.
- [x] Run focused tests, typecheck/build and real container smoke; record the existing Telemetry full-typecheck exception explicitly.
- [x] Record evidence, update documentation and traceability.

## Discoveries and Surprises

- Existing Collector persists ProviderOps only; metrics/traces were debug/Prometheus-only.
- Current fixed deployment is loopback-bound and `OTEL_ENABLED=false`.
- Existing root debug command only manages the three SDAR host processes.
- Historical untracked acceptance reports belong to the user and are not part of this change.
- Live startup exposed an Adapter warmup race: its initial three-tool manifest was frozen by Runtime
  before Device MCP discovery completed. The launcher now waits read-only for the exact ten-tool
  Provider manifest before starting Runtime. Manifest drift validation remains intact.
- PMS catalog A→B→A rediscovery violated `(provider_id,checksum)` uniqueness. The formal repository
  now reactivates the immutable historical snapshot under the same advisory transaction lock,
  records one reactivation audit and does not consume a revision. Isolated PostgreSQL regression
  includes eight concurrent reactivations, unchanged history and the next revision allocation.
- The old host manifest contained two exited processes and one still-running Control worker. Its
  exact PID/start-time/PGID/SID/argv/cwd were verified before ownership-checked stop. With all three
  entries/groups and ports absent, the original 0600 manifest was moved unchanged to private
  `stale-supervisor-20260826T0822/processes.json`; SHA256 remained
  `03c8c8d223e8d751b580344511538d24d8a13899a54c6eb085057cc100886002`.
- Default YES previously validated every historical B02 receipt, even for the existing local ID.
  An old incompatible failure report blocked development. Explicit development composition now
  validates the owner-only local identity separately; successor IDs still require their chain and
  ordinary acceptance validation is unchanged. No acceptance records were edited.
- Collector queues may contain OTLP data before a Prometheus scrape. The real recovery verifier
  now observes a metrics queue and at least one full scrape interval before restart; it asserts
  actual outage-time metric points were recovered, not just a queue gauge changing.
- Telemetry's existing whole-repository strict typecheck has baseline errors outside the changed
  query modules. Its existing production build uses `--noCheck`; this fact is not hidden. The
  affected query source/tests receive a separate strict check, and all 69 existing tests pass.

## Decision Log

Use existing Collector 0.157.0 and x86 ClickHouse 25.3.14.14, not new runtime dependencies.
No Grafana in the joint profile; leave production Grafana untouched. Preserve databases and state
on every ordinary start/restart/stop and on failure. See ADR-142.

Preserve content-addressed SMPP Catalog snapshots and reactivate a historical checksum with audit
rather than removing constraints, rewriting history or clearing the database. This repairs repeat
startup, not business task execution. No new database migration is needed for that correction.

## Implementation Steps

1. Add migration-owned diagnostic tables and bounded Query API routes in Telemetry.
2. Add telemetry development profile, stable identity mapping and persistent Collector queue.
3. Add explicit development host profile and anonymous public HTTP identities.
4. Compose existing infrastructure, formal seed/bootstrap and host supervisor in debug lifecycle.
5. Exercise container pipeline and read-only SMPP observation; document actual results.

## Validation

Focused CLI/auth/public-card/query/schema contracts; scoped lint/format; TypeScript/build;
real ClickHouse/Collector three-signal, restart and outage/queue recovery checks. Production
authentication and original ProviderOps ACK contracts must continue passing. No fake data may
be reported as live UGV evidence; isolated protocol fixtures are labeled test data.

Executed: SDAR 9 files/164 tests plus 13 real supervisor tests; SMPP 3 files/32 tests on isolated
PostgreSQL; Telemetry 69 tests. All passed. SDAR/SMPP typecheck/build, Telemetry affected-module
strict check/build, 858-source SDAR architecture and scoped lint/format/syntax/diff passed.
Telemetry full strict check is not green: 450 existing diagnostics remain outside the changed code.
Commands and limits are in `reports/ugv-debug/verification-2026-08-26.md`.

Live `start NO`, `start` (default YES) and `restart` (default YES) completed. At 08:32:59Z the
final A2A/Management listener was PID 234714 and Control API PID 233749, bound to 0.0.0.0;
supervisor verified three processes and YES. Authority counts/revisions stayed 1/1, 1/2, 1/2;
Task/MCP counts stayed 5/0. No new Device call or mutation was recorded. Port 3000 remained absent.

## Idempotence and Recovery

Use the existing task-owned Compose identities and a separate telemetry project. Retain secrets,
volumes and first-writer identity state. Fail with a specific stage and do not switch newly started
SDAR to YES until startup succeeds. Never use down --volumes, prune or automatic task retries.

## Artifacts and Evidence

Record commands/results in this plan and a dedicated joint-debug validation report, separate from
historical acceptance reports. Generated local connection configuration is private and ignored.

Real Telemetry report: sibling `smpp-telemetry-platform/reports/ugv-debug/verification-2026-08-26T07-59-42-865Z.json`.
It records real events, gauge/sum/histogram points and spans, both OTLP and Prometheus source labels,
queue size 2 during ClickHouse outage, 46 outage-time points recovered after Collector restart,
retained volumes and seven live MergeTree TTLs of seven days. Exponential histogram/summary had
no source; no synthetic or backdated data was inserted. Device tool and A2A Task calls were zero.
The seven-day TTL check is DDL verification, not a seven-day elapsed retention soak.

## Outcomes and Retrospective

The requested development integration is implemented and running, with no Grafana. Final real
Telemetry recheck at 08:29:06Z–08:29:56Z again restored 46 outage-time metric points after Collector
restart, retaining all volumes and TTLs. The final healthy debug stack is left in the explicitly
requested default YES mode; subsequent user Tasks may execute physical tools after their normal
confirmation/readiness gates. This turn submitted none. Historical acceptance evidence was kept.
No all-repository clean release, full typecheck success for Telemetry or navigation acceptance is
claimed. Git publication is tracked separately by the repository commits and pull requests.
The remaining verification baseline is the unrelated Telemetry
whole-project strict TypeScript debt; it is visible in the report and Project Status.
