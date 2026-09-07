# FR-EVO-010 Workflow Template Evidence

Date: 2026-07-12

## Result

Verified. Three successful Evolution Experiences with the same normalized Goal and Workflow structure induce a PostgreSQL-backed versioned template. A later exact or lexically similar request receives that template as planning input, produces a newly identified and fully validated Workflow, follows normal plan confirmation, and records the resulting success/failure and duration against the exact template version.

## Reproducible evidence

- Unit: `pnpm exec vitest run packages/application/test/workflow-template.unit.test.ts packages/application/test/workflow-planner.unit.test.ts`
  - proves the three-success threshold, source Experience linkage, lexical similarity preference, adjusted Workflow identity, and effect aggregation.
- Integration: `pnpm test:integration`
  - 29/29 passed with real PostgreSQL; verifies template/version/use persistence, plan foreign keys, transactional outcome update, and migration `0043`.
- Contract: `pnpm exec vitest run packages/management-api/test/http-endpoint.contract.test.ts`
  - verifies template inventory and per-template usage routes.
- E2E: `pnpm test:e2e`
  - 37/37 passed with PostgreSQL, Redis, server, LangGraph planning/execution and A2A endpoint. The added scenario completes and confirms three tasks, observes one induced template, then completes and confirms a fourth task and reads back one successful use with metrics.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`
  - format, lint, typecheck, 180 combined unit/contract tests (139 unit, 41 contract), architecture, source pins, Compose, SBOM/licenses, build, 29 integration, 37 E2E, and local server smoke passed.
  - `pnpm smoke` was also attempted and correctly failed because no such script exists; the repository-defined command is `pnpm smoke:server`.

## Verification classification

- Real: PostgreSQL occurrence/template/use records; threshold induction; planner preference; standard DSL validation; plan confirmation; LangGraph execution; usage outcome aggregation; management reads.
- Simulated: the local deterministic model provider supplies the adjusted Workflow DSL in E2E; the same production Model Runtime boundary and validation path are used.
- Not claimed: embedding-based paraphrase similarity or production-provider planning quality. V1 matching is normalized exact plus deterministic token Jaccard similarity with a documented threshold.

## Safety and invariants

The template is model input data, never executable source. Reuse never executes the stored Workflow instance directly, never mutates an active graph, and never bypasses validation or confirmation. LangGraph.js remains the sole Workflow runtime.
