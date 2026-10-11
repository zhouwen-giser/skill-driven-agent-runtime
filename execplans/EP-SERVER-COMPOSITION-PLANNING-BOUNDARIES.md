# EP-SERVER-COMPOSITION-PLANNING-BOUNDARIES

Status: LOCAL_VERIFIED_PUBLICATION_PENDING (2026-10-11, Asia/Shanghai). Base: a230bac9b61e6cf901a91c094dbfe63704717fce. Publication is authorized; site operations and deployment are NOT_RUN.

## 1. Purpose / Outcome

Split server composition and isolate UGV/SMPP policies across server and application boundaries without changing external protocols, Task states or execution safety. Candidate generation must not own formal execution-state writes. This is a scoped refactor, not a claim of whole-project release readiness.

## 2. Requirements Covered

NFR-MNT-001 modular adapters; FR-EXE-001/002 plan confirmation; FR-EXE-003 one Task outcome; FR-EXE-006 cancellation; FR-EXE-007 Goal Patch invalidation; FR-EXE-008/009 no running-work replay. Preserve ADR-041, ADR-111, ADR-138–139, ADR-153, ADR-155–160 and all frozen public contracts.

## 3. Context and Orientation

`apps/server/src/runtime.ts` has 8,731 lines of composition and callbacks. `WorkflowPlannerService.plan` combines candidate generation, audit, formal persistence and supersession. `UserGoalPlanningService.generateCandidate` does not write but shares an object with a writable repository. Initial Task preparation writes Skill planning evidence and confirms plans. Five existing planning unit files pass 69 tests; architecture passes 1,001 TypeScript sources at the unmodified base.

## 4. Architecture and Interfaces

Explicit typed composition stages retain construction/recovery order and one instance per runtime. Narrow late-bound ports handle existing callback cycles and fail closed before binding. The original runtime exports remain a facade. Candidate generators receive model, validator, read-only authority and append-only planning audit ports, never formal repositories or confirmation/execution services. Formal plan commit services own persistence, existing CAS/idempotence and supersession. TaskService/PlanPreparationProcessor, WorkflowExecutionService and UserGoalPlanController retain lifecycle authority. UGV policies live in an internal profile package; SMPP transport construction stays behind the MCP adapter. Generic confirmation idempotence types remain in Application.

## 5. Progress

- [x] 2026-10-11 Base verified clean and implementation branch created.
- [x] M1: 15 typed composition stages and resource cleanup verified. Full isolated `sdar-verify-8e80b7f4-b164-4987-aa1f-361a129a99b5` PASS, all 30 stages; 2633 unit / 552 contract / 270 integration / 77 E2E. Runtime inputs and baseline unchanged, cleanup 0. Raw logs/hash manifest in M1_VALIDATION.json. Earlier contract/projection/host performance failures preserved.
- [x] M2: internal UGV profile, shared confirmation ports, separate PostgreSQL reader and MCP transport factory verified. Full isolated `sdar-verify-e035b76b-81fd-4413-834a-06a939bec908` PASS, all 30 stages; 2633 unit / 552 contract / 270 integration / 77 E2E. Runtime inputs and baseline unchanged, cleanup 0. Raw logs/hash manifest in M2_VALIDATION.json. Prior lint/TCK/image failures retained.
- [x] M3: User Goal/Workflow generators and commit services, candidate-only interactive/experience injection and formal initial-task orchestration verified. Full isolated `sdar-verify-53662b2d-8114-4df1-8c51-889c8d1d7898` PASS, all 30 stages; 2650 unit / 552 contract / 270 integration / 77 E2E. Runtime inputs and baseline unchanged, cleanup 0. All 2024 local runtime inputs and six external verification inputs match commit 870e94b6; M3_VALIDATION.json and M3_SOURCE_IDENTITY.json retain exact identities.
- [ ] M4: post-review final `pnpm verify:isolated -- --frozen` PASS (`sdar-verify-5db2a153-cc6d-4e7d-b9dd-ddbb7f4b5433`), all 30 stages, 2652 unit / 552 contract / 271 integration / 77 E2E, frozen install 0, cleanup 0, unchanged runtime/baseline. Exact runtime commit 6b3fc0e2bda523b8dcd0aa9934ef41f3e1af3766, input 57f82abc90d87bda99fd285f06b9cc5b464cdeee38281c56b32d23b4502c161c. Same local frozen inputs pass restricted-role GOWM `sdar-smpp-gowm-5542f350-6926-4f09-a400-ffba1a6b0e03`: 8 steps, two formal E2E and 30 native scenarios, including four new atomic/readiness regressions. Previous M4 evidence is retained in PRE_REVIEW and original run folders. Git publication/normal merge is pending.

