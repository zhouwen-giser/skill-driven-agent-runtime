# FR-MEM-002 Refined Memory Admission Evidence

Date: 2026-07-12

## Result

Verified. PostgreSQL retains complete raw Task/execution evidence in the existing Task, Workflow event/instance, processed-result and Evolution Experience records. Durable `memory_item` rows are admitted from strict structured model output, contain normalized structured knowledge rather than raw traces, and reference their Task and ProcessedResult evidence.

## Reproducible evidence

- `pnpm exec vitest run packages/application/test/memory-service.unit.test.ts packages/application/test/result-processing-service.unit.test.ts`
  - proves valuable-only admission, type mapping, normalization, source references, duplicate suppression, and mandatory structured refinement for external submissions.
- `pnpm test:integration`
  - 29/29 passes with real PostgreSQL/pgvector persistence and retrieval alongside authoritative raw Task/Workflow/result records.
- `pnpm exec vitest run packages/management-api/test/http-endpoint.contract.test.ts`
  - proves the management contract invokes refinement rather than exposing direct creation.
- `pnpm test:e2e`
  - 37/37 passes; a confirmed real Task traverses Result Processor, fixed model routing, automatic Memory admission, PostgreSQL/pgvector storage, and management retrieval of `{kind, statement}` plus `task:` and `processed-result:` references. Existing administrator submissions also traverse the model refinement route.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 182 combined unit/contract tests (141 unit, 41 contract), architecture, source pins, Compose, SBOM/licenses, build, 29 integration, 37 E2E, and local server smoke passed.
  - The first full run exposed an incorrect `.item` access after a deduplication return-type refactor; the resulting Task failures were fixed at the source. Repeated E2E runs retain historical rows and pass without clearing them.

## Verification classification

- Real: PostgreSQL raw records, model-runtime invocation/audit boundary, JSON Schema parsing, pgvector search, normalized duplicate decision, automatic admission, source-linked retrieval.
- Simulated: refinement quality is supplied by the local deterministic provider in E2E.
- Not claimed: production-provider knowledge quality or fuzzy semantic merge of differently worded claims. V1 deduplication is deterministic normalized type/summary equality after pgvector candidate retrieval.
