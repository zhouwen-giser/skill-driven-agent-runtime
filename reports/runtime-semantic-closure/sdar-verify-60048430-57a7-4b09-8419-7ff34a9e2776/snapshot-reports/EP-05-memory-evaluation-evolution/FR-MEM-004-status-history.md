# FR-MEM-004 Memory Status and Replacement Evidence

Date: 2026-07-12

## Result

Verified. Memory supports active, superseded and invalid lifecycle projections, explicit replacement links and append-only transition evidence. Historical content remains directly readable and is never physically overwritten; only active rows participate in semantic/stage retrieval.

## Reproducible evidence

- `pnpm exec vitest run packages/application/test/memory-service.unit.test.ts`
  - verifies active-only supersede, replacement identity, one-way invalidation, actor/reason audit and repeat-transition rejection.
- `pnpm test:integration`
  - 29/29 passes with migration `0044`; real PostgreSQL proves transactional replacement, old-content preservation, transition history and active search exclusion after invalidation.
- `pnpm exec vitest run packages/management-api/test/http-endpoint.contract.test.ts`
  - verifies supersede, invalidate and transition-history contracts.
- `pnpm test:e2e`
  - 37/37 passes; real management/model/PostgreSQL flow supersedes a source-linked global Memory, reads unchanged old content and audit history, invalidates the replacement, and still reads its content while active retrieval excludes it.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 184 combined unit/contract tests (143 unit, 41 contract), architecture, source pins, Compose, SBOM/licenses, build, 29 integration, 37 E2E, and local server smoke passed.

## Verification classification

- Real: PostgreSQL transaction/locking predicate, transition rows, management routes, historical direct reads and active retrieval exclusion.
- Simulated: replacement refinement content is returned by the deterministic local model provider in E2E.
- Not claimed: authenticated actor identity, consistent with the accepted trusted-intranet/no-auth V1 baseline.