- [x] Post-review fixes: PR36 P1 readiness loss and P1 non-atomic deferred GOWM audit fixed. Focused 66 unit tests, typecheck, lint and 8 architecture negative fixtures PASS; owned restricted-role GOWM `sdar-smpp-gowm-3e4c5d7b-faa4-45ee-947a-80acb1e16a88` passes two formal E2E and 30 native scenarios on unchanged working-tree inputs. New four PostgreSQL scenarios cover rollback/exact retry, durable readiness, stale CAS and formal failure. Previous acceptance is preserved in PRE_REVIEW and its original run directories. Post-review complete frozen gate and same-source GOWM PASS; publication is pending.

- [x] Current-source complete freeze and same-source GOWM verified on `6b3fc0e2`. Code-version CI passes `38131929285`, with actual checkout `990230d98550f335f809701f23d9e1a774f4711b` matching all frozen runtime inputs; metadata-head CI/normal merge still pending.

## 6. Discoveries and Surprises

- Artifact architecture currently permits only the literal runtime.ts composition root. Replace that location exception with a bounded composition allowlist and negative fixtures, preserving SDK and authority restrictions.
- Existing initial capability binding must complete before publishing the Task plan; retain its held-binding regression.
- Existing remote waits are recoverable only through the original snapshot/Binding authority. Ordinary process-lost execution is still failed without retry.

- GOWM `saveAttempt` creates a formal planning root. Its candidate-only adapter now defers root-dependent audit records in immutable candidate data; formal commit flushes attempts/readiness before finalizing the plan. Native audit evidence is durable after formal submission; discarded candidates do not allocate execution authority. A process lost during candidate generation does not recover/replay it.
- Workflow commit must compare the entry-time frozen Goal contract, rather than the mutable caller object after a model await. The existing mutation regression and new candidate regressions pass.
- M1/M2 retries use independent copies of the original frozen snapshots and retain all failed run logs; active M3 work never contaminates earlier milestone inputs.
- Performance failures also reproduce on the previously accepted pre-refactor frozen source (24.25% baseline drift, 15.48% P95 regression). CPU affinity did not resolve them. The repository already accepted real tmpfs PostgreSQL performance isolation in `reports/resource-identity-20260909/performance-isolated.json`. The isolated driver now uses a separately owned tmpfs PostgreSQL and the same pinned Redis/image/settings for only the unchanged performance test; functional/integration/migration durability gates retain persistent volumes. The outer cleanup includes this owned project even if its child is killed. No test threshold or product setting changes.

- PR36 review found that PostgreSQL plan reads omitted append-only readiness, so an idempotent return could lose a confirmation blocker. Both plan and confirmed-definition reads now hydrate durable planning readiness rather than accepting a fresh candidate assessment.
- Deferred attempts previously committed separate GOWM roots before readiness and source CAS. PostgreSQL now saves all deferred attempts, readiness/snapshots, source CAS, final plan/targets and command effect in one fenced transaction. A planning failure is thrown only after its formal failed record commits.

- Post-review frozen run `sdar-verify-ff0fb504-cfab-4e57-a259-b702df3e0563` fails the existing P08 claim-COMMIT-response-loss integration case: a 120 ms Cognitive lease expires before expected reconciliation. New Workflow atomic regression passes. Runtime/baseline remain unchanged and cleanup exits 0; all failed-stage raw hashes are retained in `review-fixes/failed-full/`. Unchanged frozen-source focused P08 runs 10/10 PASS on fresh owned PostgreSQL. Recovery fixtures now retain the existing default 10-second nominal test lease, and explicitly expire it with a checked one-row SQL update; all reconciliation/replay assertions stay intact. The new current-source complete frozen gate passes; the failed run remains preserved.

- Frozen `sdar-verify-f6caff6a-e6d1-4fa5-bbf0-caf84887f334` preserves a second existing fixture failure: its 50 ms projection lease expires before entry, yielding lease-conflict and an unresolved barrier timeout. New Workflow regression and all ten corrected P08 recovery cases PASS. Runtime/baseline unchanged, cleanup 0. The projection test now uses the existing nominal test lease, observes actual database expiry and the takeover connection waiting on a PostgreSQL Lock, and propagates early projection errors. Original order/state assertions and 30-second test timeout remain. Focused real PostgreSQL projection test PASS; the new current-source complete frozen gate passes, with original failures preserved.

- Current `fea9ae03` frozen failure is the unchanged P07 retrieval P95 assertion (284.56 ms / 100 ms). Its input/baseline remain unchanged and owned cleanup exits 0; preserve all logs and diagnose the original case on a fresh persistent-store fixture. The exact unchanged frozen four-case file passes alone on a fresh persistent PostgreSQL fixture, P95 13.48 ms / unchanged 100 ms limit; the exact cause of the failed full-run latency is not established. No product path or performance assertion is changed. The next complete frozen gate `68be0fa9` passes all 271 integration cases (P07 P95 9.14 ms) and 76 functional E2E, but fails original P13 baseline drift 18.24% / 15% limit; Runtime regression 4.65% and append P95 2.46 ms meet their limits. Inputs/baseline unchanged, cleanup 0. The unchanged frozen performance case passes independently: drift 11.24%, regression -1.74%, append P95 2.72 ms; all original samples and limits retained. This is diagnostic evidence, not full acceptance; another complete frozen gate is required without runtime/test changes.

