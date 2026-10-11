# Verification Summary

- Status: **passed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T20:12:19.884Z
- Finished: 2026-10-10T20:45:31.229Z
- Duration: 1991345 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 34907 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 9694 ms |
| lint | `pnpm lint` | passed | 140156 ms |
| typecheck | `pnpm typecheck` | passed | 45629 ms |
| unit | `pnpm test:unit` | passed | 131896 ms |
| contract | `pnpm test:contract` | passed | 42894 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7652 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4461 ms |
| architecture | `pnpm verify:architecture` | passed | 7907 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7085 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5111 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7111 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 7709 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7239 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7071 ms |
| sources | `pnpm verify:sources` | passed | 7096 ms |
| protocol | `pnpm verify:protocol` | passed | 7303 ms |
| infra | `pnpm verify:infra` | passed | 7217 ms |
| project-license | `pnpm verify:project-license` | passed | 4962 ms |
| licenses | `pnpm verify:licenses` | passed | 7210 ms |
| build | `pnpm build` | passed | 43105 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 27513 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 67080 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 438843 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 310556 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 92184 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 327588 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 24130 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 63263 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 96727 ms |
