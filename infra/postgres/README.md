# PostgreSQL migration baseline

`init/0001_sdar_bootstrap.up.sql` runs only when the Docker volume is first initialized. It enables pgvector and creates a deterministic bootstrap probe table used by EP-00 smoke verification.

For an existing database, apply forward migrations through the future migration runner rather than replaying Docker init scripts. The matching rollback is `migrations/0001_sdar_bootstrap.down.sql`.

Rollback order:

1. Stop application processes that may use the probe table.
2. Back up the database.
3. Run the down migration in a transaction.
4. Keep the `vector` extension unless dependency inspection proves it is unused.

The local default password in `compose.yaml` is deliberately marked local-only. Shared environments must provide `SDAR_POSTGRES_PASSWORD` and must not expose database ports outside the trusted network.

Run `pnpm smoke:infra` to start the digest-pinned services, wait for health, verify the pgvector version, migration marker, vector distance operation and Redis write/read behavior, then stop both containers while retaining their volumes. This command requires a running Docker daemon and is intentionally not replaced by the static `pnpm verify:infra` gate.
