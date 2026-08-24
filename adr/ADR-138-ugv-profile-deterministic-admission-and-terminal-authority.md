# ADR-138: UGV Profile Deterministic Admission and Terminal Authority

## Status

Accepted and locally verified for the `UAP-P2-B03` implementation boundary on 2026-08-21. The formal
local PostgreSQL/Redis/Runtime/A2A E2E and P2-focused command matrix pass. The full generic E2E,
repository-wide lint and repository-wide format gates retain disclosed unchanged pre-P2 baselines.
P3 external SMPP simulation qualification is still pending.

The deterministic one-metre target and two-metre start-to-target cap in this decision are superseded
for new external-simulation admissions by ADR-139 and the versioned `embodied.move@2` authority.
ADR-138 remains authoritative for historical `embodied.move@1` evidence and for every unchanged
confirmation, continuation, terminal and single-runtime boundary.

## Context

The `ugv-agent-profile` must execute the exact `embodied.move_to@1` contract through the existing
Skill Usage planner, immutable Workflow DSL, LangGraph.js runtime and MCP Tasks continuation path.
The movement target is safety-significant: it must come from the persisted Task Capability authority
and a fresh, taskless qualification receipt, not from A2A metadata, model prose or a late mutable
lookup. The one navigation dispatch also requires a real authenticated human confirmation before the
Provider transport is crossed.

The generic runtime already owns plan confirmation, governed control, MCP Task external wait,
continuation, result processing and atomic terminal persistence. Creating a UGV-specific planner,
polling graph, terminal Task writer or evidence store would introduce competing authorities. Letting
the generic structured Goal evaluator decide a successful UGV terminal result would instead place a
model between durable objective position evidence and the final Task/Goal state.

## Decision

- The feature is an additive, Profile-only composition selected only when the active deployment
  profile is exactly `ugv-agent-profile`. Generic Task understanding, Skill selection, planning,
  governed-control and terminal-evaluation paths retain their existing behavior.
- PostgreSQL-authoritative `TaskCapabilityBinding` and its exact-version Skill Usage authority own
  admission input. One already-persisted, taskless `vehicle_get_state` qualification receipt must
  match the frozen Server, simulation ID, resource and exact read arguments. Freshness is required
  independently at Task Capability admission (`receipt.completedAt` to `binding.boundAt`) and at
  Skill Usage planning (`receipt.completedAt` to the current clock). Both windows include exactly
  3000 ms and fail closed at 3001 ms; later Planner latency therefore can and must reject stale state.
- The qualification position and the exact `ugv_simulation_target_policy` deterministically derive a
  one-metre east WGS84 target, bounded by the two-metre maximum. The derived target must equal the
  immutable binding input. The B02 resolver then freezes Provider, Server, Binding revision,
  operation/schema/lifecycle, exact navigate/final-read arguments, readiness and the target into one
  self-hashed `SelectedTaskOperation`. Request metadata and model output cannot replace coordinates.
- The immutable `embodied.move_to@1` package remains byte-identical to the P0 freeze. No generic
  `policy.replay=forbidden` constraint is added to it. The Profile-owned admission marker
  `profile.ugv-agent-profile.side_effect_replay=forbidden` narrows this deployment, while the exact
  graph, dispatch cardinality, one-shot confirmation consumption, persisted frontier and terminal
  evidence enforce no replay at their owning layers.
- The selected operation is appended to the existing `SkillExecutionRecord` reference lineage as
  `ugv.selected_task_operation/v1`. PostgreSQL remains the source of truth; no Profile table or
  mutable in-memory selection authority is added. Every load reconstructs the Domain value and
  verifies its self-hash, exact Task/Goal/Plan/Workflow/Skill identity and cardinality.
- `prepareSkillUsagePlan` remains the formal planning entry. A Profile guard accepts only the
  deterministic nine-node definition: initial state read, three context gates, one
  `vehicle_navigate` with `TASK_REQUIRED`, final state read, final-position evidence gate and explicit
  success/failure results. The existing Workflow validator and Skill Usage compliance checker still
  run. No new DSL node, dynamic code, graph mutation or executable model output is introduced.
