# Known limitations — SDAR × UGV SMPP

- The credential-free PMS Web proxy exposes the frozen `sdar-registry-v1` projection. Projection
  200/304, explicit credential-free Source revision 1, native lineage and the exact
  Provider/Server tuple are proven. Source restart, Registry outage with unexpired LKG,
  expired-LKG rejection and bad-checksum rejection were not executed against this deployment.
- The latest materialized authority is Provider Binding revision 5, Runtime tool revision 5 and
  Catalog `2.0.0-rc.1:5` with 11 operations. Its availability/readiness windows are point-in-time
  observations and have not been promoted into current-liveness evidence.
- The latest disposable integration database publishes five read-only Skills/Capabilities and one
  explicitly activated coordinate-point navigate Skill/Capability at version 5; the other four
  controls remain Draft/non-selectable. The accepted TaskCapability froze the exact configured
  WGS84 point and `stopOnObstacle=true`, but observed live v5 predates the final Schema-const fix.
  The corrected driver must materialize a successor before dispatch. Fire has no Capability or
  Skill and was not invoked, but an unconditional Runtime hard deny for generic Workflow access to
  `vehicle_fire_weapon` is not proven.
- The live contract does not declare execution semantics. Tool effect and task behavior therefore
  use reviewed `admin_override` values; this is not Runtime-declared semantic authority and does
  not prove a physical UGV.
- Runtime model startup bootstrap and the real model prerequisite are complete. The real database
  has two Providers, 42 operation routes (21 structured and 21 embedding) and 21 enabled current
  default Prompts. Real conformance passed nine structured stages, Workflow correction, and
  `goal`/`skill_selection` embeddings at 1024 dimensions. This does not qualify the downstream MCP
  or A2A outcome.
- Real A2A `run016` reached Task/Goal/Plan preparation, exact Skill `ugv.get-state@4`, Capability
  `vehicle.ugv.read-state@2`, Exposure version 2 and one live MCP invocation. The external adapter
  returned `MCP_TOOL_BUSINESS_REJECTION / UGV_EXECUTION_MODE_UNSUPPORTED`; no successful
  `result_processing` stage or normalized UGV observation exists.
- The Goal Evaluator no longer reproduced the earlier decision-shape crash: the latest
  `replace_skill` result contained its required action instruction. The bounded replan budget was
  nevertheless exhausted, leaving Goal `unachievable` and Task failed with `GOAL_UNACHIEVABLE`.
- CapabilityAttempt
  `capability-attempt-7dcb57de-a1f1-4df1-b19e-7227e3a253d0-1` was initially observed `prepared`,
  then Runtime restart reconciliation durably closed it `failed` with start/completion timestamps.
  This verifies failed-attempt restart reconciliation, not successful UGV execution.
- Terminal outcome `terminal-outcome-task-7dcb57de-a1f1-4df1-b19e-7227e3a253d0` is durably
  `unachievable / replan_budget_exhausted` and Task-linked to the failed attempt, but its direct
  `capability_attempt_id` column is null. The Task association is reported; no direct FK is invented.
- The latest persisted A2A projection for failed Runtime Task
  `7dcb57de-a1f1-4df1-b19e-7227e3a253d0` remains `TASK_STATE_WORKING`. A terminal A2A failure
  projection was not observed. A2A readiness therefore remains false even though a real A2A Task
  and live MCP call were executed.
- `a2a-readonly.json` is the primary real run016 failure report. Detailed Task/Goal/Capability/MCP
  lineage is separately preserved in `failed-attempts/a2a-readonly-run016.redacted.json`; neither
  report is a passing A2A qualification.
- Earlier deterministic and A2A live reads failed at the external execution-mode boundary. The
  non-production `SDAR_MCP_LIVE_EXECUTION_MODE_HEADER=omit` compatibility switch now preserves
  Runtime `live` evidence while omitting only that transport header; the latest no-header
  availability probe did not reproduce `UGV_EXECUTION_MODE_UNSUPPORTED`. The latest exact
  coordinate availability reads returned `disabled / UGV_CHASSIS_TRACK_BUSY` continuously for
  more than 39 minutes, so physical dispatch remains unavailable.
- Four one-A2A-Task attempts requested a native five-node navigate procedure totaling 10 m. Three
  timed out during preparation. Latest Task `55496234-f5e7-4589-9a18-b24afd2439d6` reached Task
  Understanding, Goal Contract generation and Goal Planning, but `interactive_plan_patch` failed
  `MODEL_TRANSPORT_UPSTREAM_ERROR` while correcting an invalid six-Skill-Goal candidate to the
  required one Skill Goal. All four attempts have zero MCP/navigate invocations, zero physical
  writes and zero proven movement; see
  `failed-attempts/a2a-move10-live-header-omit-20260814.redacted.json`.
- The later exact coordinate A2A Task `2eb25439-8d9d-448a-9e04-5a4ed761170d` accepted a corrected
  Goal and one exact `vehicle.ugv.navigate` Skill Goal, then failed before Workflow Plan persistence
  because Provider task readiness was disabled. Twelve protocol-faithful read-only availability
  checks from `10:40:27Z` through the post-integration retry at `11:25:57Z` consistently returned
  `UGV_CHASSIS_TRACK_BUSY`; Runtime PostgreSQL had zero UGV remote bindings. No Plan or governed
  confirmation was created and MCP Tool calls/physical writes remained zero. See
  `failed-attempts/a2a-coordinate-navigation-20260814.redacted.json`.
- The five-dispatch code does not claim that remote command completion proves chassis stationarity.
  The deployed `vehicle_get_state` output schema does not freeze authoritative
  fresh/connected/stationary/unowned-task fields, and node-scoped one-shot sequence confirmation is
  not yet implemented. Both remain closed prerequisites for physical dispatch.
- The requested `unsafe_test_open` policy bypasses outbound authority membership and the
  HTTPS-required rule only for explicit development/test/integration deployments. It remains
  rejected in Production; HTTPS certificate validation, URL-credential rejection and scheme
  validation remain enabled.
- All physical-write gates are closed by the external busy result. No movement, recon, gimbal, tracking, lifecycle control,
  emergency stop or recovery-side-effect scenario has been attempted. The latest live attempt was
  read-only; physical writes, navigate calls and fire calls remain zero.
- A historical disposable local bootstrap incorrectly published five control authorities. Its
  evidence remains under `failed-attempts/` and is excluded from qualification. Current governance
  correctly stages controls non-executable; the one-time remediation driver was not run against
  those historical databases.
- The current repository-wide `pnpm verify` did not pass. Static/unit/contract/build, cognitive
  replay, migrations and Integration passed (35 files/215 tests plus isolated export 1/1). Main
  E2E passed 72 tests with one skip, then protected Phase 13 baseline drift failed. The diagnostic
  writer's fixed attempt-8 defect was repaired to allocate immutable attempts monotonically.
- The unchanged Phase 13 rerun wrote immutable attempt 9 and failed baseline drift at
  `15.828% > 15%`. Runtime regression (`7.128%`) and append P95 (`4.219 ms`) passed. The official
  A2A TCK could not start because the host lacks `python3-venv`; evidence demo 44/44 and all three
  smokes passed.
- The aggregate deployment bootstrap is not qualified. The recorded preflight remains a
  phase-time snapshot; later reports independently prove Catalog/model facts but do not backfill
  every historical preflight field.
- Existing delivery ZIP/SHA/patch files predate this evidence refresh. They must be regenerated
  after the final worktree is frozen and are not current delivery authority.
- `.gitignore` contains an unrelated preserved working-tree change. It is outside this Goal and
  must remain excluded from delivery artifacts.
