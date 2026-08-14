# EP-SDAR-UGV-SMPP-INTEGRATION

## Purpose / Outcome

Integrate SDAR with one externally deployed UGV-only SMPP through the frozen SDAR Registry
projection and governed Node Control/Runtime authorities. The intended observable path is A2A Task
Understanding → Goal/Plan → exact Skill/Capability → current MCP Provider Binding → frozen remote
MCP Task → UGV Runtime, with deterministic read-only qualification first and every physical write
default-closed, explicitly confirmed, remotely observed to terminal state, and restart-safe without
duplicate dispatch.

This plan executes `.codex/goal-sdar-ugv-smpp-integration/CODEX_WORK_PROMPT.md`. The external
`sdar-mcp-provider-platform`, simulator, UGV Adapter and UGV Runtime are read-only dependencies and
are never edited or redeployed by this repository.

## Requirements Covered

- S0-S2 / Gates A: execution-time baseline, external preflight, Source synchronization, projection
  and native lineage, 200/304/LKG/expiry/checksum behavior.
- S3-S5 / Gates B-C: generic Provider materialization, exact Binding and live Catalog authority,
  schema-driven Capability/Skill governance with fire execution disabled.
- S6-S9 / Gates D-G: zero-model/zero-write deterministic reads, generic `managed_capability`
  Task Understanding, real Model Provider conformance and real A2A read-only lineage.
- S10-S16 / Gates H-K: default-closed real-control policy, explicit Plan Confirmation, bounded
  movement, remote pause/resume/cancel, emergency stop, outage/restart reconciliation and one
  side-effect dispatch.
- S17-S19 / Gate L: repeatable deployment profile, focused/full regression, security, reports,
  traceability and secret-free delivery ZIP/SHA/patch.

## Context and Orientation

- Base and `origin/main`: `b8fc6c20b95114007eab86305aa4e34863f1334d`.
- Branch: `codex/sdar-ugv-smpp-integration`, created directly from that base.
- Existing authorities to reuse: `NodeControlSmppRegistryService`, Candidate Directory,
  `NodeControlMcpProviderBindingService`, Runtime frozen MCP Registry/Catalog, Remote Task Binding
  and continuation, Capability/Skill governance, A2A adapter and canonical evidence.
- Existing special cases are in `apps/node-control-acceptance/src/home-lab-*` and
  `apps/server/src/home-lab-*`. They are regression inputs, not templates for a UGV clone.
- PostgreSQL remains the system of record, Redis/BullMQ remains rebuildable scheduling state, and
  LangGraph.js remains the only Workflow executor.

## Architecture and Interfaces

Node Control owns SMPP Source/Snapshot/Candidate, Provider Binding, Capability Definition and
Implementation Binding state. Runtime owns live MCP Server/Tool Catalog, MCP invocation, Remote
Task/observation/continuation, Task/Goal/Plan/Workflow, Skill Version and terminal outcome state.
External projection/MCP SDK values are validated and mapped inside their adapters; they do not
cross into Domain as SDK types.

The generic materialization increment will select one exact
`smppSourceId + externalProviderId + externalServerId` tuple, reconcile one local Runtime MCP
Server, obtain the live frozen Catalog, and import/reconcile one current Provider Binding. Its
report is redacted orchestration evidence only and never a second authority. The generic
Capability/Skill bootstrap will derive exact immutable contracts from the current Binding and live
Catalog and publish only through existing governance services.

`managed_capability` will configure `GenericTaskUnderstandingService`, `CognitiveEntryRouter`,
normal Skill/Capability authority and the existing Planner. Vehicle Task Types are deployment
configuration. The generic path may not embed UGV/HA resource IDs or Binding maps; multiple
resources require explicit context or clarification. Side-effect intent may reach planning but no
Tool call occurs before the existing Plan Confirmation boundary.

No new dependency or copied upstream code is planned. If that changes, the OSS Intake skill and
repository license/source-lock process become mandatory before the dependency or code is added.

## Progress

- [x] 2026-08-12 09:12 +08:00 read the complete Goal package in its mandatory order and selected
      the Architecture Guardian, Implementation Gate and Acceptance Auditor workflow.
