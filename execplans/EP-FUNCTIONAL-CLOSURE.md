# Functional closure after current-source audit

## Purpose / Outcome

Repair the audited incomplete paths: GOWM device Temporary Skill terminal persistence and auxiliary remote links, safe Skill evolution validation/publication, and Console Workflow node editing. Preserve external protocols, task semantics, confirmation, PostgreSQL authority and the sole LangGraph runtime. Missing patrol provider capabilities and source trajectory timestamps require real upstream capability/evidence; never substitute fabricated success.

## Requirements Covered

FR-EVO-004–008 / AC-13–14 (candidate validation and publication), FR-SKL policy/version constraints, Workflow management editing, and existing GOWM device/service ownership acceptance. Final traceability entries must identify concrete tests rather than equating structural acceptance-map checks with behavior.

## Context and Orientation

SDAR starts at main `2029f4b7fca908724e58b77f079fc893eff69cb4`. Fresh audit run `sdar-verify-59d697db-893a-4815-9867-6199a1d988d0` passed all 30 stages with runtime input hash `57f82abc90d87bda99fd285f06b9cc5b464cdeee38281c56b32d23b4502c161c`; this is a pre-change baseline only. Existing DeferredSkillEvolutionService deliberately blocks unsafe publication. GOWM is a separate local owner repository, initially `506315b`; SDAR consumes pinned read-only contracts.

## Architecture and Interfaces

- GOWM owns additive forward overlays, history and expected structure. Do not edit applied migration checksums. Terminal experience inherits actual task/temporary-skill device attribution in the existing transaction. Auxiliary links use authoritative binding ownership and retain opaque remote IDs.
- SDAR startup only verifies the pinned contract. No consumer DDL, shadow state or additional Task/Goal writer.
- Skill candidate validation must preserve exact base policies and dependencies, exercise the candidate through the existing planner/validator/LangGraph with strictly isolated recorded tool results, and report real assertions. Formal publication must CAS the frozen base and atomically store version, candidate receipt and catalog event. Keep fail-closed behavior until this is proven.
- Console edits retain complete DSL data; visual editing must not bypass server validation, immutable running instances or plan confirmation.

## Progress

- [x] 2026-10-11 Audited current main and retained fresh full baseline evidence.
- [x] 2026-10-11 User explicitly extended scope to local GOWM repairs and contract re-intake.
- [x] 2026-10-11 Implement additive owner storage fixes and consumer regressions/re-intake. Owner source `2e1af12`; 43 owner and 32 restricted consumer PG scenarios pass; full milestone gate pending.
- [x] 2026-10-11 Implement Console node editing and draft confirmation guard; 43 focused tests and UI build pass. Browser acceptance passed with real API revision, confirmation, LangGraph execution and trace; full milestone gate pending.
- [x] Implement ordinary recorded Skill candidate validation and atomic publication; focused tests pass. Full gate and remaining unsupported recording kinds are explicitly separate.
- [x] 2026-10-12 Freeze final source, run all 30 isolated stages and same-source restricted-role GOWM verification.
- [ ] Commit, push, check actual-head CI and merge SDAR delivery. GOWM PR23 is merged and post-merge CI passes.

## Discoveries and Surprises

- The current GOWM installer rejects changed applied checksums; new overlays are required even for function replacement.
- The existing legacy evolution service's historical replay does not receive the candidate and publication uses separate writes. Merely wiring it back is unsafe.
- Fresh all-green local tests coexist with explicit unimplemented features; passing tests alone do not close those requirements.

## Decision Log

- 2026-10-11: User authorization supersedes the earlier local SDAR-only scope for the two GOWM defects. Owner changes remain local until validated; physical operation/deployment remains NOT_RUN.
- Incremental work uses focused tests. Formal implementation completion requires one full current-source gate plus owner/consumer database proofs. Unimplemented work remains open.

## Implementation Steps

1. Add owner forward overlay, upgrade/idempotence/provenance regressions, regenerate manifests/expected structure and handoff. Commit owner source for reproducible consumer intake.
2. Update SDAR pinned contract and storage verification; make both known-gap reproducers required positive and negative tests under restricted roles.
3. Extend visual node actions/configuration without losing unknown DSL fields; preserve server validation and publish ordering.
4. Build isolated candidate simulation and transactional publication behind existing evolution interfaces. Test changed/disabled bases, late candidates, mismatched policy, replayed publication and failed assertions.
5. Update ADR, traceability/status/changelog. Freeze source and run final gates. Report unavailable source capabilities and field evidence accurately.

## Validation

Save command, source identity, exit code and raw log for every result under `reports/functional-closure/`. Run smallest related tests after each increment. Final: `pnpm verify:isolated -- --frozen` (format, lint, types, unit, integration, contracts, E2E, build, smoke), owner install/upgrade tests and restricted-role GOWM checks. Baseline results do not replace post-change validation.

## Idempotence and Recovery

Use isolated test databases and owner installer history; do not migrate field databases. Preserve earlier evidence and both working trees. Failed upgrade transactions roll back without changing prior history. Candidate validation does not publish; publication retries return a durable identical receipt or reject changed identities.

## Artifacts and Evidence

Baseline: `reports/runtime-semantic-closure/sdar-verify-59d697db-893a-4815-9867-6199a1d988d0/`. Known owner reproducers: `docs/gowm-shared-storage/UPSTREAM_STORAGE_GAP.md`, `apps/server/test/gowm-temporary-skill-scope.ts`, auxiliary-link gap report. Focused and browser evidence: `reports/functional-closure/`; full source freeze evidence pending.

