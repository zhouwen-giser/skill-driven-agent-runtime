# FR-EVAL-001 Five-component Task Quality Evidence

Date: 2026-07-13

## Result

Verified. Every successfully completed formal or Temporary Skill Task runs Goal, Workflow, Skill, result-quality and Tool-call evaluation through five strict fixed-stage calls, persists one linked TaskQualityReport, and exposes it by Task.

## Reproducible evidence

- `pnpm exec vitest run packages/application/test/task-quality.unit.test.ts`
  - verifies all five components, strict evidence fields, deterministic mean and status threshold.
- `pnpm test:integration`
  - 30/30 passes and applies migration `0046` with Goal/Workflow/ProcessedResult foreign-key constraints.
- `pnpm exec vitest run packages/management-api/test/http-endpoint.contract.test.ts`
  - verifies the five-component Task report contract.
- `pnpm test:e2e`
  - 39/39 passes; a real confirmed LangGraph Task produces a schema-validated ProcessedResult, five audited `evaluation` calls and a PostgreSQL report read back with all components, score 0.9 and evidenceRefs.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 188 combined unit/contract tests (145 unit, 43 contract), architecture, source pins, Compose, SBOM/licenses, build, 30 integration, 39 E2E, and local server smoke passed.

## Verification classification

- Real: lifecycle hook, fixed Model Runtime routing/audit, strict parsing, deterministic aggregation, PostgreSQL constraints and management readback.
- Simulated: local deterministic evaluator semantics in E2E.
- Not claimed: production-model score calibration, which requires operational evaluator calibration evidence in later FR-EVAL work.