- [x] 2026-08-12 09:19 +08:00 fetched origin, proved the initial worktree clean, found no baseline
      drift, preserved local `main` commit `d309e24`, and created the target branch from exact
      `origin/main`.
- [x] 2026-08-12 09:25 +08:00 read AGENTS, PLANS, architecture/domain baselines, accepted ADRs,
      Node Control ADRs and the Home-Lab living plan.
- [x] 2026-08-12 09:26 +08:00 began real external preflight and separated the PMS authority on
      port 18088 from the UGV Runtime on port 19100.
- [x] 2026-08-12 10:34 +08:00 discovered one native production provider, its exact Server,
      11-operation catalog and public resource from PMS, and proved Runtime readiness.
- [x] 2026-08-12 10:35 +08:00 implemented the operator-requested non-production
      `unsafe_test_open` outbound policy with production startup rejection and deployment/preflight
      regression coverage. This profile can be functionally qualified but is not Production-secure.
- [x] 2026-08-12 13:05 +08:00 re-ran the real credential-free external preflight after the operator
      deployment update: projection 200, exact ETag/checksum, native lineage, contract header,
      conditional 304, unique UGV tuple, endpoint alignment and Runtime health all passed. No direct
      MCP Tool call was made.
- [x] Implement and verify explicit credential-free Source and Runtime credential authorities;
      missing SecretRefs do not silently downgrade to credential-free operation.
- [x] 2026-08-12 14:12 +08:00 completed the real credential-free Source revision 1 persistence,
      Snapshot/Candidate lineage sync and conditional 304 path after applying the additive CHECK
      constraint migration. Derived redacted lineage reports are recorded without endpoints.
- [x] Implement and verify the generic Provider materializer and Catalog/Binding drift gates.
- [x] Implement and verify schema-driven UGV Capability/Skill bootstrap, including fire-governance
      absence and pre-mutation drift/unknown-semantics rejection.
- [x] 2026-08-12 13:58 +08:00 implemented a separate one-time, fail-closed remediation driver for
      the five control authorities accidentally published by the earlier bootstrap. It pre-reads
      every exact Skill/Capability/implementation and fire absence before mutation, uses current
      Skill governance revisions and Capability ETags with idempotency keys, suspends only
      published authorities, re-evaluates readiness to suspended/blocking, and emits a redacted
      zero-MCP/zero-device report. The focused 4-test remediation suite, 14 package-driver tests,
      scoped format/lint and repository TypeScript check pass; real remediation execution remains
      pending and is not claimed by unit evidence.
- [x] Implement and verify the generic `managed_capability` Task Understanding composition and
      deterministic admission guards while preserving the HA profile regression.
- [x] Reconciled exact Provider Binding revision 2, Runtime tool revision 2 and live 11-operation
      Catalog `2.0.0-rc.1:2`; published five read Skills at version 4 and five read Capabilities at
      version 2, and staged five controls non-selectable Draft without implementation bindings.
      Fire has no Capability/Skill and was not called.
- [x] Exercised the deterministic read boundary and recorded the fail-closed external blocker: the
      sole SDAR live read invocation failed with `UGV_EXECUTION_MODE_UNSUPPORTED`; simulation was
      rejected by readiness as `UGV_DEVICE_MCP_UNAVAILABLE` before invocation; a direct simulation
      compatibility probe returned `UGV_ADAPTER_INTERNAL_ERROR`.
- [x] 2026-08-14 merged `origin/main@34ce7a7` through merge commit `80e9f93` before continuing the
      physical-control work. Implemented an explicitly activated navigate authority whose one
      immutable Skill procedure contains five linear `vehicle_navigate` nodes, each frozen to
      `forward / 2 m`, with exact-count and remote-terminal proof. Focused 124/124 and repository
      TypeScript checks pass; this is implementation evidence, not physical-movement evidence.
- [x] 2026-08-14 repeated a real live deterministic `vehicle_get_state` call after refreshing Source
      and Runtime readiness. Invocation
      `mcp-invocation-deterministic-6160523029e621b25c2f1a995c14d1ce` reached the deployed adapter
      and failed `MCP_TOOL_BUSINESS_REJECTION / UGV_EXECUTION_MODE_UNSUPPORTED`; navigate calls and
      physical writes remained zero.