## Outcomes and Retrospective

LOCAL_COMPLETE for the scoped repair. All 30 final frozen stages pass; publication remains in progress. Full FR-EVO and whole-project acceptance remain OPEN. Field operations and deployment NOT_RUN. Patrol capability, per-sample trajectory clocks and production operational evidence remain open unless a real authoritative implementation/contract is supplied and verified.

### Increment discoveries and validation

The owner manifest generator omitted existing core 079; generation now preserves it. Populated predecessor upgrade changed only two link columns, scoped uniqueness, one terminal function and the link ownership function/trigger. All earlier object definitions and installed checksums were retained.

Consumer attempts `eb846e9a` and `95d6c18d` exposed mistakes in the new fixture (terminal repository writes are intentionally rejected; capability_gap requires evidence), not reasons to relax production guards. The fixture now asserts the rejection and supplies the proper gap evidence. Focused run `6ae4b1b4` passes 32 native scenarios; two formal E2E passed in both preceding attempts but are not combined with that run to claim a full result.

Skill evolution implementation now uses ADR-163: the unpublished candidate runs through usage assessment, read-only planning and real LangGraph with local recorded IO. PostgreSQL stores version, receipt, correction and outbox atomically. Restricted profiles and unsupported recordings remain explicitly deferred or failed; full feature acceptance remains open. Legacy publisher is removed from application exports and forbidden in production imports.

Browser acceptance found the UI sent an unchanged Workflow version during revision; it now advances exactly one version while preserving Workflow/Goal identity. The draft comparison also ignores JSON property ordering after PostgreSQL round-trips. Added regression assertions pass (33 focused cases). Browser evidence: `reports/functional-closure/console-browser-20261011/result.json`; edited literal result, V2, superseded prior plan, confirmed new plan and two runtime events were observed. Both owned fixture containers were removed.


### Candidate publication discoveries

Real PostgreSQL retry testing caught JSON report codecs dropping the new authority/execution receipt. The codec now validates and preserves those fields; full readback and repeated/concurrent publication are asserted. Transaction fault injection verifies candidate/version/outcome/outbox/correction rollback and retry. Recorded failures compare stable errors from actual LangGraph execution rather than treating any thrown exception as a passing exception test. Source readers check exact Task/Goal/plan/instance attribution; correction records and historical input/error summaries feed subsequent induction.

First post-change full run `aca368ac` failed lint. Run `a76f2b6d` passed ordinary format/lint/types/unit/contract/integration/E2E but failed the official TCK environment: system Python lacks ensurepip. Retry `2d4168c4` uses the bundled Python and failed earlier during the supervisor contract: unrelated `/proc` entry disappeared with ESRCH. The test cleanup now treats ESRCH like ENOENT while preserving permission failures and complete process-group ownership checks; its 14 contracts pass. None of these runs is relabeled PASS. The restricted-role GOWM run `70f3f93a` passes 8 steps / 2 formal flows / 32 native scenarios on exact first-batch frozen inputs; it will be repeated for the final source.


Delivery discovery: GOWM local base 506315b includes unrelated unmerged history changes. Cherry-picked only the storage repair onto remote main 9a99369 in an isolated delivery checkout, producing dca0fcdbbe35f94ddaf968b6489decdbf228755a. Shared-storage source files match the prior tested repair byte for byte. Consumer pins now use this narrow delivery commit. Run 90519bda was intentionally canceled through its owned cleanup handler before full validation to refreeze this exact contract provenance; it is NOT a passing gate. Owner verification and final SDAR/GOWM gates run on the delivery identity.


Final attempt `f49c363d` passed format/lint/types, 2,683 unit, 553 contract and 272 integration cases, then failed ordinary E2E (75 passed / one failed; the isolated performance case was not reached). The full-file reproducer confirmed that induction carried prior Skill guidance and the loopback model's broad keyword routing selected another operation. Production correctly saved a failed induction receipt without publishing. Route the induction outer operation before legacy content-based branches, retain strict proposed-candidate/correction/no-live-call assertions, and rerun the full frozen gate. Original failures are archived without reclassification.


### Final local acceptance — 2026-10-12

Frozen run `sdar-verify-db3f431f-8e48-4f7c-9d66-59a5df663e6f` passes all 30 stages: 2,683 unit, 553 contract, 272 integration and 77 E2E; install/exit/cleanup 0, runtime and baseline unchanged. Runtime input `d7b0a6d9fcdc000e9e9804c8b812972c2e496a0759bb3d48aa073c6ece8ff40b`, baseline `77107c3ba2c1363bd0c8038a0941678354be8aaada2a222858d40eec5bbdbfd6`. Official HTTP/JSON MUST protocol harness: 74 passed / 161 skipped / 0 failed; skips are not acceptance. Independent performance regression 7.33%, append P95 3.02 ms. Same-source GOWM run `d2e3e90d` passes eight steps, two formal flows and 32 native cases, with unchanged schema/private state and owned cleanup. Browser production inputs match this freeze; only the E2E mock routing changed after browser acceptance. GOWM owner PR23 and actual merged-head CI pass; source equality is recorded. See `reports/functional-closure/FINAL_CLOSEOUT.md` and `final/VALIDATION.json`. This scoped milestone does not close unsupported recordings, real inspection/trajectory authority or whole-project DoD.
