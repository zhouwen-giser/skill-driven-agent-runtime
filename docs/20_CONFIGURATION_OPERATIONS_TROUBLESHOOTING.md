# Configuration, Operations, and Troubleshooting

## Configuration

The Server loads `.env` when present and then validates environment variables strictly.

| Variable                                        | Default                                                  | Purpose                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SDAR_POSTGRES_URL`                             | `postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar` | PostgreSQL/pgvector authority                                                                                                    |
| `SDAR_REDIS_HOST`                               | `127.0.0.1`                                              | Redis/BullMQ host                                                                                                                |
| `SDAR_REDIS_PORT`                               | `56379`                                                  | Redis/BullMQ port                                                                                                                |
| `SDAR_A2A_HOST` / `SDAR_A2A_PORT`               | `127.0.0.1` / `9999`                                     | A2A listener                                                                                                                     |
| `SDAR_MANAGEMENT_HOST` / `SDAR_MANAGEMENT_PORT` | `127.0.0.1` / `9998`                                     | Management API and Console listener                                                                                              |
| `SDAR_MASTER_KEY_BASE64`                        | required                                                 | 32-byte AES-256-GCM master key, Base64 encoded; never persisted                                                                  |
| `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE`     | `false`                                                  | Required only after reviewing an explicitly trusted non-loopback bind; adds no authentication                                    |
| `SDAR_REUSE_EXISTING_INFRA`                     | `false`                                                  | Verification/demo scripts reuse already-running loopback PostgreSQL/Redis and never invoke Docker lifecycle commands when `true` |

Model Providers, fixed stage routes, Prompts, MCP Servers, wait policy, retention values, and evolution thresholds are managed through the API/Console and persisted in PostgreSQL. Provider/MCP credentials are write-only at the management boundary and AES-256-GCM encrypted at rest.

After V1.1 merged, the released migration profile is one monotonic chain through 0106. The explicit
`v1.1-isolated` profile and `sdar_v11_*` name/acknowledgement guard remain only for disposable
compatibility tests. Any ledger gap in 0100–0106 fails closed. The runtime composes the remote
poll/continuation/input/cancel workers and enables only the validated `waiting_external` restart
exemption; ordinary running work is never recovered.

## Local operation

Use `pnpm demo:acceptance` for a self-contained, automatically cleaned acceptance deployment. For a persistent local process:

```powershell
docker compose up -d --wait postgres redis
$env:SDAR_MASTER_KEY_BASE64='<32-byte-base64-key>'
pnpm build
pnpm start:server
```

Stop the process gracefully, then run `docker compose stop postgres redis`. Graceful shutdown closes ingress, drains the Worker and tracked Task controls, then closes MCP transport and PostgreSQL. An abrupt process failure intentionally fails running Tasks/instances on the next start and never resumes or retries them. Queued BullMQ jobs remain eligible for dispatch.

When an operator already owns the PostgreSQL/Redis lifecycle, set `SDAR_REUSE_EXISTING_INFRA=true` in `.env`. Verification and demo scripts then connect through `SDAR_POSTGRES_URL`, `SDAR_REDIS_HOST`, and `SDAR_REDIS_PORT` without starting, stopping, or executing commands inside containers. The external services must already be healthy and use isolated local development data; migration-path verification creates and removes the temporary databases `sdar_verify_empty` and `sdar_verify_upgrade`.

The repository Compose file publishes PostgreSQL and Redis only on `127.0.0.1`; do not remove the loopback host binding or create a public route.

## Health and evidence

- `GET http://127.0.0.1:9998/api/v1/health`
- `GET http://127.0.0.1:9999/.well-known/agent-card.json`
- `pnpm smoke:infra`
- `pnpm smoke:server`
- `pnpm verify:migrations`
- `pnpm verify:v11-acceptance`
- `pnpm demo:acceptance`
- `pnpm verify`

V1.2 package operations use the Management API validate/import routes and always reread and revalidate
the checksum-bound package. Deployment context and capability-slot resolution are injected runtime
policies, not environment variables; absence fails closed. Inspect exact execution evidence through
`GET /api/v1/skill-executions/{executionId}` and
`GET /api/v1/tasks/{taskId}/skill-executions`. Final v1.2 evidence is stored in
`reports/v1.2-skill-usage/15-final-acceptance.{md,json}`.

`pnpm demo:acceptance` writes `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.{json,md}` and `V11-LOCAL-DEMO.{json,md}`. The Phase 6 evidence run records 493 unit+contract tests, 80 integration tests using real PostgreSQL/Redis, 49 E2E tests, 232 architecture assertions, 110 OpenAPI operations and 68 migration pairs. The Provider and model decisions are deterministic local simulations; external production Provider interoperability remains unverified.

