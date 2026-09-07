# FR-ADM-008 system and model operations increment

Date: 2026-07-13

## Delivered

- Credential-free PostgreSQL Provider inventory and fixed-stage route inventory management APIs.
- Console operations for encrypted Provider configuration and explicit single-Provider stage routing.
- Readable Task wait, Memory retention, Skill evolution, evolution-trigger, and sanitized model-invocation evidence.
- Validated console updates for Task wait timeout, Memory review/archive/delete values, and Skill evolution threshold; automatic Memory archive/delete are always submitted as disabled.
- Persistent no-auth, no-fallback, write-only credential, and disabled automatic-retention warnings.

The domain-owned `ModelProviderConfiguration` and `StageModelRoute` remain authoritative. The application repository returns credential-free projections; the console owns no operational state. No new runtime or SDK type crosses a domain boundary, and ADR-018 remains sufficient.

## Reproducible verification

- `pnpm exec vitest run packages/application/test/model-runtime.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts apps/console/src/console.unit.test.tsx` — 41 passed.
- `pnpm verify:management-openapi` — 101 operations matched.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm verify:architecture`, `pnpm build` — passed.
- Follow-up policy-control evidence: `pnpm exec vitest run apps/console/src/console.unit.test.tsx packages/management-api/test/http-endpoint.contract.test.ts` — 39 passed; format, lint, typecheck, and build passed.

The PostgreSQL integration assertion for Provider/route lists is implemented in `repositories.integration.test.ts` but is not counted as run: local Docker container start remains hung. Browser E2E and the full EP gate remain unverified.