## 7. Decision Log

- D1: Preserve APIs, wire schemas, error codes, defaults, migrations, dependencies and protocol pins (ADR-161).
- D2: Preserve attempt/readiness/model audit while removing formal write capabilities from generators.
- D3: Profile hooks return candidates/policies/evidence; existing application services commit official state.
- D5: TaskBusiness operation support uses an explicit profile policy port with a frozen contract-data default for compatibility; generic lifecycle writers remain unchanged.
- D4: Each formal milestone receives the full isolated gate. No external services or physical devices are used.
- D6: Use the existing accepted tmpfs PostgreSQL performance practice in the isolated test driver; preserve the original 72/72 runtime samples, 100 append samples, 15% baseline drift, 10% P95 regression and 20 ms append limits. Record this fixture separately from persistent-store verification (ADR-161).

- D7: Reload authoritative PostgreSQL readiness for idempotent plan/confirmed-definition reads; preserve persisted blockers and confirmation status.
- D8: Use an optional formal atomic persistence port backed by one PostgreSQL transaction. Existing repository methods remain compatible, candidate-only ports remain writer-free, command fencing and device ownership precede writes.

- D9: Recovery fixtures control expiry through `expireAction`, rather than depending on unrelated I/O completing within 120 ms. Use the existing nominal test lease and assert explicit expiry changes one pending action. Production lease/defaults and every state/replay assertion remain unchanged.

- D10: Verify projection/takeover serialization using PostgreSQL expiry and lock-wait observations rather than fixed sleeps. Retain the original 30-second test limit and exact owner/attempt/order assertions, and always release the projection/owned takeover Pool.

## 8. Implementation Steps

1. Extract infrastructure, evidence/knowledge/model, planning, execution, remote Task, HTTP and lifecycle stages with explicit dependencies; regression-check startup and teardown.
2. Move UGV policies to `packages/ugv-profile`; split generic confirmation once-store types and PostgreSQL UGV authority reader; centralize SMPP client construction.
3. Introduce User Goal and Workflow candidate generators and commit services; inject generator-only objects into interactive/experience paths; move Task planning evidence/confirmation to formal orchestration. Preserve all initial/revision/repair/child-workflow entry points.
4. Add architecture negative fixtures and candidate success/failure/late-result, commit failure/CAS/idempotence and safety regressions. Update documentation and evidence after actual checks.

## 9. Validation

Small relevant unit/contract suites after every increment. At every milestone: `pnpm verify:isolated` (all format/lint/type/unit/real PostgreSQL integration/contracts/E2E/build/smokes). Final: `pnpm verify:isolated -- --frozen`, and the existing restricted-role GOWM runtime driver on the same frozen source. Capture command, exit code, input hashes, raw logs, cleanup and real/simulated/NOT_RUN classification. CI must pass the pushed tested tree before merge.

## 10. Idempotence and Recovery

No schema migration or new runtime dependency. Local stages retain repository transactional semantics, exact scope and version checks. Partial startup tears down only resources owned by this Runtime; shutdown awaits owned work before closing PostgreSQL. Failed gates are retained and diagnosed with focused tests before another freeze. Git commits preserve the base and enable code rollback; no deployment is performed.

## 11. Artifacts and Evidence

Evidence root: `reports/server-composition-planning-boundaries/20261011-local`. Full isolated raw logs remain under the runner's existing report root, referenced by run ID and hashes. Record source identities and publication separately. All site reads/writes and deployment: NOT_RUN.

## 12. Outcomes and Retrospective

Local refactor acceptance is verified on post-review runtime commit 6b3fc0e2bda523b8dcd0aa9934ef41f3e1af3766, input 57f82abc90d87bda99fd285f06b9cc5b464cdeee38281c56b32d23b4502c161c: fifteen typed composition stages, internal UGV/SMPP policies and writer-free generators with formal submission authority. M1/M2/M3 original full milestone gates and the new final frozen gate pass 30 stages each. Final 2652 unit / 552 contract / 271 integration / 77 E2E, fresh install and cleanup 0. Seventeen local acceptance groups PASS; same-source GOWM verifies two formal E2E and 30 native scenarios. SQL/readiness/CAS failures roll back deferred audits and planning roots; the same candidate retries, durable blockers remain authoritative and failed planning records commit. Original failed runs and earlier accepted versions are retained. Git publication is pending; site/deployment remain NOT_RUN and original project-level gaps stay open.
