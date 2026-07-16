# V1.1 Local Acceptance Demo

- Status: **passed**
- Commit: `df8b6e0fa0d0934ca4412d409c1749ede1911aa3` (dirty working tree)
- Duration: 64050 ms
- Infrastructure: real PostgreSQL/pgvector and Redis/BullMQ through compose or operator-managed equivalents
- Provider/model: deterministic local Mock MCP Tasks Provider and Mock Model loopbacks
- Acceptance report: `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.json`

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| production-build | `pnpm build` | passed | 9936 ms |
| mcp-tasks-sixteen-scenario-contract | `pnpm exec vitest run --project contract packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts` | passed | 1589 ms |
| acceptance-unit-evidence | `pnpm test:unit` | passed | 6457 ms |
| postgres-redis-integration-including-restart | `pnpm test:integration` | passed | 9612 ms |
| full-e2e | `pnpm test:e2e` | passed | 28197 ms |
| acceptance-report-verifier | `pnpm verify:v11-acceptance` | passed | 57 ms |
