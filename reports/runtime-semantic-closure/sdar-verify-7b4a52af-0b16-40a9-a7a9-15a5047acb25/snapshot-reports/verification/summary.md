# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T12:58:59.072Z
- Finished: 2026-10-10T13:07:30.003Z
- Duration: 510931 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37314 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 11149 ms |
| lint | `pnpm lint` | passed | 132133 ms |
| typecheck | `pnpm typecheck` | passed | 44875 ms |
| unit | `pnpm test:unit` | passed | 124165 ms |
| contract | `pnpm test:contract` | passed | 42342 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8169 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 5399 ms |
| architecture | `pnpm verify:architecture` | passed | 8546 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 5174 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7439 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 5108 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10340 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 8142 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7680 ms |
| sources | `pnpm verify:sources` | passed | 4885 ms |
| protocol | `pnpm verify:protocol` | passed | 8656 ms |
| infra | `pnpm verify:infra` | passed | 4656 ms |
| project-license | `pnpm verify:project-license` | passed | 30174 ms |
| licenses | `pnpm verify:licenses` | failed | 4557 ms |
