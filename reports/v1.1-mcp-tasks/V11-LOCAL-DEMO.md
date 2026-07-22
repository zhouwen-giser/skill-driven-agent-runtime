# V1.1 Local Acceptance Demo

- Status: **passed**
- Commit: `c979feb7a5ddd56cefcf126a763c370e626170fd` (dirty working tree)
- Duration: 81934 ms
- Infrastructure: real operator-managed PostgreSQL/pgvector and Redis/BullMQ supplied by the caller
- Provider/model: deterministic local Mock MCP Tasks Provider and Mock Model loopbacks
- Acceptance report: `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.json`

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| production-build | `pnpm build` | passed | 14854 ms |
| mcp-tasks-sixteen-scenario-contract | `pnpm exec vitest run --project contract packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts` | passed | 2495 ms |
| acceptance-unit-evidence | `pnpm test:unit` | passed | 9105 ms |
| postgres-redis-integration-including-restart | `pnpm test:integration` | passed | 15598 ms |
| full-e2e | `pnpm test:e2e` | passed | 39739 ms |
| acceptance-report-verifier | `pnpm verify:v11-acceptance` | passed | 66 ms |
