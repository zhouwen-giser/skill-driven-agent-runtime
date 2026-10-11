# Verification Summary

- Status: **failed**
- Commit: `6b3fc0e2bda523b8dcd0aa9934ef41f3e1af3766` (dirty working tree)
- Started: 2026-10-11T10:26:16.357Z
- Finished: 2026-10-11T10:44:49.610Z
- Duration: 1113253 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39827 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10150 ms |
| lint | `pnpm lint` | passed | 147712 ms |
| typecheck | `pnpm typecheck` | passed | 47834 ms |
| unit | `pnpm test:unit` | passed | 139419 ms |
| contract | `pnpm test:contract` | passed | 44971 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 7958 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4706 ms |
| architecture | `pnpm verify:architecture` | passed | 8380 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7388 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5073 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7438 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 8894 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7565 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7443 ms |
| sources | `pnpm verify:sources` | passed | 4926 ms |
| protocol | `pnpm verify:protocol` | passed | 7817 ms |
| infra | `pnpm verify:infra` | passed | 7602 ms |
| project-license | `pnpm verify:project-license` | passed | 5108 ms |
| licenses | `pnpm verify:licenses` | passed | 77590 ms |
| build | `pnpm build` | passed | 43087 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7838 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 85759 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 378725 ms |
