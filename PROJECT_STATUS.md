# Project Status

## UGV ten-tool Capability / Skill / A2A expansion (2026-09-01, implemented; final deployment gate pending)

ADR-147 and `execplans/EP-UGV-10-TOOL-CAPABILITY-EXPANSION.md` register the current ten-operation UGV
Provider catalog as thirteen append-only public surfaces: four read operations, the preserved point
navigation lineage, route/distance/return-home navigation, reconnaissance, tracking, gimbal,
emergency stop and weapon control. Read-only and ordinary controlled operations reuse the one
managed-capability / Skill Usage / LangGraph / Frozen MCP Task runtime. Existing Binding, Skill,
Capability, Exposure and Agent Card versions are never overwritten.

Physical, direct-emergency and weapon authorities are now distinct PostgreSQL one-shot confirmation
kinds. Management, A2A and Console adapters converge on TaskService/Application services; the Console
shows only non-sensitive target/resource, immutable hashes, expiry, revocation and consumption state.
Weapon lifecycle authority is published but invocation remains restricted until strict fresh target
and payload evidence exists. Unknown/additive provider-policy fields are retained; understood fields
remain individually validated. Current implementation gates include 151 high-risk focused tests, 125
query/Console tests, real PostgreSQL 3/3, migrations through 0177, typecheck, lint, build and the
870-source architecture gate. No A2A/MCP Task, Provider Tool call or device action was performed.
Final full-suite rerun and read-only governance deployment evidence remain before closure.

## UGV append-only successor admission repair (2026-09-01, implemented; navigation waiting)

ADR-146 removes the UGV Profile's fixed `embodied.move@2` / `a2a.embodied.move@2` product-code
assumption. The Provider dependency policy now validates immutable append-only Capability content,
and natural-language admission resolves the current Exposure from the active PostgreSQL Agent Card.
The localhost revision-2 authority was adopted through normal publish/Card governance without an
override or history rewrite: `embodied.move@4` and `a2a.embodied.move@3` are published, Agent Card
revision 14011 is active, and the legacy v2 Card lineage is superseded rather than overwritten.
Current catalog/Binding readiness points at `127.0.0.1:19100`. The obsolete simulation-only
readiness/planning restriction is removed: frozen live Task Capability authority now remains live
without a simulation identity through selection, planning, governed dispatch and terminal evidence.
The independent default-closed live deployment gate, plan confirmation and one-shot physical
confirmation remain mandatory. Focused tests, typecheck, architecture, lint and build pass. Actual
navigation is intentionally waiting because an unrelated Provider mission was observed running; no
new A2A/MCP Task or Tool call was created by this repair.

## SMPP MCP Tasks Runtime Consumer Sync (2026-08-31, implemented and qualified)

ADR-145 and `execplans/EP-SDAR-SMPP-MCP-TASKS-CONSUMER-SYNC.md` add a restart-stable logical MCP
invocation identity, reconciliation-only recovery for uncertain mutating calls, immutable
Task-to-Provider execution lineage, and five additive Required Canonical Evidence records. An
uncertain call cannot fall through to ordinary dispatch; exact found reconciliation materializes the
original Task through the existing PostgreSQL `RemoteTaskBinding` and LangGraph continuation path,
while not-found, conflict, unavailable and deferred remain fail-closed.

The formal `sdar.evidence/v1` contract now contains 105 records (100 Required, five Diagnostic), and
the generated registry, schemas, protocol contract, source matrix and downstream handoff share one
authority. The SMPP Producer is source-locked at `1e67e6e421d70a3cbce2d41bf5007e99463712fe`;
missing Provider execution or Device Mission identities remain explicitly unresolved. This work does
not claim physical UGV, Simulator, Telemetry, Benchmark or production qualification, and it triggered
no Device or navigation action.

The downstream Telemetry current-authority dependency is now independently locked to implementation
commit `cceea2b88b697dcaef33dba0bd7679b15b3b28d3`, qualification commit
`01719507aea97f2bcca904fc3838127ee2fd29b2` and image digest
`sha256:34b75ac34cf67bc0ad4d392a4589a8c67fbc1118df96eda279e0857ded3971b1`.
The deployed consumer passed its read-only current-view chain: latest unresolved/conflict facts hide
historical exact Mission relations from current authority while preserving audit history. This closes
the Telemetry/P9A observation axis only; it does not mutate SDAR Task authority or prove Goal/physical
success.

## UGV Benchmark passive debug (2026-08-27, live service ready / data waiting)

ADR-144 and `execplans/EP-UGV-BENCHMARK-DEBUG.md` now cover the running passive
Benchmark stack. External ClickHouse migration 015 and the two dedicated identities
are applied: each has an exact 132-relation SELECT closure and only Projector has
INSERT on the frozen 40 tables. API, Reconciler, Evaluation Worker, passive Benchmark
Worker and Projector run with persistent PostgreSQL/artifacts; anonymous `/ready` is
HTTP 200. Registry bootstrap preserves the immutable first boundary. The repaired
global metadata projector published all 68 outbox rows; the 68 original failures are
retained as resolved audit records and no unresolved DLQ remains. Status correctly
reports `waiting_source` and `EXECUTABLE_RULESET_NOT_CONFIGURED`; no Run, Task, score
or Device Tool was created. The Telemetry producer is now published at
`4d1dd58697a6deb6e2efabd6c21aa0c8097703c8`; Benchmark pins that exact commit,
manifest blob and byte hash, and its complete 6-file/64-test contract gate passes.

## SDAR Telemetry joint debug extension (2026-08-26, implemented; live activation pending)

`execplans/EP-SDAR-TELEMETRY-DEBUG.md` / ADR-143 track the approved external warehouse,
incremental-only Evidence/ProviderOps, unified diagnostic queries and default-active domain worker.
Incremental Evidence, independent SMPP routing, fixed diagnostic federation and the real domain
consumer/lifecycle are implemented with targeted tests. Shared warehouse migration 014 and ten
mapping metadata checks passed; real diagnostic queries returned stored metrics/traces. SDAR →
Commander/NPC is explicitly deferred. Real source registration is still missing for live ACTIVE;
the old debug services were not restarted, and no new Task/Device action or complete acceptance is
claimed. Commands, test counts, rollback behavior and the existing SMPP TypeScript baseline are in
`reports/sdar-telemetry-debug/verification.md`. The ExecPlan remains open for live source acceptance.

## UGV / SMPP / Telemetry development integration (2026-08-26)

ADR-142 / `execplans/EP-UGV-DEBUG-TELEMETRY.md` implement the complete `pnpm ugv:debug` stack
without Grafana. Actual LAN access, anonymous public management, separate Agent Card announcement,
NO startup and default YES have been verified. All required ports are public except databases/Redis;
3000 is absent. Repeated startup retains one Binding (revision 1), Capability/Exposure version 2,
five pre-existing Tasks and zero MCP invocations. No new Task or Device action was submitted.
Real events/metrics/traces persist, and ClickHouse outage plus Collector restart restores queued
metrics while preserving volumes and seven-day diagnostic TTLs. See the joint-debug guide and
`reports/ugv-debug/verification-2026-08-26.md` for commands and coverage.

Affected SDAR/SMPP typechecks and builds pass. Telemetry's 69 tests/build and affected-module strict
typecheck pass; its whole-repository strict typecheck remains blocked by 450 pre-existing diagnostics
outside this change. This is not a claim of a clean all-project release gate or navigation acceptance.
Implementation evidence was captured before the separately authorized Git publication;
publication status is recorded by the commits and pull requests, not by the live smoke result.

## PR #26 integration (2026-08-26, published / ready for merge)