- [x] 2026-08-14 added the explicit non-production
      `SDAR_MCP_LIVE_EXECUTION_MODE_HEADER=omit` compatibility switch. It omits only the live MCP
      transport header, keeps persisted execution evidence `live`, leaves simulation headers
      unchanged and is rejected in Production. A protocol-faithful no-header availability request
      no longer reproduced `UGV_EXECUTION_MODE_UNSUPPORTED`; the external adapter instead returned
      `unknown / UGV_MQTT_UNAVAILABLE`.
- [x] 2026-08-14 retried the requested single A2A movement Task shape whose one native navigate
      Skill procedure contains five sequential `forward / 2 m` MCP nodes. Four Task attempts
      created zero MCP/navigate invocations: three preparation waits timed out; latest Task
      `55496234-f5e7-4589-9a18-b24afd2439d6` reached Task Understanding, Goal Contract generation
      and Goal Planning, then `interactive_plan_patch` failed `MODEL_TRANSPORT_UPSTREAM_ERROR`
      while correcting a six-Skill-Goal candidate to the required one Skill Goal. No Plan/control
      confirmation or physical write occurred.
- [x] 2026-08-12 implemented ADR-137 create-on-empty Runtime model initialization. Startup
      atomically creates the explicitly configured structured Provider and optional separate
      embedding Provider plus all 21 operation routes only when the Provider table is empty; any
      existing Provider is a strict no-op. Migrations provide 21 current default Prompts in
      PostgreSQL rather than an in-process fallback.
- [x] 2026-08-12 qualified the real model boundary through `ModelRuntimeService`: all nine required
      structured stages, Workflow application-schema rejection/correction and finite
      1024-dimensional `goal`/`skill_selection` embeddings passed. The redacted report records two
      Providers, 42 operation routes and 21 current Prompts without credentials or endpoints.
- [x] 2026-08-12 executed real A2A read-only `run016` through Task/Goal/User Goal Plan, exact
      `ugv.get-state@4`, `vehicle.ugv.read-state@2`, Exposure v2 and one live MCP invocation. The
      external adapter returned `UGV_EXECUTION_MODE_UNSUPPORTED`; corrected Goal Evaluation no
      longer shape-crashed, but the bounded replan budget exhausted and the Task failed
      `GOAL_UNACHIEVABLE`. This is real failure evidence, not a passed A2A gate.
- [ ] Resolve the current external `UGV_MQTT_UNAVAILABLE` state, terminal-outcome direct
      `capability_attempt_id` gap, missing terminal A2A failure projection and transient model Plan
      patch failure; then rerun successful deterministic/A2A reads. The transport-header mode
      rejection itself is resolved by the non-production compatibility switch. Failed
      CapabilityAttempt restart reconciliation and real-model conformance are complete.
- [ ] Enable live execution on the deployed UGV adapter, provide authoritative fresh/connected/
      stationary state evidence, and complete node-scoped one-shot sequence confirmation before
      running the five-dispatch movement Task. Then complete lifecycle/emergency/recovery
      qualification.
- [x] Ran focused gates and the repository acceptance matrix. Static, cognitive replay, migrations,
      main Integration (189/189), main E2E (72/72 with one skip), evidence demo (44/44) and all three
      smokes passed. The aggregate `pnpm verify` remains failed because its isolated P11 export run
      timed out; an unchanged standalone rerun passed 1/1. The later E2E Phase 13 baseline drift
      failed at `22.939% > 15%`, and the official A2A TCK could not start without host
      `python3-venv`. No threshold, assertion or timeout was weakened.
- [x] Refresh final Markdown/JSON evidence and traceability with the real failed A2A run while
      preserving detailed failed-attempt lineage and the historical failed full verification.
- [x] Regenerated the secret-scanned delivery ZIP/SHA/patch after the final evidence was frozen;
      `.gitignore`, `.codex/**`, actual secrets and generated delivery files are excluded.

## Discoveries and Surprises

- The execution-time remote main is byte-identical to the reviewed baseline; no baseline-drift audit
  is required.
- Local `main` contains one unrelated committed `.gitignore` addition. Switching from it left the
  same line as a working-tree modification on the Goal branch. It is preserved, excluded from Goal
  changes and will not be reset/stashed/cleaned or included in delivery.
