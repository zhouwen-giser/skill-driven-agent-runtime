# Verification Summary

- Status: **passed**
- Commit: `e21fbafe7a89f9093fc744839f53d4610d6d8007` (dirty working tree)
- Started: 2026-10-15T01:35:27.599Z
- Finished: 2026-10-15T02:08:35.516Z
- Duration: 1987917 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37828 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3526 ms |
| lint | `pnpm lint` | passed | 163690 ms |
| typecheck | `pnpm typecheck` | passed | 45577 ms |
| unit | `pnpm test:unit` | passed | 147506 ms |
| contract | `pnpm test:contract` | passed | 41815 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1538 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 782 ms |
| architecture | `pnpm verify:architecture` | passed | 1911 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 797 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 757 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 787 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 4721 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 916 ms |
| acceptance | `pnpm verify:acceptance` | passed | 764 ms |
| sources | `pnpm verify:sources` | passed | 779 ms |
| protocol | `pnpm verify:protocol` | passed | 1015 ms |
| infra | `pnpm verify:infra` | passed | 912 ms |
| project-license | `pnpm verify:project-license` | passed | 732 ms |
| licenses | `pnpm verify:licenses` | passed | 853 ms |
| build | `pnpm build` | passed | 45741 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1169 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 93383 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 400952 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 301205 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 71238 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 402566 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 21447 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 72190 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 120765 ms |
