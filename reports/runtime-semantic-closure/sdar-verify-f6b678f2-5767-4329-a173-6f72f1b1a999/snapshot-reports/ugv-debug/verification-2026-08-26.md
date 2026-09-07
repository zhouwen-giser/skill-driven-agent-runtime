# UGV / SMPP / Telemetry joint-debug verification — 2026-08-26

## Scope and result

Implemented the user-approved development profile, without Grafana or a replacement UI.
Real three-project startup, explicit NO, default YES, anonymous LAN access, stable registration,
three-signal persistence and telemetry queue recovery passed. This is not navigation acceptance,
an A2A execution test, or a claim that every pre-existing repository-wide gate is green.

This evidence was captured from the local code before the separately authorized Git publication.
No cleanup of production configurations, database reset, acceptance qualification or Device
execution was performed during implementation verification.

## Automated evidence

SDAR:

```bash
pnpm exec vitest run \
  apps/node-control-acceptance/test/ugv-debug-command.contract.test.ts \
  apps/node-control-acceptance/test/ugv-debug-profile.unit.test.ts \
  apps/node-control-acceptance/test/ugv-debug-identity.unit.test.ts \
  apps/node-control-acceptance/test/ugv-agent-profile-authority-bootstrap-driver.unit.test.ts \
  apps/server/test/environment.unit.test.ts \
  apps/server/test/artifact-management-identity.unit.test.ts \
  apps/node-control-api/test/environment.unit.test.ts \
  apps/node-control-api/test/http-endpoint.contract.test.ts \
  packages/a2a-adapter/test/http-endpoint.contract.test.ts
pnpm exec vitest run apps/node-control-acceptance/test/ugv-agent-profile-simulation-deployment.contract.test.ts
pnpm typecheck
pnpm build
pnpm verify:architecture
```

Results: 9 files / 164 tests plus 13 real supervisor contracts passed (177 total).
Typecheck/build passed; architecture verified 858 TypeScript sources. The supervisor fixture
uses isolated real processes, not the live UGV. Changed-source ESLint, formatting, shell/Node
syntax and diff checks passed. Formatting-sensitive YAML assertions were corrected to tolerate
whitespace while retaining exact queue/retry/provenance semantics; no test was skipped.

SMPP:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55472/catalog_test pnpm exec vitest run \
  packages/pms-persistence-postgres/test/catalog-snapshot.test.ts \
  apps/pms-worker/test/catalog-registry-phase.test.ts \
  packages/catalog-manager/test/client.test.ts
pnpm typecheck
pnpm build
```

32/32 passed, including immutable history and eight concurrent A→B→A reactivations. Typecheck,
build, scoped lint/format and diff checks passed. The uniquely labeled temporary PostgreSQL
container and its tmpfs test database were removed after verification; live databases were untouched.

Telemetry:

```bash
npm test
pnpm exec tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext \
  telemetry-dashboard/query-api/src/observability-query.ts \
  telemetry-dashboard/query-api/src/clickhouse.ts \
  telemetry-dashboard/query-api/src/server.ts \
  telemetry-dashboard/query-api/test/observability-query.test.ts \
  telemetry-dashboard/query-api/test/observability-http.test.ts \
  telemetry-collector/tests/ugv-debug.test.ts
```

69/69 tests and the affected strict check passed. The existing build (`tsc --noCheck`) passed.
**Whole-repository `npm run typecheck` remains exit 2 with 450 existing diagnostics** in unrelated
Processor/tools/legacy test code. It is not waived or presented as passing; no TypeScript strictness
was disabled by this change. Changed files were formatted and syntax/diff checks passed.

## Live HTTP, ports and authority

At 08:28Z, the verified three-process supervisor reported YES, revision 2; the actual A2A and
Management listener PID was 192918. Public Agent Card advertised
`http://192.168.6.7:10999/a2a`, `embodied.move_to`, no security requirements and
`io.sdar/naturalLanguageCapabilityAdmission`.

Anonymous LAN GETs returned 200: Card; Management health, Skills and Artifacts; Node Control
`/api/v1/node`; Runtime/PMS readiness; events/metrics/traces queries; Processor readiness;
Collector health and both metrics endpoints. Node Control `/internal/v1/...` still returned 401.

Host listeners verified `0.0.0.0` for 10999/10998/10091, 19131/18092/17031,
4317/4318, 8088/8443 and 13133/8888/9464. Database/Redis listeners were
`127.0.0.1:55462/55463/56391/8123/9000`; SMPP databases have no published host port.
Port 3000 was absent. Production Grafana files were not modified.

The Runtime retains frozen MCP `2026-07-28`; `server/discover` and `tools/list` with its prescribed
metadata returned 200 and ten tools. A legacy initialize-shaped probe was rejected as invalid
parameters; no compatibility change was made. Device MCP initialization/tool listing was also
observed during Adapter discovery. No `tools/call` was sent by this verification.

Before and after repeated startup, PostgreSQL SELECTs showed:

| Authority | Before | After |
| --- | --- | --- |
| Provider Binding rows / max revision | 1 / 1 | 1 / 1 |
| Capability rows / version | 1 / 2 | 1 / 2 |
| Exposure rows / version | 1 / 2 | 1 / 2 |
| SDAR Tasks | 5 | 5 |
| SDAR MCP invocations | 0 | 0 |

Adapter has one historical `get_status` from `2026-08-25T03:38:59.061Z`, no new Device calls on
2026-08-26 and zero mutation rows. Existing Task, database and registration state was retained.
The stopped legacy supervisor manifest was preserved byte-for-byte in the private stale archive;
only its verified remaining worker was terminated before normal startup resumed.

## Real telemetry persistence and restart recovery

Final whole-stack `pnpm ugv:debug restart` also exited 0. At `08:32:59Z`, A2A/Management PID
234714 and Control API PID 233749 were listening on 0.0.0.0, supervisor mode was YES, and all
authority/Task/MCP counts in the preceding table remained unchanged. Database/Redis containers
were retained while application processes/containers were replaced. Collector/Processor returned
ready with diagnostic queue and WAL pending-write counts both zero; 3000 remained absent.

Ran `node tools/verify-ugv-debug.mjs --allow-telemetry-restart` in Telemetry. Final report:
`../smpp-telemetry-platform/reports/ugv-debug/verification-2026-08-26T08-29-06-526Z.json`.
Window: `08:29:06.526Z`–`08:29:56.524Z`.

| Signal/table | Before | After |
| --- | --- | --- |
| ProviderOps events | 4188 | 4201 |
| Gauge | 4010 | 4068 |
| Sum | 391 | 399 |
| Histogram | 136 | 139 |
| Spans | 7989 | 8174 |

Both OTLP and Prometheus source labels were present. During ClickHouse outage the persistent queue
reached 2; after Collector restart, **46 metric points timestamped inside the outage** were restored.
All named volumes were retained. Seven actual MergeTree table DDLs had 7-day TTL. No backdated
or synthetic signals were inserted; no seven-day elapsed retention soak is claimed. Exponential
histogram and Summary had no live source and correctly remained `waiting_for_source`.

The verifier restored ClickHouse and Collector in its finalizer. It never submitted a Task or
Device command. Telemetry failures did not trigger business retries or change Task authority.
