# FR-MCP-011 Dependency Warning Reconciliation

Date: 2026-07-13

## Acceptance criterion

When Tool removal or Schema change affects a Skill, the runtime must create a dependency warning while the Skill remains enabled; management must display the warning and must not automatically disable the Skill.

## Reproducible evidence

Historical real infrastructure gate:

- EP-02 migration `0009_mcp_audit` and the production PostgreSQL repository were run against a real database.
- The test created a current enabled SkillVersion that required an MCP Tool, atomically replaced the Tool set, and read the persisted `removed` warning for that exact enabled Skill/version.
- The warning transaction writes only `mcp_dependency_warning`; the MCP repository has no Skill-status mutation port. The Skill registry remains the sole status authority.
- The complete gate passed 30 unit, 9 real integration, 14 contract, 6 E2E, production build, smoke, architecture, and the pinned A2A harness.

Current regression:

- `pnpm exec vitest run packages/application/test/mcp-registry.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts apps/console/src/console.unit.test.tsx`
- Result: 3 files and 57 tests passed.
- Unit evidence covers both `removed` and `schema_changed`; management contracts return the persisted Skill/version warning; Console evidence exposes the real warnings action.
- Unified `pnpm verify` passes 54 files/241 tests and all static/build gates.

## Classification

FR-MCP-011 is verified. Current Docker-backed repetition is unavailable, but the exact persistence/no-status-mutation acceptance already has real historical infrastructure evidence and current boundary regression.
