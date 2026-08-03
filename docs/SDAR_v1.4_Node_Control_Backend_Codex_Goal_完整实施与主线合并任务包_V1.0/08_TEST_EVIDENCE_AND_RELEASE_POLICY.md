# 08. 测试、证据和发布策略

## 阶段门禁

每阶段运行：

- format/check；
- lint；
- strict typecheck；
- affected unit/contract；
- affected integration/E2E；
- architecture；
- migration/API/contract 专项门禁；
- build 或 smoke（适用时）。

## 最终门禁

至少运行仓库实际存在的等价命令：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm verify:architecture
pnpm verify:management-openapi
pnpm verify:node-control-openapi
pnpm verify:runtime-control-contract
pnpm verify:node-events
pnpm verify:telemetry-export
pnpm verify:a2a-baseline
pnpm test:a2a-tck
pnpm verify:migrations
pnpm verify:secrets
pnpm build
pnpm smoke
pnpm verify
```

若最新 main 的命令名称不同，P00 建立命令映射；不可跳过语义门禁。

## 必须真实验证

- Control DB fresh create；
- Runtime DB fresh create；
- Revision Apply/Ack/LKG；
- Node Control outage；
- Runtime restart；
- concurrent publish/CAS；
- SMPP outage/LKG；
- Provider Catalog drift；
- Availability expiry；
- Capability Readiness；
- Agent Card rollback；
- Task atomic binding；
- Replan/failover Attempt；
- Telemetry endpoint outage non-impact；
- Secret scan；
- A2A TCK。

## 证据真实性

阶段报告记录：

```text
requested
actually_run
passed
failed
skipped
duration
environment
commit_sha
dirty
```

Skip 不是 Pass。Mock 不是真实系统证据。