- The existing outer Plan confirmation is the only business confirmation boundary. For this Profile,
  the official A2A adapter authenticates the caller before protocol dispatch and passes a
  protocol-neutral human principal only for `confirm_plan`. After idempotent Plan confirmation and
  before execution, the Profile derives the complete immutable scope from persisted authority and
  issues one deterministic, retry-safe governed-control confirmation. A2A request metadata cannot
  spoof that principal. The confirmation is consumed exactly once immediately before the Provider
  transport, after refreshed Binding, Catalog, exact-argument readiness and the deployment-owned
  simulation side-effect gate all pass.
- Confirmation time is captured only after the asynchronous current-authority/readiness refresh and
  the same instant owns scope validation and TTL derivation. Immediately before transport, the UGV
  path reloads the exact current Provider Binding by Binding ID and local Server ID, verifies its
  Provider/Binding/Catalog identity and includes `providerId` in the dispatch hash. Missing or drifted
  Provider authority fails before governed authorization or transport.
- `vehicle_navigate` uses the existing MCP Task implementation. A remote handle ends the current graph
  call in `waiting_external`; PostgreSQL owns the Binding, observations, claimed terminal control and
  continuation attempt. The existing continuation resumes the persisted frontier for the final read
  and must not replay navigation. No polling Workflow or second remote-Task state machine is added.
- A `receipt_recorded` restart can race a Provider poll that already advanced the same binding. When
  the recovery snapshot CAS reports `stale`, the existing recovery service performs one read-only
  reload and accepts the race only if the complete immutable binding identity is equal, the binding is
  still open, its Runtime revision is equal or newer, and its active continuation is exact. Missing,
  drifted, closed, older-revision or continuation-drift state remains a hard error; no re-admission or
  Provider dispatch is added.
- UGV success is determined without a model. The Profile-only deterministic terminal authority
  reloads the exact binding/attempt, Skill, selected-operation reference, three MCP invocations,
  consumed confirmation, one remote lifecycle and one succeeded continuation attempt. It requires
  the exact Workflow input envelope and compares its `skillInput` member with the immutable Task
  Capability input snapshot. The persisted Workflow result must equal the result derived from Provider
  terminal evidence and the authoritative fresh final position. It then uses the existing
  `ResultProcessor` and existing atomic terminal repository; it does not persist independently or
  become another Task/Goal writer.
- The deployment side-effect gate is default-closed. It admits only the exact simulation ID bound to
  an explicit `ALLOW_UGV_SIMULATION_SIDE_EFFECTS=YES` and `uap-p3-b02-*` run identity. The isolated P2
  Runtime E2E temporarily enables a test-owned matching identity solely against its strict loopback
  frozen Provider fixture and records one local navigation dispatch. P2 never enables the external
  SMPP deployment gate and records zero SMPP, Device MCP and MQTT actions.

## Authority and Boundary Ownership

| Type or state                                      | Authoritative owner                                                         | Profile responsibility                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Task Capability binding and execution attempt      | existing Domain/Application model and PostgreSQL repository                 | require one exact `embodied.move` / `embodied.move_to@1` authority                         |
| Qualification invocation receipt                   | existing MCP invocation repository                                          | read and validate one taskless state receipt; never call the Provider during selection     |
| `SelectedTaskOperation`                            | existing Domain value; persisted in existing Skill execution references     | derive, self-hash, append once and reload exactly                                          |
| Workflow definition and instance                   | existing planner, validator, PostgreSQL plan store and LangGraph.js runtime | supply and guard one Profile-specific deterministic candidate                              |
| Authenticated principal                            | A2A adapter at the SDK boundary; protocol-neutral principal in Application  | expose it only to `confirm_plan`; ignore request metadata as authority                     |
| Governed confirmation and consumption              | existing governed-control PostgreSQL authority                              | issue one exact retry-safe Profile confirmation and consume it once                        |
| Remote Task and continuation                       | existing MCP Task Binding/observation/control/continuation authorities      | verify exact lineage and no navigation replay                                              |
| Processed result and Task/Goal terminal transition | existing Result Processor and atomic terminal repository                    | prepare a deterministic evidence-derived result, without writing terminal state separately |