Historical data is retained indefinitely in V1. Automatic archive/delete are disabled; retention day values are advisory. Back up PostgreSQL as the system of record. Redis is ephemeral queue/runtime state and is not a recovery source for running tasks.

## Troubleshooting

### Docker or database is unavailable

Run `docker version`, `docker compose ps`, and `pnpm smoke:infra`. Confirm ports 55432 and 56379 are free and that Docker Desktop is healthy. Do not substitute static Compose validation for a real smoke pass.

### Server rejects startup

- Missing/invalid `SDAR_MASTER_KEY_BASE64`: supply a 32-byte Base64 key.
- Non-loopback listener rejected: restore loopback, or document firewall/trusted-network isolation before setting the acknowledgement flag.
- PostgreSQL migration failure: stop the Server, preserve the database, inspect `schema_migration`, and run `pnpm verify:migrations` against isolated databases. Do not manually edit the production ledger.

### Task remains queued or waiting

Check Redis health, Task phase, wait policy, and Task events in Console. Confirmation and input waits are explicit states. Same-`context_id` work is serialized by design.

For an MCP Task, inspect `GET /api/v1/tasks/{taskId}/remote-task-lifecycle` or the Console lifecycle panel. Compare Binding version, Provider status/substate, next poll time, accepted/rejected observations, active continuation, input round, and cancellation uncertainty. A versioned `POST /api/v1/remote-task-bindings/{bindingId}/refresh` performs one bounded observation; it must not be used as an unbounded retry loop. A cancel acknowledgement is not remote cancellation.

For a Frozen Provider, inspect `GET /api/v1/mcp/servers/{serverId}/protocol` before changing credentials or diagnosing Task latency. Compare the current discovery snapshot, supported versions, baseline hash, Task Notification capability, Tool task behavior and output-schema hash. Run `POST .../protocol-baseline-audit` for a read-only drift check. Existing Provider identities cannot switch between `legacy_v11` and `frozen_v1`; `POST .../mode-switch-guard` returns HTTP 409 and a new explicitly registered Provider identity is required. If Task Notifications are unavailable or no accepted notification has been observed, the API and Console show a polling-fallback warning; use one version-CAS binding refresh for reconciliation and investigate the stream component instead of looping refresh calls.

Register Frozen Providers only through `POST /api/v1/mcp/frozen/servers`; the Legacy registration route
does not infer or upgrade protocol mode. Use the corresponding Frozen refresh route so discovery, Tool
profiles/output schemas and the snapshot commit atomically. For a broken Notification stream, invoke the
Frozen reconnect endpoint once and inspect its disposition. If the runtime reports the subscription
component unavailable, startup composition failed and polling remains the explicit fallback; inspect the
credential-safe protocol diagnosis and server logs. Do not loop force-reconciliation calls or claim that
they restored streaming. A successful reconnect reconciles accepted active Task IDs before admitting
Notifications, and the API reports `started` or `already_running`.

### Model or MCP stage fails

There is no Provider fallback. Inspect credential-safe model/MCP invocation audits, fixed stage route, Prompt version, endpoint health, schema mismatch warnings, and timeout. Never paste secrets into logs or reports.

### Running work after a crash

Ordinary running/paused/evaluating work is not recovered or automatically retried. Startup marks it failed with `PROCESS_EXECUTION_LOST`; re-submit only after reviewing possible external side effects.

When and only when the V1.1 composition is enabled, a Task backed by a valid active `waiting_external` snapshot and matching remote Binding is preserved. Startup reconstructs Poll/continuation scheduling from PostgreSQL, does not replay `tools/call`, and starts a fresh LangGraph invocation only after an authoritative control event. Missing or inconsistent evidence fails closed. The real restart integration test also inserts an ordinary running Task and proves that it fails while the remote wait completes without duplicate Tool admission.

## Release operations

Run `pnpm verify`, review `reports/verification/`, the V1 acceptance/migration/demo reports, SBOM, Third-Party Notices, security warnings, and `templates/RELEASE_CHECKLIST.md`. Public ingress is prohibited. No deployment or production mutation is performed by repository scripts.

## v1.4.1 Canonical Evidence recovery

Use `docs/operations/v141-canonical-evidence-export-recovery.md` for receiver outage, High Watermark,
DLQ retry, record/source/episode replay, coverage reconcile and bounded Diagnostic retention. Inspect
metadata-only status before recovery, preserve the active export revision and use a Node Admin or
Security Admin audited command. Never delete PostgreSQL Evidence authority, reset cursors manually,
replay business commands, expose payload/secret fields or treat Redis/the receiver as recovery truth.
