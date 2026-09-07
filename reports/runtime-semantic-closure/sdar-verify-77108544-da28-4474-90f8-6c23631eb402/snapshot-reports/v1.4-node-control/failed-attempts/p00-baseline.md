# P00 baseline failed attempts

## Attempt 1: GitHub fetch TLS

- Command: `git fetch --prune --tags origin`
- Exit: 1
- Failure: `OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443`.
- Repair: retried the same read-only fetch with the authorized network execution context.
- Rerun: passed; `origin/main` resolved to `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`.

## Attempt 2: Docker sandbox access

- Command: `pnpm verify`
- Exit: 1
- Passed before failure: formatting; 1122 unit/contract tests; architecture; A2A; 164-operation
  Management OpenAPI; source/protocol/license/SBOM/Compose/build; cognitive replay.
- Failure: access denied for `C:\Users\zhouw\.docker\config.json` and buildx instances.
- Repair: reran the unchanged command with user-authorized Docker access.

## Attempt 3: existing physical PGDATA collation

- Command: `pnpm verify` with Docker access
- Exit: 1
- Passed before failure: bootstrap, cognitive replay, and isolated migration-path verification.
- Failure: PostgreSQL `XX000`, `template database "template1" has a collation version, but no actual
  collation version could be determined`, when Compose reused an existing Debian-initialized volume
  with the hardened Alpine image.
- Safety decision: do not delete, reset, or overwrite the existing volume.
- Repair: set `COMPOSE_PROJECT_NAME=sdar-v14-baseline-019fa7dc` so Compose created independent
  PostgreSQL/Redis volumes.
- Rerun: full `pnpm verify` passed with exit 0 in 345479 ms.
