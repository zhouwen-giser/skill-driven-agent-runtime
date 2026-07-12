# Prompt, Memory, and Evaluation Console Evidence

## FR-ADM-005 Prompt lifecycle

- Create immutable stage-specific Prompt versions from administrator, correction, or inactive automatic-candidate sources.
- Optionally publish at creation; inspect full version history and version effects.
- Explicitly publish, rollback, or disable through existing application boundaries.
- The console does not synthesize candidates or change current pointers locally.

## FR-ADM-007 Memory lifecycle

- Search globally active Memory through the semantic retrieval API.
- Create only source-linked structured Memory candidates through the refinement boundary.
- Read a Memory and immutable status transitions; supersede with an explicit replacement/reason or invalidate with an actor/reason.
- Persistently display the accepted V1 risk that anonymous Memory is shared without user isolation.

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
- Model comparison and capability-growth/optimization dashboards need richer composed views before FR-ADM-008 can be verified.