- `http://192.168.1.7:18088/` is PMS Web and `/api/` is the proxied PMS API, while
  `http://192.168.1.7:19100/` is the UGV frozen MCP Runtime. Port 19100 must never be treated as the
  Registry endpoint.
- PMS native Registry revision 1/checksum
  `72a880d6415d318919f821379007af9f59b5f611ac8560a5833b3b134603c218` contains exactly
  `isr.vehicle.ugv.ugv1 / production-ugv-direct-1`, catalog revision 1, 11 tools and public resource
  `vehicle:ugv1`. After the external deployment update, the Web proxy exposes the protected
  credential-free SDAR projection at `/api/v1/registry/.../latest`: projection revision 1/checksum
  `5efefbcdbf4f4d44bc9e8fb89dca1b10f9a3b150f9bae28a22ffafbb0f1fb6c1`, native lineage headers,
  exact ETag and conditional 304 all validate.
- Registry and UGV Runtime authentication have deliberately been removed by the external operator.
  SDAR models this only through the exact `unauthenticated://none` authority; absence of a token or
  failed SecretRef resolution never implies no-auth mode.
- A supported real structured model and a separate real embedding model are configured. Their
  conformance passed independently of A2A; this does not satisfy the downstream MCP/A2A lineage
  gate or authorize any write.
- The external UGV adapter evidence is simulation-only. Tool execution semantics are reviewed
  `admin_override` values because the live contract does not declare them; neither is sufficient
  to claim a real physical UGV or Runtime-declared semantic authority.
- A live-mode SDAR `vehicle_get_state` attempt created one failed read-only MCP invocation with
  `MCP_TOOL_BUSINESS_REJECTION / UGV_EXECUTION_MODE_UNSUPPORTED`. The subsequent SDAR simulation
  path failed closed in readiness with `UGV_DEVICE_MCP_UNAVAILABLE` and created zero simulation
  invocations. A direct simulation compatibility probe returned `UGV_ADAPTER_INTERNAL_ERROR`.
- With `SDAR_MCP_LIVE_EXECUTION_MODE_HEADER=omit`, a current no-header live availability request no
  longer reproduced the mode rejection and instead exposed `UGV_MQTT_UNAVAILABLE`. The movement
  A2A retry remained pre-dispatch: all four Task attempts have zero MCP invocations; the latest
  failed during model Plan correction after its Goal was patched to the exact five-dispatch
  contract.
- The failed invocation report does not carry the Goal-required complete Task/Goal/Plan/Skill/
  Capability/Capability Attempt/Binding/Registry/catalog/invocation/remote-task/terminal reference
  set. The missing lineage is a qualification blocker and is not reconstructed from unrelated rows.
- The current real Runtime database has two Model Providers, 21 `structured_generation` routes, 21
  `embedding` routes and 21 enabled current Prompts. The real conformance report passes nine
  structured stages, application-layer Workflow correction and two finite 1024-dimensional
  embeddings.
- Real A2A `run016` persisted Task `7dcb57de-a1f1-4df1-b19e-7227e3a253d0`, Goal
  `goal-113fdcb2-8577-4107-8562-172ba4e38c5b`, User Goal Plan
  `user-goal-plan-b72790fb-63d4-46de-831c-25073124e797`, exact Skill `ugv.get-state@4`, Capability
  `vehicle.ugv.read-state@2`, Exposure v2, CapabilityAttempt and live MCP invocation
  `mcp-invocation-fb54fcdb-dabf-42ee-85d6-eebcb7aa8717`. The adapter rejected the mode with
  `UGV_EXECUTION_MODE_UNSUPPORTED`; Goal replan budget exhausted. No successful
  `result_processing` exists. Restart reconciliation closed the CapabilityAttempt from `prepared`
  to `failed`; the terminal outcome has a null direct `capability_attempt_id`, and the external A2A
  projection remained `TASK_STATE_WORKING`.
- Source revision 1 and conditional 304 are proven, but real restart, outage with unexpired LKG,
  expiry and bad-checksum scenarios were not executed. The aggregate bootstrap and its DB/Redis/
  Node Control/model checks also remain blocked. The preflight's pending catalog field is an earlier
  phase snapshot; the later catalog report is the separate catalog authority.
