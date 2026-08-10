# Phase 0 failed attempts and recovery

## Dependency installation

1. `pnpm install --frozen-lockfile` in the restricted sandbox timed out after registry requests
   failed with `EACCES`.
2. `pnpm install --frozen-lockfile --offline` failed with `ERR_PNPM_NO_OFFLINE_TARBALL` for
   `mime-types-3.0.2.tgz`.
3. After explicit user authorization, the network-enabled locked install passed. The lockfile was
   unchanged.

## Full verification

1. Restricted `pnpm verify` reached `verify:migrations` and failed because the sandbox could not
   access Docker config/buildx.
2. Elevated `pnpm verify` proved migrations but integration startup failed because external
   `smpp-continuation-postgres` owned `127.0.0.1:55432`.
3. Overriding both PostgreSQL and Redis ports caused one environment unit test to receive the
   overridden Redis value. Assertions were not weakened.
4. Using alternate PostgreSQL only reached integration but the old `sdar` PostgreSQL named volume
   failed with `template1` collation version metadata incompatibility.
5. A fresh Compose project passed integration and E2E, then smoke connected to the preserved
   external database because `SDAR_POSTGRES_URL` had not been overridden.
6. With all PostgreSQL URLs aligned, all 149 integration assertions passed but one `afterAll`
   cleanup hook timed out after 30 seconds.
7. The identical clean rerun passed the complete `pnpm verify` in 660,217 ms.

## Recovery configuration

```powershell
$env:COMPOSE_PROJECT_NAME='sdar-v141-baseline-cc0719f'
$env:SDAR_POSTGRES_PORT='55484'
$env:SDAR_POSTGRES_URL='postgresql://sdar:sdar_local_only@127.0.0.1:55484/sdar'
$env:SDAR_TEST_POSTGRES_URL=$env:SDAR_POSTGRES_URL
Remove-Item Env:SDAR_REDIS_PORT -ErrorAction SilentlyContinue
pnpm.cmd verify
```

No product source, test assertion, existing external container, or old database volume was deleted
or rewritten to obtain the passing result.