## Consequences

- The UGV Profile has a model-free safety and terminal boundary while continuing to use the normal
  Skill-driven planning and single LangGraph.js execution runtime.
- Historical and generic profiles remain byte- and behavior-compatible at their composition branches;
  they do not acquire UGV target derivation, A2A authentication, side-effect gates or deterministic
  terminal evaluation. The shared Remote Task admission recovery receives only the narrow fail-closed
  stale-CAS race repair described above.
- A missing, stale, ambiguous or mismatched binding, receipt, selection, confirmation, invocation,
  remote lifecycle, continuation or final-position fact fails closed. Provider `completed` alone can
  never mark the Goal achieved.
- The generated Workflow JSON is evidence only. PostgreSQL plan/instance state and append-only runtime
  facts remain authoritative.
- This decision is local implementation evidence. It does not prove an external simulation movement,
  production eligibility or physical-vehicle qualification.
- “No MCP call before confirmation” is scoped to the Task Workflow and side-effect path. The local E2E
  truthfully records one earlier taskless read-only qualification receipt, zero task-scoped MCP calls
  and zero navigation calls before confirmation.
- Final P2 verification passes the focused 21-file/210-test matrix, full approved-host Unit and
  Contract suites, the isolated 38-file/219-test Integration suite, typecheck, 835-source architecture,
  build, changed-file ESLint/Prettier and diff checks. The repository-wide lint and format failures are
  restricted to seven and two unchanged baseline files respectively and remain explicit non-P2 gaps.
- The full generic E2E gate retains three old `task-service-endpoint` failures. An isolated replay
  produces the identical seven failures at the pure pre-P2 `git archive` of
  `4c0b1f7a398b5f79e05df2103d1e5191436b3129`, so it is disclosed as a reproduced baseline rather than
  attributed to this decision.

## Rejected Alternatives

- Let an LLM choose or repair the movement target: the target is authorization data, not adaptive
  guidance.
- Put a second confirmation node in the graph: this duplicates the outer Plan boundary and complicates
  restart semantics.
- Treat Provider command acknowledgment or terminal status as Goal success: neither proves final
  position, correlation, freshness or displacement.
- Resume by rerunning the Workflow from its entry node: this can duplicate the completed side effect.
- Persist Profile selection or terminal state in a new store: this creates a second source of truth.
- Apply the authenticated UGV A2A path or deterministic evaluator globally: unrelated profiles have
  different policy and compatibility contracts.

## Evidence

- `apps/server/test/ugv-move-skill-usage.unit.test.ts`
- `apps/server/test/ugv-move-workflow.unit.test.ts`
- `apps/server/test/ugv-move-workflow-authority.unit.test.ts`
- `apps/server/test/ugv-move-workflow-evidence.unit.test.ts`
- `apps/server/test/ugv-move-terminal-outcome.unit.test.ts`
- `apps/server/test/ugv-move-workflow-continuation.integration.test.ts`
- `apps/server/test/ugv-agent-profile-execution.integration.test.ts`
- `apps/server/test/task-provider-binding-context.unit.test.ts`
- `packages/application/test/governed-control-ugv-authority.unit.test.ts`
- `packages/application/test/remote-task-admission-recovery.unit.test.ts`
- `packages/a2a-adapter/test/http-endpoint.contract.test.ts`
- `packages/skill-package-adapter/test/ugv-agent-profile-contract.contract.test.ts`
- `examples/ugv-agent-profile-workflow.json`
- `reports/ugv-agent-profile-simulation/uap-p2-b03-verification.json`
