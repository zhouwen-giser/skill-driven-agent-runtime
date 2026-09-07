# FR-MEM-005 Evolution Memory Evidence

Date: 2026-07-12

## Result

Verified. Skill manual corrections, Prompt manual-correction versions, Task failure reasons and Goal evaluation conclusions are refined into source-linked evolution Memory and are retrievable through the shared PostgreSQL/pgvector store for later stage-specific generation.

## Reproducible evidence

- `pnpm exec vitest run packages/application/test/memory-service.unit.test.ts packages/application/test/prompt-service.unit.test.ts packages/application/test/task-service.unit.test.ts packages/application/test/workflow-controller.unit.test.ts packages/application/test/skill-evolution.unit.test.ts`
  - verifies the source services and refinement/mapping boundary without weakening their existing lifecycle assertions.
- `pnpm test:integration`
  - verifies PostgreSQL/pgvector Memory persistence and source-linked active retrieval.
- `pnpm test:e2e`
  - 38/38 passes; the added scenario creates a real Prompt manual correction and explicit Task failure, then reads `prompt_learning`, `skill_learning`, `failure_experience`, and evaluation experience with their authoritative source prefixes. Earlier scenarios provide real Skill correction and Workflow evaluation records.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 184 combined unit/contract tests (143 unit, 41 contract), architecture, source pins, Compose, SBOM/licenses, build, 29 integration, 38 E2E, and local server smoke passed.
  - E2E initially exposed that Prompt corrections with version-independent summaries were deduplicated to an older source. Including Prompt version in the projection summary preserves each distinct correction while retaining idempotent deduplication.

## Verification classification

- Real: authoritative source writes, runtime hooks, structured source references, PostgreSQL/pgvector storage and retrieval.
- Simulated: local deterministic model refinement quality in E2E.
- Not claimed: authenticated operator identity under the V1 trusted-intranet/no-auth baseline.
