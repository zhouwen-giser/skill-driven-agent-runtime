# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T11:22:30.377Z
- Finished: 2026-09-07T11:41:04.949Z
- Duration: 1114572 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 21062 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2935 ms |
| lint | `pnpm lint` | passed | 87275 ms |
| typecheck | `pnpm typecheck` | passed | 26449 ms |
| unit | `pnpm test:unit` | passed | 86820 ms |
| contract | `pnpm test:contract` | passed | 24808 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 894 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 510 ms |
| architecture | `pnpm verify:architecture` | passed | 1160 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 483 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 491 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 505 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 2783 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 589 ms |
| acceptance | `pnpm verify:acceptance` | passed | 467 ms |
| sources | `pnpm verify:sources` | passed | 521 ms |
| protocol | `pnpm verify:protocol` | passed | 642 ms |
| infra | `pnpm verify:infra` | passed | 603 ms |
| project-license | `pnpm verify:project-license` | passed | 484 ms |
| licenses | `pnpm verify:licenses` | passed | 578 ms |
| build | `pnpm build` | passed | 25343 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 722 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 28463 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 256543 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 193519 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 77584 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 222436 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11063 ms |
| server-console-smoke | `pnpm smoke:server` | failed | 38796 ms |
