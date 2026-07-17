# SDAR v1.2 Phase 11 — Skill Execution Records and Evidence Links

Date: 2026-07-17

Status: Passed and published

Dependency: V11-MAIN-BASELINE-DEPENDENT

Input SHA: `0ca3de21912959aca3999936b9b7e2b70ad4a1f9`

Feature SHA: `dc55f471a691dde3a613d5528e7bf2e106b150bd`

## Result

Domain now owns one immutable exact-version `SkillExecutionRecord`, eight projection statuses, the
frozen twenty-event vocabulary and thin evidence references. The record links Goal/version, exact
Skill version, parent execution, persisted selection, applicability, mode, context/composition policy,
Workflow plan/definition and Task. References link Provider, Task operation/resource,
`RemoteTaskBinding`, context/outcome evidence, hard gates and human intervention without embedding
credentials, SDK objects or private model reasoning.

Migration 0106 adds a root record, identity-ordered append-only event table and append-only reference
table. The PostgreSQL repository Domain-revalidates every read, locks status transitions, derives the
current projection from ordered events and rejects all transitions after completed/failed/cancelled/
degraded. The released migration profile is monotonic through 0106; gaps fail closed and rollback
refuses while execution evidence exists.

The existing Task planning path records selection through plan-compliance evidence. Existing confirmed
and automatic execution paths record start, external wait, resumption and authoritative Controller
outcome. Remote MCP Task admission appends its binding reference and terminal Controller projection
appends the existing outcome reference. These writes observe existing Task/Workflow/Provider authority;
post-side-effect projection failure produces a structured warning and cannot rewrite terminal state.

Management API/OpenAPI adds Task-scoped execution collections and exact execution detail. Responses
include parent/child trees, Task/Provider/resource/remote-binding refs, EvidenceRefs, hard gates and
degraded reasons with trusted-intranet and authority warnings. No general telemetry or ClickHouse-like
platform was added.

## Verification

- Clean pushed feature SHA: format, lint, strict typecheck, 84 unit/contract files with 562/562 tests,
  256-source architecture, 116 Management API operations and production Server/Console build passed.
- Real disposable PostgreSQL repository suite: 57/57, including ordered selected→planning→executing→
  waiting_external→executing→degraded projection, thin reference round-trip and terminal immutability.
- Real local PostgreSQL/Redis/loopback remote continuation runtimes: final changed-area 10/10; the
  earlier three-file runtime regression also passed 11/11 before the final resumption hook.
- Migration verifier: released empty/0064 upgrade through 0106, reverse rollback/reapply,
  isolated-profile guard and ledger-gap fail-closed passed.
- The complete unit/contract gate contains no skipped tests. The targeted integration commands selected
  files/cases intentionally; their reported skips were only non-selected cases during focused runs,
  followed by the complete 57/57 repository run.

The first complete repository run found stale test assumptions about installing only 0100–0102 and
rolling 0055 back beneath later foreign keys. Tests now use the single released 0100–0106 chain and
preserve the v1.1 `cancel_observing` rule. A later runtime rerun initially failed because the repository
containers had already been intentionally stopped; they were restarted, the exact tests passed 10/10,
and the containers were stopped again with volumes preserved.

## Remaining Scope

Phase 12 must prove the formal `embodied.move_to` vertical, including remote input/cancel/restart and
hard-gated final-position evidence. Phase 13 must prove recursive `embodied.area_patrol` parent/child
records and degradation. Phase 14–15 retain the mandatory full verification and final acceptance gates.
Draft PR #5 remains Draft and is not merged. External production MCP Tasks Provider interoperability
remains unverified.