- Absence of fire Capability/Skill is proven, but an unconditional Runtime hard deny protecting
  generic Workflow access to `vehicle_fire_weapon` is not yet proven.
- Node.js Fetch rejects port 10080 as a WHATWG forbidden port even though curl can reach it. The
  isolated local acceptance Node Control therefore runs on 10081; this does not change any external
  authority or protocol contract.
- The first real Source create reached Node Control but PostgreSQL rejected
  `unauthenticated://none` through the old `smpp_registry_source_credential_ref_check`. This is an
  implementation/migration defect, not an external Registry failure; it must be fixed at the
  durable schema boundary before retrying.
- The operator requires global TLS/SSRF relaxation for current integration/test deployments. The
  explicit escape hatch admits credential-free HTTP(S) without authority membership checks only
  when both Node and SDAR deployment environments are non-production; this intentionally fails the
  Production security gate.
- This Goal's full verification did not pass: the aggregate run encountered an isolated P11 export
  wait timeout despite an unchanged standalone 1/1 pass, while the separately completed E2E command
  failed protected Phase 13 baseline drift at `22.939% > 15%`. Runtime regression (`1.7548%`) and
  append P95 (`3.410 ms`) passed. The official A2A TCK was host-blocked by missing `python3-venv`;
  evidence demo 44/44 and infra/Server/Node Control smokes passed.

## Decision Log

- 2026-08-12: Preserve the unrelated `.gitignore` residual and work around it; do not include it in
  Goal commits, reports or the delivery patch.
- 2026-08-12: Treat the supplied IP/port as an observed reachable SMPP service base, not as proof of
  Registry projection or UGV Runtime authority. Exact projection and Catalog identities must still
  come from live validated contracts.
- 2026-08-12: Continue repository implementation while the external projection inputs are missing,
  but classify every unexecuted real phase honestly and never substitute mocks for real evidence.
- 2026-08-12: No physical action is attempted unless every `REAL_CONTROL_SAFETY.md` gate is explicit
  and all current SDAR/SMPP active/uncertain counts are zero.
- 2026-08-12: Implement global outbound relaxation as a named, explicit non-production policy, not
  as a change to the secure default. It permits plaintext HTTP and bypasses SSRF authority matching,
  but still forbids URL credentials/non-HTTP schemes, preserves authenticated redirect boundaries,
  keeps HTTPS certificate verification enabled and is rejected by production configuration.
- 2026-08-12: Represent the operator-confirmed credential-free Source and Runtime with one explicit
  sentinel, never with an empty/missing SecretRef or dummy token. Update durable CHECK constraints
  through a forward migration rather than bypassing PostgreSQL authority.
- 2026-08-12: Accept ADR-137. Deployment environment configuration may seed Model authority only
  when the complete Provider table is empty. PostgreSQL owns Providers, operation routes and Prompt
  versions; startup never repairs or overwrites existing authority. Embeddings require an explicit
  separate model/Provider and `(stage, operation)` routes rather than inference from a chat model.

## Implementation Steps

1. Freeze baseline/preflight evidence and identify exact current services, APIs and tests.
2. Extract a reusable SMPP Provider materialization primitive from the Home-Lab acceptance logic;
   migrate the Home-Lab driver to it where practical and retain exact regressions.
3. Add a generic Catalog-to-Capability/Skill bootstrap and UGV configuration adapter; classify live
   semantics conservatively and disable fire execution.
4. Add `managed_capability` production composition with configured vehicle Task Types, normal
   Skill selection/governance and resource ambiguity/confirmation guards.
5. Add deterministic read, real-model/A2A read, control-safety and recovery qualification drivers
   that call existing public/application authorities rather than a direct UGV MCP client.
6. Add the repeatable deployment profile and redacted evidence/delivery generation.
7. Run focused tests, full repository verification, traceability/status/changelog updates,
   Implementation Gate and independent Acceptance Auditor review.

## Validation

