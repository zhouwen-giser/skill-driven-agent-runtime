# FR-MEM-003 Stage-specific Memory Evidence

Date: 2026-07-12

## Result

Verified. Intent, Skill selection, Workflow generation, exception handling and Goal evaluation use distinct query templates and domain Memory-type allowlists. Hits are inserted as source-linked data into the corresponding fixed model request and are therefore retained in the existing model invocation audit.

## Reproducible evidence

- `pnpm exec vitest run packages/application/test/memory-service.unit.test.ts packages/application/test/model-decisions.unit.test.ts packages/application/test/workflow-planner.unit.test.ts packages/application/test/goal-evaluator.unit.test.ts`
  - verifies stage templates/type filtering and non-empty Memory evidence in all five model instructions.
- `pnpm test:integration`
  - verifies the shared PostgreSQL/pgvector active-memory search path.
- `pnpm test:e2e`
  - 37/37 tasks pass with the stage retriever wired into real intent, selection, planning, exception and evaluation services; lifecycle and confirmation behavior remain unchanged.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 183 combined unit/contract tests (142 unit, 41 contract), architecture, source pins, Compose, SBOM/licenses, build, 29 integration, 37 E2E, and local server smoke passed.
  - An initial chained shell invocation was terminated by its outer timeout while `smoke:server` remained alive. The orphaned command was identified and stopped, containers were cleanly removed, and every gate was rerun separately to completion.

## Verification classification

- Real: stage routing, PostgreSQL/pgvector retrieval, type filtering, model-request inclusion, invocation audit and Task lifecycle.
- Simulated: local deterministic embeddings/model responses in E2E.
- Not claimed: production embedding relevance quality; the configured provider owns semantic ranking quality.
