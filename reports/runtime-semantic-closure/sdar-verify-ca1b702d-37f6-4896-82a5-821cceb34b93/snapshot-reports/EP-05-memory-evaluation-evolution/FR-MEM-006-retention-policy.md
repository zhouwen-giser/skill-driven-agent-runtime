# FR-MEM-006 Memory Retention Policy Evidence

Date: 2026-07-12

## Result

Verified. Domain, PostgreSQL and management API expose review/archive/delete policy fields. V1 rejects automatic archive or deletion and contains no cleanup scheduler or worker; existing Memory remains readable after policy changes.

## Reproducible evidence

- `pnpm exec vitest run packages/application/test/memory-retention.unit.test.ts`
  - verifies persisted fields and fail-closed automatic-cleanup rejection.
- `pnpm test:integration`
  - 30/30 passes; migration `0045` seeds the singleton, PostgreSQL persists nullable thresholds and enforces both automatic flags false.
- `pnpm exec vitest run packages/management-api/test/http-endpoint.contract.test.ts`
  - verifies GET/PUT request and response models.
- `pnpm test:e2e`
  - 39/39 passes; a real Memory survives retention changes, automatic archive enablement returns 400, and the stored policy remains disabled.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 186 combined unit/contract tests (144 unit, 42 contract), architecture, source pins, Compose, SBOM/licenses, build, 30 integration, 39 E2E, and local server smoke passed.

## Verification classification

- Real: domain validation, PostgreSQL constraints/persistence, management operations and retained Memory readback.
- Simulated: none for policy behavior.
- Intentionally unimplemented: archive/delete execution, exactly as required for V1.
