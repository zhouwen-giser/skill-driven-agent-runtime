# Verification Summary

- Status: **passed**
- Commit: `a0f82c3291d94f1897c95386162a11a809b3f8a0` (dirty working tree)
- Started: 2026-10-14T12:55:35.002Z
- Finished: 2026-10-14T13:30:59.525Z
- Duration: 2124523 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 41787 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3519 ms |
| lint | `pnpm lint` | passed | 163284 ms |
| typecheck | `pnpm typecheck` | passed | 49420 ms |
| unit | `pnpm test:unit` | passed | 148779 ms |
| contract | `pnpm test:contract` | passed | 44036 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1487 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 759 ms |
| architecture | `pnpm verify:architecture` | passed | 1800 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 819 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 806 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 794 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 4689 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 887 ms |
| acceptance | `pnpm verify:acceptance` | passed | 779 ms |
| sources | `pnpm verify:sources` | passed | 808 ms |
| protocol | `pnpm verify:protocol` | passed | 1015 ms |
| infra | `pnpm verify:infra` | passed | 945 ms |
| project-license | `pnpm verify:project-license` | passed | 766 ms |
| licenses | `pnpm verify:licenses` | passed | 876 ms |
| build | `pnpm build` | passed | 46823 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1226 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 109246 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 407396 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 308109 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 104064 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 440106 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 23724 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 83313 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 132403 ms |
