# FR-ADM-008 complete operations analytics increment

Date: 2026-07-13

## Delivered

- MCP usage grouped by actual Task-linked Server/Tool invocation audits: volume, success rate, and average duration.
- Model effects grouped by actual Task-linked Provider/model invocation audits: volume, success rate, average duration, and average Token use.
- Capability growth grouped from immutable SkillVersion observations across Experiences: first/latest version, observed version count, samples, and successes.
- Evidence-counted optimization suggestions for repeated failures, unreliable Tools/models, and unstable Skill versions.

Suggestions are advisory read models only. They cannot disable Skills, publish versions, change model routes, invoke Tools, or mutate Workflow execution. PostgreSQL remains authoritative under the extended ADR-063.

## Verification

- `pnpm exec vitest run packages/application/test/evaluation-analytics.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts apps/console/src/console.unit.test.tsx` — 42 passed.
- format, lint, strict typecheck, architecture, 102-operation OpenAPI drift, and production build passed.
- The PostgreSQL integration assertion now includes exact Task-linked MCP/model audits but remains unexecuted while Docker services are unavailable.
