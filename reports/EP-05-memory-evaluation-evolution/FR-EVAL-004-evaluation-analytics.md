# FR-EVAL-004 Evaluation Analytics Evidence

Date: 2026-07-13

## Result

Verified. The management API displays PostgreSQL-derived success rate, duration, call cost, failure types, Skill-version stability, and ordered quality trend, with Skill/version/provider/model/Server/Tool filters.

## Reproducible evidence

- `pnpm test:unit`: 152/152 pass. Deterministic aggregation covers success, duration, total/average cost, failure counts, quality ordering, version grouping/deviation/stability, six-decimal output, and invalid child filters.
- `pnpm test:integration`: 31/31 pass. Migration `0049` adds the model-to-Task foreign key and indexes; repository evidence filters a real persisted execution simultaneously by provider/model and Server/Tool.
- `pnpm test:contract`: 46/46 pass. The public endpoint parses all six filters and returns every required metric; OpenAPI includes parameters and an example.
- `pnpm test:e2e`: 40/40 pass.
  - Real two-round MCP control execution filtered by Skill/version/Server/Tool returns two samples, 50% success, total cost 2, average cost 1, an `adjust_plan` failure type, and version stability.
  - Real low-quality Task filtered by Skill/version/provider/model returns its failed 0.3 quality report in the ordered trend and version-quality summary.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 198 combined unit/contract tests (152 unit, 46 contract), architecture, source pins, Compose, SBOM/licenses, build, 31 integration, 40 E2E, and local server smoke passed.

## Verification classification

- Real: PostgreSQL joins, explicit model Task linkage, actual Workflow budget costs, Skill/Tool identities, failure classifications, quality reports, management filtering, and local E2E.
- Deterministic calculation: stability formula and rounding are application-owned and unit verified.
- Not claimed: statistical confidence or production cost completeness where an operator configures zero/omitted per-call prices.