Focused materialization, governance, managed Task Understanding, outbound policy, deployment and
cleanup regressions pass. The repository-wide attempt passed its static, cognitive replay,
migration and main Integration portions, including 189/189 Integration tests, but failed its
isolated P11 evidence-export wait. The exact isolated case subsequently passed 1/1 without changing
the test. A separate `pnpm test:e2e` passed 72/72 main cases with one skip and then failed Phase 13
baseline drift (`22.939% > 15%`); Runtime regression (`1.7548%`) and append P95 (`3.410 ms`) passed.
The canonical evidence demo passed 44/44, and infra, Server and Node Control smokes passed. The
official A2A TCK did not start because the host lacks `python3-venv`. These are classified as a
failed full gate, not combined into a synthetic pass.

The model-initialization increment passes 131 focused Unit/Contract tests across 10 files,
repository TypeScript typecheck, the 747-source architecture gate, and an isolated real PostgreSQL
bootstrap test. That database test proves atomic two-Provider/42-route creation and restart no-op;
the Prompt and operation-route migration contracts also pass. Per operator direction, the full
repository gate was not repeated for this increment. Real provider conformance separately passed
nine structured stages, the Workflow application-schema correction path, and 1024-dimensional
`goal`/`skill_selection` embeddings; the redacted evidence is
`reports/sdar-ugv-smpp-integration/model-stage-conformance.json`.

Real qualification additionally requires accepted projection 200/304, live Catalog and schema
capture, successful zero-write deterministic reads, complete A2A query/terminal lineage, explicitly confirmed bounded control,
authoritative remote terminal observations, restart/outage reconciliation and one external
dispatch. The supported real Model Provider prerequisite is now passed, but is not a substitute for
any downstream gate.

## Idempotence and Recovery

Source reconciliation, materialization and governance bootstrap use exact identities, revisions,
checksums and current-version comparisons. Re-running an equal input must reuse authority rather
than create duplicate Servers, Bindings, Capabilities or Skill Versions. Endpoint/catalog drift
fails closed. A post-dispatch timeout becomes uncertain/reconcilable and never grants permission to
redispatch. Remote completion/cancellation comes only from frozen `tasks/get`/observation authority.

## Artifacts and Evidence

- Goal package: `.codex/goal-sdar-ugv-smpp-integration/`.
- Living plan: `execplans/EP-SDAR-UGV-SMPP-INTEGRATION.md`.
- Reports: `reports/sdar-ugv-smpp-integration/`.
- Deployment profile: `deploy/ugv-smpp-integration/`.
- Repeatable scripts: `scripts/sdar-ugv-smpp/`.
- Requirement mapping: `docs/17_TRACEABILITY_MATRIX.md`.

## Outcomes and Retrospective

`SDAR_UGV_INTEGRATION_BLOCKED`. Real projection/native lineage/304, Source revision 1, the exact
candidate, Binding revision 2, Runtime tool revision 2 and the live 11-operation adapter Catalog
`2.0.0-rc.1:2` are proven. Five read Skills v4/Capabilities v2 are published and five controls are
staged Draft/non-selectable without implementations; fire has no Capability/Skill/invocation. The
generic materializer and `managed_capability` path have focused evidence. Real-model conformance is
complete with two Providers, 42 operation routes, 21 current Prompts, nine structured stages,
Workflow correction and two finite embedding checks. Real A2A `run016` reached exact governed Skill
and live MCP invocation, but the adapter returned `UGV_EXECUTION_MODE_UNSUPPORTED`; corrected Goal
Evaluation completed, then replan budget exhausted and the Goal became unachievable. The newer
non-production no-header compatibility path removes that mode rejection but reveals
`UGV_MQTT_UNAVAILABLE`. Four single-Task 10 m movement attempts remained pre-dispatch; the latest
failed model Plan correction, and all four have zero MCP calls. The linked
CapabilityAttempt was closed `failed` by restart reconciliation, but the terminal outcome lacks a
direct CapabilityAttempt FK, no successful `result_processing` exists and the A2A projection
remained `TASK_STATE_WORKING`. Deterministic Read, A2A, broader recovery, control and Production
qualification therefore remain blocked. Physical writes, control calls and fire calls are all zero.
Additional limitations are
`admin_override` semantics, missing Runtime fire hard-deny proof, incomplete Source reliability,
incomplete failed-invocation lifecycle/terminal lineage, aggregate bootstrap, a failed repository verification gate,
an unstarted official A2A TCK and required `unsafe_test_open`. Final readiness is Discovery `true`;
Read, A2A, Control, Workflow, Resilience and Production are all `false`.
