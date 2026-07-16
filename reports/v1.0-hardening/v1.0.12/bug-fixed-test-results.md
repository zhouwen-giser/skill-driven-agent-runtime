# v1.0.12 Bug-fixed Test Results

The required operator-managed `pnpm verify` passed in 85,277 ms:

- format, ESLint and strict TypeScript: passed;
- unit: 287 passed;
- contract: 64 passed;
- architecture: 182 TypeScript source files passed;
- A2A TCK: 74 passed, 161 scoped skips, 100% MUST;
- management OpenAPI: 106 operations passed;
- acceptance: 18 requirements passed;
- source/license/SBOM/build gates: passed;
- empty and historical-0049 migrations through 0064: passed;
- real PostgreSQL/Redis integration: 60 passed;
- real A2A/Model/MCP E2E: 46 passed;
- infrastructure and Server/Console smoke: passed.

New regressions prove forged durable outcomes for coordinates, battery, online state, occupancy and
current device tasks are rejected before any embedding; durable authority elevation is rejected;
direct creation cannot bypass the rule; and post-call content/vector mutation, cycles and non-finite
JSON cannot change or enter persisted evidence. No Docker command ran.
