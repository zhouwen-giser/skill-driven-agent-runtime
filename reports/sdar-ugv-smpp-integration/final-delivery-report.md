# SDAR × UGV SMPP final delivery

Generated at `2026-08-14T11:25:57.105Z`.

Final qualification: `SDAR_UGV_INTEGRATION_BLOCKED`.

The real Registry, Provider Binding, governed read and coordinate-navigation authorities and
real-model boundary are proven. The latest exact coordinate A2A request reached a corrected Goal
and one exact navigate Skill Goal, but the external UGV Runtime reported
`disabled / UGV_CHASSIS_TRACK_BUSY` on twelve protocol-faithful read-only Availability checks.
This is a blocked result, not a partial or successful qualification; no physical command was
dispatched.

## Delivered authority

- Source `ugv-smpp` revision 1 is active with explicit credential-free authority and poll mode. A
  real projection 200 and conditional 304 were observed, with native Registry lineage preserved.
- Provider `isr.vehicle.ugv.ugv1` / Server `production-ugv-direct-1` is materialized through
  `mcp-binding-ugv-smpp` revision 5. Runtime tool revision 5 and frozen Catalog
  `2.0.0-rc.1:5` expose 11 operations under checksum
  `1170522d7013a43af33d9bedfb5b823be00e458d46e0a77f72d7ee023c359a62`.
- Five read-only Skills and Capabilities are published at version 5. Coordinate-point
  `ugv.navigate@5` / `vehicle.ugv.navigate@5` is published for one point mission with
  `stopOnObstacle=true`; the accepted TaskCapability froze the requested point. Observed live v5
  predates the final input-Schema const fix, so the corrected driver must materialize a successor
  before dispatch. Four other control authorities remain Draft/non-selectable. Fire has zero Skill,
  Capability and invocation authority.
- Runtime startup now provides create-on-empty model authority initialization. A clean database can
  atomically register the explicitly configured structured Provider and optional embedding Provider;
  any existing Provider makes startup a strict no-op. PostgreSQL contains two Providers, 21
  `structured_generation` routes, 21 `embedding` routes and 21 enabled current default Prompts.
- Real-model conformance passed all nine required structured stages, the Workflow
  application-schema rejection/correction path, and finite 1024-dimensional embeddings for `goal`
  and `skill_selection`.

Catalog, Binding, availability and readiness observations are point-in-time evidence. Their
recorded validity windows are not promoted into a current-liveness claim at handoff.

## Latest real A2A result

The latest coordinate-navigation Task `2eb25439-8d9d-448a-9e04-5a4ed761170d` targeted longitude
`106.81413978`, latitude `29.72042600`, altitude `500.000` for `vehicle:ugv1`. Its malformed model
Goal candidate was rejected and replaced by a deterministically exact Goal; one exact navigate
Skill Goal was reviewed and accepted. Provider Availability nevertheless remained
`UGV_CHASSIS_TRACK_BUSY` from the first observation through the post-integration retry at
`2026-08-14T11:25:57.105Z`. The Task therefore failed before Workflow Plan persistence. No
governed-control confirmation, MCP Tool invocation, remote Task or physical write exists for this
attempt. The redacted evidence is
`failed-attempts/a2a-coordinate-navigation-20260814.redacted.json`.

The prior real read-only run (`run016`) remains relevant historical evidence:

It created Runtime Task
`7dcb57de-a1f1-4df1-b19e-7227e3a253d0`, Goal
`goal-113fdcb2-8577-4107-8562-172ba4e38c5b`, User Goal Plan
`user-goal-plan-b72790fb-63d4-46de-831c-25073124e797`, and selected exact Skill
`ugv.get-state@4` through Capability `vehicle.ugv.read-state@2` and A2A Exposure version 2.

The real model successfully produced `task_understanding`, `goal_contract_generation`,
`goal_planning`, `skill_input_resolution` and `goal_evaluation`. The run evidence window also
captured three successful post-failure `experience_observation` invocations. No successful
`result_processing` invocation exists, so no normalized successful UGV result is claimed.

Live invocation `mcp-invocation-fb54fcdb-dabf-42ee-85d6-eebcb7aa8717` called
`ugv-smpp-runtime-ugv6 / vehicle_get_state` and failed with
`MCP_TOOL_BUSINESS_REJECTION / UGV_EXECUTION_MODE_UNSUPPORTED`. The corrected Goal Evaluator no
longer failed on the earlier decision-specific shape conflict: its structured `replace_skill`
decision included an action instruction. The Goal nevertheless exhausted its bounded replan budget
and ended `unachievable`; the Task ended `failed / GOAL_UNACHIEVABLE`.

