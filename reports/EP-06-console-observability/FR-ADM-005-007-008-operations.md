# Prompt, Memory, and Evaluation Console Evidence

## FR-ADM-005 Prompt lifecycle

- Create immutable stage-specific Prompt versions from administrator, correction, or inactive automatic-candidate sources.
- Optionally publish at creation; inspect full version history and version effects.
- Explicitly publish, rollback, or disable through existing application boundaries.
- The console does not synthesize candidates or change current pointers locally.

Acceptance reconciliation (2026-07-13): FR-ADM-005 is verified. EP-03 ran real PostgreSQL, management HTTP, local model HTTP, invocation audit, effect queries, and same-process E2E proving candidate isolation, publication, new-version routing, and traceable effects (15 integration, 12 E2E, build, smoke). Current Prompt/management/Console regression passes 3 files/52 tests; unified `pnpm verify` passes 54 files/241 tests.

## FR-ADM-007 Memory lifecycle

- Search globally active Memory through the semantic retrieval API.
- Create only source-linked structured Memory candidates through the refinement boundary.
- Read a Memory and immutable status transitions; supersede with an explicit replacement/reason or invalidate with an actor/reason.
- Persistently display the accepted V1 risk that anonymous Memory is shared without user isolation.

Acceptance reconciliation (2026-07-13): FR-ADM-007 is verified. FR-MEM-004's real management/model/PostgreSQL E2E covers source-linked read/search, transactional supersede, unchanged historical content, replacement links, transition audit, invalidation, and active-only retrieval (29 integration, 37 E2E, build, smoke). Current Memory/management/Console regression passes 3 files/55 tests; unified `pnpm verify` passes 54 files/241 tests.

## FR-ADM-008 Evaluation operations

- Filter PostgreSQL analytics by Skill, SkillVersion, provider, model, MCP Server, and Tool.
- Display success/duration/cost/failure/version-stability/quality-trend payloads and Skill quality warnings.
- Reiterate warning-only policy and link operators conceptually to explicit Skill disable/rollback/correction controls; no automatic disable is performed.

## Verification

- Console server-render unit checks cover all three operational panels and prove no fixed Prompt/Memory records are embedded.
- Existing application, PostgreSQL, management-contract, and E2E tests remain the owning lifecycle evidence referenced by FR-PMT, FR-MEM, FR-EVAL, and FR-EVO rows.
- Strict typecheck, lint, format, and production build pass for the new controls.

## Pending

- Real browser interaction E2E remains open.
- Docker-backed reruns remain unavailable while local stopped containers cannot start.
- Cross-page browser verification remains required before FR-ADM-008 can be verified.

## Evaluation dashboard follow-up (2026-07-13)

`apps/console/src/EvaluationPanel.tsx` now renders the PostgreSQL-backed analytics snapshot as operational KPIs, failure distribution, Skill-version stability, and ordered quality trend. It preserves expandable raw evidence and explicit empty states. `pnpm exec vitest run apps/console/src/console.unit.test.tsx packages/application/test/evaluation-analytics.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts` passed 42 tests; format, lint, typecheck, and production build passed. Browser E2E remains unverified.
