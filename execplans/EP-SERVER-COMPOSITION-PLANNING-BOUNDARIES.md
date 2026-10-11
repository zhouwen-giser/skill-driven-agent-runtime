# EP-SERVER-COMPOSITION-PLANNING-BOUNDARIES

Status: IN_PROGRESS (2026-10-11, Asia/Shanghai). Base: a230bac9b61e6cf901a91c094dbfe63704717fce. Publication is authorized; site operations and deployment are NOT_RUN.

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
- [ ] M1: 15 typed composition stages and resource cleanup implemented; focused lifecycle/processor PASS. Full gate retries pending (obsolete source-layout assertion repaired; later transient projection read failed E2E).
- [ ] M2: internal UGV profile, shared confirmation ports, separate PostgreSQL reader and MCP transport factory implemented; 173 focused tests PASS. Full gate passed through E2E, then failed because system Python lacks ensurepip. Retry uses bundled Python; product code is unchanged.
- [ ] M3: User Goal/Workflow generators and commit services, candidate-only interactive/experience injection, formal initial-task orchestration implemented; 85 planning/audit and 57 TaskBusiness/profile focused tests PASS; isolated gate and restricted-role GOWM check running.
- [ ] M4: final frozen-install gate, restricted-role GOWM verification and publication.

## 6. Discoveries and Surprises

- Artifact architecture currently permits only the literal runtime.ts composition root. Replace that location exception with a bounded composition allowlist and negative fixtures, preserving SDK and authority restrictions.
- Existing initial capability binding must complete before publishing the Task plan; retain its held-binding regression.
- Existing remote waits are recoverable only through the original snapshot/Binding authority. Ordinary process-lost execution is still failed without retry.

- GOWM `saveAttempt` creates a formal planning root. Its candidate-only adapter now defers root-dependent audit records in immutable candidate data; formal commit flushes attempts/readiness before finalizing the plan. Native audit evidence is durable after formal submission; discarded candidates do not allocate execution authority. A process lost during candidate generation does not recover/replay it.
- Workflow commit must compare the entry-time frozen Goal contract, rather than the mutable caller object after a model await. The existing mutation regression and new candidate regressions pass.
- M1/M2 retries use independent copies of the original frozen snapshots and retain all failed run logs; active M3 work never contaminates earlier milestone inputs.

## 7. Decision Log

- D1: Preserve APIs, wire schemas, error codes, defaults, migrations, dependencies and protocol pins (ADR-161).
- D2: Preserve attempt/readiness/model audit while removing formal write capabilities from generators.
- D3: Profile hooks return candidates/policies/evidence; existing application services commit official state.
- D5: TaskBusiness operation support uses an explicit profile policy port with a frozen contract-data default for compatibility; generic lifecycle writers remain unchanged.
- D4: Each formal milestone receives the full isolated gate. No external services or physical devices are used.

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

IN_PROGRESS. No implementation or acceptance claim yet. Final outcomes must identify actual boundary changes, test counts, limitations and merged revision.
