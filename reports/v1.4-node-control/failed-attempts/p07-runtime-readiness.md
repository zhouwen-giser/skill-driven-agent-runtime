# P07 Retained Failed Attempts

## Focused integration environment

- The first command omitted `SDAR_CONTROL_TEST_POSTGRES_URL` while setting only the Runtime pool.
- Control migration/cleanup therefore authenticated against the wrong default port; one file failed
  before its single test could run.
- Supplying both test URLs fixed the environment. The focused rerun passed 1/1 and the official
  aggregate created distinct Runtime/Control databases and passed 25 files / 138 tests.

## Migration verification sandbox

- The first unprivileged `pnpm verify:migrations` could not read Docker Desktop config/buildx state.
- The identical command rerun with the user's authorized Docker access passed all 30 migrations
  through `0137`, rollback/reapply, interruption recovery and checksum drift rejection.

## Review repairs

Four read-only review passes found and the implementation phase closed five Major and two Minor
findings: immediate safety degradation, route-backed model readiness, Node Profile maintenance,
complete request hashing, the frozen internal endpoint, supporting-role degradation, and Problem
Details for missing snapshots. Every affected gate was rerun before the final 0/0/0 verdict.
