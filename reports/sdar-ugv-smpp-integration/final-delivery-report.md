# SDAR × UGV SMPP final delivery

Generated at `2026-08-12T13:02:13.008Z`.

Final qualification: `SDAR_UGV_INTEGRATION_BLOCKED`.

The real Registry, Provider Binding, governed read authorities and real-model boundary are proven.
The latest A2A read-only run reached the exact governed Skill and made a live MCP invocation, but
the external UGV adapter rejected the execution mode and the Goal became unachievable after its
bounded replan budget was exhausted. This is a failed/blocked result, not a partial or successful
qualification.

## Delivered authority

- Source `ugv-smpp` revision 1 is active with explicit credential-free authority and poll mode. A
  real projection 200 and conditional 304 were observed, with native Registry lineage preserved.
- Provider `isr.vehicle.ugv.ugv1` / Server `production-ugv-direct-1` is materialized through
  `mcp-binding-ugv-smpp` revision 2. Runtime tool revision 2 and frozen Catalog
  `2.0.0-rc.1:2` expose 11 operations under checksum
  `1170522d7013a43af33d9bedfb5b823be00e458d46e0a77f72d7ee023c359a62`.
- Five read-only Skills are published at version 4 and their five Capabilities are published at
  version 2. Five control authorities remain Draft/non-selectable with no persisted implementation
  binding. Fire has zero Skill, Capability and invocation authority.
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

The latest run (`run016`) created Runtime Task
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
No movement, control or fire operation was called; physical writes remain zero.

Execution semantics are reviewed `admin_override` values because the external contract does not
declare them. An unconditional Runtime hard deny for generic Workflow access to
`vehicle_fire_weapon` is not yet proven.

## Verification

The historical repository-wide gate remains failed and is not rewritten by later focused passes.
Static/unit/contract/build passed with 243 files and 1,753 tests; cognitive replay passed; 45
Runtime and 11 Control migrations passed; the main PostgreSQL/Redis Integration suite passed 32
files and 189 tests. The aggregate command failed when the isolated Evidence Export case timed out;
an unchanged standalone rerun later passed 1/1.

Main E2E passed 72/72 with one skip, then Phase 13 failed its protected baseline-window drift gate
at `22.939% > 15%`. Runtime P95 regression (`1.7548%`) and Evidence append P95 (`3.410 ms`) passed.
Evidence E2E passed 44/44 and infrastructure, Server and Node Control smokes passed. The standalone
official A2A TCK could not enter tests because the host lacks `python3-venv/ensurepip`. No threshold,
assertion or timeout was weakened.

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

The secret-scanned ZIP, checksum and binary-capable patch were regenerated from this final evidence
and code state. They exclude `.gitignore`, `.codex/**`, actual secret files, checkpoints and the
delivery directory itself. The checksum authority is
`delivery/sdar-ugv-smpp-integration-delivery.zip.sha256`.

Machine-readable state is in `final-handoff.json`; the immutable real A2A failure is under
`failed-attempts/`; historical regression evidence is in `regression.json`; remaining limitations
are in `known-limitations.md`.
