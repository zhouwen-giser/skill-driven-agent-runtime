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
- `pnpm verify`

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

### Model or MCP stage fails

There is no Provider fallback. Inspect credential-safe model/MCP invocation audits, fixed stage route, Prompt version, endpoint health, schema mismatch warnings, and timeout. Never paste secrets into logs or reports.

### Running work after a crash

V1 does not recover or automatically retry running work. Startup marks interrupted Tasks/instances failed with `PROCESS_EXECUTION_LOST`. Re-submit only after reviewing possible external side effects.

## Release operations

Run `pnpm verify`, review `reports/verification/`, the V1 acceptance/migration/demo reports, SBOM, Third-Party Notices, security warnings, and `templates/RELEASE_CHECKLIST.md`. Public ingress is prohibited. No deployment or production mutation is performed by repository scripts.
