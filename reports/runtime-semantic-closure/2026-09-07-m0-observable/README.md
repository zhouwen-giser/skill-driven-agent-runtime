# M0 observable verification — in progress

This is implementation evidence, not milestone closure or semantic acceptance.

The first split full-gate attempt is `sdar-verify-770e63c9-3bf0-46bc-a6c1-9b7a68ec3b89`:
- runtime input SHA256: `a5657726813e3144d83cfc33718ce8240cfde4351de91fb608aac8ff420eae48`.
- format 62525 ms, isolation/runner contracts 3967 ms, lint 176368 ms, typecheck 58048 ms: passed.
- unit 181734 ms: 2375 passed / 3 failed in 274 files; performance-only follow-up was not reached because the ordinary unit command failed.
- failure 1: existing template and README use development, but an old test expected test/integration. Corrected exact environment assertions and added an explicit closed real-operation gate assertion.
- failures 2/3: debug profile tests read sibling telemetry templates outside the original source-only snapshot. Added six explicit byte-copied external inputs, all bound to runtime identity; no .env or links to shared working data.
- source and baseline identity unchanged; cleanup exit 0. Contract/integration/E2E/build/TCK/smoke not reached.

The original aggregate 601-second timeout had insufficient step evidence to identify its exact active command. The new attempt proves format/lint/typecheck individually pass; it does not retrospectively establish which original command timed out.

Implementation adds streaming per-stage logs, independent time limits, process-group termination, peak RSS/process sampling, source/baseline hashes, independent frozen installation, and explicit new/legacy verification report readers. Protocol checks need pinned historical Git blobs, now provided by a private local bare clone, never a link to the developer Git directory.

Nine runner regressions passed in the permitted environment (`node scripts/test-verification-runner.mjs`). Sandbox subprocess stdout/stderr is unavailable for some child tests; those failed attempts are environment evidence, not product regressions. No assertions were removed. The corrected three-file unit replay passed 23/23 in the permitted environment. The new frozen attempt `sdar-verify-47146855-054f-4610-a9ae-c8684ce2c899` installed all 290 packages into an independent store/node_modules in 77581 ms (no reused dependency tree), and is running the complete gate. Snapshot protocol checksum/locked-Git-blob check also passed; no canonical sibling protocol authority claim is made by its default vendored mode.


## Frozen attempt 47146855

`sdar-verify-47146855-054f-4610-a9ae-c8684ce2c899` completed with exit 1 / cleanup 0 and unchanged snapshot hashes.
- Fresh dependency install passed (290 packages, 77581 ms).
- Format 39897 ms, 13 isolation/runner contracts 3050 ms, lint 195101 ms, typecheck 58284 ms: passed.
- All unit tests passed: 2378 ordinary + 22 performance = 2400; 275 files; 167055 ms.
- Contract: 530 passed / 1 failed in 61 files; 47852 ms. Existing migration-selection test's expected tail stopped at 0177 despite the pre-existing development migration 0178. Added 0178 to the exact expected seven-entry suffix; 3 targeted migration-selection contracts now pass.
- Later phases were not reached; this is not a complete gate.

Additional M0 review found nested Node Control smoke projects omitted from outer timeout cleanup. They now derive exact names from the run ID, share a tested cleanup allowlist and explicitly pass the Runtime Compose project. Outer cleanup attempts all three owned projects and records each result. Old phase-12 progress is removed from each new snapshot so it cannot resume historical suites. Static test-selection and frozen-contract files under reports are hashed as runtime inputs; generated result/status reports remain excluded.

Ten runner tests plus four pre-existing isolation tests pass in the permitted environment. A third frozen full-gate attempt now includes all these changes. No M0 milestone has closed.


## Frozen attempt ffde5273

`sdar-verify-ffde5273-ebd7-452f-8f13-881d88b48510` input `8d69816b62b7981d2d4235d54a44773d204e0b752b5cffea05eead035386bae4`:
- format, 14 runner/isolation contracts, lint, typecheck passed;
- all 2400 unit and 531 contract tests passed;
- evidence contract/coverage, 881-source architecture and A2A baseline checks passed (baseline report checks are structural/historical, not current TCK acceptance);
- management OpenAPI check failed because the three existing development isolated-demo routes were undocumented. Added their real request/response schemas, idempotency/manual acknowledgement semantics and errors to the specification.
- all three registered project cleanup commands passed; runtime/baseline hashes unchanged. Full gate remains failed; remaining stages are now being checked as targeted diagnostics before a new full run.

Remaining static follow-up (scope is explicitly **not** a full gate) passed all 11 stages: management OpenAPI 177 operations; Node Control frozen contract 131 operations; implementation conformance 455 RBAC decisions; vendored SMPP checksum; historical acceptance mapping; 35 source pins; frozen protocol; Compose config; project license; SBOM; production build. Logs/results: `static-followup/`. This follow-up does not establish current 18-AC acceptance or current official TCK. A new full frozen run now includes the OpenAPI repair.