The run preserves Task, Goal, confirmed Workflow Plan, User Goal Plan, Skill Goal, Skill Attempt,
Capability Binding, CapabilityAttempt, MCP invocation and terminal-outcome identifiers. Runtime
restart reconciliation closed CapabilityAttempt
`capability-attempt-7dcb57de-a1f1-4df1-b19e-7227e3a253d0-1` from its initially observed `prepared`
state to `failed`, with start/completion time `2026-08-12T12:48:48.416Z`.

Terminal outcome `terminal-outcome-task-7dcb57de-a1f1-4df1-b19e-7227e3a253d0` is
`unachievable`, authority `user_goal_plan_controller`, control status `replan_budget_exhausted`,
and references the final Workflow instance. It is associated through Task identity with the failed
CapabilityAttempt, but its direct `capability_attempt_id` column is null; no direct FK is invented.
One protocol projection gap still blocks qualification: the Runtime Task is failed, while the
latest persisted A2A projection remains
  `TASK_STATE_WORKING`; no terminal A2A failure projection was observed.

`a2a-readonly.json` is the primary real run016 failure report. Detailed PostgreSQL lineage is
recorded separately in `failed-attempts/a2a-readonly-run016.redacted.json`. A2A and Read readiness
remain false.

## Remaining functional boundary

The earlier deterministic-read qualification also failed at the external adapter boundary. Source
restart/outage/LKG-expiry/bad-checksum qualification, successful reads, explicitly confirmed
physical control, lifecycle control, emergency stop, recon and broader end-to-end recovery remain
unproven.
No movement, control or fire operation was called; physical writes remain zero. The latest blocker
is external chassis-track occupancy, not missing operator confirmation authority.

Execution semantics are reviewed `admin_override` values because the external contract does not
declare them. An unconditional Runtime hard deny for generic Workflow access to
`vehicle_fire_weapon` is not yet proven.

## Verification

The current repository-wide gate remains failed and is not rewritten by focused passes.
Static/unit/contract/build passed with 275 files and 2,003 tests; cognitive replay passed; 56
Runtime and 11 Control migrations passed; PostgreSQL/Redis Integration passed 36 files and 216
tests. Main E2E passed 72 tests with one skip, then Phase 13 failed its protected baseline-window
drift gate. The post-fix immutable diagnostic attempt 9 records `15.828% > 15%`; Runtime P95
regression (`7.128%`) and Evidence append P95 (`4.219 ms`) passed. The allocator now writes the
next immutable attempt instead of masking the assertion with `EEXIST`. The full command stopped at
Phase 13, so later gates including the official A2A TCK were not reached. No threshold, assertion or
timeout was weakened.

## Layered readiness

| Readiness | Value |
| --- | --- |
| `SDAR_UGV_DISCOVERY_READY` | `true` |
| `SDAR_UGV_READ_READY` | `false` |
| `SDAR_UGV_A2A_READY` | `false` |
| `SDAR_UGV_CONTROL_READY` | `false` |
| `SDAR_UGV_WORKFLOW_READY` | `false` |
| `SDAR_UGV_RESILIENCE_READY` | `false` |
| `SDAR_UGV_PRODUCTION_READY` | `false` |

Discovery means projection/native lineage, the unique candidate, Source, Binding and recorded
Catalog authority were established. It does not mean successful UGV reads, current liveness or
Production readiness was proven.

## Safety and deployment boundary

The requested `unsafe_test_open` profile relaxes the HTTPS-required rule and SSRF authority
membership only behind explicit non-production gates. TLS certificate verification was not
disabled. This profile is suitable only for the trusted integration network and is not Production
security qualification.

The deployable test profile is under `deploy/ugv-smpp-integration/`. Narrow drivers are implemented,
but aggregate `bootstrap.sh` and complete Production qualification remain blocked.

## Delivery artifact status

The prior ZIP, checksum and patch were not regenerated after this coordinate attempt and are stale;
they are not current delivery authority. Implementation commit `3c4a797` and Draft PR #22 are the
delivery authority for this worktree. `.gitignore`, `.codex/**`, actual secret files and checkpoints
remain excluded.

Machine-readable state is in `final-handoff.json`; the immutable real A2A failure is under
`failed-attempts/`; historical regression evidence is in `regression.json`; remaining limitations
are in `known-limitations.md`.
