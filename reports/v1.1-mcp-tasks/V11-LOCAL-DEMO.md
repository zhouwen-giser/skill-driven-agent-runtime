# V1.1 Local Acceptance Demo

- Status: **passed**
- Commit: `f97637b4152ef697785167b5df5aa09f9ab7deea` (dirty working tree)
- Duration: 58258 ms
- Infrastructure: real PostgreSQL/pgvector and Redis/BullMQ through compose or operator-managed equivalents
- Provider/model: deterministic local Mock MCP Tasks Provider and Mock Model loopbacks
- Acceptance report: `reports/v1.1-mcp-tasks/V11-ACCEPTANCE.json`

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| production-build | `pnpm build` | passed | 10412 ms |
| mcp-tasks-sixteen-scenario-contract | `pnpm exec vitest run --project contract packages/mcp-adapter/test/mcp-tasks-mock-provider.contract.test.ts` | passed | 1658 ms |
| acceptance-unit-evidence | `pnpm test:unit` | passed | 6384 ms |
| postgres-redis-integration-including-restart | `pnpm test:integration` | passed | 9659 ms |
| full-e2e | `pnpm test:e2e` | passed | 27672 ms |
| acceptance-report-verifier | `pnpm verify:v11-acceptance` | passed | 51 ms |
