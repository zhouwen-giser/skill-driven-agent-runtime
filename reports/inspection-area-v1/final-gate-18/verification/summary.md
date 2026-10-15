# Verification Summary

- Status: **passed**
- Commit: `ebe1e7ebced304c35448553dba27840af1bb651b` (dirty working tree)
- Started: 2026-10-15T07:34:25.547Z
- Finished: 2026-10-15T08:09:06.802Z
- Duration: 2081255 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 38082 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3503 ms |
| lint | `pnpm lint` | passed | 155705 ms |
| typecheck | `pnpm typecheck` | passed | 42910 ms |
| unit | `pnpm test:unit` | passed | 141346 ms |
| contract | `pnpm test:contract` | passed | 39461 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1513 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 752 ms |
| architecture | `pnpm verify:architecture` | passed | 1772 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 762 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 739 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 756 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 4563 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 921 ms |
| acceptance | `pnpm verify:acceptance` | passed | 733 ms |
| sources | `pnpm verify:sources` | passed | 756 ms |
| protocol | `pnpm verify:protocol` | passed | 952 ms |
| infra | `pnpm verify:infra` | passed | 882 ms |
| project-license | `pnpm verify:project-license` | passed | 737 ms |
| licenses | `pnpm verify:licenses` | passed | 855 ms |
| build | `pnpm build` | passed | 43767 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1162 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 104272 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 386034 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 307444 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 70527 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 490780 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 24214 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 78735 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 136571 ms |
