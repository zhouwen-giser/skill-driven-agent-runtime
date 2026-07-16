# v1.0.13 Feature Test Results

## Complete gate

- `pnpm verify`: passed in 89,011 ms;
- format, ESLint and strict TypeScript: passed;
- unit: 296 passed;
- contract: 64 passed;
- integration: 60 passed against real PostgreSQL/Redis;
- E2E: 46 passed against real PostgreSQL/Redis and deterministic loopback Model/MCP;
- architecture: 185 TypeScript source files passed;
- A2A TCK: 74 passed, 161 scoped skips, 100% MUST compatibility;
- management OpenAPI: 106 operations passed;
- acceptance, source, license, SBOM and production-build gates: passed;
- empty and historical-0049 migration paths through 0064: passed;
- PostgreSQL/Redis and Server/Console smoke: passed.

## Actual notification performance sample

Environment: Node.js v22.23.1, Linux x64, Vitest local process, in-memory notifier with fake Task
repository counters. These are test measurements, not production throughput claims.

- terminal, input-required and capability-gap notification: one PostgreSQL-authority read each;
  measured wake latency rounded to 0 ms in the sampled local run;
- one Task, 250 ms wait, 100 ms safety interval: 4 reads in 251 ms, rather than the old 10 ms loop's
  approximately 25 reads in the same window;
- 20 concurrent Task waits, 250 ms window, 100 ms safety interval: 83 reads in 253 ms, rather than
  the old loop's approximate 500 reads;
- deliberately missed notification: recovered by the 100 ms safety poll with 1 read in 94 ms;
- close with a pending 30-second waiter and 5-second safety interval: released in less than 1 ms
  after rounding, with no hang.

The real E2E runtime sets safety polling to 5,000 ms and still passes all 46 scenarios, including
return-immediately and stream-disconnect/poll/resubscribe behavior. Operator-managed mode explicitly
disabled Docker lifecycle commands; Compose daemon/config validation was deferred.