## Frozen attempt 60048430

`sdar-verify-60048430-57a7-4b09-8419-7ff34a9e2776`, runtime hash `8ebaf536bb27d85445fda50e61db073342cb022d8b43c8618d55ac2a1f9fac03`:
- Fresh independent frozen install, all 23 bootstrap stages and cognitive replay passed; 2400 unit / 531 contract tests. Production build passed.
- Migration path passed in 164185 ms: 71 additive Runtime / 12 Control migrations, frozen backup/restore and all rollback/data/checksum checks.
- Integration failed in 356487 ms: 206 passed / 1 failed, 37 files. Later isolated integration files and E2E/TCK/smoke were not reached.
- Failure: the governed-control recovery test expected a Provider poll after an already reconciled terminal receipt. Existing admission deliberately schedules only polling/cancel-observing states; the same test already expects terminal_event_pending and its durable task.completed event. Corrected the obsolete poll expectation and added duplicate-recovery assertions for exactly one pending event, zero new polls, and one original tool invocation. No product behavior or acceptance requirement was removed.
- Source/baseline identities unchanged; all three owned Compose cleanup commands passed. M0 remains open.

Additional cleanup audit found raw migration containers/volumes outside Compose, and swallowed cleanup errors in older gate scripts. Isolated migrations now use the outer run identity; outer cleanup inventories by both run/scope labels and validates exact resource names before removal. Failed cleanup is logged and makes the stage fail while subsequent cleanup attempts continue. Normal migration completion clears the dropped database reference before stopping its container. Added three regressions (17 total runner/isolation tests passed), including unexpected resource ownership rejection and a failed Docker cleanup causing a nonzero stage exit. Targeted eslint passed.

Post-bootstrap diagnostics run in a separate copied snapshot with these repairs. They do not replace a full current-source gate or frozen-install acceptance.

## Post-bootstrap diagnostics and interruption evidence

Diagnostic run `96bacfad-aa5e-4057-ba8f-575752df1eb8`:
- Governed-control PostgreSQL regression passed 3/3.
- E2E reached 69 passed / 3 failed; the separately selected performance test had not yet run. All three failures came from the old model fixture unconditionally selecting continue, now outside the immutable fail_fast/recoverable choices. The fixture now parses the actual allowed strategies; denied governed invocation must retain MCP_CONTROL_AUTHORITY_REQUIRED, with zero Provider calls. Malicious out-of-policy decision regressions remain in the compiler unit suite.
- Official pinned TCK HTTP+JSON MUST pytest run passed 74, skipped 161 transport-inapplicable tests and deselected 30 other-level tests. Its JSON per-requirement states are 62 PASS, 38 NOT TESTED, 29 SKIPPED, no FAIL. The official console table misleadingly counts NOT TESTED as failed; retain the original report. This is protocol-harness evidence, not M5 Runtime stream-result closure.
- Canonical evidence demo stopped at suite 6/25 on the same old model fixture; infra and server/console smoke passed.
- Node Control smoke passed Control API/worker/RBAC/restore/restart checks but failed creating the subsequent Runtime network: Docker default address pools fully subnetted. The Control network was still retained after all its assertions. The script now fully stops its owned Control infrastructure before the Runtime independence check, freeing its subnet and strengthening independence. No Docker global settings or other projects changed.
- All registered diagnostic cleanup operations succeeded.

Real local interruption run `347b139e-838c-43f9-a85f-1459405a78e2` created only a stopped test container and volume, canceled the owning verifier, then removed both through the outer migration cleanup. Two subsequent inventories were empty. Evidence: `cleanup-interruption/`.

Frozen run `dbec0be0-f529-4997-aabc-5f253054b45d` initially encountered ERR_PNPM_ENOSPC. Removed only private frozen dependency trees/stores from three completed runs plus an unused copied diagnostic store; source snapshots and reports retained, actions recorded in `dependency-cache-cleanup.json`. Install recovered and passed (290 packages, 77.4 s). Format and all 17 runner/isolation tests passed. Explicitly canceled during lint because the new Control cleanup-order repair superseded this source snapshot; reason=canceled, not a lint defect. Five outer cleanup operations passed, input/baseline identities unchanged. This canceled run is not a complete gate.

Repaired follow-up `3a8d64b3-fc5f-4b13-be95-e31699d3c510` reruns complete E2E, all canonical evidence suites from empty progress, and Node Control smoke in the private diagnostic copy. M0 remains open until a new complete frozen gate passes.

### Final E2E fixture and shutdown follow-up

The repaired exception fixture restored the nested child confirmation/version-change E2E. Diagnostic `58c85e9c` reached 70 passed / 2 failed: the generic Goal evaluator fixture still returned achieved for failed Workflow instances, correctly rejected by WORKFLOW_CONTROL_ACHIEVEMENT_INSTANCE_INVALID. It now parses the actual Workflow status and returns unachievable for failure. The area-patrol test requires Task GOAL_UNACHIEVABLE **and** a failed Workflow preserving the exact MCP_CONTROL_AUTHORITY_REQUIRED node error, zero charged MCP calls, and zero Provider tools/call or tasks/get. The production forged-achievement guard and its unit regression remain unchanged.

