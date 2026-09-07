# v1.0.13 Bug-fixed Test Results

## Required commands

- `pnpm verify`: passed in 88,363 ms;
- `pnpm demo:local`: passed; production build plus 1 focused real A2A scenario passed, 45 scenarios
  intentionally filtered by the demo runner;
- `pnpm demo:acceptance`: passed; production build plus all 46 E2E scenarios passed.

The full gate contained:

- format, ESLint and strict TypeScript: passed;
- unit: 298 passed;
- contract: 64 passed;
- integration: 60 passed against real PostgreSQL/Redis;
- E2E: 46 passed against real PostgreSQL/Redis and deterministic loopback Model/MCP;
- architecture: 185 TypeScript source files passed;
- A2A TCK: 74 passed, 161 scoped skips, 100% MUST compatibility;
- management OpenAPI: 106 operations passed;
- acceptance, source, license, SBOM, build, empty/0049 migration and both smoke gates: passed.

## Actual bug-fixed performance sample

Environment: Node.js v22.23.1, Linux x64, Vitest local process with in-memory notifier and fake Task
repository counters. These are local test measurements, not production capacity claims.

- terminal notification: 1 read / 1 ms rounded wake latency in the full gate;
- input-required and capability-gap notification: 1 read / less than 1 ms rounded wake latency;
- one Task, 250 ms window, 100 ms safety interval: 3 reads / 252 ms;
- 20 concurrent Task waits, 250 ms window, 100 ms safety interval: 60 reads / 267 ms;
- deliberately missed notification: 1 read / 85 ms recovery at a 100 ms safety interval;
- close of a pending 30-second waiter: zero Task reads and less than 1 ms rounded release.

The real E2E runtime retained its 5,000 ms safety interval and passed all 46 scenarios. Every command
reported operator-managed infrastructure reuse and disabled Docker lifecycle commands; Compose
daemon/config validation remained explicitly deferred.
