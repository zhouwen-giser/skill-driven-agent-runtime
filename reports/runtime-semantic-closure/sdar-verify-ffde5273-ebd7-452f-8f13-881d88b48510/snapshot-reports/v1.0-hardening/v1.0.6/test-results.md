# v1.0.6 Test Results

Date: 2026-07-16

The feature evidence gate passes:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit`: 242 passed
- `pnpm test:contract`: 58 passed
- `pnpm test:integration`: 52 passed
- `pnpm test:e2e`: 44 passed
- `pnpm verify:architecture`: 175 TypeScript source files
- `pnpm build`
- `pnpm verify:migrations`

All real-service commands used `SDAR_REUSE_EXISTING_INFRA=true`; no Docker lifecycle command ran.