Node Control cleanup-order smoke passed in this diagnostic, but its nested server stderr exposed a teardown race: the script dropped the database before the owned service had finished shutdown. Added bounded service exit waiting and nonzero/timeout failure propagation before database cleanup. Two further regressions pass; total verification contracts are now 19 (7 isolation/child lifecycle + 12 runner).

Diagnostic `3a8d64b3` is environment failure evidence: copied package symlinks referred to the completed source snapshot whose private dependencies were reclaimed. The diagnostic now explicitly reuses the retained private `dbec0be0` dependency tree; this mode is classified as diagnostic, never frozen acceptance. Its startup/readiness and address-pool failures were cleaned by the outer runner. The current diagnostic is `5aa9d06e`.

Frozen run `28b2b0dd` passed install, format, 17 then-current runner contracts, lint, typecheck, all unit/contract and remaining static checks; explicitly canceled during build after the fixture/shutdown repairs superseded its input. Cancellation is not a build defect. A full current-source run will follow the focused repairs; no milestone has closed.

### X03 prerequisite found by valid failure evaluation

Diagnostic `5aa9d06e` passed the repaired Node Control smoke without the previous forced database disconnect. Its E2E run exposed a real failure-path gap (65 passed / 7 failed): evaluating an unachievable governed invocation allowed the outer control to produce another awaiting-confirmation plan. The controller now terminates an already-failed Workflow containing MCP_CONTROL_AUTHORITY_REQUIRED before any Goal model evaluation, retaining that original typed error. The owning control failure path persists failed status; no model can grant missing authority or replan it. Three unit cases cover possible achieved/unachievable/adjust_plan suggestions, with zero evaluator calls, one execution, zero replan rounds and a failed control (24 controller unit tests pass). E2E keeps the valid failure evaluator and now requires the original permission denial on Task plus failed Workflow and zero Provider effects. This is a narrow X03 prerequisite, not full A2A admission generalization.

Current diagnostic `7784c444` runs full E2E and all canonical evidence suites with the controller repair; no full milestone closure is claimed.

Diagnostic `7784c444` confirms the real authority-denial repair fixes the two recursive area-patrol cases. Five existing move-to cases fail only because their old expected code was the model achievement guard; they now correctly receive MCP_CONTROL_AUTHORITY_REQUIRED. Updated that exact expectation; all original failed Workflow, MCP budget and zero Provider-call assertions remain. Canonical evidence passed its formerly failing suite 6 and continues through the remaining PostgreSQL suites. A new full frozen current-source run is underway; no source mutation is planned while it runs.

Canonical evidence diagnostic `7784c444` completed all 25 suites from empty progress: PASS 44/44 scenarios, 42 direct tests. Copied the generated report into that diagnostic evidence folder as `canonical-evidence-report.json`. Its entire diagnostic run still exits 1 because the earlier five obsolete E2E error-code expectations failed before correction; this is not a full gate. The new full frozen run is `e5741fdb-0b7e-4452-8145-6627ffc38e5b`, with all current fixes and 19 verifier contracts.

## Frozen attempt e5741fdb

Runtime input `731752d22b26868506be2731b87678bb01f981a380713a2624cddb5189069d4d`: all bootstrap checks passed, including 2403 unit tests, 531 contracts and production build; migration verification passed in 35418 ms. Integration reached 220 passed / 8 failed. All 207 ordinary integration tests and the 13-test isolated evidence-persistence suite passed. The isolated evidence-export suite's first test manually rolled back 0177..0174 while leaving 0178 applied, correctly rejected by the production migration ledger checker; seven following tests consequently lacked the rolled-back table. Updated that test to roll back the entire actual applied suffix in descending order and assert exact full ledger restoration after two startup migrations. Production ledger validation was not weakened. The final isolated integration file and later full stages were not reached. All five outer cleanup operations passed; runtime/baseline hashes remained unchanged.

Diagnostic `e170ef62` completed the entire integration collection: 207 ordinary + 13 evidence-persistence + 8 evidence-export + 1 node-control export = 229 passed (273340ms). Full E2E passed 72 ordinary tests and the separately selected performance test, 73 total (204287ms). The two E2E invocations select complementary cases; their displayed selection skips do not represent omitted coverage. All five outer cleanup operations passed. See that run's `results.json`, stage logs and `cleanup.json` under `post-bootstrap/`. This is a diagnostic run, not full frozen closure.

The 2026-09-07 execution review found seven version-2 full attempts totaling 3481545ms (58.0 minutes), excluding installs and diagnostics. Two attempts were canceled after subsequent fixes superseded their snapshots. These records measure execution cost, not feature completion or wholly wasted time. The active ExecPlan now specifies targeted diagnosis before batching fixes and freezing source for a complete gate; no full gate is currently running.