`execplans/EP-PR26-DEBUG-INTEGRATION.md` tracks conflict resolution and publication of
`codex/live-dev-evaluation-chain` to the existing PR with `main` as target. The integration preserves
admission observation, trusted-intranet natural-language admission and the ADR-141 lifecycle repair.
The committed `pnpm ugv:debug` entrypoint reuses the existing stack and defaults debug start/restart
to YES per operator instruction, with explicit NO available and no implicit Task/Device call.
All 295 relevant tests across 17 files, typecheck, production build, 858-source architecture and
changed-scope lint/format/syntax checks pass. Integration commit `febab07` is pushed to the existing
source branch; [PR #26](https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/26) targets
`main` and reports `MERGEABLE` / `CLEAN`. No actual main merge or hosted CI completion is claimed.
Read-only inspection found no listener
on 10999; no service restart or live movement acceptance is claimed here.

## Persistent Provider authority repair (2026-08-26)

ADR-141 / `execplans/EP-SDAR-PERSISTENT-PROVIDER-AUTHORITY.md` is complete. Binding registration
is now independent of observation TTL; unchanged health does not create semantic revisions. Card
publication reads current registered Skills rather than readiness. New Task snapshots resolve current
semantic Binding authority while existing Task/Plan snapshots remain immutable. Background health,
registration and Runtime Catalog reconciliation are wired. All 358 relevant unit/contract tests and
21 isolated PostgreSQL integration tests pass, as do typecheck, production build and scoped static
checks. Code `9fc5ae0` is pushed on `codex/provider-binding-lifecycle`; the three debug processes were
restarted on the original Runtime/Control databases with migration 0012. At `02:34:09Z`, Binding
revision remained 1 with fresh available health, readiness snapshot 1278 was fresh/available, and the
public Card advertised the natural-language `a2a.embodied.move@2` contract. Actual A2A/management
listener PID is `2416023`. No MCP invocation or remote Task was created; side effects remain `NO`.
No navigation, Tool call, database reset or `main` merge is claimed by this repair.

## SACS v0.3 live current-authority recheck (2026-08-25)

The task-owned UGV stack was rebuilt and the old process PID `1333129` was replaced by the current
A2A/management process PID `2856666`. Its safe environment projection confirms Runtime PostgreSQL
`postgresql://sdar_uap@127.0.0.1:55462/sdar_uap`, A2A port 10999, management port 10998 and physical
side effects `NO`; formal bootstrap used that Runtime database and the paired Control PostgreSQL on
port 55463. Bootstrap and readiness pass with `a2a.embodied.move@2` published/current/available, and
the public Card now exposes `io.sdar/naturalLanguageCapabilityAdmission` with the exact v2 request
schema and anonymous trusted-intranet requester policy.

Currentness is no longer a one-shot manual refresh. The Profile Source uses `poll` with a 300-second
TTL and the long-lived Node Control worker polls every 60 seconds. Live evidence observed Source
`last_sync_at` advance from `02:04:57Z` to `02:05:57Z` with `active_snapshot_valid_until` extended to
`02:10:57Z`; seven attempts were one `applied` plus six `not_modified`, and Runtime readiness versions
4/5/6 remained `available`. A metadata-free text-only A2A 1.0 message created Task
`4d1c02a6-fc43-4066-b7eb-e86be6f62533` in `awaiting_plan_confirmation`. Task MCP, total MCP,
confirmation and remote-binding counts were all zero, and Supervisor remained `NO`. No plan
confirmation, simulator validation, Provider tool call or Device action was performed.

## SACS v0.3 natural-language admission compatibility (2026-08-24)

ADR-140 is implemented for the SACS v0.3 client while preserving the A2A `1.0` wire and normative
1.0.1 baseline. A metadata-free `text/plain` UGV request now enters an Application-owned,
deterministic resolver, produces the existing `a2a.embodied.move@2` candidate input and is accepted
only after the current PostgreSQL Exposure/readiness/Provider authority is re-resolved. The public
UGV Agent Card exposes a safe optional admission contract, including Exposure/capability versions
and request schema, so SACS does not need private SDAR metadata or management API access.

The trusted-intranet deployment remains consistent with empty Card security requirements: initial
A2A admission can be anonymous, while plan confirmation, governed-control identity and the physical
side-effect gate remain independent execution boundaries. The focused matrix passes 8 files/204
tests and the real local Runtime integration with isolated PostgreSQL/Redis passes 1/1. That
integration proves one durable Task/Binding/Attempt, same-message replay, zero navigate before
confirmation, one navigate after confirmation and restart recovery using a frozen local Provider.
Typecheck, production build, 852-source architecture, changed-scope lint/format and diff checks pass.
Full lint/format retain only the disclosed out-of-scope Home-Lab/two-file baselines. No test contacted
the external UGV/simulator or opened a live YES window, and this does not upgrade the external P3 Goal.

## UGV Agent Profile external-simulation Goal (2026-08-21)

The current `ugv-agent-profile` Goal is `IN_PROGRESS`; this status does not replace or upgrade the
historical blocked UGV handoff below. P0, SMPP P1 qualification and SDAR P2-B01/P2-B02/P2-B03 local
milestones are complete. P3-B01 clean-stack runtime and changed-scope static gates are accepted with
disclosed out-of-scope lint/format baselines and fifteen frozen artifact hashes. P3-B02/P3-B03
external movement/recovery and P4 final Goal acceptance remain pending.
The current SMPP execution pin is merged
`main@b6f0f645f1ce01d717420abe342aa16e3a22ee6e`;
`90466127aee7c01014eef29a1e346b071de3704e` remains the immutable P1 qualification evidence
checkpoint, `b5f3ba2076468695c781bea1e5e6d3045e60f70e` remains the historical P3-B01 intake, and
`ce57d3d7ac2f99c0c95fa61bd9746abe862ed507` remains the P0 contract source.

The latest authorized real attempt reached A2A admission, immutable planning and confirmation, then
dispatched exactly one `vehicle_navigate` through Frozen MCP Tasks. The Provider Task completed and
the Adapter execution succeeded; the simulator ended near `106.81344283,29.72040457` for target
`106.81344630,29.72034353` (approximately 6.8 metres horizontal error). SDAR did not complete the
A2A Task because its Adapter rejected the Provider's legal CreateTask state `working` with substate
`accepted`, producing `FROZEN_CREATE_TASK_RESULT_INVALID`. The failure is sealed as
`terminal_provider_safe`: no redispatch is permitted and no SDAR continuation or terminal outcome is
invented.

The compatibility defect is implemented and locally verified: Domain/Adapter contracts now accept
the bounded `accepted` substate, migration `0173_remote_task_accepted_substate` updates and can roll
back the PostgreSQL constraint, and the terminal-safe reconciliation contract is strict. The final
affected matrix passes 5 files/165 tests; typecheck, build, 849-source architecture verification,
scoped lint and diff checks pass. The user cancelled post-fix simulator validation because the
simulator was being used by another client. The task-owned containers and volumes are absent and the
host supervisor is stopped. Therefore code handoff is ready, but P3-B02/P3-B03 and overall Goal
acceptance remain pending; no successful SDAR A2A terminal result is claimed.

An earlier recovery-issued P3-B02 attempt was executed exactly once on 2026-08-24 after fresh A3/A4 and
strict A5 gates. The task-owned stack had seven healthy SMPP services, three healthy SDAR services,
three host processes in `NO`, migration `0172` applied, an empty initial-admission ledger, clean
28-collection execution ledgers, and measured authority runways above the exact
240s/1200s/1200s/30s budgets. A live-only private-authority hashing defect was fixed without relaxing
the public evidence redaction boundary; Source driver/runner regressions pass 40/40.

The one YES window failed closed at `prepare-unique-admission`. The taskless
`vehicle_get_state`/Device `get_status` succeeded and was durably recorded, but the external state
reported `chassis.mission.state=0`, outside the frozen qualification set `[-1,3,4,5]`. No formal A2A
admission, Task, Goal, Plan, model invocation, confirmation, navigate, Provider Task, remote binding,
continuation, Adapter execution, mutation journal or command ACK was created. The finalizer restored
the Server from Supervisor revision 2/YES to revision 3/NO while both control-process identities
remained stable. The public immutable failure artifact is
`reports/ugv-agent-profile-simulation/attempts/uap-p3-b02-failure-uap-p3-b02-mt6kdjmv-38f9f84f9cebfb999bab-20260824025148997-4ab396c5b97b2dca.redacted.json`
(SHA-256 `dd3cb5b542c5d6ef8955cdc09eb0bb2a1b34fbfcf5aadaa32231fb46549e3025`).
Canonical P3-B02 PASS remains absent. Current verdict is `BLOCKED_EXTERNAL_QUALIFICATION`; the used
simulation identity is sealed and will not be retried. This is safety/failure evidence, not movement
or Goal completion.

P3-B01 ran the current SMPP checkout without modifying it. A task-owned clean operation followed by
preflight and ordered `up.sh` started seven SMPP services, three SDAR infrastructure services and
three host processes using isolated projects, databases, networks and volumes. Only the SMPP Adapter
owns Device MCP/MQTT southbound access; SDAR uses the governed Runtime MCP northbound path. The
official authority bootstrap passes twice without duplicate Source, Binding, Skill, Capability,
implementation or Exposure records. Repeated readiness passes prove exact Skill suspend/restore and
Profile public-Card removal/restoration; the separate managed Card remains Exposure authority.

The host Server loaded generation and embedding configuration from the local repository-root `.env`.
Redacted baseline/final audits prove two exact model Providers, 42 routes and zero model invocations;
`.env` content was not sent to Compose or recorded as evidence. B01 side effects stayed `NO` with
navigation, mutation, forbidden/weapon and model counts all zero. The SMPP qualifier made one
correlated read-only Device Tool call and no execution, mutation-journal or command-ack entry.

Readiness TTL recovery is now bounded and fail-closed. The 60-second expiry path evaluates on a
non-overlapping five-second timer, rebuilds the managed Card through serialized P08 authority, and
bootstrap can reconcile only an exact hash-valid/coherently partitioned expired or unavailable
snapshot. One exact stability-window result may be retried after 10,250 ms; a second fails. A live
bounded observation saw readiness v2→v3 and active managed Card revision 2→3 at 15:34Z. Retained
`UAP_CAPABILITY_READINESS_INVALID` attempts document the earlier recovery deadlock and are not
rewritten. Provider-generation rollover after the configured 300-second authority TTL remains open:
immutable `embodied.move@1` freezes Binding revision N and cannot absorb revision N+1, so recovery
requires a clean task-owned database or a reviewed new Capability version.

`reports/ugv-agent-profile-simulation/uap-p3-b01-verification.json` is
`PASS_WITH_DISCLOSED_BASELINE_GAPS`. The focused matrix passes 10 files/163 tests in 58.05 seconds;
independent partitioned replay passes 9 files/160 tests. Both typechecks/builds, 842-source SDAR
architecture, B01 changed-file ESLint/Prettier, SMPP full lint and both diff checks pass. SDAR full lint
retains 22 errors in seven committed out-of-scope Home-Lab files; SDAR full format retains two existing
files and SMPP full format retains one historical P1-B02 report. Fifteen primary artifact hashes are
frozen. P3-B01 is complete with those baseline disclosures. No movement, P3-B02, P3-B03, P4 or overall
Goal completion is claimed.

P2-B03 passes its formal local Runtime E2E with real isolated PostgreSQL/Redis,
`startServerRuntime`, the official A2A HTTP+JSON path and a strict loopback frozen Provider fixture.
Exact `embodied.move_to@1` admission flows through Skill Usage and the formal nine-node Planner path;
an authenticated outer confirmation precedes one `TASK_REQUIRED` navigate, `waiting_external` is
materialized, restart reconstructs the saved frontier without replay, and the final read/hard position
gate yields an exact completed A2A artifact. The E2E passed 1/1 in 16.93 seconds. The exact final
focused matrix passes 21 files/210 tests; approved-host Unit passes 244 files/1913 tests plus the
22-test performance phase; approved-host Contract passes 51 files/318 tests; isolated Integration
passes 38 files/219 tests plus its 1/1 evidence export. Typecheck, build, 835-source architecture,
frozen UGV package 3/3, SMPP provenance/clean checks, scoped lint/format and diff checks pass.

P2-B03 is accepted with disclosed repository baseline gaps. Full generic E2E passes 69, fails three
old Task Service endpoint cases and skips one of 73; the exact isolated failures reproduce identically
at a pure `git archive` of pre-P2 HEAD `4c0b1f7`, proving they are not P2 regressions. `pnpm lint`
retains 22 errors in seven unchanged Home-Lab files and `pnpm format:check` retains two unchanged
files, while every changed TypeScript/Prettier-scoped file passes. Sandbox Unit/Contract attempts fail
only on denied loopback listen or child-process operations and are corroborated by identical
approved-host passes. Earlier default-contract, PostgreSQL `template1`, isolated fixture and Runtime
E2E failures remain immutable evidence rather than being rewritten by the final passes.
`implementationCommit` remains null until the parent handoff creates the checkpoint; no commit
identity is invented.

Current P2-B03 evidence is local only: `evidenceClass=external_simulation`,
`observationClass=local_runtime_and_postgresql`, `productionEligible=false`,
`physicalVehicleQualified=false` and `externalExecution=false`. The loopback fixture observes one
taskless read, three task-scoped Tool calls and one local navigation; external SMPP Tool calls,
navigation dispatches and MQTT publishes remain zero. Local artifact SHA-256 values and the P2 task
acceptance state are frozen in `reports/ugv-agent-profile-simulation/uap-p2-b03-verification.json`.
P2 smoke verified LLM configuration loading and database bootstrap through the local `.env`
mechanism without recording secrets or values and with zero model calls. P3-B01 reloaded and audited
that path in the clean stack, again with zero model calls; external inference remains for a later P3
movement task. UGV target authorization, side-effect admission, continuation proof and terminal success
remain deterministic and model-independent.

SDAR × UGV SMPP integration is `SDAR_UGV_INTEGRATION_BLOCKED` (updated 2026-08-14). Discovery readiness is
`true`; Read, A2A, Control, Workflow, Resilience and Production readiness are all `false`. Real
projection 200/304 and native lineage, credential-free Source revision 1, exact Provider/Server,
new Source generation `ugv-smpp-r2`, Provider Binding `mcp-binding-ugv-smpp-r2` revision 1,
Runtime tool revision 1 and Catalog `2.0.0-rc.1:1` with 11 operations are proven at their
observation times. The disposable integration database now has five read authorities and one
explicitly activated coordinate-point navigate authority at version 6. The
reusable Skill/Capability bounds WGS84 input and requires `stopOnObstacle=true`; the accepted
TaskCapability, Availability snapshot, Plan and confirmation freeze the requested point exactly.
The other four controls remain Draft/non-selectable.
Fire has zero Capability/Skill and zero invocation authority.

The branch was synchronized with `origin/main@34ce7a7` in merge commit `80e9f93`. Exact five-node
planning, remote-terminal aggregation and generic frozen movement-constraint interpretation pass
focused tests and full TypeScript checking. A non-production compatibility switch now omits only
the live MCP execution-mode transport header while preserving `live` invocation evidence. The
latest coordinate-point authority uses a single dispatch. After the SMPP rebuild, the latest A2A
Task reached an exact confirmed Plan and consumed one one-shot physical confirmation. Exactly one
real `vehicle_navigate` invocation crossed the Provider boundary, but Provider admission returned
`MCP_TOOL_BUSINESS_REJECTION / UGV_EXECUTION_MODE_UNSUPPORTED`, `retryable=false`, before a remote
Task existed. Physical movement remains unproven and fire invocations remain zero.

Runtime's create-on-empty model bootstrap is implemented and verified. Existing Provider state makes
startup a strict no-op, while a clean database can atomically create the explicitly configured
structured and optional embedding Providers and operation routes. The real database contains two
Providers, 21 `structured_generation` routes, 21 `embedding` routes and 21 enabled current default
Prompts. Real conformance passed nine structured stages, Workflow application-schema
rejection/correction, and finite 1024-dimensional `goal`/`skill_selection` embeddings.

Real A2A read-only was executed and failed; it is no longer classified as unexecuted. Latest
`run016` created Task `7dcb57de-a1f1-4df1-b19e-7227e3a253d0`, Goal
`goal-113fdcb2-8577-4107-8562-172ba4e38c5b`, User Goal Plan
`user-goal-plan-b72790fb-63d4-46de-831c-25073124e797`, selected exact Skill
`ugv.get-state@4` through Capability `vehicle.ugv.read-state@2`/Exposure v2, and made live MCP
invocation `mcp-invocation-fb54fcdb-dabf-42ee-85d6-eebcb7aa8717`. The external adapter returned
`MCP_TOOL_BUSINESS_REJECTION / UGV_EXECUTION_MODE_UNSUPPORTED`. Goal Evaluation no longer reproduced
the earlier shape crash, but the bounded replan budget exhausted and the Goal ended unachievable;
the Task failed with `GOAL_UNACHIEVABLE`. No successful `result_processing` exists. Runtime restart
reconciliation closed the initially `prepared` CapabilityAttempt to `failed` with durable
timestamps. The terminal outcome is Task-linked but has a null direct `capability_attempt_id`, and
the last A2A projection remained `TASK_STATE_WORKING`, so complete direct/terminal lineage is not
proven. `a2a-readonly.json` is the primary real
run016 failure report; detailed lineage is under `failed-attempts/a2a-readonly-run016.redacted.json`.
Successful physical writes and fire calls remain zero. The later coordinate retry contributes one
failed, admission-rejected control invocation.

The earlier movement attempt was Task `55496234-f5e7-4589-9a18-b24afd2439d6`. Task Understanding,
Goal Contract generation and Goal Planning completed, and the Goal was patched to the exact
five-dispatch contract. The model then returned `MODEL_TRANSPORT_UPSTREAM_ERROR` for
`interactive_plan_patch`, so no Plan confirmation, governed-control confirmation or MCP call was
created. Exact redacted evidence is preserved in
`failed-attempts/a2a-move10-live-header-omit-20260814.redacted.json`.

An earlier coordinate attempt was Task `2eb25439-8d9d-448a-9e04-5a4ed761170d`. It accepted an exact
patched Goal and one exact navigate Skill Goal for longitude `106.81413978`, latitude
`29.72042600`, altitude `500`, but failed before Workflow Plan persistence because Provider
readiness was disabled. Twelve exact read-only availability checks through the post-integration
retry at `11:25:57Z` all
returned `UGV_CHASSIS_TRACK_BUSY`; Runtime PostgreSQL had no UGV remote binding. No governed
confirmation, MCP Tool call or physical write occurred. The Runtime now propagates nested Provider
readiness reason codes into `SKILL_SELECTION_NO_CANDIDATES`; evidence is in
`failed-attempts/a2a-coordinate-navigation-20260814.redacted.json`.

The post-rebuild coordinate retry is Task `e31eae69-f5d3-4937-923c-4c0f9f2c62c7`. It used Source
`ugv-smpp-r2`, Binding `mcp-binding-ugv-smpp-r2` revision 1, `ugv.navigate@6`, Capability
`vehicle.ugv.navigate@6` and Exposure v3. The exact one-node Plan and structured point input were
confirmed; one server-derived one-shot confirmation was consumed by the sole real MCP invocation.
The Provider rejected live admission as `UGV_EXECUTION_MODE_UNSUPPORTED`, so no remote Task or
movement was created and no replay was attempted. A preceding zero-invocation attempt exposed and
led to fixing a readiness-envelope/raw-argument hash mismatch in governed authority lookup. The
same run also led to rejecting punctuation-only Goal Contract text. Focused tests cover both
defects; evidence is in
`failed-attempts/a2a-coordinate-navigation-r2-20260814.redacted.json`.

The next Goal continuation Availability read at `11:40:25Z` observed
`unknown / UGV_STATE_STALE` rather than chassis busy. The external Runtime process is healthy, but
its Business Event inbox backlog remains 113; without fresh vehicle state, navigation admission
continues to fail closed. The following read at `11:48:01Z` returned
`disabled / UGV_CHASSIS_TRACK_BUSY` again. After the authorized Runtime restart with only
`physical_control.confirm` / `physical_control.revoke`, the fifteenth and sixteenth exact reads
through `12:01:54Z` again returned `UGV_CHASSIS_TRACK_BUSY`; the external readiness is still
unavailable.

Source restart/outage/LKG-expiry/bad-checksum cases, successful reads, aggregate bootstrap and all
control/lifecycle/emergency/recovery cases remain unqualified. Execution semantics remain
`admin_override`, an unconditional Runtime fire hard deny is not proven, and the non-production
`unsafe_test_open` profile relaxes plaintext/authority-membership checks without disabling HTTPS
certificate validation.

The current repository gate remains failed: static/unit/contract/build passed 275 files/2,005
tests, Cognitive Replay passed and all 56 Runtime plus 11 Control migrations passed. Integration
did not start because the operator-managed PostgreSQL rejected test-database creation: `template1`
has invalid collation-version metadata (`XX000`). The operator database was not modified, and this
run did not reach Integration, E2E, Phase 13 or the official A2A TCK. An earlier isolated full run
passed Integration and Main E2E, then failed Phase 13 baseline drift at `15.828% > 15%`; Runtime
regression (`7.128%`) and append P95 (`4.219 ms`) passed. Neither run is rewritten as a pass.

SDAR x SMPP Home-Lab Integration is `BLOCKED_DRAFT_PUBLISHED` (2026-08-12) on
`codex/sdar-smpp-home-lab-integration`. Draft PR #19 contains pushed implementation candidate
`258c8113bd0523064525dd1f3b15c204e12cfba3`. Goal Run
`019fca75-f48a-7780-ac5e-942503c6690e` passed G00-G08: exact baseline/isolation, real Home
Assistant read-only preflight (10/10), live SMPP Climate/Light deployments, byte-identical frozen
Registry projection, real Source 200/304/LKG/outage/restart behavior, exact revision-17 Provider
Bindings and live MCP Catalogs, five governed exact-version Skills/Capabilities, and deterministic
Climate/Light read-only execution plus same-run replay. G08 now passes one real A2A Task and Goal,
all seven required structured-model stages, an exact two-read Workflow, a combined structured
Outcome, and same-run Runtime restart recovery; the model boundary is explicitly a simulated local
structured fixture while Runtime, PostgreSQL, A2A, MCP, SMPP and Home Assistant reads are live.
G09 and G10 now pass the bounded real SMPP Runtime/Adapter/Home Assistant provider path and restore
the original light and climate state, but remain partial because the SDAR Goal/Plan/confirmation
path was not executed. G11 failed because the Climate Task confirmed `cool` but Home Assistant
returned to `off` within about three seconds; both lights and the climate were restored. G12 lacks
Required real in-flight restart/fault evidence. The authoritative SDAR
repository-wide `pnpm verify` passed its first four stages and failed its final E2E stage solely at
the Phase 13 Runtime P95 regression gate (`39.981096754646735% > 10%`); failed attempts 6 and 7 are
preserved and the later focused pass is not full-run acceptance evidence. Final active/uncertain
Task counts are SDAR `0/0` and SMPP `0/0`; device restore is `RESTORED` and all write gates are closed.
`crossRepositoryIntegrationReady=false`. No merge, tag, release or public deployment has started.
The living plan is `execplans/EP-SDAR-SMPP-HOME-LAB-INTEGRATION.md`; shared run state is under the
sibling `.codex-sdar-smpp/` directory.

SDAR v1.4.1 Canonical Evidence Export is `COMPLETED_PR_READY` (2026-08-10) on
`feature/v1.4.1-canonical-evidence-export`, based on `origin/main` `cc0719f`. Phases 0-13
have completed their scoped implementation and independent Review; the single Phase 14
release-level `pnpm verify` passed all ten stages in 1,213,445 ms. Required Source Coverage is
95/95, total Catalog coverage is 100/100, Phase 12 is 44/44 and Phase 13 is 25/25. Implementation
commit `eb72012` is pushed and PR #18 is `OPEN`, `CLEAN` and Ready for
Review against `main`; final acceptance is published under `reports/v1.4.1-evidence/`. The
user-supplied task package is SHA-256
verified and retained under `docs/`; immutable
published migrations 0142/0143 force Strategy B (append-only clean cutover); and every one of the
100 catalog record types has an explicit non-guessed authority classification. Phase 1 found 93
confirmed sources and seven explicit evidence-infrastructure blockers; Phase 3 has now closed all
seven source-authority gaps. Phase 2 freezes
deterministic canonical JSON, stable source/schema IDs, payload hashes, a fail-closed 100-entry
Domain Catalog, 100 non-placeholder Draft 2020-12 record schemas, and seven protocol schemas under
registry hash `sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d`.
Fifteen focused Unit and three Contract tests pass, including compilation/validation of all schemas
and adversarial secret/private-reasoning/depth/size/conflict checks. Migration 0144 performs the
Strategy B clean cutover: all three old Telemetry product tables are removed and eight canonical
Evidence authorities enforce source identity, hash conflict, sequence, partition cursor,
High Watermark, lease/fencing, ACK, DLQ, issue, and manifest invariants. The seven missing sources
are now closed, for 100/100 source-confirmed, while formal projector coverage remains 0/100.
Eleven focused PostgreSQL tests and the 37-migration gate pass. Phase 4 removes the complete legacy
Telemetry API/service/transport surface and adds bounded fenced `sdar.evidence/v1` delivery with
exact sent ownership, explicit contiguous/partial ACK, required-family enforcement,
CredentialRef-only endpoint security and nonblocking receiver outage behavior. Focused evidence is
21 Unit, 71 Contract, 11 real PostgreSQL and one real Control-to-HTTP vertical test. Full
`pnpm verify` passed in 601,088 ms: 1,207 static Unit/Contract tests, 158 Integration, 72 E2E,
build and all smokes. Phase 5 projects all 18 Runtime types from repeatable-read authoritative
snapshots, including version/patch lineage, action basis, layered receipts, stable Skill Execution
references, terminal consistency, blocking source-gap issues, checkpoints and a draft manifest.
Format/lint/typecheck, 658-source architecture, the 100-record contract, 3 Unit and 1 real
PostgreSQL Integration tests pass. Phase 6 adds all 16 Skill records from repeatable-read
authoritative snapshots, sharing exact Skill Execution identity with Runtime Action and preserving
exact Skill Version usage, selection/context, parent/child composition, Capability ID/version,
procedure/compliance, seven reference kinds, wait/resume and failure boundaries. Its 10 focused
Unit and 2 real PostgreSQL Integration tests pass with zero Quality Issues and idempotent replay.
Phase 7 adds all 11 MCP Task and seven Capability records, preserving Task Handle, Observation,
Control Event, continuation, no-side-effect-replay, cancel uncertainty and Provider Receipt versus
Goal Verification boundaries. Complete Capability Binding snapshots and hashes are retained.
Control-owned definitions/bindings use an authenticated full-state read and require the exact
governance Evidence ref before Runtime projection. Twelve focused Unit and three real PostgreSQL
Integration tests pass with idempotent replay; architecture covers 667 sources and the Catalog
remains 100/100. The mandatory Phase 7 full `pnpm verify` passes in 865,814 ms with 970 Unit, 22
performance, 230 Contract, 161 Integration and 72 E2E tests, 37 migrations, build and all smokes.
Phase 8's first independent read-only review rejected the initial implementation with two Blocking
and eight Major findings; a later review added three Major and one Minor. The source-owned repair
now includes poison-item isolation with durable Projection Issues, exact schemas for all 22 Phase 8
records, structured `CognitiveSourceRef`, latest-per-source reads and lossless 10,000-element
Pattern ArtifactRef descriptors. All 100 records declare `durable_projection`. Evidence Contract
100/100 (95 Required plus five diagnostic), focused Contract 9/9, real PostgreSQL Runtime Core 5/5
and the 10,000-element producer/resolver 1/1 pass under registry hash
`sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d` and contract hash
`sha256:a1ffebfde0902dab632c16a8ffdad781926198a9bf69ed3722b52da1206dfd86`.
Final independent Review is `CLEAN_FOR_PHASE8_CLOSURE` with zero Blocking, Major or Minor findings;
generated coverage is 74/100 verified and 74/95 Required (77.89%). The two best-effort full verify
attempts did not complete: the first exposed and repaired an Architecture allowlist omission before
timing out on the wrong Redis port `56385`; the second used `56379`, passed the other 32 Integration
files / 165 tests and exposed one Node Control startup/migration isolation defect whose exact file
then passed 1/1 after repair. Latest targeted format/lint/typecheck pass; no whole-repository format
or successful full-verify claim is made. Task-package section 30 mandates full `pnpm verify` only at
Phases 0/3/7/9/12/13/14, so Phase 8 is `COMPLETED`.

Phase 9 adds Control migration `0009_canonical_evidence_authority` and Runtime migration
`0146_v14_evidence_export_observation_ledger`, preserving Control PostgreSQL as Node Control
authority and Runtime PostgreSQL as Evidence/export authority. Two independently checkpointed
sources project all 21 `node_control.*` records through a fixed privileged
`node_control.evidence.read` service identity. Exact Last-Event-ID recovery, revision/conflict
handling, Configuration -> Apply ACK -> LKG references, delivery -> receiver ACK references,
recursive CredentialRef redaction, scope/classification checks and the generation-1/no-generation-2
self-observation boundary are verified. The Server uses a bounded 32-partition single-flight drain;
Redis remains wake-only. The Registry is 100 records (95 Required and five diagnostic), the source
matrix is 95 `implemented_and_verified` plus five `source_confirmed`, Node Control is 21/21
verified, and the five remaining `evidence.*` records are reserved for Phase 10. The real
PostgreSQL/Redis/HTTP vertical passes 1/1 and independent Review is Accepted with zero Blocking,
Major or Minor findings under Registry hash
`sha256:62fd3e06d4b2b5cebf00814a9cee1d8331ac6acd3e2b59bafbce9c2e7099cf88`.

Phase 9 does not claim a successful full `pnpm verify`. Attempt one stopped at lint and the listed
mechanical findings were repaired. Attempt two passed format, lint, typecheck and 1,058 Unit/
performance assertions, then stopped on one stale positive Contract fixture; the repaired direct
Evidence Schema Contract passes 10/10. Following the user's instruction not to repeat intermediate
whole-repository verification, the next complete full gate is deferred to Phase 14. Phase 9 is
`COMPLETED` for implementation, Review and handoff with that release-level gate explicitly pending.

Phase 10 adds Runtime migration `0147_v14_evidence_coverage_authority`, authority-derived
expectations, revisioned draft/projecting/sealed Episode Manifests, ten quality rules, schema-gated
canonical appends and all five `evidence.*` projectors. Required facts count complete only after
receiver ACK. Skill selection/input/execution, MCP Availability and task-scoped Artifact
retrieval/usage/feedback now contribute exact applicability and issue scope; poison partitions are
durable, isolated and retried without false-complete or unrelated false-incomplete Manifests. The
proof-manifest-derived gate reaches 100/100 implemented and verified records, 95/95 Required and
5/5 diagnostic under Registry hash
`sha256:a7ac427efdc75530aee8cb27359243084cb29a0450d62e7b19bd21feb99771e5`.
Focused Unit 3/3, Contract 1/1, PostgreSQL 1/1 and typecheck pass; independent Review is Accepted
with 0 Blocking / 0 Major / 0 Minor. Per explicit user direction, full `pnpm verify` is not repeated
here and remains the single Phase 14 final gate. Phase 10 is `COMPLETED`.

Phase 11 adds Runtime migration `0148_v14_evidence_operations_recovery`, durable request/claim/
action recovery, restart resume, record/source-partition/episode replay, DLQ retry, real coverage
reconciliation and bounded continuing Diagnostic retention. Node Control exposes metadata-only
reads and audited recovery commands through typed Runtime internal APIs; Organization Service is
denied, recovery is limited to Node Admin/Security Admin, and no arbitrary SQL, payload or
ClickHouse proxy is exposed. The real PostgreSQL/Redis/HTTP vertical passes 1/1 with record replay,
canonical ManagementOperation Evidence, re-ACK and receiver-outage isolation. It also exposed and
closed duplicate canonical-null Schema branches and an impossible export-partition checkpoint
reference; preserved Export Status batches project 2/2 using exact Telemetry Delivery lineage.
Current Registry hash is
`sha256:2bc75460820a778830bc1c787afa74a4f71571b9658b8dd496b495e528c85567`; independent Review is
Accepted with 0 Blocking / 0 Major / 0 Minor. Phase 11 is `COMPLETED`.

Phase 12 passes all 44 required Runtime/Skill, MCP Task, Capability/Experience, Node Control and
Export/Manifest scenarios with 42 direct tests across 25 resumable suites. Every scenario has
explicit passed-test provenance for all ten required dimensions; real delivery uses the local
Control/Runtime PostgreSQL databases, Redis `56384` and an HTTP Evidence receiver. The first
read-only Review found and closed one Major over-attribution in the report; the final Review is
0 Blocking / 0 Major / 0 Minor. First failures and repairs remain under
`reports/v1.4.1-evidence/failed-attempts/`. By explicit user direction, no intermediate full gate
was repeated; one final repository-wide `pnpm verify` remains Phase 14. Phase 12 is `COMPLETED` and
Phase 13 closes the frozen 25-item adversarial list with direct owning-layer evidence. PostgreSQL
now rejects resolved Evidence references whose explicit tenant or user scope conflicts; the
single-process scheduler grants foreground Tasks priority while guaranteeing projection and export
one durable slice at least every ten seconds under sustained load. The stable balanced ABA/BAA/AAB
benchmark passes with baseline P95 805.957 ms, Evidence-enabled P95 880.984 ms (9.309%), append
P95 15.576 ms and first/second-half median drift 14.823%. Final independent Review is 0 Blocking /
0 Major / 0 Minor after one Blocking, two Major and one Minor repair. The final repository-wide
`pnpm verify` passed all ten stages in 1,213,445 ms. Phase 13 is `COMPLETED`; Phase 14 publication
is pending local commit/push and marking PR #18 Ready for Review.
No ClickHouse implementation, merge, tag, release, or deployment has started.

SDAR v1.4 Node Control Backend P13 is `COMPLETED` locally (2026-08-03) on
`feature/v1.4-node-control-backend`, based on latest observed `origin/main`
`a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`; P00 through P12 remain completed. P13 adds exact
Administrator/Operator/Viewer/Security/Organization role profiles, tenant-bound service identity,
ingress rate/size limits, endpoint allowlist/TLS/SSRF enforcement, real credential rotation,
PostgreSQL dump/restore, restart and Control-outage recovery plus explicit production-limit
runbooks. Exact clean `pnpm verify` passed on `ec10587` in 665,151 ms with 960 Unit/performance, 220
Contract, 149 real PostgreSQL/Redis Integration and 72 E2E tests, 36 Runtime and 8 Control
migrations, build and all smokes. Review is 0 Blocking / 0 Major / 0 Minor after two Major repairs.
P14 local release qualification is complete. Latest `origin/main` remains `a7a7c62`, already an
ancestor of the branch (`0 behind / 66 ahead`), so there is no main conflict or missing merge commit
to resolve. Exact clean candidate `e6d0b69` passes the complete `pnpm verify` in 581,785 ms with
`dirty=false`, security/recovery gates and A2A HTTP/JSON MUST TCK; final Review is 0 Blocking / 0
Major / 0 Minor. Evidence `d5368bd` and release head `4dade43` were pushed; non-draft PR #15 merged
without bypass as Merge Commit `0cbb42d` with parents `a7a7c62`/`4dade43`. Candidate `e6d0b69`,
evidence and release head are verified `origin/main` ancestors, the remote feature branch is deleted,
and P14 is terminal `COMPLETED`. No tag, GitHub Release or deployment was started.

PR #13 merge remediation is locally implemented and verified (2026-08-01) on
`feature/v1.3-sequential-implementation`. `git merge-tree` found no textual
conflict with current `origin/main`; the actual blockers were three unresolved
review threads, followed by three additional threads posted after the first
repair push. The six fixes make Model Route evidence request-scoped, enforce
SQL-side tenant isolation for Artifact read-audit projections, preserve
Template failure-evidence errors, resume Task scheduling after committed fast
handoffs, fence P08 authority commits by the Gateway stage deadline and use a
Cascade-aware Model Usage cursor. Regression evidence passes 27 focused Unit,
7 focused real PostgreSQL Integration, 908 full Unit, 130 full Integration,
214 full Contract and 72 E2E tests, plus format, lint, typecheck, architecture,
production build and isolated Server smoke gates. The second repair commit,
push, all six thread resolutions and the live merge-state recheck are complete.
GitHub reports PR #13 Ready, OPEN, `MERGEABLE/CLEAN`, with no status checks and
no unresolved review threads. The PR remains unmerged; no automatic merge,
tag, release or deployment was performed.

SDAR v1.3 P14/X01 Optional Post-release Operations is terminal
`POST_RELEASE_OPERATIONS_BLOCKED` (2026-08-01) on
`feature/v1.3-sequential-implementation`. The non-formal extension preserves
`formalPackageCount=14`, creates no G23 and performs no production action. Its
sixteen required operations reports, machine-readable Handoff and independent
read-only review are complete; the review verdict is 0 Blocking / 0 Major /
0 Minor for the truthful plan-only delivery. Eighteen acceptance items pass and
sixteen remain blocked by seven external prerequisites: P13 terminal release
evidence, release authorization/tag, deployment manifest, monitoring access,
named owners, approved SLO/alerts and post-release observation/drill data.
Existing Draft PR #13 remains the only main-targeted publication path; no
merge, tag, release or deployment is authorized by P14.

SDAR v1.3 P13/G22 Hardening, Release and Final Consistency Audit is
`IN_PROGRESS` (2026-07-30) on `feature/v1.3-sequential-implementation`.
The exact v1.2.3 logical migration, real PostgreSQL/Redis recovery drills,
stable hardened PostgreSQL image, final container scans, dependency override,
default-off operational controls and deployment-owned Bearer identity are
implemented. Independent Architecture/Authority review is closed at
0 Blocking / 0 Major / 0 Minor after promotion and validation-type alias
repairs. Current focused/full evidence includes 905 Unit, 214 Contract,
129 Integration and 72 E2E tests, with typecheck, lint, architecture, build,
OpenAPI and secret scan passing. Exact-candidate reproducibility,
Security/Privacy and Operations/Release re-review, 75-item acceptance,
completion and Handoff remain pending. Per user instruction, no push occurs
until the optional P14 extension is closed. P14 is now terminal BLOCKED and
does not promote or otherwise change this P13 status.

SDAR v1.3 P11/G19-G20 Case Template and Model Route Runtime is `COMPLETED`
(2026-07-30) on `feature/v1.3-sequential-implementation`. Commits `b116a6c`,
`c62334a` and `dc636e6` add the ten frozen V1.1 contracts, type-keyed Gateway
adapters, safe Case-to-P08 candidate handoff, Provider Registry/readiness-owned
Profiles, bounded serial Cascade, migration 0133 evidence/Outbox and bounded
Management API/OpenAPI/Console projections. Three read-only review rounds
closed inactive timeout enforcement, PII coverage and camelCase privacy
bypasses; final verdict is 0 Blocking / 0 Major / 0 Minor. Clean exact-commit
`pnpm verify` passed in 275,223 ms with 1,097 Unit/Contract, 122 Integration,
64 E2E, 26 migrations, architecture/OpenAPI/TCK/build and both smokes. All 51
acceptance items pass and the P12 Handoff is `COMPLETED`. P12 has not started.

SDAR v1.3 P10/G17-G18 Fast Gateway and Artifact Runtime Feedback is
`COMPLETED` (2026-07-30) on `feature/v1.3-sequential-implementation`.
Implementation commits `a27e49c`, `211b88b`, `3d7c722` and `13d4b54` add the
frozen V1.1 Gateway contracts, ordered authority prechecks, P07/P09/P08/fallback
orchestration, deadline/cancellation/late-result guards, isolated bulkheads and
circuits, PostgreSQL request/decision/feedback/Outbox authority, P02 usage
projection, drift analysis and bounded Management API/Console evidence.
Independent read-only review closed at 0 Blocking / 0 Major / 1 local-SLO
Minor. Clean `pnpm verify` passed on `3361ff8` in 263,433 ms with 1,069
Unit/Contract, 119 Integration, 63 E2E, 25 migrations, architecture/OpenAPI/TCK,
build and both smokes. All 52 acceptance items pass and the P11 Handoff is
`COMPLETED`. P11 subsequently completed under its own package evidence above.

SDAR v1.3 P09/G16 Decision Rule and Policy Runtime is `COMPLETED`
(2026-07-30) on `feature/v1.3-sequential-implementation`. Implementation commit
`3244647` adds the frozen V1.1 strict Rule DSL, typed three-valued evaluator,
stable conflict resolver, policy/authorization/current-state rechecks,
confirmation-bound parameter suggestions and conservative patches through the
existing Validator/P08 planning authority. P02 core execution, feedback and
Outbox rows remain usage authority; drift only signals P06. The final
read-only review has 0 Blocking / 0 Major / 0 Minor. Clean exact-commit
`pnpm verify` passed in 272,326 ms with 1014 Unit/Contract, 114 real
Integration, 62 E2E, 24 migrations, architecture/build and both smoke stages.
Draft PR #13 is open and unmerged. `v1.3-p09-handoff.json` is `COMPLETED`;
P10 has not started.

SDAR v1.3 P08/G15 Plan Template Runtime and Formal Planner Handoff is
`COMPLETED` (2026-07-29) on `feature/v1.3-sequential-implementation`.
Implementation commit `3883786` adds frozen V1.1 P08 contract values,
materialization from a P07-selected active template, source/trust/schema
parameter guards, lossless candidate graph/recovery data, double current-state
rechecks and stable idempotency. It reuses the existing Validator, interactive
planning session, confirmation, Goal lock and UserGoalPlan authority; P02
execution/feedback stores usage correlation only. Server composition requires a
deployment-owned state reader and exposes no route, Fast Gateway or direct
Skill/MCP/Provider call. The final read-only review has 0 Blocking / 0 Major /
0 Minor. `pnpm verify` passed in 254,312 ms with 958 unit/contract, real
integration, 62 E2E, migration, architecture/protocol/build and isolated
infrastructure/server smoke stages. `v1.3-p08-handoff.json` is `COMPLETED`;
P09 has not started.

SDAR v1.3 P07/G13-G14 Active Artifact Retrieval and Applicability is
`COMPLETED` (2026-07-29) on `feature/v1.3-sequential-implementation`.
Implementation commits `a53798b`, `d2a37fd` and `26b60c2` add the frozen V1.1
retrieval/applicability contracts, P02 PostgreSQL active-index projection,
deterministic hard-gated selection, trusted parameter binding, durable audit,
version-evidence dependency checks and P06-atomic revalidation requests.
P07 keeps Redis/semantic/memory projections non-authoritative and adds no public
route, Fast Gateway, template execution, Goal/Plan/Attempt or Skill/MCP call.
The independent read-only review closed at 0 Blocking / 0 Major / 0 Minor. The
final operator-managed `pnpm verify` passes 954 unit/contract, 113 integration,
62 E2E, 24 migrations, architecture/protocol/build and both smokes in 220,114
ms; `v1.3-p07-handoff.json` is `COMPLETED`. P08 has not started.

SDAR v1.3 P06/G11-G12 Shadow, Promotion and Governance is `COMPLETED`
(2026-07-29) on `feature/v1.3-sequential-implementation`. Implementation commit
`70647a0` adds six immutable V1.1 governance contracts, migration 0130,
PostgreSQL-authoritative Shadow/Promotion/Approval/Activation/Revalidation
projections, wake-only BullMQ workers, Server composition and trusted operator
management operations. P06 derives promotion coverage from durable P05/P06
facts, preserves P02 authority, rejects unsafe/single-device/single-user/
temporary-authorization evidence, removes the active pointer on critical safety
incidents and never implements P07 retrieval or execution. An independent
read-only review closed at 0 Blocking / 0 Major / 0 Minor. The final isolated
`pnpm verify` passes 941 unit/contract, 110 integration, 62 E2E, 23 migrations,
architecture/protocol/build and both smokes; its seven-stage report is in
`reports/verification/summary.json`. `v1.3-p06-handoff.json` is `COMPLETED`.

SDAR v1.3 P05/G09-G10 Replay Dataset and Artifact Validation Engine is `COMPLETED` (2026-07-29) on
`feature/v1.3-sequential-implementation` from P04R closure `b28b183`. The strict six-contract
Domain, four-way immutable Dataset/leakage builder, snapshot-only No-Physical boundary,
Plan/Rule/Counterfactual evaluators, transparent 29-metric catalog, migration 0129 PostgreSQL
authority, wake-only BullMQ worker and Server composition are committed through accepted
implementation head `14eb978`. The real native Formal Episode (without test-only `replayValidation`) ->
P03 Trace/Pattern -> P04 Candidate -> P02 ArtifactRepository -> P05 Replay Validation chain passes
with 8 Cases, 4 Dataset purposes and 3 independent Holdout results. A real denied network operation
persists `unsafe`, a critical Failure, Counterexample and canonical `artifact.validation_completed`
while Candidate state stays unchanged. Five production Fact Reader/Episode Builder outputs remain
bound to their historical Capability Summary after all current Skills are disabled. Focused replay
tests pass 42/42; 22 migrations through 0129 pass fresh/idempotent/rollback/reapply. Deletion
retains terminal validation evidence, invalidates promotion eligibility and creates successor
Dataset versions. Four PostgreSQL workers claimed 100 bounded Runs in 43.385 ms and Redis wake lag
measured 18.272 ms. Five independent read-only Review rounds closed every earlier finding; the
accepted implementation has 0 Blocking / 0 Major / 0 Minor. The full gate passes 916 unit/contract,
109 real PostgreSQL/Redis integration, 62 E2E, architecture, migration, build and both smoke stages.
All 43 P05 acceptance items pass; the 28-field P06 Handoff is complete. Draft PR #12 remains open
and unmerged. P06 implementation has not started.

SDAR v1.3 P04R mandatory remediation is `COMPLETED` (2026-07-28) on
`feature/v1.3-sequential-implementation`. Activity Identity V1.2 now separates lifecycle facts from
traceable workflow activities; P03 preserves repetitions, self-loops, parallel/branch/recovery
semantics and real quality metrics; P04 executes bounded generalization, exact DAG/parallel/
conditional compilation, live Capability Catalog checks, distinct fingerprints and Static
Validator V1.2. The durable real path reaches P02 `ArtifactRepository.saveCandidate`, lineage,
validation, transactional Outbox and a completed PostgreSQL run while Redis remains wake-only.
Independent Reviews A/B/C each have 0 Blocking and 0 Major findings. Revised P03 and P04 Handoffs
and the P04R Handoff are `COMPLETED`; all 47 P04R criteria pass. Shared Registry V1.2 hash is
`8aa828fa...7d60dee`, package accounting is 14/1/1, and the clean exact implementation commit
`de25f4c` passes 848 unit/contract, 104 real integration, 62 E2E, 21 migrations, 468-source
architecture, production build and both smokes in 220,389 ms. P04R itself did not implement P05.

SDAR v1.3 P03/G05-G06 Experience Trace normalization and deterministic process mining is in
remediation (2026-07-27) on `feature/v1.3-sequential-implementation`. G05 `22cf9a3` and G06
`119fe43` were followed by a rejected independent review with 2 Blocking, 4 Major and 2 Minor
findings. Compatibility commit `8adecec` and remediation `1f7e043` connect the formal
Episode→durable run→BullMQ→Trace→Pattern product path, persist 10,000-trace evidence within the
existing 1 MiB authority boundary, reclaim terminal expired leases, enforce strict nested contracts,
provide tenant-scoped WorkflowPattern reads and prove real Redis reconstruction. The remediation
gate passes 828 unit/contract, 100 real integration, 62 real E2E, 459-source architecture, A2A
74/74, 152 OpenAPI operations, all 19 migrations and production build. Its final infrastructure
smoke remains environment-blocked because the protected operator `/sdar` database lacks the
documented clean-baseline ledger marker. A second independent review closed every original finding
but rejected `1f7e043` with three new Major findings: timestamp-colliding/unbounded mining triggers,
event-loop blocking and missing Task Source attribution. Working-tree remediation adds
cohort-batched event identity with advisory-lock/60-second rate control, cooperative async mining,
async Brotli, single mining concurrency and formal `task_request` lineage; 829 unit/contract tests
and architecture pass. Real integration, a dedicated migrated-database full gate and another fresh
review must close before P03 can become `COMPLETED` or P04 can be read.

SDAR v1.3 P02/G02-G04 Artifact Persistence, Registry and Governance is complete as `COMPLETED`
(2026-07-27) on `feature/v1.3-sequential-implementation`. Three independent reviews rejected earlier
commits with a combined 6 Blocking, 8 Major and 1 Minor finding; every finding is closed. A fourth
new independent read-only reviewer accepted exact implementation commit
`14abffe75ed1e7108bfe59f7ceeeafed43a0ac45` with zero findings and authorized the Handoff.
PostgreSQL is the sole Artifact/Approval/Pointer authority; versions and Lineage are immutable,
current Validation/Approval and tenant evidence are bound transactionally, Pointer tombstones
prevent CAS ABA, and relevant Outbox cursor order is serialized through commit without claiming
shared publication. Registry rebuild, full lifecycle cache invalidation, real mixed-event startup,
complete JSON bounds, repeated event aggregates and 501-row paging are covered. The exact
`dirty=false` gate passes 795 unit/contract, 92 real integration, 62 real E2E, 447-source
architecture, A2A 74/74, 152 OpenAPI operations, 18 migrations, Replay with zero physical calls,
production build and both smokes in 170,656 ms. The operator `/sdar` database remained untouched;
verification used isolated databases. P03 may consume the six frozen P02 contracts after the
evidence/cursor commits are pushed to Draft PR #12.

SDAR v1.3 P01/G01 Runtime Artifact Domain is complete as `READY_FULL` after a rejected first
independent review and accepted remediation re-review
(2026-07-26) on `feature/v1.3-sequential-implementation`. The first review found downstream
PlanTemplate incompatibility, Domain/Zod/AJV drift, a direct-activation bypass and missing nested enum
guards. Exact shared-design/P04 nested shapes, AJV recursive-bound keywords, direct activation
evidence and expanded regressions now pass 20/20 focused tests. The post-remediation complete gate
passes 785/785 unit+contract, 84/84 real integration, 62/62 real E2E, 435-source architecture, A2A
74/74, 152 OpenAPI operations, 17 migrations, Replay with zero physical Provider calls, production
build and both smoke tests. A new independent read-only re-review accepts the remediated tree with
zero blocking/major findings; its documentation-only minor item is closed. The meaningful completion
commit `8ac5f5e` passes the same full gate with `dirty=false`; final Handoff has 9/9 accepted, zero
failed/blocked and zero open blockers. P02 may now consume the 15 frozen P01 contracts.

SDAR v1.3 P00 foundation gate is complete as `READY_FULL` (2026-07-26) on
`feature/v1.3-sequential-implementation` from exact `origin/main@v1.2.3-final`
`856f909d22c33e6e20d7e0a1cffc2f54c03b4477`. All fifteen package self-checks and the aggregate
cross-package validator pass with frozen registry SHA-256 `d7b1d971...a7ff4cbb`. The repository owner
explicitly accepted the audited external v1.2.3 merge deviation and all three authoritative records
now agree without claiming native auto-merge or the absent unmerged state. A complete clean recovery
gate at `6e27d70` passes 765 unit/contract, 84 real integration, 62 real E2E,
architecture, A2A, OpenAPI, Replay, 17 migrations, production builds and both smoke stages against a
dedicated clean-slate database. Fresh independent read-only review accepts the exact `READY_FULL`
contracts with zero baseline blockers and no product/P01 scope drift. The branch is pushed through
`cbd9069`; Draft PR #12 targets `main` and remains Draft. No merge, tag, release or deployment was
performed.

SDAR v1.2.3 G00–G17 are complete (2026-07-26). Clean `pnpm verify` on `7e50541` passes 765
Unit+Contract, 84 real Integration, 62 real E2E, Replay, 17 migrations, A2A MUST 74/74, 152 OpenAPI,
425-source architecture, production builds and both smoke stages with `dirty=false`. G17 adds unified
PostgreSQL-authoritative cognitive reconstruction, deletion propagation, review-only retention and the
frozen six-stage rollout policy. Recovery/security/privacy/capacity evidence is classified in
`reports/v1.2.3-release/`. After the authorized Ready transition, GitHub recorded an external
owner-authenticated merge of PR #9 as `d68195a` and deleted the branch; no Codex Merge call or tag
occurred. No native auto-merge event is present, so the initiating mechanism remains unverified. The
branch was recreated by the already-running final evidence push. Release gates remain green, but the
required unmerged final state is not satisfied and no automatic revert is authorized.
Corrective evidence is isolated in Draft PR #11; it must remain Draft pending user direction.

SDAR v1.2.3 G00–G16 are complete (2026-07-26); G17 release hardening is next. G16 adds immutable,
evidence-linked Planning Replay datasets, disjoint development/holdout partitions, all five Shadow
verdicts, hard-failure non-regression, a zero-Provider/MCP/device side-effect guard and idempotent
Promotion provenance through migration 0124. Insufficient samples now produce an `incubating`
evaluation and leave Knowledge in `candidate`. Affected gates pass 604 unit, 157 contract, 84 real
integration, 62 real E2E, 152 OpenAPI operations, 423-source architecture, A2A MUST 74/74, production
build and all 17 additive migrations. Implementation `265f865` and evidence `8886f0f` are pushed to
Draft PR #9, which remains Draft until every G17 release gate passes.

SDAR v1.2.3 G00–G15 are complete (2026-07-26); G16 Replay/Shadow is next. G15 provides strict
cognitive management write envelopes, optional non-breaking bearer authentication, durable
PostgreSQL audit/idempotency claims, exact operational reads, real Console governance and routing-only
A2A `INPUT_REQUIRED` continuation. Existing Session/Knowledge/Capability/Experience records remain
authority and no Console route mutates Provider, Outcome or Active Plan directly. Affected gates pass
597 unit, 157 contract, 84 real integration, 62 real E2E, 152 OpenAPI operations, 419-source
architecture, A2A MUST 74/74, production build, isolated Server/Console smoke and all 16 migrations
through 0123. Implementation `d77794a` and evidence `9d66eab` are pushed to Draft PR #9; no merge,
tag or Ready transition is authorized before G17.

SDAR v1.2.3 G00–G14 are complete (2026-07-26); G15 Management/Console/A2A integration is next. G14
adds a governed decorator over the unchanged base Planner with distinct off/shadow/advisory/frozen
low-risk-active modes, bounded fail-open replanning and immutable Contract/readiness/terminal
authority. Candidate, knowledge usage, affected Skill Goals and validation save atomically; Session
actions and final Outcome extend the same lineage in their owning transactions. Affected gates pass
587 unit, 155 contract, 83 real integration, 62 real E2E, 147 OpenAPI operations, 411-source
architecture, production build, isolated Server smoke and all 15 migrations through 0122.
Implementation `1bd52dd` is pushed to Draft PR #9; no merge or tag is authorized.

SDAR v1.2.3 G00–G13 closure (2026-07-26): G13 adds
Active-only scoped Vector+FTS/RRF retrieval, bounded one-hop relations, Session dedupe and strict
Level-0 Index → Full Definition → exact current Skill disclosure under a factory-checked 20K budget.
PostgreSQL remains the sole authority; generic Memory cannot read Active Knowledge projections, and
Candidate relations remain outside retrieval until Promotion. Affected gates pass 575 unit, 155
contract, 83 real integration with P95 4.476 ms, 62 real E2E, 147 OpenAPI operations, 408-source
architecture, production build, Server smoke and all 14 migrations through 0121. Implementations
`1879ff1` and `3201325` are pushed to Draft PR #9; no merge or tag is authorized.

SDAR v1.2.3 G00–G10 closure (2026-07-26): G10 adds
seven-dimensional deterministic Task Type fingerprints/clusters before strictly validated model naming,
bounded Offline/Online Candidate revisions with 1–3 real Episode Exemplars, Negative Examples and a
current-context Applicability Guard. PostgreSQL owns revision/evidence/Outbox authority through
migration 0118; Candidate status remains excluded from the unchanged G03 formal Understanding source.
Affected gates pass 554 unit, 153 contract, 80 real integration, 62 real E2E, 142 OpenAPI operations,
378-source architecture, A2A MUST 74/74, production build and all 11 migrations. Implementation
`c36e83d` is pushed to Draft PR #9; no merge or tag is authorized.

SDAR v1.2.3 G00–G09 closure (2026-07-26):
The former G07–G09 platform blocker is closed with real PostgreSQL/Redis/A2A evidence: 549/549 unit,
152/152 contract, 79/79 integration and 62/62 E2E tests pass, along with 141 OpenAPI operations,
372-source architecture, A2A MUST 74/74, licenses/SBOM, production build and the ten-migration
0108–0117 rollback/reapply gate. Real verification found and fixed Outbox SQL type inference,
post-insert Episode idempotency, incomplete v1.2.2 terminal-authority fixtures and a missing
`experience_reflection` Management API stage; assertions were not weakened. Candidate Knowledge
remains excluded from the formal Planner. Historical PR #8 was merged externally, so the branch was
normally synchronized with `origin/main` and replacement PR #9 is Draft:
<https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/9>. No merge, tag, force-push or
direct `main` mutation was performed. See `reports/goal/g07-completion.md` through
`reports/goal/g09-completion.md`.

SDAR v1.2.3 G06 is complete and pushed (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime`. Understanding, Goal Contract and Plan corrections now
persist immutable actor/source-attributed before/instruction/patch/after/validation Facts and
deterministic Interaction Episode revisions. Terminal Outcome/counterexamples append rather than
mutate history. Only explicit accepted low-risk user preferences enter the existing scoped Memory
projection; task, tenant, global-candidate, safety and authorization evidence cannot auto-promote, and
user deletion propagates without cross-user leakage. API/OpenAPI, Console evidence links and the real
A2A flow are wired. Affected gates pass 529 unit, 150 serial contract, 75 real integration, 62 real
E2E, 136 OpenAPI operations, 344-source architecture, 0108-0114 migration rollback/reapply and
production build. Implementation `cade96f` is pushed and Draft PR #8 remains Draft; G07 durable
Experience outbox/jobs and Goal Episodes are next.

SDAR v1.2.3 G05 is complete and pushed (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime`. A confirmed G04 Goal Contract now enters a
PostgreSQL-authoritative PLAN_REVIEW session whose immutable candidates can be inspected, patched,
rejected, cancelled or explicitly confirmed. The audited strict patch compiler, seven-check validator,
manual high-risk policy, CAS/idempotency/outbox recovery and dedicated `goalId + goalVersion` handoff
lock preserve the existing v1.2.2 formal Planner/Workflow authority. API/OpenAPI, operational Console
and A2A `io.sdar/interaction` are wired. Affected gates pass 526 unit, 149 serial contract, 74 real
integration, 62 real E2E, 134 OpenAPI operations, 338-source architecture, 0108-0113 migration
rollback/reapply and production build. Implementation `02a367d` is pushed and Draft PR #8 remains
Draft; G06 correction facts and interaction episodes are next.

SDAR v1.2.3 G04 is complete and pushed (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime`. Ambiguous tasks now use a PostgreSQL-authoritative
Interactive Goal Session with non-repeating clarification, immutable Understanding revisions,
reviewable/diffable Goal Contract candidates, explicit actor confirmation, bounded budgets and
transactional CAS/idempotency/outbox evidence. Only a confirmed contract creates the existing v1.2.2
Goal and enters its existing Planner. API/OpenAPI, operational Console and A2A
`io.sdar/interaction` are wired. Affected gates pass 667 unit/contract, 73 integration, 62 real E2E,
132 OpenAPI operations, 329-source architecture, 0108-0112 rollback/reapply and production build.
Implementation `d226bfb` is pushed and Draft PR #8 remains Draft; G05 interactive planning is next.

SDAR v1.2.3 G03 is complete and pushed (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime`. Ambiguous requests now pass through strict bounded Task
Understanding, persist immutable PostgreSQL revisions/dimensions/source lineage and a real audited model
invocation, then stop at `INPUT_REQUIRED` when a blocking clarification or authorization is missing.
Explicit requests retain the v1.2.2 Goal path; no candidate or model result becomes Goal authority.
Affected gates pass 663 unit/contract, 72 integration, 62 real E2E, 130 OpenAPI operations, 323-source
architecture, 0108-0111 rollback/reapply and production build. Implementation `05b4df4` is pushed and
Draft PR #8 remains Draft; G04 interactive Goal clarification/confirmation is next.

SDAR v1.2.3 G02 is complete and pushed (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime`. The active G01 Summary now produces a strict allowlisted,
hash/policy-bound Public Capability Card with deterministic narrative fallback, enabled public A2A
Skills, transactional PostgreSQL activation/outbox, snapshot-only Agent Card reads and real API/Console
projections. Tool/Provider/credential/Workflow/internal Skill/private Experience/user/readiness/live
resource data is excluded. The isolated full gate on implementation `2ec8987` passes 656 unit/contract,
71 integration, 61 E2E, A2A MUST 74/74, 128 OpenAPI operations, 318-source architecture, 0108–0110
migrations, production build and both smokes in 159,967 ms. Draft PR #8 remains Draft; G03 Generic Task
Understanding is next.

SDAR v1.2.3 G01 is complete and pushed (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime`. Exact Enabled Skill declarations now produce a canonical,
order-independent Catalog Hash and a PostgreSQL-authoritative active Capability Summary with bounded
Index/Detail loading. Skill enable/disable/version/Usage/Outcome changes emit transactional
`skill.catalog_changed` events and the one-process Server deterministically rebuilds; no Provider
readiness or request-time model becomes summary authority. Affected gates pass 501 unit, 144 contract,
70 real integration, 60 real E2E, migration 0108/0109 rollback/reapply, 126 OpenAPI operations and
production build. A final isolated-database `pnpm verify` passes all six stages and both smokes in
166,839 ms. Implementation `820d78d` is pushed and Draft PR #8 remains Draft; G02 Public Card/A2A
projection is next.

SDAR v1.2.3 G00 is complete (2026-07-23) on
`feature/v1.2.3-cognitive-planning-runtime` from exact `origin/main@35cb927`. Implementation commit
`ffd9791` is pushed and Draft PR #8 is open. ADR-111–114, Domain/Port/schema/DDL, exact source intake,
architecture guards and rollback/reapply migration evidence freeze the cognitive foundation without
activating product behavior or changing v1.2.2 authority. A final isolated-database `pnpm verify`
passes 635 unit/contract, 68 real integration, 59 E2E, A2A MUST 74/74, 124 OpenAPI operations,
production build and both smoke gates in 168,876 ms. G01 deterministic capability summary is next.

SDAR v1.2.2 G00–G10 implementation and local acceptance complete (2026-07-22): the clean-slate User
Goal contract/planning → Skill Goal DAG/scheduler/attempt → layered outcome → sole
`UserGoalPlanController` terminal authority → bounded recovery/no-replay chain is implemented through
the single LangGraph runtime. Provider Business Events Profile 1.0 assets are pinned at `8a81b1b`; the
strict client, durable dual cursors, generation/continuity/relation runtime and event-impact recovery are
complete. Exact real Provider Streamable HTTP interop passes all Task/Event/Drain/Reset/Relation/restart
cases. Clean candidate `2db3996` passes unified verification with 629 unit/contract, 68 real integration,
59 E2E, A2A MUST 74/74, migrations, production build and both smoke stages; an isolated real pgvector
database restart audit also passes. AC-001–AC-078 are verified and failed attempts remain recorded.
Evidence commit `3ba0d59` is pushed and Draft PR #7 is open at
<https://github.com/zhouwen-giser/skill-driven-agent-runtime/pull/7> with `MERGEABLE/CLEAN` state and no
configured checks. Disposable databases/containers/volumes and isolated archives were deleted. The
Master Goal is complete; protected review/merge and tagging remain unauthorized.

SDAR v1.2.2 G00 baseline and contract freeze (2026-07-22): development started from exact
`origin/main@0f52a6d` on `feature/v1.2.2-user-goal-planning-business-events`; the minimum ancestor and all
21 Goal-package hashes pass. The explicit disposable-infrastructure pre-upgrade `pnpm verify` passes all
seven stages in 143,043 ms with 650 unit/contract, 84 integration, 60 E2E, 71 migrations, production
build and both smoke gates. EP-12, ADR-109, the frozen User Goal/Skill Goal/outcome/recovery contract,
AC-001–AC-078 mapping, repository/Legacy inventory and external dependency boundary are established.
The read-only Provider has clean protocol/source assets at `196620a` but modified generated reports;
EXT-BE-SKELETON remains review-pending and real Runtime Candidate interop remains unexecuted. The
focused document/architecture gate and meaningful content commit `414d167` complete G00; G01 Legacy
product-path removal is in progress.

SDAR v1.2.1 Frozen MCP Tasks Phase 11/12 (2026-07-22): Provider PR #15 is merged as `main@217e089`; independent Provider implementation `b30d839` (PR #16 final evidence head `4d90b199`) closes explicit Availability reservation semantics, base-only CreateTaskResult and strict `tools/list`, and its complete `pnpm verify:v2` passes in 340.8 seconds (74/74 frozen, 29/29 closure, 79 unit, 9 contract, 199 integration, 9 recovery, 29 security, 6 E2E, both Adapter conformance runs, capacity, SBOM and reproducible container). A real SDAR Streamable HTTP run passes strict discovery, `reservationMode: none`, MRTR, business/technical failure, mandatory `tasks/get` and Task Notification. The run found and fixed one SDAR client defect: a base CreateTaskResult may upgrade once to the first DetailedTask at the same Runtime Revision only when all Task base fields remain identical, while later same-revision drift remains forbidden; focused lifecycle passes 15/15. After recording and fixing an E2E read-after-request race without weakening its strict persistence assertion, clean exact SDAR commit `61142f9` passes all seven `pnpm verify` stages with `dirty=false` in 184,634 ms: 650/650 unit+contract, 84/84 integration, 60/60 E2E, 71 migrations, build and both smoke stages. Provider PR #16 Actions run `29882714727` passes `runtime-ci` and `runtime-compose`; SDAR has no configured Actions workflow. G2/G3/G4 and local G5 evidence pass. Final G5 and PR #6 Ready status await protected Provider PR #16 review/merge; automatic merge is not authorized. See Phase 11/12 reports.

SDAR v1.2.1 Frozen MCP Tasks Phase 10 (2026-07-19): the one-process Runtime now composes Frozen Notification subscriptions, derives invocation authority from persisted discovery/Tool profiles, persists immediate `tasks/get` reconciliation and converges polling/reconnect/Notification through one PostgreSQL Runtime Revision and continuation authority with output-schema validation. The explicit Frozen Mock re-authorizes Task interests at send time and bounds its producer queue; the client bounds incomplete SSE input. Move-to/area-patrol requalification, restart, parallel/child continuation and zero-duplicate Tool calls pass. Focused Frozen contracts are 54/54, unit 480/480, real integration 84/84, E2E 60/60, migration 0107/protocol/OpenAPI/architecture/build/static gates pass, and operator-managed `demo:acceptance` restores 16/16 Legacy evidence without starting/stopping Docker. Full contract was 166/167 solely because Windows could not create the original symlink fixture (`EPERM`); Phase 12 later resolved that host-only setup gap. SDAR Frozen Client and Frozen Mock Provider are Component Conformant; real Provider Runtime interop is not claimed and is Phase 11. The isolated stack was safely removed on 2026-07-22.

SDAR v1.2.1 Frozen MCP Tasks Phase 9 (2026-07-19): Management/OpenAPI/Console expose credential-free Provider discovery/version/baseline/Notification/Tool evidence and Remote Task TTL/revisions/source/health/Evidence summaries. Frozen register/refresh performs strict `server/discover` + complete `tools/list` and atomically stores encrypted credentials, Tool profiles/output schemas and the immutable snapshot; PostgreSQL prevents Legacy-to-Frozen overwrite even under a check/write race. Diagnosis, baseline audit, mode guard, reconnect surface and version-CAS reconciliation are explicit. Focused unit 3/3, focused contract 47/47, all unit 480, Repository integration 58/58, OpenAPI 122, architecture 279 and format/lint/typecheck/build pass; full contract is 158/159 solely due unchanged Windows symlink `EPERM`. Phase 10 must compose the local subscription runtime. The isolated `sdar-codex-phase9` stack was preserved while cleanup approval was unavailable and was safely removed on 2026-07-22. Phase 10 component conformance is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 8 (2026-07-19): bounded profile-1.0 Provider Evidence parsing validates output schemas, objective item identity/time/pointers/URI schemes/duplicates/size/depth and forbids local `requirementId`. Exact `evidenceType` matching emits only local `validatedEvidence`; arbitrary Provider metadata cannot satisfy Workflow gates, hard-gate URI evidence requires SHA-256 and execution references retain Provider/local/pointer/hash/Runtime Revision lineage. Focused unit 11/11 and contract 18/18, all unit 475, isolated PostgreSQL Repository integration 58/58, architecture 273 sources and format/lint/typecheck/build pass; full contract is 153/154 solely due unchanged Windows symlink `EPERM`. Full E2E/local component certification is Phase 10 and real Provider evidence is Phase 11. Phase 9 Management/Operations is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 7 (2026-07-19): Frozen POST SSE subscriptions require Ack first, correlate the listen request ID, expose only a stable authorized subset, cap/deduplicate/sort 256 interests and send neither `Mcp-Name` nor `Last-Event-ID`. Reconnect runs one `tasks/get` reconciliation per accepted Task. Create, poll, notification and reconciliation share Runtime Revision/content/terminal admission, suppressing duplicate notification/poll races. Focused subscription contracts pass 7/7 (subscription+lifecycle 19/19), unit 471, architecture 269 sources, format/lint/typecheck/build pass; full contract is 147/148 solely due the unchanged Windows symlink `EPERM`. This is client-component evidence; Provider-side authorization-at-send/producer-overflow remains mandatory in Phase 10, and real interop in Phase 11.

SDAR v1.2.1 Frozen MCP Tasks Phase 6 (2026-07-19): Frozen Availability now uses only `io.sdar/taskExecution/checkAvailability` profile 1.0 with `checks/requestId/state/knownValue`; strict request/result correlation, windows and reservation policy reject Legacy aliases. Tool profiles derive only frozen task-behavior, availability, timing, observation, input, idempotency and notification attributes—no removed `cancellation:*` or `execution:*` vocabulary. Reviewed `embodied.move_to` and `embodied.area_patrol` packages require `observations + task_notifications`; normative hashes, package checksums and golden imports are refreshed through the real Reader→Validator→Importer path without imposing `task_behavior:task_required`. Focused contracts pass 11/11, unit 471, architecture 267 sources, format/lint/typecheck/build pass; full contract is 140/141 solely due the unchanged Windows symlink `EPERM`. Phase 7 Task Notification convergence is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 5 (2026-07-19): Frozen lifecycle parsing now requires synchronous/create/get/update/cancel `resultType` discriminators, rejects nested Bridge Tasks, performs exactly one immediate `tasks/get` reconciliation after flat Task creation, derives expiration from `createdAt + ttlMs`, supports null/dynamic TTL and quarantines expired observations. Numeric `runtimeRevision`, duplicate-content identity and terminal monotonicity survive serialized component-state restore. MRTR supports partial keyed `elicitation/create` responses, ignores unknown/answered/superseded keys and deduplicates repeated A2A submissions across restore. Cancel Ack means cooperative intent only; completed, failed and cancelled remain possible. Focused contract passes 12/12, unit 471, architecture 265 sources, format/lint/typecheck/build pass; full contract is 134/135 solely due the unchanged Windows symlink `EPERM`. Phase 6 Availability and readiness migration is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 4 (2026-07-19): `FrozenV1McpClient` now sends independent POST requests with normative `2026-07-28` metadata and headers, validates `server/discover`, handles JSON/SSE response correlation and normalizes all five frozen error codes. Concurrent requests remain stateless, configured headers are the only authentication source, and `McpTransportRouter` selects explicit Legacy/Frozen clients without fallback or Frozen Bridge construction. Focused contract passes 10/10, unit 471, architecture 263 sources, format/lint/typecheck and production build pass. Full contract is 122/123 solely because the unchanged Windows symlink fixture fails with `EPERM`. Phase 5 flat Task lifecycle, TTL, MRTR and cancellation is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 3 (2026-07-19): released migration 0107 adds append-only protocol discovery snapshots, Server mode/current snapshot, Tool output schema, immutable Workflow protocol contracts and Frozen binding/observation/control revision authority; `v1.1-isolated` remains capped at 0106. Repositories round-trip Frozen snapshots, output/task profiles and Workflow contracts without Legacy translation. An isolated pgvector PostgreSQL on port 55433 passed empty, 0106 upgrade, idempotent, safe rollback/reapply, Legacy backfill, unsafe Frozen rollback rejection and ledger-gap rejection; Repository integration passed 58/58. Unit 471, architecture 260 sources, build and static 71-migration/Compose gates pass; full contract remains 112/113 only because the unchanged Windows symlink fixture setup fails with `EPERM`. The disposable container was deleted and operator port 55432 was untouched. Phase 4 Frozen stateless HTTP is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 2 (2026-07-19): Domain now owns the explicit `legacy_v11`/`frozen_v1` contract, Frozen task behavior/profile, protocol snapshot, canonical decimal runtime revision and dedupe key, Frozen Availability projection and Provider Evidence Item without local `requirementId`. Workflow DSL/Zod/runtime resolution preserve historical Legacy `mode`, require `protocolMode: frozen_v1` for new Frozen invocation controls and reject mixed contracts; the Legacy adapter fails closed on Frozen input. All 471 unit tests, focused 17 Workflow unit tests, focused 3 Workflow Schema contracts, format/lint/typecheck and 260-source architecture pass. The full contract suite remains honestly 112/113 because the unchanged Windows symlink fixture cannot create a link (`EPERM`). Phase 3 migration 0107 is next.

SDAR v1.2.1 Frozen MCP Tasks Phase 1 (2026-07-19): the shared protocol package now vendors the exact 180,695-byte MCP source Schema with verified Git blob/SHA-256, derives nine SDAR-owned strict schemas, locks eleven baseline/source/schema files plus the frozen document, and exercises nine valid plus twelve explicit Legacy/invalid fixtures. `pnpm verify:protocol`, the focused contract, 20-source lock verification, format, lint and strict typecheck pass. The new verifier is part of `verify:bootstrap`, so source/schema/document drift fails the normal gate. No Runtime or Domain behavior changed; the v1.1 SDK/Bridge remains the isolated Legacy authority. Phase 2 Domain/Workflow contracts are next; the Phase 0 Windows symlink/fixed-port limitations remain explicit.

SDAR v1.2.1 Frozen MCP Tasks Phase 0 (2026-07-18): development started from exact merged main `922f428` on `feature/v1.2.1-frozen-mcp-tasks-protocol`. The complete frozen protocol and upgrade plan are read; the pinned MCP commit, schema blob, 180,695 source bytes, mixed-transition LICENSE, absent NOTICE and schema SHA-256 `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708` are verified. ADR-108 preserves an explicit Legacy/Frozen adapter split, single PostgreSQL observation authority, the sole LangGraph runtime and Evidence A local matching. Baseline bootstrap passed format/lint/typecheck and 576 tests before the unchanged Windows symlink fixture failed to create with `EPERM`; Docker-backed baseline remains unverified because operator container `sdar-rc2-test-db` owns fixed port 55432 and was not modified. Phase 0 remains active until safe baseline evidence, commit/push and Draft PR publication are complete.

PR #5 review-blocker hardening complete (2026-07-18): Git ancestry and GitHub proved the feature branch had no text conflict; the actual repository-rule blockers were three unresolved review threads. Published commit `df65de4` and ADR-107 cover exact child output projection across immediate/continued execution, correct empty child input binding, mapped-evidence presence gates and top-level visibility filtering. All three threads contain fix evidence and are resolved. PR #5 was subsequently merged as protected-main commit `922f4288880e0fe3dee6ce402aa9788f4caa80eb`. Format/lint/strict typecheck, all 465 unit tests, focused Workflow DSL contracts 3/3, 256-source architecture and production build pass. Full contract reached 111/112; the unchanged symlink fixture is blocked by Windows `EPERM` even elevated. Infrastructure startup was blocked by operator container `sdar-rc2-test-db` owning fixed port 55432 and that container was not changed.

SDAR v1.2 Skill-driven capability usage Goal complete (2026-07-18): Phases 0–15 are implemented, verified, documented and pushed. Package 1.2.0, all nine local v1.2 requirement groups, all 22 adversarial threats, the complete explicit command matrix and clean SHA `b3b6e67` full verification have reproducible evidence. Required deferred items are zero. PR #5 carried the final scope/evidence body, was Ready for Review, and is now merged at `922f428`. Real/simulated/unverified boundaries and the trusted-intranet/Provider-authority limitations remain explicit.

SDAR v1.2 Skill usage Phase 15 verification (2026-07-18): all fourteen explicit final commands pass on clean release-candidate SHA `b3b6e67`. The 148,794 ms self-managed `pnpm verify` records 574 unit/contract, 82 real integration, 59 real E2E, 256-source architecture, 116 OpenAPI operations, 18 baseline plus 16 v1.1 acceptance scenarios, A2A MUST 74/74, 70 migrations, fresh 1.2.0 SBOM, production build and both smoke stages. The audit fixed a missing disposable-database bootstrap and stale SBOM version rather than deferring them. There are zero required deferred items. The disposable database was deleted and repository containers were stopped with volumes preserved. Final evidence was published, PR #5 transitioned to Ready for Review and protected review later merged it at `922f428`; no Goal action performed the merge.

SDAR v1.2 Skill usage Phase 15 release preparation (2026-07-18): package metadata is advancing to 1.2.0 and the architecture, domain, DSL, API, ADR, DoD, traceability, known-gap, operations and release-checklist surfaces are being reconciled against the original SRS and the frozen v1.2 Goal package. This entry is not a completion claim: the explicit 14-command final matrix, final acceptance report, final evidence commit and PR Ready-for-Review transition remain mandatory.

SDAR v1.2 Skill usage Phase 14 adversarial hardening (2026-07-18): all 22 required threats have reproducible owning-layer evidence. Prompt-injected labels cannot self-attest Provider/context/evidence compliance. Review found and fixed native recursive child allowlist enforcement; the first mandatory full gate then exposed and fixed legacy compatibility-projection misclassification. Clean feature SHA `74344ce` passed self-managed `pnpm verify` in 153,204 ms with 574 unit/contract, 82 integration, 59 E2E, 256-source architecture, 116 OpenAPI operations, 18 main plus 16 v1.1 acceptance scenarios, A2A MUST 74/74, 70 migrations, production build and both smoke gates. The disposable database was deleted and repository containers are stopped with volumes preserved. Phase 15 final release audit and Ready-for-Review transition are next.

SDAR v1.2 Skill usage Phase 13 recursive area-patrol acceptance (2026-07-18): all 20 required `embodied.area_patrol` scenarios now map to executable unit, contract, integration or real A2A/Server evidence. The parent freezes the exact current/enabled move-to dependency and deployment-selected inspection slot, native children retain immutable Usage/Goal authority, and legacy children remain compatible. Nested confirmation interrupts bypass error handlers; optional/degraded handlers continue explicitly; complete and degraded Provider outcomes retain exact parent/child execution trees and distinct missing-effect/evidence projections without replay. Feature commit `83753db` is pushed. Format/lint/typecheck, 569 unit/contract tests, build and 256-source architecture pass; isolated real PostgreSQL/Redis integration passes 82/82, A2A E2E passes 59/59, empty/0049 migration paths and isolated production smoke pass. Disposable databases were deleted and repository containers are stopped with volumes preserved. Phase 14 adversarial full verification is next.

SDAR v1.2 Skill usage Phase 12 move-to vertical acceptance (2026-07-17): all 14 required `embodied.move_to` scenarios now have executable unit, contract, integration or real A2A/Server evidence. Guidance, template and procedure modes select the exact Skill/version, produce compliant existing Workflow plans, invoke exact `embodied.move` arguments once, reuse V1.1 waiting/continuation and expose complete execution records. Missing target and forbidden-area paths block before Provider side effects; restricted/disabled/input/cancel/restart paths preserve their authorities; Provider terminal success without final-position evidence cannot complete. Canonical Task attributes, explicit deterministic `skillInput`/`context`/`evidence` roots, bounded guidance instructions and outcome-reference-first terminal projection close the acceptance defects. Feature commit `873ee80` is pushed. Format/lint/typecheck, 565 unit/contract tests, build and 256-source architecture pass; real PostgreSQL/Redis A2A passes 55/55 and restart/remote integration passes 11/11. Repository containers are stopped with volumes preserved. Phase 13 recursive area-patrol acceptance is next.

SDAR v1.2 Skill usage Phase 11 execution evidence (2026-07-17): Domain now owns immutable exact-version `SkillExecutionRecord`, 8 projection statuses, the frozen 20-event vocabulary and credential/private-reasoning-free thin references. Append-only migration 0106 stores root/parent execution identity, ordered events and Provider/resource/RemoteTaskBinding/evidence/hard-gate/intervention/outcome links without replacing Task, Workflow or Provider authority. The existing Task planning, confirmation/auto execution, external wait/resumption and terminal controller paths append evidence; terminal status transitions are immutable and projection failures cannot rewrite authoritative terminal state. Two Management API reads expose execution detail, Task collections, parent/child trees, task/provider refs, evidence, hard gates and degraded reasons. Feature commit `dc55f47` is pushed. Clean-feature-SHA format/lint/typecheck, 562 unit/contract tests, 256-source architecture, 116-operation OpenAPI and production build pass; real PostgreSQL repositories pass 57/57, final remote continuation runtimes pass 10/10, and migration 0106 released/rollback/reapply/gap guards pass. Phase 12 move-to vertical acceptance is next.

SDAR v1.2 Skill usage Phase 10 Runtime integration (2026-07-17): the existing Task preparation chain now loads the exact persisted selection candidate, recomputes bounded Usage composition/interpretation and passes one immutable `SkillUsagePlanPolicy` through the existing Workflow Planner, Validator, outer plan confirmation, revisions, replans and Goal Patch. Policy snapshots are Domain-revalidated on database reads; legacy no-declaration composition reuses only the existing exact Skill Graph authority. The integration found and fixed selection-evidence stripping at the PostgreSQL boundary and removed duplicate in-graph confirmation. Because v1.1 is merged, ADR-106 promotes the single released migration chain through 0105 while preserving isolated-profile guards and ledger-gap fail-closed. Exact feature commit `efb03e8` is pushed; clean-tree `pnpm verify` passed in 106,796 ms with 556 unit/contract, 81 integration, 50 E2E, 251-source architecture, 69 migrations, production build and both smoke stages. Phase 11 execution records are next.

SDAR v1.2 Skill usage Phase 9 plan compliance (2026-07-17): Domain-owned exact-version `SkillUsagePlanPolicy` now carries bounded normative/adaptive context, selected Task operations, readiness, related versions, mappings, failure and evidence policy. Guidance injects structured data only; template/procedure IR deterministically compiles into the existing Workflow DSL, then every deterministic/model/repair candidate passes the existing Validator plus structural compliance. Provider/Tool allowlists, child admission, recursion budget, explicit failure policy and context/evidence false-to-failure gates fail closed; explanations alone cannot establish compliance. The policy remains attached for the existing outer Workflow Plan confirmation; no duplicate in-graph confirmation is created. Deterministic failures consume only the existing bounded repair attempts. Focused planner/Validator/schema/LangGraph regressions pass 68/68, all unit 448/448 and all contract 107/107. ADR-105 is accepted; feature commit `7cdee9e` is pushed and remotely matched.

SDAR v1.2 Skill usage Phase 8 Provider readiness (2026-07-17): exact case-sensitive Skill Task Types now resolve enabled registered MCP operations, deterministic hard attributes derive only from validated v1.1 Task semantics, Provider policies filter before live availability, and immutable candidate summaries preserve risk, validity, earliest time, multiple windows, reservation and possible-effect evidence. Required Providers never fall back; preferred fallback requires explicit adaptive permission; forbidden/unknown/disabled/stale/inconsistent reservation paths fail closed. Usage-aware selection is always wired, while the existing exact-argument pre-invocation readiness remains final and Skill stores no live resource authority. Targeted selection/readiness tests pass 23/23, real MCP registry integration 8/8, PostgreSQL plan snapshot integration 56/56 and real A2A/MCP E2E 48/48. ADR-104 is accepted; feature commit `978d56f` is pushed and remotely matched; Phase 9 mode-to-plan compilation/compliance is next.

SDAR v1.2 Skill usage Phase 7 persistence/API (2026-07-17): append-only migration 0105 extends the existing exact `skill_version` authority with a native Usage JSON snapshot and checksum-bound package import audit; lifecycle remains derived from existing status and all changes create new versions. The bounded package reader/validator is wired through the existing Registry into real validate/import, exact-version and filtered catalog Management APIs, OpenAPI and Console fields. Validation is read-only, import revalidates, stale versions and rollback with Usage evidence fail closed. Full format/lint/typecheck, 83 focused tests, 56 real PostgreSQL integration tests, 48 real Server E2E tests, 114-operation OpenAPI, 246-source architecture, both migration paths through 0105 and production build pass. Commit `b664b6d` is pushed and remotely matched; Phase 8 real v1.1 Provider readiness binding is next.

SDAR v1.2 Skill usage Phase 6 contract freeze (2026-07-17): current `origin/main` `667146a` and v1.1 final `9e32311` are already ancestors of the V1.2 branch, so no empty merge was created. Regenerated repository/symbol/overlap maps identify final V1.1 readiness, Provider, external-wait/continuation and Workflow authorities. ADR-097–103 freeze versioned usage, three modes through the existing Workflow authority, normative policy, shared bounded composition, package import/runtime authority, direct V1.1 readiness/continuation reuse and minimal execution records. ADR high-water is 103; applied migration high-water remains 0104 with 0105 allocated to Phase 7 usage/import and 0106 to Phase 11 execution records. Post-main-sync self-managed `pnpm verify` passed in 141,005 ms with 542 unit/contract, 80 integration, 49 E2E, 246-source architecture, migrations/build and both smoke gates. Phase 6 commit `67cf7c3` is pushed; Phase 7 usage/import persistence is next.

SDAR v1.2 Skill usage Phase 5 (2026-07-17): the existing `SkillCompositionPlanner` and Skill Graph now resolve graph-authorized fixed dependencies and exact-version dynamic capability slots with schema-checked declarative input/output mappings. One shared default-three/hard-five recursion budget, 32-Skill/128-node bounds, cycle/duplicate/topology/candidate checks and immutable Domain snapshots fail closed. Guidance, template and procedure modes emit safe deterministic IR only; procedure IR is not Workflow DSL. All four failure policies have distinct parent semantics and degraded continuation requires explicit missing effect/evidence. Targeted regressions pass 20/20; full self-managed `pnpm verify` passes in 139,408 ms with 542 unit/contract, 80 integration, 49 E2E and 246-source architecture evidence. Phase 5 publication and the immediate v1.1-main Gate repeat are next; persistence, API, real readiness and execution remain deferred.

SDAR v1.2 Skill usage Phase 4 (2026-07-17): Domain-owned structured applicability (`satisfied/partial/unsatisfied/unknown`), evidence-only context resolution, Task readiness summaries, mode policy and exact usage-candidate snapshots now extend the existing selection chain. Context declarations must preserve authoritative→read-only→deterministic→user-input order; available context requires an evidence reference, unknown/unsatisfied or blocked-mode candidates never reach the model decider, and guidance is the only policy-admitted partial-context path. A read-only `SkillTaskReadinessPort` is exercised by mocks only; no v1.1 Adapter or Provider state was copied. Targeted application/formal-package regression tests pass 23/23, all 428 unit tests pass, full format/lint/typecheck pass and architecture verifies 244 sources. Phase 5 bounded composition and three-mode IR are next.

SDAR v1.2 Skill usage Phase 3B (2026-07-17): reviewed `embodied.move_to` and `embodied.area_patrol` packages now exercise the real bounded Reader→Validator→Importer path. Move-to includes goals/non-goals, authoritative position/resource/permission context, three modes, dynamic Provider binding, forbidden-area/cancel/failure policy and a final-position evidence hard gate. Area-patrol includes boundary/resource/time/partition context, exact move-to dependency, dynamic inspection slot, recoverable/degraded edges, three modes and coverage/trajectory/anomaly evidence. Focused schema/import/invalid/legacy/golden tests pass 5/5, all 106 contract tests pass and strict typecheck passes. Phase 4 applicability/context/mode decisions are next; package files remain reviewed import artifacts, not Runtime authority.

SDAR v1.2 Skill usage Phase 3A (2026-07-17): the existing `SkillRegistryService`, `SkillRepository` path and `SkillCandidateSnapshot` now expose immutable current/exact-version usage summaries, native-versus-legacy diff, exact package import continuity, lifecycle projection and visibility/mode/domain/tag catalog filtering. ADR-096 derives domains/tags from the existing capabilities authority and lifecycle from existing status, preventing parallel taxonomy or state. Targeted catalog/selection tests pass 12/12, all 417 unit tests pass, strict typecheck passes and architecture verifies 240 TypeScript sources. Phase 3B formal packages are next; no migration, Management API, Console or Runtime graph was touched.

SDAR v1.2 Skill usage Phase 2 (2026-07-17): a strict `sdar.io/v1alpha1` JSON package schema, bounded UTF-8 Markdown/JSON reader, checksum verification, canonical-root/path/symlink/type/size guards, embedded JSON Schema validation and immutable import candidate now form the package boundary. Package files remain import artifacts and cannot become Runtime authority or executable code. The complete self-managed Compose `pnpm verify` passed in 149,172 ms with 513 unit/contract tests, 80 integration tests, 49 E2E tests, 239-source architecture, migrations, builds and both smoke stages; final security contracts pass 10/10 with typecheck and targeted lint. Phase 3A catalog/version integration is next; no migration, API, Console, Provider state or Runtime path was changed.

SDAR v1.2 Skill usage Phase 1 (2026-07-17): Domain now owns an additive immutable `SkillUsageSpecification`, three execution-mode descriptors, visibility, normative/adaptive/observed separation, context requirements, Provider binding policy, fixed dependencies/capability slots, four failure policies, evidence hard gates, candidate-only patches and legacy-guidance projection. Runtime validation fails closed on enum/size/depth/duplicate/contradiction/private-reasoning/executable-artifact violations; usage depth is independently default 3/hard 5 while the existing generic Skill Graph remains unchanged. Targeted 12/12 and all 414 unit tests, strict typecheck, full lint, format and 234-source architecture checks pass. Phase 2 package validation is next; no v1.1 integration file, migration or Runtime was touched.

SDAR v1.2 Skill-driven capability usage Phase 0 (2026-07-17): Goal execution is active on `feature/v1.2-skill-driven-capability-usage` from merged v1.1 main `667146a`. Final v1.1 submitted SHA `9e32311` is an ancestor of main and GitHub PR #4 is merged, so the production-integration Gate is OPEN. EP-10, the exact supplied task package, normalized design, repository/symbol/overlap maps and recoverable baseline state are frozen. The latest-main self-managed Compose `pnpm verify` passed with 493 unit/contract, 80 integration, 49 E2E, 232-source architecture, 110 OpenAPI operations, 68 migration pairs and both smoke stages. The separately named v1.2 Overall Design source was not supplied and is recorded as an input gap; Phase 1 implementation is next.

SDAR v1.1 MCP Tasks Phase 6 RC increment (2026-07-17): the one-process Server now completes the Skill→plan confirmation→availability/risk guard→LangGraph→remote MCP Task→poll/control→durable continuation→result/evaluation→A2A vertical path, exposes the remote lifecycle and operator actions through the real management API/Console, and covers restart reconciliation without broadening V1 ordinary-running-task recovery. Migration 0104 admits the persisted `node_waiting_external` event that the vertical/restart gate exposed as missing from the PostgreSQL constraint. Clean `pnpm demo:acceptance` at `df8b6e0` passed with 10 Provider contract tests, 402 unit tests, 80 real integration tests, 49 real E2E tests and production build. Clean self-managed Compose `pnpm verify` at `13194b8` passed in 162.0 seconds; an isolated exact-commit `38356ea` checkout also passed frozen install, `pnpm verify` and `pnpm demo:local`. The branch and annotated `v1.1.0-rc.1` tag are pushed, and ready PR #4 targets protected `main` with GitHub reporting `MERGEABLE` and no configured status-check runs. Phase 6 RC publication is complete; review/merge and stable `v1.1.0` remain intentionally pending.

SDAR v1.1 MCP Tasks Phase 5 lifecycle-outcomes increment (2026-07-17): bounded Provider form elicitation now reuses the existing A2A/Task input boundary without Goal replanning, exact `tasks/update` supports durable multi-round answers and same-revision echo deduplication, and local Task/Goal cancellation records a cooperative request while protocol acknowledgement/uncertainty and Provider terminal state remain separate. Structured `admission_rejected`, `start_window_missed`, `deadline_reached`, `partial_completion` and `business_failure` evidence enters the existing LangGraph error-handler path; local timers/unreachability never fabricate Provider outcomes. Migration 0103, ADR-094 and the Phase 5 report are complete. Operator-managed `pnpm verify` passed in 112,673 ms with 401 unit, 79 contract, 77 real integration, 48 real E2E, 225-source architecture, 107-operation OpenAPI, 67 migration pairs, production builds and both smoke gates. Phase commit `470fdac` is pushed. Phase 6 management/Console completion, 16 composed MCP Tasks scenarios, demos and final publication remain incomplete; see `reports/v1.1-mcp-tasks/05-lifecycle-outcomes.{md,json}`.

SDAR v1.1 MCP Tasks Phase 4 remote-continuation increment (2026-07-16): bounded domain-owned frontier snapshots, PostgreSQL control claims/attempts, one-attempt BullMQ continuation scheduling, fresh LangGraph `Command.goto` continuation, parallel join evidence, child Skill lineage propagation and Goal Patch/cancellation invalidation are implemented and verified. `pnpm verify` passed in 153,461 ms with 362 unit, 79 contract, 72 real integration, 48 real E2E, 212-source architecture, 107-operation OpenAPI, 66 migration pairs, production builds and both smoke gates. Phase commit `e925099` and remote hardening topology sync `eb69947` are pushed. Phase 5 is verified above; Phase 6 final acceptance remains incomplete. See `reports/v1.1-mcp-tasks/04-remote-continuation.{md,json}`.

SDAR v1.1 MCP Tasks Phase 3 availability/timing increment (2026-07-16): complete `v1.0.13-bug-fixed` hardening is merged at `4007b38`; V1.1 ADRs are unambiguously numbered ADR-085–092 and isolated migrations require `0064 → 0100 → 0101`. Domain-owned timing/readiness, strict DSL, schema-constrained risk decisions, transitive confirmation conjunction, exact-argument pre-call refresh, append-only PostgreSQL evidence and real API/Console projections are verified. `pnpm verify` passed in 166,576 ms with 328 unit, 79 contract, 68 real integration, 48 real E2E, 204-source architecture, 107-operation OpenAPI, 65 migration pairs, production builds and both smoke gates. Phase commit `b205d5d` is pushed; Phase 4–6 remain incomplete.

SDAR v1.1 MCP Tasks Phase 2 persistence/polling increment (2026-07-16): PostgreSQL owns explicit remote Task bindings, ordered Provider observations, idempotent controls and protocol attempts; BullMQ carries `{bindingId, expectedVersion}` with attempts=1. Complete pre-hardening `pnpm verify` passed with 292 unit/contract, 48 real integration and 42 real E2E tests. `reports/v1.1-mcp-tasks/02-persistence-polling.{json,md}` records the exact evidence boundary.

SDAR v1.1 MCP Tasks Phase 1 protocol-adapter increment (2026-07-16): exact official `@modelcontextprotocol/client@2.0.0-beta.4` plus the frozen `ext-tasks` Schema provide modern negotiation and legacy fallback behind the adapter. Complete pre-hardening `pnpm verify` passed with 283 unit/contract, 42 real integration and 42 real E2E tests; see `reports/v1.1-mcp-tasks/01-protocol-adapter.{json,md}`.

SDAR v1.1 MCP Tasks Phase 0 design-freeze increment (2026-07-16): EP-09, canonical addendum/provider contract, exact source pins and conflict maps are published on Draft PR #2. Phase 0 is complete.

Runtime-hardening v1.0.13 bug-fixed increment (2026-07-16): feature commit `a13d8e7` and annotated `v1.0.13` are published and remotely verified. The independent audit removes the duplicate deadline read, finishes close-released waiters before another database/event publish, rejects new execution after close, prevents 10ms/non-positive configuration and proves five transaction rollback points emit no notification. Required operator-managed `pnpm verify` passed in 88,363 ms with 298 unit, 64 contract, 60 integration, 46 E2E, 185-source architecture, build, migrations and smoke; `pnpm demo:local` completed its confirmed Task and `pnpm demo:acceptance` passed 46/46. Bug-fixed publication remains; no Docker command ran.

Runtime-hardening v1.0.13 feature increment (2026-07-16): ADR-084 replaces A2A's 10 ms PostgreSQL loop with a bounded process-local Task notification port and a 1,000 ms default safety read that always reloads database authority. Every successful Task mutation path publishes after commit; timeout returns the current working/terminal snapshot, and Runtime close releases waiters. With E2E safety polling deliberately set to 5,000 ms, all 46 return-immediately, streaming, terminal/input/capability-gap, timeout and disconnect/resubscribe scenarios pass. The complete operator-managed `pnpm verify` passed in 89,011 ms with 296 unit, 64 contract, 60 integration, 46 E2E, 185-source architecture, build, migrations and smoke; feature commit `a13d8e7` and annotated `v1.0.13` are published and remotely verified, and no Docker command ran.

Runtime-hardening v1.0.12 bug-fixed increment (2026-07-16): feature commit `01e2d44` / annotated `v1.0.12` and bug-fixed commit `21b9f79` / annotated `v1.0.12-bug-fixed` are published and remotely verified. The adversarial audit prevents models from elevating durable authority, deterministically forces every named dynamic device-state class to volatile MCP evidence even under a forged durable response, blocks direct-create bypass, and takes bounded immutable Memory-content and Embedding snapshots across asynchronous boundaries. The required operator-managed `pnpm verify` passed in 85,277 ms with 287 unit, 64 contract, 60 real integration, 46 real E2E, 182-source architecture, 106-operation OpenAPI, production build, empty/0049→0064 migrations and both smoke gates; no Docker command ran.

Runtime-hardening v1.0.12 feature increment (2026-07-16): ADR-083 makes Memory durability and authority explicit, restricts automatic long-term admission to strictly refined durable evidence, and keeps volatile/unknown device state out of durable retrieval. Migration 0064 supports generic positive pgvector dimensions with exact provider/dimension matching, conservatively excludes legacy unknown rows, and guards lossy rollback. Post-commit Memory enhancement failure remains a queryable Runtime Terminal Outcome warning and cannot reverse a completed Task or fabricate Memory success. The complete operator-managed `pnpm verify` passed in 86,193 ms with 284 unit, 64 contract, 60 real integration, 46 real E2E, 182-source architecture, 106-operation OpenAPI, production build, empty/0049→0064 migrations and both smoke gates. Feature commit `01e2d44` and annotated `v1.0.12` are published and remotely verified; no Docker command ran.

Runtime-hardening v1.0.11 bug-fixed increment (2026-07-16): feature commit `2efbef6` / annotated `v1.0.11` and bug-fixed commit `fe3b126` / annotated `v1.0.11-bug-fixed` are published and remotely verified. The adversarial audit rejects contradictory `default_unknown` evidence, freezes accepted snapshots, fails closed on malformed exact MCP declarations, revalidates persisted Tool/Invocation authority, and atomically stores administrator override with its management audit so concurrent deletion or audit failure cannot leave false evidence. The operator-managed bug-fixed `pnpm verify` passed in 85,191 ms with 283 unit, 63 contract, 59 real integration, 46 real E2E, 182-source architecture, 105-operation OpenAPI, production build, empty/0049→0063 migrations and both smoke gates. No Docker command ran.

Runtime-hardening v1.0.11 feature increment (2026-07-16): ADR-082 defines complete MCP Tool execution semantics with literal MCP-declaration → retained administrator override → conservative unknown authority. Official SDK declarations remain adapter-local; Tool rows retain declared/admin/effective values, Invocation rows preserve call-time values, and immutable Workflow plans/attempts preserve Planner-time confirmation values through migration 0063. Planner, confirmation Console, MCP Console/API and Skill Tool Policy views expose the snapshots without letting LLM Enhancement become authority. The complete operator-managed `pnpm verify` passes in 86,700 ms with 281 unit, 62 contract, 59 integration, 46 E2E, 182-source architecture, 105-operation OpenAPI, build, empty/0049→0063 migrations and both smoke gates. Feature commit `2efbef6` and annotated `v1.0.11` are published and remotely verified; no Docker command ran.

Runtime-hardening v1.0.10 bug-fixed increment (2026-07-16): feature commit `f8ae410` / `v1.0.10` and bug-fixed commit `2eba64e` / `v1.0.10-bug-fixed` are published and remotely verified. The adversarial audit prevents a same-Goal successor's Goal Patch from invalidating the old capability-gap Task, serializes Round insertion against terminal WorkflowControl authority, rejects corrupt PostgreSQL evidence and incomplete A2A projection, and validates non-empty domain evidence. The operator-managed bug-fixed gate passed 274 unit, 61 contract, 58 real integration, 46 real E2E, 181-source architecture, 104-operation OpenAPI, production build and empty/0049 migrations through 0062; no Docker command ran.

Runtime-hardening v1.0.10 feature increment (2026-07-16): ADR-081 supersedes the old capability-gap waiting projection. `capability_gap` is now a monotonic terminal Task/WorkflowControl outcome, projects to A2A `FAILED` with `CAPABILITY_GAP`, structured evidence and an explicit new-Task action, while its Goal remains active for a normal same-Context successor Task. PostgreSQL rejects stale Task/Control writes, follow-up resume is forbidden, and wait timeout ignores the terminal row. The operator-managed feature gate passed 274 unit, 60 contract, 58 real integration, 46 real A2A/Model/MCP E2E, 181-source architecture, 104-operation OpenAPI, production build and empty/0049 migration paths through 0062. Feature commit `f8ae410` and annotated `v1.0.10` are published; no Docker command ran.

Runtime-hardening v1.0.9 bug-fixed publication (2026-07-16): commit `63eb1e5`, annotated `v1.0.9-bug-fixed` and the release branch were pushed and remotely verified; the tag resolves to the same commit.

Runtime-hardening v1.0.9 bug-fixed increment (2026-07-16): feature commit `8f7bba9` and annotated `v1.0.9` are published and remotely verified. The adversarial audit rejects disconnected/duplicate/cyclic/over-depth persisted or inherited composition authority, caps exact context to 8 levels, 32 Skills, 128 relations and 64 JSON levels, and replaces full-graph loading with indexed bounded source/type reads. Corrupted PostgreSQL snapshots are revalidated before use. The required full operator-managed `pnpm verify` passed in 87,491 ms with 273 unit, 59 contract, 58 real integration, 46 real A2A/Model/MCP E2E, 181-source architecture, A2A/OpenAPI/acceptance/license/SBOM gates, production builds, empty/0049 migrations through 0062 and both smoke stages. Bug-fixed publication is pending; Compose daemon/config was deferred and no Docker command ran.

Runtime-hardening v1.0.9 feature increment (2026-07-16): ADR-080 and migration 0062 make the existing Skill Graph part of initial composition planning. The Planner receives a bounded exact-version snapshot containing only reachable non-alternative Skills and relations; `skill_call` is constrained by that durable authority or an explicit internal capability-gap admission, while the LLM retains the final subset decision. Initial Task/child planning recomputes authority, revisions and ordinary replans inherit it, Skill replacement recomputes it, and execution revalidates persisted authorization. The operator-managed feature gate passed format/lint/typecheck, 270 unit, 59 contract, 58 real integration, 46 real A2A/Model/MCP E2E, 181-source architecture, 104-operation OpenAPI, production build and empty/0049 migrations through 0062; commit `8f7bba9` and annotated `v1.0.9` are published.

Runtime-hardening v1.0.8 bug-fixed increment (2026-07-16): feature commit `f6501a9` / `v1.0.8` and bug-fixed commit `be4a50f` / `v1.0.8-bug-fixed` are published and remotely verified. The adversarial audit enforces runtime copy/freeze at asynchronous Contract boundaries, rejects stale or terminal registered Goal selection/planning before embeddings/models, and blocks same-version Goal Patch source drift before invalidation. The bug-fixed gate passes format/lint/typecheck, 262 unit, 59 contract, 57 real integration, 46 real A2A/Model/MCP E2E, 179-source architecture, 104-operation OpenAPI, production build and empty/0049 migrations through 0061; no Docker command ran.

Runtime-hardening v1.0.8 feature increment (2026-07-16): ADR-079 and migration 0061 establish one immutable six-field Goal Execution Contract across Skill retrieval/selection/replacement, Temporary Skill resolution, top-level/replan/child planning, evaluation, model audit and plan attempts. Candidate snapshots contain every required planning signal. Registered management calls, repair confirmation inheritance, execution and outer control fail closed on content drift, while Goal Patch alone advances to the proposed version. The feature gate passed format/lint/typecheck, 259 unit, 59 contract, 57 real integration, 46 real A2A/Model/MCP E2E, 178-source architecture, 104-operation OpenAPI, production build and empty/0049 migrations through 0061; commit `f6501a9` and annotated `v1.0.8` are published.

Runtime-hardening v1.0.7 bug-fixed increment (2026-07-16): feature commit `9bf6ba3` / `v1.0.7` and bug-fixed commit `88d1d01` / `v1.0.7-bug-fixed` are published and remotely verified. Migration 0060 binds each formal Task plan to the exact immutable input-resolution ID with a composite Task/Goal/Skill identity foreign key; execution cannot drift to a newer record, replacements and Goal Patch clear stale bindings, authoritative metadata cancels stale unresolved markers, root schema errors remain resumable, and Goal Patch input resolution preflights before invalidation. The bug-fixed gate passed format/lint/typecheck, 251 unit, 58 contract, 56 real integration, 46 real A2A/MCP E2E, 178-source architecture, OpenAPI, production build and empty/0049 migrations through 0060; no Docker command ran.

Runtime-hardening v1.0.7 feature increment (2026-07-16): ADR-078 and migration 0059 add immutable top-level formal Skill input resolution tied to exact Task, Goal and Skill versions. The fixed `skill_input_resolution` model stage receives priority-ordered metadata/text/Goal/context/supplement/Memory evidence, explicit metadata remains authoritative, Memory remains non-authoritative, schema-invalid input enters the durable v1.0.3 same-Task continuation, and schema-valid structured input reaches LangGraph/MCP directly. Goal Patch re-resolves for the new Goal version; management API/Console expose stage configuration and resolution history. The feature gate passed format, lint, strict typecheck, 249 unit, 58 contract, 55 real integration, 46 real A2A/MCP E2E, 178-source architecture, OpenAPI, production build and empty/0049 migrations; feature commit `9bf6ba3` and annotated `v1.0.7` are published.

Runtime-hardening v1.0.6 bug-fixed increment (2026-07-16): feature commit `4df20a9` / `v1.0.6` and bug-fixed commit `967d555` / `v1.0.6-bug-fixed` are published and remotely verified. The adversarial audit makes generic Task/Goal/Control terminal rows fully immutable, validates terminal Round/plan/decision/final-instance identity, moves waiting-input cancellation into the atomic transaction, reconciles Goal-wide active Controls with per-Control canceled outcomes, and keeps warning-persistence failure non-authoritative. The complete operator-managed `pnpm verify` passed in 82,005 ms with 243 unit, 58 contract, 53 integration, 44 E2E, 175-source architecture, empty/0049 migrations, production builds and both smoke gates; no Docker command ran.

Runtime-hardening v1.0.6 feature increment (2026-07-16): commit `4df20a9` and annotated `v1.0.6` are published. ADR-077 and migration 0058 establish one PostgreSQL transaction for Processed Result, Task output/phase, Goal, WorkflowControl, terminal Round reference and Runtime Event. Exact retries are idempotent, conflicting/stale Workers cannot overwrite terminal authority, and active-control cancellation uses the same boundary. Memory, Quality and evolution run only after commit and persist warnings without changing A2A output. Trigger-based PostgreSQL faults prove rollback before Result and after Task/Goal/Control/Event; real A2A injects post-commit Memory failure and still returns completed with achieved Goal/Control. Feature gates pass 242 unit, 58 contract, 52 integration, 44 E2E, 175-source architecture, production build and empty/0049 migrations without Docker lifecycle operations.

Runtime-hardening v1.0.5 bug-fixed increment (2026-07-16): feature commit `6decc5d`, bug-fixed commit `8d82427` and both annotated tags are published. The adversarial audit serializes Task decisions, rejects phase-stale/canceled-parent confirmations before side effects, binds continuation to the exact child confirmation target, revalidates immutable plan/current Skill authority before resume, projects every fresh checkpoint after invalidation, and releases user/timeout-canceled child waits. Real A2A/MCP E2E proves canceled parents cannot execute and a v1-to-v2 child change creates a second independently confirmable checkpoint with zero stale MCP calls. The full operator-managed gate passes format/lint/typecheck, 238 unit, 58 contract, 43 integration, 43 E2E, 174-file architecture enforcement, migrations, production builds and smoke without Docker lifecycle operations.

Runtime-hardening v1.0.4 bug-fixed increment (2026-07-15): feature commit `82a90ab`, bug-fixed commit `fa4b050` and both annotated tags are published. The audit bounds simulation IDs to 256 visible ASCII characters, proves case-insensitive duplicate legacy reserved Headers cannot override canonical runtime values, preserves non-live failure audit, and verifies paused/resumed propagation plus stable-ID official MCP session reuse. Final gates pass format/lint/typecheck, 218 unit, 58 contract, 42 real integration, 42 real E2E, 172-file architecture enforcement, production builds and 0056 migration paths without Docker lifecycle operations.

Runtime-hardening v1.0.3 bug-fixed increment (2026-07-15): the feature commit `c25e92b` and annotated `v1.0.3` tag are published. The audit closed the PostgreSQL/Redis dispatch window by atomically committing input answer, response, continuation attempt and Task phase, then reconciling only durable queued attempts into idempotent one-attempt BullMQ Jobs. Interrupted running attempts fail with `PROCESS_EXECUTION_LOST` and are never redispatched; inputs over 64,000 characters fail before persistence. The full operator-managed `pnpm verify` passes 271 unit/contract, 41 real integration, 42 real E2E, architecture, protocol/OpenAPI/license/SBOM, production builds, empty/0049 migration paths and both smoke stages without Docker lifecycle operations; bug-fixed publication is pending.

Runtime-hardening v1.0.2 bug-fixed increment (2026-07-15): migration 0054 replaces the one-row-per-parent-node Skill-call relation with append-only `call_id` history while preserving deterministic latest lookup; rollback explicitly collapses repeats to the latest legacy-compatible row. Child outputs are finite JSON capped at 64,000 characters before parent-state injection. The bug-fixed gate passes 48/206 unit, 7/57 contract, 2/37 real integration, 1/41 E2E, architecture, production build and empty/0049 migration verification; publication is pending.

Runtime-hardening v1.0.2 feature increment (2026-07-15): `skill_call` now invokes the normal Workflow Planner with the current Skill definition and MCP planning metadata, revalidates and executes an independent child plan through the sole LangGraph runtime, propagates cancellation, validates the real child result, and rejects cycles/depth over eight. A real E2E proves the current Skill v2 dynamically binds input into a real child MCP call and persists parent/child/version/audit evidence. Commit `0e3122c` and annotated tag `v1.0.2` are published; nested confirmation remains explicitly scheduled for v1.0.5.

Runtime-hardening v1.0.1 bug-fixed increment (2026-07-15): recursive Workflow binding traversal and detached cloning are explicitly bounded to 64 levels, cyclic/pathological runtime values fail with a stable typed error, unset result references use the missing-reference code, and dotted node IDs retain unambiguous JSON path evidence. The bug-fixed gate passes format, lint, strict typecheck, 167-file architecture enforcement, 48/197 unit, 7/57 contract and 1/41 real Workflow E2E tests without Docker lifecycle operations; commit `6417a6f` and annotated tag `v1.0.1-bug-fixed` are published.

Runtime-hardening v1.0.1 feature increment (2026-07-15): Workflow nodes now resolve domain-owned recursive bound values from initial input, node outputs, errors, loop counts, and result state immediately before LangGraph execution. Resolved values are detached immutable JSON snapshots; MCP and Skill inputs are revalidated at their live schema boundary; LLM context and Subworkflow input use the same resolver. Focused unit/contract tests and the real PostgreSQL/Redis + loopback MCP Workflow E2E pass; commit `34c48a8` and annotated tag `v1.0.1` are published.

Runtime-hardening baseline repair (2026-07-15): the release branch now restores immutable OCI digest pins after the tag-only Compose regression and supports an explicit `SDAR_REUSE_EXISTING_INFRA=true` verification mode. In that mode the operator owns PostgreSQL/Redis lifecycle, while migration, integration, E2E, infrastructure smoke, and Server smoke connect to the real loopback services without invoking Docker. Focused evidence passes 47/186 unit, 7/56 contract, 2/36 integration, 1/41 E2E, empty/0049 migration paths, production build, infrastructure smoke, and Server/Console smoke. A clean unified `pnpm verify` remains the baseline acceptance action before v1.0.1 starts.

Open-source licensing increment (2026-07-14): Skill-Driven Agent Runtime is now licensed under Apache-2.0 with `Copyright 2026 zhouwen`. Canonical `LICENSE`, project `NOTICE`, root/Console SPDX metadata, README and contribution terms, license-ledger disclosure, CycloneDX root-component license, and an executable drift gate are present. Third-party dependencies retain their independent licenses and notices.

V1.0 release-readiness completion (2026-07-14): isolated commit `2e398d9` clean-clone/frozen-install verification passes format, lint, strict typecheck, 54 files/242 tests, architecture, A2A/OpenAPI/AC/source/migration/license gates and production builds. The exercise found and fixed Windows LF policy plus stale/path-dependent SBOM evidence. PostgreSQL/Redis Compose ports are loopback-only and machine-guarded; release posture scans and all 13 checklist items pass. The final warning-free `pnpm verify` passed in 116237 ms with real migration, 2-file/36-test integration, 1-file/41-test E2E, infrastructure and Server/Console smoke. All requirements and 18 ACs are verified with real/simulated boundaries classified; V1.0 is release-ready for the documented trusted-intranet local deployment posture.

Documentation/release-evidence increment (2026-07-13): added configuration, operations, graceful/crash behavior, backup posture, health, troubleshooting and release guidance plus CONTRIBUTING rules; README links the complete architecture/API/storage/security/test/demo/DoD/traceability/operations set. Unified verification already proves exact OSS pins, SBOM/licenses, Third-Party Notices, risk-warning contracts, production build and Console warnings. The corresponding DoD documentation, OSS, and risk conditions are complete. Remaining project-level conditions are the signed release checklist, clean-checkout install proof, and final clean worktree/build/history evidence.

Migration-path acceptance (2026-07-13): `pnpm verify:migrations` now creates two isolated PostgreSQL databases, applies the complete runtime migration chain to an empty bootstrap, applies historical migrations through 0049 to the second database, upgrades it through 0053 using the production monotonic runner, verifies the latest ledger and `tool_enhancement` constraint, and removes both databases. The command passed and is now a stage in full `pnpm verify`; the migration DoD condition is complete.

One-command delivery increment (2026-07-13): `pnpm demo:local` now builds and starts PostgreSQL, Redis, deterministic Mock Model, Mock MCP, Server and production Console bundle, then runs the documented official-SDK A2A example client through streamed input-required, plan confirmation, real MCP execution and completion. `pnpm demo:acceptance` runs the full 41-scenario E2E suite and passed in 21.27 seconds of test time. The first demo attempt exposed a production shutdown race where terminal Task state preceded evaluation/evolution completion and the pool closed early; the composition root now tracks background controls and waits before closing MCP/PostgreSQL, with ADR-029 updated. README is now an actual product quickstart. DoD marks one-command startup, non-static composed runtime behavior, and real-API Console surfaces complete.

V1 AC reconciliation (2026-07-13): all 18 baseline acceptance scenarios now have a machine-readable and human-readable audit mapped to the current full gate. `pnpm verify:acceptance` enforces the exact AC-01..18 set, passed status, evidence, and real/simulated classification. The audit relies on the just-executed 54/242 unit+contract, 2/36 real integration, 1/40 real E2E, smoke, official A2A TCK baseline, and real production-Console browser evidence. Deterministic model/embedding/evaluation semantics are explicitly simulated; infrastructure, protocols, persistence, LangGraph and UI/API paths are real local execution. DoD now marks all AC scenarios complete; one-command demo, migration upgrade/clean-install, release checklist and documentation completeness remain open.

Unified verification correction (2026-07-13): the prior `pnpm verify` omitted Docker-backed integration/E2E/smoke and generated no summary, contrary to `docs/09_TEST_AND_ACCEPTANCE_STRATEGY.md`. `scripts/verify-full.mjs` now runs the complete static/unit/contract/build + PostgreSQL/Redis integration + PostgreSQL/Redis/Mock Model/Mock MCP E2E + infrastructure smoke + Server/Console-bundle smoke sequence and always emits JSON/Markdown evidence. The first full run passed all five stages in 104146 ms; `docs/16_DEFINITION_OF_DONE.md` now marks the all-requirements and unified-verification conditions complete. AC bundle, one-command demo, upgrade-path/clean-install proof, release checklist, and final documentation audit remain open.

Current real-gate and browser reconciliation (2026-07-13): Docker/PostgreSQL/Redis recovered. `pnpm test:integration` passes 2 files/36 tests, `pnpm test:e2e` passes 1 file/40 tests, `pnpm smoke:infra` and the strengthened Server/Console-bundle smoke pass, and unified `pnpm verify` passes 54 files/242 tests. Real in-app browser execution against the production bundle and management API verified Task/Goal/Workflow/Skill/MCP/model/Memory/Evaluation navigation and correlated trace. FR-MCP-008, FR-MCP-012, NFR-PERF-002, NFR-OBS-001, and NFR-UX-001 are now verified. Browser execution found and fixed the `/console/` Vite base defect; real startup repetition found and fixed legacy migration replay through ADR-072. The traceability matrix now has no developing rows; project-level DoD/acceptance reconciliation still continues before V1 completion is declared.

EP-07 NFR-REL-002 acceptance reconciliation (2026-07-13): the exact criterion prohibits whole-Task automatic retry and policy-driven duplicate side effects after Task, Worker, or model failure; it does not prescribe a live OS-kill experiment. Historical real Redis/BullMQ proves production Jobs use one attempt, PostgreSQL startup recovery fails rather than resumes interrupted work, real MCP E2E proves checkpoint loss does not replay the prior call, and real loopback-model/PostgreSQL E2E proves an upstream 503 produces exactly one failed invocation without fallback. Current 2-file/11-test fail-fast regression and unified `pnpm verify` (54 files/242 tests) pass. NFR-REL-002 is verified; the newer direct thrown-Worker Redis repetition remains explicitly unexecuted. Five requirements remain developing.

EP-06 FR-ADM-004 acceptance reconciliation (2026-07-13): the original workbench displayed a DAG but exposed topology edits only through JSON, so the missing repository-owned visual editor is now implemented for node names, entry/exit markers, and edge endpoints/outcomes/add/remove. Every edit remains canonical restricted data, preserves node-specific configuration, and requires explicit validation, immutable revision, and fresh confirmation. Historical real PostgreSQL/Redis/management/model/MCP/LangGraph gates prove revision, execution, and ordered node events; current 4-file/63-test regression and unified `pnpm verify` (54 files/242 tests) pass. FR-ADM-004 is verified; latest Docker-backed and real-API browser repetition remain separate EP/release gaps. Six requirements remain developing.

EP-06 FR-ADM-006 acceptance reconciliation (2026-07-13): historical real EP-04/05 A2A/PostgreSQL/LangGraph/MCP/model flows query Task/context/Goal, model/MCP calls, ordered events, processed results, five-part evaluation, and persisted errors. Current 4-file/69-test Task/workflow/management/Console regression proves persisted-identifier navigation, bounded filtering and read-only refresh; unified `pnpm verify` passes 54 files/241 tests. FR-ADM-006 is now verified; migration-0052 extended confirmation/Patch fields and latest browser repetition remain separately tracked under NFR-OBS-001/NFR-UX-001.

EP-06 FR-ADM-003 acceptance reconciliation (2026-07-13): every required Skill Studio operation maps to verified real evidence—draft/Schema/edit/publication (FR-SKL-001..003, FR-EVO-008), versions/diff/rollback/enable/disable (FR-SKL-006/007), six graph relations (FR-SKL-009), simulation/correction (FR-EVO-005..007), and warnings (FR-EVO-009). Current 5-file/60-test authoring/registry/evolution/management/Console regression and unified 54-file/241-test gate pass. FR-ADM-003 is now verified; latest all-control browser repetition remains separately unverified.

EP-06 FR-ADM-008 acceptance reconciliation (2026-07-13): historical FR-EVAL-004 passed 31 real PostgreSQL integration and 40 E2E tests plus smoke for two-round MCP/model/Tool-filtered success, duration, cost, failure, stability and quality trends. Current 3-file/51-test regression proves MCP usage, model effects, capability growth, evidence-counted advisory suggestions, management projection and dashboard rendering; unified `pnpm verify` passes 54 files/241 tests. FR-ADM-008 is now verified against “dashboard displays key metrics”; latest all-fields database/browser repetition remains separately unverified.

EP-06 FR-ADM-007 acceptance reconciliation (2026-07-13): the SRS requires Memory view/search, status changes, replacement links, source trace, and active/superseded/invalid management. FR-MEM-004 already passed real management/model/PostgreSQL E2E for transactional supersede, unchanged history, audit, invalidation and active-only retrieval (29 integration/37 E2E/build/smoke). Current 3-file/55-test Memory/management/Console regression and unified 54-file/241-test gate pass. FR-ADM-007 is now verified; latest browser repetition remains separately unverified.

EP-06 FR-ADM-005 acceptance reconciliation (2026-07-13): the SRS requires Prompt version/candidate/publish/rollback/effect operations with traceable changes. EP-03 already passed real PostgreSQL, management HTTP, local model HTTP and same-process E2E proving candidate isolation, publication/new-version routing, invocation links, and effect queries (15 integration/12 E2E/build/smoke). Current 3-file/52-test Prompt/management/Console regression and unified 54-file/241-test gate pass. FR-ADM-005 is now verified; latest browser repetition remains separately unverified.

EP-06 FR-ADM-002 acceptance reconciliation (2026-07-13): the original criterion requires complete MCP CRUD and available operation logs. EP-02 already passed real same-process MCP lifecycle, while EP-06 passed 31 real PostgreSQL/Redis tests applying migration 0050 and covering refresh/health/credentials/metadata/delete plus append-only credential-safe logs after Server deletion. Current 3-file/57-test application/management/Console regression and unified 54-file/241-test gate pass. FR-ADM-002 is now verified; the latest real-API browser repetition remains separately unverified.

EP-06 FR-ADM-001 acceptance reconciliation (2026-07-13): the exact criterion requires access without login plus a trusted-intranet deployment risk warning, not backend CRUD. Production management/Console paths have no authentication middleware; real loopback HTTP and the historical real in-app browser access them without login and expose persistent warnings; deployment/security/release documentation covers isolation. Current 4-file/57-test regression and unified 54-file/241-test gate pass. FR-ADM-001 is now verified; current Server smoke and real-API browser CRUD remain separate gaps for other requirements/release acceptance.

EP-02 FR-MCP-011 acceptance reconciliation (2026-07-13): the original criterion is exact—Tool removal/Schema change creates a visible dependency warning while the Skill remains enabled. EP-02 already ran the production PostgreSQL warning transaction against a current enabled SkillVersion and passed 9 integration/6 E2E/build/smoke; the warning repository has no Skill-status mutation port. Current 3-file/57-test regression covers removed/schema_changed, management display, and Console access, while unified `pnpm verify` passes 54 files/241 tests. FR-MCP-011 is now verified; current Docker repetition remains separately unverified.

EP-06 NFR-UX-001 bidirectional-navigation correction (2026-07-13): acceptance audit found that Task-to-Skill lacked the reverse Skill-to-Task entry and Task-to-MCP focused only a Server rather than the exact Tool. Task inventory now has an exact `selected_skill_id` PostgreSQL/API filter; Skill focus opens that inventory in one click; Task MCP evidence carries `serverId` plus `toolName` into Tool focus. Typecheck and 3 files/59 tests pass, including an executed Skill click callback; unified `pnpm verify` passes 54 files/241 tests and all static/build gates. PostgreSQL assertions are implemented but unexecuted and real-browser/API navigation remains unavailable, so NFR-UX-001 correctly stays developing.

EP-07 NFR-PERF-001 acceptance reconciliation (2026-07-13): the SRS requires approximately 1–10 concurrent active Tasks, strict same-`context_id` serialization, and a stable concurrency test without conversation-state crossover; it does not prescribe Redis as the only test layer. Historical real Redis/BullMQ integration proves the production Worker/serializer path, while the current deterministic 10-context regression proves maximum activity 10, exact per-context order, and 20 unique uncrossed results in 2 files/12 tests. NFR-PERF-001 is now verified; the newer 20-Job Redis scenario remains a separately disclosed current Docker rerun gap.

EP-07 NFR-SEC-002 acceptance reconciliation (2026-07-13): the SRS requires encrypted MCP/Model credentials, a master key independent from the database, and no plaintext credentials in security inspection. EP-02 and EP-03 already passed real PostgreSQL and same-process E2E using production AES-256-GCM credential flows; current 5-file/50-test regression proves the cipher, environment key, both application boundaries, and credential-free management output, while unified `pnpm verify` remains 54 files/240 tests. NFR-SEC-002 is now verified; the newer direct raw-row decrypt assertions remain a clearly separated current Docker rerun gap.

EP-07 NFR-SEC-001 acceptance reconciliation (2026-07-13): the original acceptance requires explicit trusted-intranet/no-auth labeling and network-isolation items in the deployment checklist, not an OS namespace experiment. Loopback/fail-closed environment validation, A2A/management HTTP warnings, Console warning, README/security guidance, and the release firewall/no-public-database checks pass a 4-file/56-test regression; unified `pnpm verify` remains 54 files/240 tests. NFR-SEC-001 is now verified, while current Docker Server smoke remains a separate release-level gap.

EP-07 NFR-OBS-002 acceptance reconciliation (2026-07-13): the original acceptance is that A2A external output contains no hidden reasoning while management retains Prompt, displayable raw response, and structured decisions. Real loopback OpenAI/Anthropic contracts, Model Runtime, official A2A SDK projection, management HTTP, and Console regression pass 6 files/63 tests; current unified `pnpm verify` passes 54 files/240 tests. These directly exercise the privacy boundary without requiring persistence, so NFR-OBS-002 is now verified; the current PostgreSQL E2E rerun remains separately unverified.

EP-07 NFR-DATA-001 acceptance reconciliation (2026-07-13): the original SRS requires no automatic deletion task and reserved retention-policy fields; it does not require a long-running soak. EP-05 already passed migration 0045, real PostgreSQL CHECK/persistence, management HTTP, retained-Memory E2E, 30 integration/39 E2E, build, and smoke. Current domain/management/Console regression passes 3 files/49 tests and unified `pnpm verify` remains 54 files/240 tests. Current Docker rerun is classified separately, so NFR-DATA-001 is now verified.

EP-07 NFR-MNT-001 acceptance reconciliation (2026-07-13): the original SRS acceptance is specifically that A2A, MCP Transport, Model Provider, Storage, and Workflow Compiler module interfaces are unit-testable. Application-owned ports, injected substitutes, production adapters, and the sole LangGraph runtime satisfy that boundary. Focused substitution evidence passes 6 files/57 tests; the architecture guard passes across 165 TypeScript files and unified `pnpm verify` passes 54 files/240 tests. Docker-backed project-wide reruns are tracked separately and are not a requirement-specific prerequisite, so NFR-MNT-001 is now verified.

EP-07 NFR-REL-001/002 failure-boundary reconciliation (2026-07-13): NFR-REL-001 is verified from the historical real Redis/BullMQ queue-client restart, production PostgreSQL startup-failure transaction, Server pre-Worker composition, and no-checkpoint/no-MCP-replay E2E. NFR-REL-002 now has a direct integration assertion that a Worker failure after a representative side effect calls the processor exactly once and retains a failed Job with `attemptsMade=1`; format, lint, typecheck and unified `pnpm verify` (54 files/240 tests plus all static/build gates) pass, but Docker/Redis cannot execute the new scenario, so NFR-REL-002 remains developing.

Traceability reconciliation for FR-A2A-012 and FR-LLM-005 (2026-07-13): both stale developing rows are now verified from later real evidence. FR-A2A-012 has real A2A→PostgreSQL draft→management read/publication→dynamic Agent Card E2E with bypass rejection. FR-LLM-005 combines pgvector Skill metadata/metrics with stage-specific historical Experience and long-term Memory context while preserving the fixed LLM final-decision boundary and management audit visibility. Historical gates passed 29 integration and 35/37 E2E respectively; the current affected unit/contract regression passes 8 files/69 tests and current unified `pnpm verify` remains 54 files/240 tests. Current Docker-backed rerun is not claimed.

EP-02 FR-MCP-012 bounded exception-recovery increment (2026-07-13): confirmed Workflows can now offer the fixed `execution_decision` LLM stage immutable bounded choices for retry, prevalidated changed arguments, another registered Tool, an enabled Skill, or termination. The validator rejects semantic target mismatches, the model cannot invent a route, LangGraph remains the sole immutable executor, and per-action counters remove exhausted choices. Targeted DSL/model/compiler evidence passes (3 files/32 tests plus schema/management contracts), and unified `pnpm verify` passes with 54 files/240 tests, 165-file architecture enforcement, 102 management operations, 52 migration pairs, SBOM, and production builds. Docker-backed PostgreSQL/MCP/model E2E could not be rerun because container mutations still hang, so FR-MCP-011/012 remain developing.

EP-02 FR-MCP-008 automatic Tool enhancement increment (2026-07-13): registration now calls the fixed `tool_enhancement` Model Runtime stage for strict six-field metadata, fails atomically without fallback, preserves manual edits on refresh, and includes enhancement plus the original authoritative schema in Workflow planning. Migration 0053 adds the stage; a new static gate also found and fixed Server omission of migrations 0050–0052 and now verifies all 52 forward/rollback pairs. Unified `pnpm verify` passes with 54 files/230 tests, 165-file architecture guard, migration/OpenAPI/SBOM checks, and production builds. Docker mutation commands hang despite a readable Engine, so real PostgreSQL/MCP/model E2E and migration rollback remain unexecuted; FR-MCP-008 stays developing.

EP-07 NFR-COMP-001 A2A 1.0.1 increment (2026-07-13): the normative spec, official JavaScript SDK beta, and official TCK now have exact machine-checked tag/commit pins. The production HTTP endpoint preserves the 1.0.1 `application/a2a+json` media type while retaining `application/json` compatibility for the pinned TCK. The official HTTP+JSON/MUST run is 100% with 74 passed, 161 scoped skips, 0 failures/errors; direct contracts close the TCK's embedded-v1.0.0 patch gap. Unified `pnpm verify` passes with 54 files/227 tests and all static/build gates. FR-A2A-002 and NFR-COMP-001 are verified for V1 HTTP+JSON without claiming JSON-RPC/gRPC or stable-SDK coverage.

EP-07 NFR-MNT-001 modularity increment (2026-07-13): application-owned ports isolate A2A, MCP transport, Model Provider, PostgreSQL storage, and the sole LangGraph compiler/executor. The architecture guard now scans package source plus the Server composition root (164 TypeScript files) and rejects SDK leakage, infrastructure leakage, dynamic code, missing LangGraph, and known second-runtime dependencies. Unified `pnpm verify` passes with 54 files/225 tests and all static/build gates; existing injected tests cover every port. NFR-MNT-001 remains developing until the Docker-backed full EP gate is rerun.

EP-07 NFR-OBS-001 correlation increment (2026-07-13): the PostgreSQL-authoritative Task trace now has deterministic persisted links across Task state events, Plan confirmation, immutable Workflow instance/node events, model/MCP invocations, Goal Patch, and evaluation. Migration 0052 adds Plan `confirmation_task_id`/`confirmed_at` and Goal Patch `triggering_task_id`, closing the two indirect-only audit gaps. Verified locally: 65 targeted tests and unified `pnpm verify` with 54 files/225 tests plus all static/build gates green. PostgreSQL and Redis ports remain unreachable; rollback/persistence assertions and real API/browser E2E are unexecuted, so NFR-OBS-001 stays developing.

EP-07 NFR-SEC-002 credential-encryption increment (2026-07-13): single-process composition now creates one AES-256-GCM SecretCipher from required environment-only `SDAR_MASTER_KEY_BASE64` and injects it into both Model and MCP services. Real-cipher PostgreSQL assertions encrypt distinct bearer secrets, reject plaintext database storage, and authenticate/decrypt the envelopes; management/audit paths remain credential-free. Verified: 43 targeted tests plus unified `pnpm verify` with 54 files/224 tests and all static/build gates green. Database assertions and same-process E2E remain unexecuted while Docker is unavailable, so NFR-SEC-002 stays developing.

EP-07 NFR-SEC-001 trusted-network increment (2026-07-13): A2A and management listeners remain unauthenticated by requirement and default to loopback. Environment validation now fails closed for any non-loopback bind unless the operator explicitly acknowledges the no-auth trusted-network risk; the flag is documented as no substitute for authentication. README, security guidance, ADR, and release checklist require firewall isolation and no public PostgreSQL/Redis route. Verified: 50 targeted tests plus unified `pnpm verify` with 54 files/224 tests and all static/build gates green. Real server smoke and OS-level isolated-network evidence remain unavailable with Docker, so NFR-SEC-001 stays developing.

EP-07 NFR-PERF-001 context-concurrency increment (2026-07-13): BullMQ Worker default concurrency is now an explicit constant of 10, while every Job remains guarded by exact `context_id` serialization. Deterministic unit evidence drives ten contexts concurrently, queues ten same-context tails, proves maximum active work 10, per-context active count never above one, exact ordering, and no result crossover. Unified `pnpm verify` passes with 54 files/222 tests and all static/build gates. The isolated real Redis scenario emitted no output and timed out after 49 seconds while Docker/Redis remained unavailable; NFR-PERF-001 stays developing.

EP-07 NFR-DATA-001 retention-posture increment (2026-07-13): management health and Console now explicitly expose indefinite historical retention, disabled automatic archive/delete, advisory-only retention-day fields, and absence of a cleanup scheduler. Domain and PostgreSQL constraints continue to reject automatic cleanup; explicit administrator lifecycle operations remain distinct and audited. Verified: 48 targeted tests plus unified `pnpm verify` with 54 files/221 unit+contract tests and all static/build gates green. Docker-backed database/E2E and long-running no-deletion soak remain unavailable, so NFR-DATA-001 stays developing.

EP-07 NFR-OBS-002 reasoning-boundary increment (2026-07-13): OpenAI-compatible and Anthropic Messages adapters now discard undeclared private reasoning plus vendor thinking/signature blocks before Model Runtime audit. A2A SDK projection proves request metadata and internal Goal/Plan evidence do not escape, while management retains Prompt identity/version, rendered request, sanitized raw response, structured decision, Token and timing evidence. Verified: 48 targeted tests plus unified `pnpm verify` with 53 files/220 unit+contract tests and every static/build gate green. The same-process E2E assertion is implemented but Docker-backed E2E remains unavailable, so NFR-OBS-002 stays developing.

EP-07 NFR-PERF-002 node-duration increment (2026-07-13): Workflow terminal node events now own monotonic nonnegative duration evidence measured inside the sole LangGraph compiler, persisted by additive migration 0051, returned by management Trace, and displayed by Console replay. Existing rows remain valid with unknown duration. Verified: 36 targeted tests plus unified `pnpm verify` with 53 files/219 unit+contract tests, strict typecheck, lint, format, 160-file architecture guard, 102-operation OpenAPI drift, 17 source pins, Compose/bootstrap static checks, SBOM/licenses, and production build. `pnpm test:integration` emitted no output and timed out after 64 seconds; PostgreSQL persistence/rollback assertions and real timing E2E remain unverified, so NFR-PERF-002 stays developing.

EP-06 traceability reconciliation (2026-07-13): all FR-ADM-001..008 matrix rows now map to current implementation, test files, and acceptance reports instead of stale placeholders. Every row remains `开发中`, not `已验证`, because Docker-backed PostgreSQL/Redis, server smoke, and real API browser E2E evidence are still unavailable. This is an evidence correction only and does not raise the approximately 99% milestone estimate.

EP-06 Goal association update (2026-07-13): approximately 99%, still not accepted. Goal identity now opens its complete Task history through an exact `goalId` management filter backed by persisted `agent_task.goal_id`; Task/Workflow/Skill/MCP/model/Memory/Evaluation navigation remains identifier-authoritative. Verified: 56 targeted unit/contract/static-console tests, strict typecheck, architecture, 102-operation OpenAPI drift, format, and production build. The PostgreSQL Goal-filter assertion is implemented but unexecuted while Docker is unavailable. NFR-UX-001 association paths are functionally complete, but real API browser E2E and Docker-backed gates remain unverified.

EP-06 cross-object navigation update (2026-07-13): approximately 98%, still not accepted. Task traces now one-click into MCP Server, model Provider/model, and selected-Skill Evaluation; persisted MCP/model invocation and quality-trend Task IDs link back to Task, while Memory links back only from explicit `task:` source references. Non-Task references are ignored. Verified: 45 targeted management/static-console tests, format, lint, typecheck, and production build. NFR-UX-001 still needs an independent Goal association entry and real API browser E2E; Docker-backed gates remain unavailable.

EP-06 bidirectional navigation update (2026-07-13): approximately 97%, still not accepted. Task identities now one-click into their persisted Workflow Plan and selected Skill; Workflow Plans resolve and link back to the exact owning PostgreSQL Task through the new `planId` Task filter. React carries identifiers only and target panels reload authoritative API state. Verified: 52 targeted Task/management/static-console tests, format, lint, typecheck, architecture, 102-operation OpenAPI drift, and production build. NFR-UX-001 remains developing until Tool/model/Memory/Evaluation links and real API browser E2E pass; PostgreSQL integration remains unexecuted while Docker is unavailable.

EP-06 FR-ADM-008 completion correction (2026-07-13): approximately 97%, still not accepted. The original SRS audit showed that prior Evaluation KPIs omitted explicit MCP usage, model effects, capability growth, and automatic optimization suggestions. The domain-owned analytics snapshot now derives all four from exact Task-linked PostgreSQL invocation audits and immutable Experience/SkillVersion evidence. Suggestions are evidence-counted and advisory only. Verified: 42 targeted analytics/management/static-console tests, format, lint, typecheck, architecture, 102-operation OpenAPI drift, and production build. PostgreSQL integration is implemented but remains unexecuted; Docker-backed gates and real API browser E2E still block EP acceptance.

EP-06 acceptance audit update (2026-07-13): approximately 97%, not accepted. `pnpm verify` passes with 53 unit/contract files and 212 tests, architecture/OpenAPI/source-lock/Compose-static/SBOM checks, and production build. A real in-app browser renders and semantically navigates Overview, Tasks, Workflows, System Config, and Evaluation with persistent risk warnings and zero browser errors, but the backend is unavailable, so this is not real API E2E. Docker service calls time out without output; direct integration confirms ports 54329/56379 are unavailable, preventing 29 PostgreSQL tests and failing both Redis tests. Integration, E2E, server smoke, real API browser E2E, and trace consistency remain unverified; EP-06 stays open.

EP-06 evaluation dashboard update (2026-07-13): approximately 96%. Filtered PostgreSQL analytics now render operational sample/success, duration, cost, failure-distribution, Skill-version stability, and ordered quality-trend views, while preserving expandable raw evidence and the warning-only Skill policy. Empty selections render explicit no-evidence states rather than fabricated metrics. Verified: 42 targeted analytics/management/static-console tests, format, lint, typecheck, and production build. All planned EP-06 functional console surfaces are implemented; real browser accessibility/E2E, Docker-backed regression, and the complete EP gate remain open.

EP-06 system-policy CRUD update (2026-07-13): approximately 93%. System configuration now updates the Task wait timeout, Memory review/archive/delete values, and Skill evolution threshold through the existing validated management services. The console always submits automatic Memory archive/delete as disabled and keeps that invariant visible. Provider encryption, fixed stage routing, policy reads/writes, triggers, and sanitized model audits now form a real system-operations surface. Verified: 39 targeted management/static-console tests, format, lint, typecheck, and production build. Metrics presentation, real browser accessibility/E2E, Docker-backed regression, and the complete EP gate remain open.

EP-06 live Task inventory update (2026-07-13): approximately 90%. The operational console now discovers recent PostgreSQL Tasks with context/phase filters, opens a Task as the correlated trace root, and can refresh the Task plus linked Goal, Plan, Workflow node, model, MCP, result, inference, feedback, and evaluation evidence every two seconds. Refresh is read-only and cannot resume or mutate LangGraph execution. Verified: 57 targeted unit/contract/static-console tests, lint, typecheck, architecture, 102-operation OpenAPI drift, and production build. The filtered PostgreSQL assertion is implemented but not rerun because Docker startup remains hung; browser accessibility/E2E and the complete EP gate remain open.

EP-06 system/model operations update (2026-07-13): approximately 85%. Operators can now list credential-safe PostgreSQL Provider configurations and fixed model-stage routes, configure encrypted Providers, route every fixed stage explicitly, and inspect sanitized model invocation audits alongside Task wait, Memory retention, evolution policy, and evolution-trigger evidence. The console retains no operational source of truth and keeps no-auth, no-fallback, write-only credential, and disabled automatic-retention warnings visible. Verified: 41 targeted unit/contract/static-console tests, format, lint, typecheck, architecture, 101-operation OpenAPI drift, and production build. The new PostgreSQL list assertions are implemented but not rerun because Docker container start remains hung; browser E2E and the complete EP gate remain open.

EP-06 Skill Studio update (2026-07-13): approximately 78%. The console now covers natural-language Schema-constrained authoring, complete validated definition editing, persisted draft inspection/publication, candidate simulation and correction history, version history/diff/rollback, enable/disable, quality warnings, and all six Skill Graph relation types. All writes continue through existing validation, simulation, publication, and immutable-version boundaries. Console static-accessibility tests, strict typecheck, lint, format, and production build pass. Real browser E2E and Docker-backed regression reruns remain open, so FR-ADM-003 stays developing.

EP-06 Prompt/Memory/Evaluation console update (2026-07-13): approximately 68%. Operators can now create and inspect Prompt versions, effects, publication, rollback and disable actions; search/refine/read/supersede/invalidate globally shared source-linked Memory; and filter Evaluation analytics across Skill/version/provider/model/Server/Tool while viewing warning-only Skill quality signals. Static-accessibility checks prove these panels contain no fixed Prompt or Memory records, and the console keeps anonymous-memory and no-auto-disable risk messages visible. Strict typecheck, lint, format, and production build pass. Browser E2E, richer model/capability-growth dashboards, and Docker-backed reruns remain open.

EP-06 correlated Task trace update (2026-07-13): approximately 58%. Task is now the explicit navigation root for persisted Goal/Plan/Skill identity and linked runtime events, latest Workflow trace, processed results, input inference, quality/feedback/evolution, task-filtered model calls, and task-filtered MCP calls. LangGraph LLM/MCP ports now carry execution identity; the composition root resolves the persisted instance and Task-by-Plan so ordinary Workflow calls receive Task/context audit linkage. Missing in-progress artifacts render as errors rather than fake empty records; plan confirm/reject/revise actions reuse the authoritative lifecycle. Targeted unit and management contract suites, format, lint, typecheck, architecture, 99-operation OpenAPI drift, and production build pass. PostgreSQL assertions are implemented but not rerun because Docker container start remains hung; live refresh, session inventory, bidirectional links, and real browser E2E remain open.

EP-06 Workflow workbench update (2026-07-13): approximately 45%. A real Plan lookup now renders validated Workflow nodes/edges, supports restricted JSON DSL validation, creates immutable administrator DAG revisions, and confirms only the current awaiting Plan. A new application/API trace projection returns the PostgreSQL WorkflowInstance plus ordered displayable node events; the console replays those events without becoming an execution runtime. Verified: 11 targeted unit/UI static-accessibility tests, 30 management contracts, console production build, lint, typecheck, architecture invariants, and 96-operation OpenAPI drift gate. The new PostgreSQL list-event assertion is implemented but not rerun because Docker Compose still cannot start the stopped test containers; real UI E2E and cross-resource live trace remain open.

EP-06 MCP/Skill lifecycle update (2026-07-13): approximately 32%. The console now operates real MCP registration/discovery, refresh, health, credential rotation, Tool metadata, deletion, invocations, dependency warnings, and append-only operation history; Skill current versions can be enabled, disabled, inspected for history/warnings, and rolled back. PostgreSQL migration 0050 persists credential-safe anonymous-management evidence after Server deletion. Verified: 5 targeted unit, 31 real PostgreSQL/Redis integration, 29 management contract, console production build, format, lint, typecheck, architecture, and 95-operation OpenAPI drift gate. The extended real E2E is not counted as passing because Docker Compose orchestration hung twice before Vitest output.

EP-06 console foundation update (2026-07-13): approximately 20%. Exact-version React 19.2.7/Vite 8.1.4 dependencies passed OSS Intake and are isolated to `apps/console`. A strict-TypeScript production console now reads health, Skill, MCP, Task, Workflow, Memory, and Evaluation records only from real management APIs, displays the no-auth trusted-intranet warning, and is served at `/console` by the existing management listener in the same process. The management OpenAPI now covers all 94 implemented API operations and an automated gate rejects route drift or duplicate operation IDs. Targeted evidence passes: console production build, source-lock validation, license/SBOM generation, 28 management contract tests, lint, format, typecheck, YAML parsing, and OpenAPI drift validation. CRUD forms, DAG editing, complete linked trace/replay, and accessibility E2E remain open.

EP-02 alternative replacement update (2026-07-12): FR-SKL-013 now has a real failure-to-recovery path. Tasks persist the initial selection ID; a genuinely failed WorkflowInstance can be evaluated into an enabled alternative-only selection, immutable superseding plan, and mandatory confirmation boundary. The second confirmation resumes the same controller and replacement Skill. Full gate passes: format, lint, typecheck, architecture, 124 unit, 29 integration, 35 contract, 34 E2E, build, and smoke.

EP-02 evidence reconciliation update (2026-07-12): later EP-03/04 vertical evidence closes FR-SKL-001/002/003/005/012, and new fail-closed planning/execution checks close FR-SKL-004 with zero-MCP-call E2E. The full gate passes: format, lint, typecheck, architecture, 122 unit, 29 integration, 35 contract, 33 E2E, build, and smoke. The genuinely open EP-02 items are now explicit: FR-SKL-013 failure-driven alternative replacement, FR-SKL-014 automatic capability-gap Temporary Skill execution, and FR-SKL-015 simulation/publication completion in EP-05.

EP-02 Skill-call completion update (2026-07-12): FR-SKL-008/010/011 are now verified with real evidence. Formal Skills remain global across user identities. Each `skill_call` resolves the current enabled SkillVersion at execution time, creates a deterministic child plan authorized by the confirmed parent, executes it through the same LangGraph.js runtime, and persists an independent WorkflowInstance plus parent/node/version/evaluation linkage. The full gate passes: format, lint, typecheck, architecture, 120 unit, 29 integration, 35 contract, 32 E2E, build, and server smoke.

EP-04 Task-owned execution update (2026-07-12): FR-EXE-001 and FR-EXE-003 now have a real vertical path. Every submitted Task persists its selected Skill and generated immutable plan; ordinary Skills stop at confirmation, while explicit Skill policy can auto-confirm and execute. A2A synchronous and return-immediately requests converge on identical processed artifacts, and pause/resume remains inside the single controller execution. The complete implementation gate passes: format, lint, typecheck, 119 unit, 28 integration, 35 contract, 30 E2E, build, and server smoke.

EP-04 acceptance-audit update (2026-07-12): FR-EXE-002 is now verified through a shared A2A/management Task action path for confirm, reject, and immutable natural-language revision, with real A2A reads of management-produced state. The audit correctly keeps FR-EXE-001 and FR-EXE-003 open: the submitted A2A Task does not yet own a generated executable plan/auto-confirm path, and synchronous versus return-immediately execution lacks complete result-consistency evidence.

EP-04 missing-input inference update (2026-07-12): approximately 98%. Missing Goal input now triggers bounded retrieval of same-context conversation history, global pgvector memory, and existing processed results before a fixed structured LLM decision. Selected evidence snapshots and the displayable decision are persisted; reliable inference proceeds to planning while unreliable evidence returns one explicit A2A question. FR-GOAL-006 is verified. EP-04 requirement rows are implemented; final EP acceptance reconciliation remains before declaring the stage closed.

EP-05 global-memory foundation update (2026-07-12): approximately 12%. Domain-owned, source-traceable MemoryItems now persist in PostgreSQL/pgvector and are retrieved globally without user isolation through real management contracts. Cross-user local E2E verifies the trusted-intranet sharing baseline, so FR-MEM-001 is verified. Candidate admission/deduplication, conflict/version status, stage-specific retrieval, evaluation, and evolution remain open. FR-GOAL-006 can now consume a real long-term-memory source in the next EP-04 increment.

EP-04 capability-gap update (2026-07-12): approximately 95%. A fixed Goal-evaluation capability gap now transitions the bound PostgreSQL-authoritative Task to `capability_gap`, persists the missing capability and suggested tool contract, publishes an audit event, and projects actionable `INPUT_REQUIRED` evidence through the official A2A SDK path without starting another node. FR-RST-006 is verified. The remaining EP-04 P0 gap is inference-before-input-required (FR-GOAL-006).

EP-04 Goal-evaluation update (2026-07-12): approximately 90%. Every terminal Workflow round now enters a fixed structured Goal evaluation. Explicit achieved/input/plan-adjustment/Skill-replacement/additional-Skill/capability-gap/unachievable actions persist their displayable evidence; planning actions create immutable versions outside LangGraph while waits start no new node. FR-RST-004/005 are verified. Remaining EP-04 gaps are inference-before-input-required and A2A Task capability-gap projection.

EP-04 Result Processor update (2026-07-12): approximately 82%. MCP outputs now enter downstream nodes through a normalized/trimmable domain envelope. A dedicated fixed model stage follows immutable Skill output instructions, produces paired text/structured output, and persists schema-validated facts, value assessment and memory candidates. FR-RST-001/002/003 are verified. Remaining EP-04 gaps are inference-before-input-required and complete Goal-evaluation decision/capability-gap handling.

EP-04 Goal-cancellation update (2026-07-12): approximately 74%. A2A or management cancellation now controls every active in-process Workflow using immutable Skill policies, then atomically cancels the Goal and all nonterminal shared Tasks, invalidates plans, terminates residual instances and records evidence without compensation. Terminal Task state cannot be resurrected by a stale Worker. FR-GOAL-008 is verified. Remaining EP-04 gaps are inference-before-input-required and Result Processor/evaluation decision completeness.

EP-04 Goal-continuity update (2026-07-12): approximately 67%. All same-context Tasks now reuse the PostgreSQL-authoritative active Goal. After terminal Goal completion, the fixed `goal` stage decides related-successor versus unrelated-new, and the new Goal plus displayable relationship evidence is atomic and queryable. FR-GOAL-001/002 are verified. Remaining EP-04 gaps are inference-before-input-required, explicit Goal cancellation and Result Processor/evaluation decision completeness.

EP-04 execution-control update (2026-07-12): approximately 58%. Task pause now reaches a native LangGraph interrupt after the active node and before the next; short resume uses the same checkpoint without replay, while an exceeded Skill threshold creates a new awaiting-confirmation plan outside the graph. Running cancellation applies the immutable Skill strategy, propagates AbortSignal when requested, persists policy evidence, starts no later node and never auto-compensates. FR-EXE-004/005/006 are verified. Remaining EP-04 gaps are multi-Task Goal continuity/relevance, inference-before-input-required, Goal cancellation and Result Processor/evaluation decision completeness.

EP-04 wait-timeout update (2026-07-12): approximately 41%. Plan-confirmation and supplementary-input waits now share one PostgreSQL-managed timeout. A same-process idempotent scanner atomically cancels overdue Tasks with `TASK_WAIT_TIMEOUT` and a runtime event; management can read/update the policy, and real A2A e2e verifies expiry. FR-GOAL-007 is verified. Real running-node pause/resume/cancel strategies remain the next lifecycle gap.

EP-04 Goal Patch update (2026-07-12): approximately 34%. Fixed-stage structured patches now increment the PostgreSQL-authoritative Goal version and atomically invalidate every old plan, Workflow instance, Task binding, confirmation and result. A2A and management paths generate the next immutable plan outside LangGraph, always require fresh confirmation, and expose compensation guidance or explicit no-auto-compensation warnings. FR-GOAL-003/004/005 and FR-EXE-007 are verified; general pause/cancel/timeouts and remaining Goal lifecycle/result requirements remain open.

EP-04 process/queue update (2026-07-12): approximately 18%. Server startup now atomically fails executing/paused/evaluating Tasks and running/paused Workflow instances with `PROCESS_EXECUTION_LOST` before starting the Worker; it never reconstructs checkpoints or retries calls. BullMQ remains attempts=1/maxStalledCount=0, and real Redis integration proves queued work survives queue-client restart. FR-EXE-008/009/010 are verified; Goal Patch, general pause/cancel policies, timeouts and integrated task execution remain open.

EP-03 Provider breadth update (2026-07-12): core EP-03 scope is approximately 99%. Provider kind is now separated from persisted API wire style; OpenAI-compatible cloud/local and non-OpenAI Messages adapters share one domain-neutral port. Real loopback contracts and same-process other-vendor Skill authoring/audit pass, including explicit unsupported-embedding failure. FR-LLM-001 is verified. Remaining FR-LLM-005 Experience/Memory context and FR-LLM-007 automatic Prompt candidates are intentionally implemented and closed with EP-05 evidence rather than falsely closing them in EP-03.

EP-03 final-decision update (2026-07-12): approximately 97%. Intent, Goal, Skill selection, Workflow generation, execution-exception strategy and Goal evaluation now use fixed schema-constrained Model Runtime stages. The real queue path persists LLM-formulated Goals and selections; candidate metadata joins pgvector/metrics; unavailable decision models fail the Task without fallback. Real local-model and stopped-MCP e2e pass. FR-LLM-004 is verified; FR-LLM-001 provider breadth and FR-LLM-005/007 EP-05 memory/evolution portions remain open.

EP-03 human-confirmation update (2026-07-12): approximately 93%. The DSL node now uses native LangGraph interrupt/Command resume, persists paused instance and displayable prompt state in PostgreSQL, preserves budgets/events, and fails rather than replaying when its ephemeral checkpoint is lost. A real MCP-before-confirmation e2e proves exactly one Tool call across resume. FR-WF-002 is verified; general user pause/cancel and long-pause replanning continue in EP-04.

EP-03 plan revision update (2026-07-12): approximately 88%. Natural-language A2A and administrator DSL/DAG edits now share strict validation, create immutable next versions, atomically supersede the source and always require fresh confirmation. Real Task-to-plan binding, PostgreSQL lineage, management contracts, and same-process A2A/admin execution e2e pass. FR-WF-010 is verified; the remaining principal EP-03 gap is persisted in-graph human confirmation/pause-resume.

EP-03 outer Goal loop update (2026-07-12): approximately 80%. A PostgreSQL-authoritative controller now executes one immutable plan per round, validates fixed-stage structured Goal evaluations, creates the next Workflow version only outside LangGraph, pauses ordinary replans for confirmation, auto-confirms only when every named Skill opts in, tracks all rounds, updates terminal Goal status, and fail-closes at `maxReplans`. Real model + real MCP e2e completes two versions and reaches achieved. FR-WF-008/009 are verified; remaining EP-03 gaps are live human interrupts and plan editing.

EP-03 Workflow budget update (2026-07-12): approximately 78%. System defaults and current enabled Skill overrides resolve to an immutable per-instance budget; composed Skills use the most restrictive effective limits. LangGraph enforces duration, LLM/MCP counts and configured accounted cost before external calls, including parallel branches, while the outer controller now enforces `maxReplans`. PostgreSQL stores selected Skill versions, limits, usage and termination. FR-WF-009 is verified.

EP-03 LangGraph execution update (2026-07-12): approximately 65%. Confirmed plans are revalidated, cloned/frozen, compiled by the sole LangGraph.js runtime, and persisted as immutable Workflow instances with ordered node events. All ten DSL node kinds have compiler execution tests; a same-process e2e proves unconfirmed MCP blocking, real MCP execution after confirmation, and corrected-plan confirmation inheritance without a second prompt. Live human pause/resume, outer replanning, A2A task orchestration, and plan editing remain open.

EP-03 Workflow planning update (2026-07-12): approximately 58%. Fixed-stage Model Runtime now generates Schema-constrained DSL, persists every candidate/error, auto-corrects within a bound, and saves immutable validated/failed plans. Initial plans remain awaiting confirmation; repository-confirmed repaired plans now execute directly through the LangGraph compiler without redundant confirmation.

EP-03 Workflow DSL validation update (2026-07-12): approximately 55%. Ten whitelisted node kinds and restricted expressions are domain-owned and serializable; validation covers structure, references, reachability, bounded loops, current MCP Tool arguments, and current Skill inputs. Planner correction, persistence, LangGraph compilation, immutable execution, and real MCP execution are now connected; wider control-loop behavior remains open.

EP-03 Prompt lifecycle update (2026-07-12): approximately 28%. Prompt versions are PostgreSQL-authoritative, immutable, stage-scoped, publishable/disableable/rollbackable, linked to real model invocations, and expose success/failure/latency/Token effects. AC-15 candidate-before-publish behavior passes e2e. Automatic candidate generation from failures/evaluations remains EP-05 work.

EP-03 Model Runtime update (2026-07-12): approximately 18%. PostgreSQL Provider configurations and fixed stage routes, AES-GCM credentials, OpenAI-compatible/local structured and embedding HTTP calls, sanitized invocation audit, token/duration capture, timeouts, and no-fallback failure semantics are implemented. Real local HTTP, PostgreSQL, and same-process e2e pass; Prompt versions and remaining decision stages/Workflow DSL remain open.

EP-02 pgvector selection update (2026-07-11): approximately 84%. Current enabled SkillVersion content is projected into PostgreSQL pgvector, provider/dimension drift fails closed, real cosine scores join persisted operational metrics, and only a separately injected decider can make the final selection. Unit, real PostgreSQL integration, and same-process e2e pass. Production embedding/model adapters and invocation audit remain EP-03 gaps.

EP-02 Skill authoring update (2026-07-11): approximately 79%. Structured model output is shape-checked, both generated Schemas are Ajv-validated and explicit, invalid output receives one bounded correction attempt, and failure persists no fallback Skill. PostgreSQL/Agent Card e2e uses an injected simulated provider; a production ModelProvider adapter, stage routing, Prompt versions, and invocation audit remain EP-03 gaps.

EP-02 Temporary Skill update (2026-07-11): approximately 74%. Task-scoped Temporary Skills are isolated from the formal registry, validate live MCP Tool references, expire into PostgreSQL Experience records, and produce only an `awaiting_simulation` candidate after two equivalent successes. Unit, integration, contract, and real same-process e2e pass. Automatic capability-gap generation/execution and EP-05 simulation/publication remain open.

EP-02 selection update (2026-07-11): approximately 68%. Candidate metric snapshots, LLM decision boundary, persistent selection evidence, and confirmation-bound alternative plans are implemented with simulated decider tests and real PostgreSQL persistence. Production ModelProvider/e2e remains open.

EP-02 graph update (2026-07-11): approximately 60%. The six-relation Skill Graph is domain-owned, persisted, cycle-checked, exposed through management API, and verified with real e2e. Selection, temporary Skills, LLM generation, and Console remain open.

EP-02 lifecycle update (2026-07-11): approximately 52%. MCP remote health/credential rotation and Skill version list/diff/rollback APIs are verified. Remaining core gaps are LLM Schema/metadata generation, Skill graph/search/selection, temporary Skills, and Console.

EP-02 management update (2026-07-11): approximately 45%. Same-process MCP/Skill management HTTP API, OpenAPI contract, trusted-intranet risk markers, and real e2e CRUD are implemented. Console, LLM generation, Skill graph/search/temporary Skills remain open.

EP-02 audit update (2026-07-11): approximately 38%. MCP invocation traces, persistent Skill dependency warnings, and editable refresh-stable Tool enhancement metadata are implemented. Management API/console and LLM-driven enhancement/failure decisions remain open.

EP-02 update (2026-07-11): approximately 30%. Persistent Skill Registry and remote MCP register/refresh/delete/call with AES-256-GCM credentials pass real integration, official SDK contract, and single-process e2e tests. Remaining: LLM Schema/metadata generation, Skill graph/search/temporary Skills, persisted warnings/audits, and management API/console.

更新时间：2026-07-11 19:04 +08:00

| 阶段                           | 状态   | 完成度 | 最近证据                                                                                          | 阻塞                                                                                  |
| ------------------------------ | ------ | -----: | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| EP-00 仓库与兼容性基线         | 已完成 |   100% | `pnpm verify:bootstrap` 16/16；`pnpm smoke:infra`：pgvector 0.8.4、migration、Redis PONG/写读通过 | 当前目录缺少 Git 元数据，无法提供 Conventional Commit 证据                            |
| EP-01 协议与领域骨架           | 进行中 |    94% | 生产断流继续/轮询/resubscribe 已验证；FR-A2A-001/004/005 已关闭；e2e 5/5                          | 精确 1.0.1 标签、持久化 SkillVersion schema/Card provider、管理端草案查看为跨 EP 缺口 |
| EP-02 MCP 与 Skill 基础        | 进行中 |    15% | Skill/SkillVersion、原子版本仓储、发布门禁、动态 Agent Card 与权威结果 Schema 已接通              | MCP Registry、LLM Schema 生成、Skill 图谱/检索与管理 API                              |
| EP-03 Workflow 规划与运行时    | 未开始 |     0% | -                                                                                                 | -                                                                                     |
| EP-04 任务生命周期与 Goal 闭环 | 未开始 |     0% | -                                                                                                 | -                                                                                     |
| EP-05 记忆、评估与演化         | 已完成 |   100% | 152 unit、46 contract、31 integration、40 E2E、build、server smoke；EP-05 audit 通过              | 生产模型语义质量仅模拟；完整 Console/全 AC 报告由 EP-06/07 完成                       |
| EP-06 控制台与可观测性         | 未开始 |     0% | -                                                                                                 | -                                                                                     |
| EP-07 加固与完整验收           | 未开始 |     0% | -                                                                                                 | -                                                                                     |

## 当前目标

将 A2A official SDK endpoint 接入 TaskService/PostgreSQL/BullMQ，覆盖 submit/query/list/cancel/stream/default metadata。

## 最近完成

- 已建立需求基线和 Codex 项目任务包。
- 已启动 Codex Goal，完整核对原始 SRS（226 个段落、38 张表）、DoD、追踪矩阵与 EP-00 前置材料。
- 已确认 A2A SDK 稳定通道仍为协议 v0.3，v1.0 支持需使用 beta 并进行 1.0.1 契约验证。
- 已建立 strict TypeScript pnpm workspace；`pnpm verify:bootstrap` 的 format、lint、typecheck、10 tests 和 build 全部通过。
- 已完成直接依赖与八个参考项目的 intake/pin；MCP 真实 loopback 和 LangGraph 真实执行 Spike 通过，A2A wire fixture 模拟验证通过。
- 已完成 A2A 官方 REST/streaming loopback endpoint、协议版本拒绝和 MCP 远端取消传播契约。
- 已完成 digest-pinned Compose、pgvector migration/rollback、CycloneDX SBOM、266 个 npm 包许可证清单和第三方通知；统一门禁为 16/16 tests。
- 已验证 A2A 客户端断流不终止任务且可轮询完成，以及 LangGraph 并行汇聚与 compiled subgraph。

## 当前风险

- A2A JavaScript SDK 对 1.0 的支持可能使用 beta 渠道，必须先做兼容性 Spike。
- 首版范围很大，必须坚持垂直增量和证据门禁，避免先搭空平台。
- 当前目录不是 Git 工作树，暂时无法提供 Conventional Commit 证据。
- Docker 阻塞已在恢复环境中解除，真实基础设施 smoke 通过；外部 A2A TCK 移交 EP-01。
- EP-01 已建立领域权威 Task/Context/Goal、application ports/TaskService 和自动 architecture boundary gate。
- EP-01 已完成真实 PostgreSQL Repository/migration、Redis/BullMQ context 串行队列和可重建 A2A 协议投影；专用 integration runner 6/6 通过。
  EP-02 automatic Temporary Skill execution update (2026-07-12): FR-SKL-014 is verified. A fixed structured model decision selects only from enabled registered MCP Tools, creates an exclusive Task-scoped Temporary Skill, generates validated Workflow DSL, waits for confirmation, executes exactly once through LangGraph/MCP, then expires and records Experience without changing formal Skills or Agent Card. Full gate passes: format, lint, typecheck, architecture, 127 unit, 29 integration, 35 contract, 35 E2E, build, and smoke.
  EP-05 Temporary Skill evolution update (2026-07-12): FR-SKL-015 is verified. Repeated successful Experience now triggers a fixed structured induction report and persisted evolution draft; static, historical, normal, boundary and exception cases are individually auditable. Any failure leaves the formal registry unchanged; all-pass system candidates publish an enabled `experience_evolution` version and update Agent Card. Full gate passes: format, lint, typecheck, architecture, 129 unit, 29 integration, 36 contract, 35 E2E, build, and smoke. Broader FR-EVO-004/005/007 work remains open.
  EP-05 authoritative Experience update (2026-07-12): FR-EVO-001 is verified. Every evaluated controller round now persists a source-linked replay unit containing Goal, immutable Workflow DSL, actual Skill versions, direct MCP Tools, input, result/errors, structured evaluation and duration. Management queries expose Goal/Skill histories; real confirmed LangGraph/MCP E2E proves collection without publishing a Skill. Full gate passes: format, lint, typecheck, architecture, 130 unit, 29 integration, 37 contract, 35 E2E, build, and smoke. Historical re-execution remains FR-EVO-005.
  EP-05 configurable evolution threshold update (2026-07-12): FR-EVO-002 is verified. The global repeated-success threshold is PostgreSQL-authoritative, validates a minimum of two, and changes without restart through management HTTP. Every successful Temporary Skill Experience records count, configured threshold and trigger decision; real E2E proves threshold three blocks the first two inductions and permits only the third. Full gate passes: format, lint, typecheck, architecture, 132 unit, 29 integration, 38 contract, 35 E2E, build, and smoke.
  EP-05 induction-report reconciliation (2026-07-12): FR-EVO-003 is verified. The fixed structured model receives source Experiences/contracts plus current formal Skill summaries and persists consistency, stability, generalizability, duplicate identity/score and a displayable decision summary. Full gate passes: format, lint, typecheck, architecture, 132 unit, 29 integration, 38 contract, 35 E2E, build, and smoke; production-model semantic quality remains explicitly simulated.
  EP-05 capability-boundary evolution update (2026-07-12): FR-EVO-004 is verified. Structured induction now declares new Skill versus existing Skill version, target identity and a displayable boundary reason. Application checks reject contradictory or nonexistent targets before mutation. Unit evidence covers both publication branches; real MCP-backed E2E proves an existing Skill advances v1→v2 without increasing formal Skill count. Full gate passes: format, lint, typecheck, architecture, 134 unit, 29 integration, 38 contract, 35 E2E, build, and smoke.
  EP-05 historical simulation update (2026-07-12): FR-EVO-005 is verified. Candidate validation now separates source records from actual Tool-related historical Experience replay, executes saved successful and failed immutable Workflows through the single LangGraph executor, compares observed versus recorded outcome class, and persists those cases with static and model-supplemented normal/boundary/exception results. Side-effecting replay requires isolated safe Tool endpoints as documented in ADR-050. Full gate passes: format, lint, typecheck, architecture, 134 unit, 29 integration, 38 contract, 35 E2E, build, and local server smoke.
  EP-05 all-pass publication update (2026-07-12): FR-EVO-006 is verified. One failed simulation now has explicit real local E2E evidence: the complete candidate is retained as `validation_failed`, the failed normal case is visible, no published identity is assigned, and an existing Skill remains exactly at versions v1/v2 with no v3 current-version mutation. ADR-046 remains the governing publication decision. Full gate passes: format, lint, typecheck, architecture, 134 unit, 29 integration, 38 contract, 35 E2E, build, and local server smoke.
  EP-05 manual correction update (2026-07-12): FR-EVO-007 is verified. Failed candidates can be corrected and fully revalidated through management HTTP; PostgreSQL records operator-supplied actor, summary, immutable before/after snapshots, JSON-pointer diff, complete result and outcome as correction Experience. Real local E2E proves failed v2 draft → corrected Schema → all-pass v3 plus history readback. Actor authenticity remains explicitly unverified under the no-auth V1 baseline. Full gate passes: format, lint, typecheck, architecture, 135 unit, 29 integration, 38 contract, 35 E2E, build, and local server smoke.
  EP-05 source-governed publication update (2026-07-12): FR-EVO-008 is verified. System Experience evolution retains automatic all-pass publication; A2A create/update requests remain PostgreSQL drafts outside Agent Card, direct `a2a_draft` authoring/registration is fail-closed, and only the dedicated management route authors/registers the draft and records publisher plus SkillVersion. Real A2A/management/Agent Card E2E passes. Publisher authenticity is not claimed under V1 no-auth. Full gate passes: format, lint, typecheck, architecture, 136 unit, 29 integration, 39 contract, 35 E2E, build, and local server smoke.
  EP-05 quality-warning update (2026-07-12): FR-EVO-009 is verified. Immutable version-specific quality observations trigger deterministic consecutive-low-score and rising-failure-rate warnings with source evidence. The service has no mutation dependency; real E2E proves the warned Skill remains the same enabled v1 and stays in Agent Card. Normalized score ingestion is real while production evaluator calibration remains simulated pending broader FR-EVAL work. Full gate passes: format, lint, typecheck, architecture, 137 unit, 29 integration, 40 contract, 36 E2E, build, and local server smoke.
  EP-05 Workflow-template update (2026-07-12): FR-EVO-010 is verified. Three matching successful Experiences induce a source-linked versioned template; exact or lexically similar tasks prefer it as planning data while full DSL validation, immutable new plan identity and confirmation remain mandatory. PostgreSQL tracks template source/version and per-use success/failure/duration; real A2A E2E proves fourth-task reuse and metrics. Full gate passes: format, lint, typecheck, architecture, 139 unit, 29 integration, 41 contract, 37 E2E, build, and local server smoke.
  EP-05 refined-memory update (2026-07-12): FR-MEM-002 is verified. Complete raw Task/Workflow/result/Experience evidence remains PostgreSQL-authoritative while only valuable strict-model candidates enter durable Memory as normalized structured statements with Task/ProcessedResult provenance. Automatic and administrator submissions share duplicate suppression; management no longer exposes direct creation. Full gate passes: format, lint, typecheck, architecture, 141 unit, 29 integration, 41 contract, 37 E2E, build, and local server smoke.
  EP-05 stage-memory update (2026-07-12): FR-MEM-003 is verified. Intent, Skill selection, Workflow generation, exception handling and Goal evaluation now use distinct query templates and domain Memory-type allowlists over the shared PostgreSQL/pgvector store. Source-linked hits and scores enter the existing fixed model requests and invocation audit. Full gate passes: format, lint, typecheck, architecture, 142 unit, 29 integration, 41 contract, 37 E2E, build, and local server smoke.
  EP-05 Memory-lifecycle update (2026-07-12): FR-MEM-004 is verified. Refined replacement creation, old active→superseded projection and append-only actor/reason audit are one PostgreSQL transaction; invalidation is one-way and conflict-safe. Historical content remains addressable while only active rows are retrieved. Full gate passes: format, lint, typecheck, architecture, 143 unit, 29 integration, 41 contract, 37 E2E, build, and local server smoke.
  EP-05 evolution-memory update (2026-07-12): FR-MEM-005 is verified. Skill/Prompt manual corrections, Task failure reasons and Goal evaluation conclusions now project after their authoritative write through strict model refinement into source-linked `skill_learning`, `prompt_learning`, success or failure Memory. Real E2E retrieves all four source classes. Full gate passes: format, lint, typecheck, architecture, 143 unit, 29 integration, 41 contract, 38 E2E, build, and local server smoke.
  EP-05 Memory-retention update (2026-07-12): FR-MEM-006 is verified. PostgreSQL and management API expose review/archive/delete periods and automatic-action flags; domain and DB reject enabling automatic cleanup in V1, and no scheduler/worker exists. Real E2E proves policy changes retain Memory. Full gate passes: format, lint, typecheck, architecture, 144 unit, 30 integration, 42 contract, 39 E2E, build, and local server smoke.
  EP-05 Task-quality update (2026-07-13): FR-EVAL-001 is verified. Completed formal and Temporary Skill Tasks now run five strict Goal/Workflow/Skill/result/Tool evaluations over replayable evidence, deterministically aggregate one report and persist Task/Goal/Workflow/ProcessedResult links. Real E2E reads all five components and evidence references. Full gate passes: format, lint, typecheck, architecture, 145 unit, 30 integration, 43 contract, 39 E2E, build, and local server smoke.
  EP-05 implicit-feedback update (2026-07-13): FR-EVAL-002 is verified. Accepted-result successors, continued plan modification, normalized repeated submissions, English/Chinese redo requests and failure-driven Skill switches now persist source/trigger Task links with fixed confidence 0.35 and management retrieval. Real local E2E covers modification and switching; deterministic tests cover all five classes. Full gate passes: format, lint, typecheck, architecture, 147 unit, 31 integration, 44 contract, 39 E2E, build, and local server smoke.
  EP-05 Evaluation-influence update (2026-07-13): FR-EVAL-003 and the remaining FR-LLM-007 automatic-generation gap are verified. Every TaskQualityReport now has one PostgreSQL influence record linked to replayable Experience; formal Skill observations cite it, only passed reports enter Workflow Template occurrence evidence, and low-quality reports generate strict stage-mapped inactive Prompt candidates without changing current Prompt. Real local E2E proves all three paths. Full gate passes: format, lint, typecheck, architecture, 150 unit, 31 integration, 45 contract, 40 E2E, build, and local server smoke.
  EP-05 Evaluation-analytics update (2026-07-13): FR-EVAL-004 is verified. Management analytics now derive success, duration, budget cost, failure classes, version stability and ordered quality trend from immutable PostgreSQL evidence, with Skill/version/provider/model/Server/Tool filters and explicit model invocation Task linkage. Real E2E covers model and MCP Tool filters. Full gate passes: format, lint, typecheck, architecture, 152 unit, 31 integration, 46 contract, 40 E2E, build, and local server smoke.
  EP-05 warning-control reconciliation (2026-07-13): FR-EVAL-005 is verified using the existing ADR-053 boundary. Warning evaluation remains read-only with respect to Skill state; real E2E now proves the warned v1 remains enabled until explicit administrator disable creates v2, and rollback creates enabled v3. Existing correction/revalidation E2E proves the separate manual correction path. Full gate passes: format, lint, typecheck, architecture, 152 unit, 31 integration, 46 contract, 40 E2E, build, and local server smoke.

## Current authoritative stage status (2026-07-13)

## UGV SMPP simulation coordinate update (2026-08-17)

The Runtime now keeps physical confirmation separate from Provider execution mode and freezes the
simulation context through Capability admission, Skill readiness and Workflow execution. Exact
Task Type IDs participate in the static index, and Goal Contract retries receive validation
evidence. Focused regressions and typecheck cover these paths. The latest coordinate A2A retry
passed reviewed Goal and Skill Goal boundaries but stopped before Workflow Plan creation because
the real Provider returned `UGV_MQTT_UNAVAILABLE` from frozen availability under simulation mode.
No MCP Tool invocation or movement occurred; UGV overall qualification remains blocked.

EP-05 Memory, Evaluation, and Evolution is complete (100%). The independent stage audit verifies FR-EVO-001–010, FR-MEM-001–006, FR-EVAL-001–005, related FR-SKL-015/FR-LLM-007 closure, migrations through 0049, and the full local gate. The legacy bootstrap table above is retained as historical text and is superseded by this status plus `reports/EP-05-memory-evaluation-evolution/EP-05-ACCEPTANCE-AUDIT.md`. Overall V1 remains incomplete pending EP-06 Console and EP-07 project-wide acceptance.

## SDAR v1.3 P04 Pattern Generalization and Plan Template Candidate Compiler (2026-07-28)

SDAR v1.3 P04/G07-G08 Pattern Generalization and Plan Template Candidate Compiler is complete on
`feature/v1.3-sequential-implementation` at commit `e4e2992`. P03 Handoff (e926445) was consumed;
3 produced contracts (FusedPattern, GeneralizedPattern, CandidateStaticValidationResult) and 3
consumed contracts (WorkflowPattern, CompiledArtifact, PlanTemplateArtifactDefinition) match
`CONTRACT-LOCK.json`. The implementation fuses P03 structural facts with optional LLM semantic
candidates (structural facts never overwritten), generalizes with 5 anti-overfitting rules, and
compiles evidence-only Plan Template candidates with `status=candidate`, `executable=false`, 7-input
SHA-256 fingerprint, and 8-check static validation (`passed_static` ≠ promotion). Migration 0127
adds 5 non-authoritative child tables; the wake-only BullMQ worker does not emit events. The domain
layer is free of `node:crypto` (hash computation moved to application layer per ADR-119). Full
`pnpm verify` passes 7/7 steps on a clean self-managed-compose database: 841 unit/contract, 100
integration, 62 E2E, 20 migrations through 0127, architecture, build, and smoke. Review 1 self-audit
concludes 0 Blocking / 0 Major / 0 Minor; the final ACCEPTED verdict is
`PENDING_USER_CONFIRMATION`. P05 Handoff is emitted. Draft PR #12 remains OPEN and unmerged.

## SDAR v1.3 P12 Management API, Console and A2A Integration (2026-07-30)

P12/G21 is complete on `feature/v1.3-sequential-implementation`. Optional authenticated Management
composition exposes tenant-scoped Artifact/evidence/runtime queries and audited governance commands
without changing P02-P11 authorities. The Console uses the real API; A2A adds only a feature-gated
safe extension; SSE is a bounded resumable PostgreSQL Outbox projection. Independent review
findings covering runtime SQL, event aliases/tenant derivation, IDOR, filters, feature-off,
promotion audit and redaction were repaired and regression tested.

# UGV Benchmark 联调进行中（2026-08-26）

用户批准被动评价接入。当前已落首批代码与定向回归，尚未完成部署、Provider v2
handoff/持久化验证或真实启动；外部 ClickHouse 专用用户及精确授权需单独确认。
未执行新 live 迁移、服务重启、Run/Task 或设备调用。见
`execplans/EP-UGV-BENCHMARK-DEBUG.md`；现有项目完成状态不因此上调。
