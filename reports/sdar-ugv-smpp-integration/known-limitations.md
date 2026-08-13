# Known limitations — SDAR × UGV SMPP

- The credential-free PMS Web proxy exposes the frozen `sdar-registry-v1` projection. Projection
  200/304, explicit credential-free Source revision 1, native lineage and the exact
  Provider/Server tuple are proven. Source restart, Registry outage with unexpired LKG,
  expired-LKG rejection and bad-checksum rejection were not executed against this deployment.
- The latest materialized authority is Provider Binding revision 2, Runtime tool revision 2 and
  Catalog `2.0.0-rc.1:2` with 11 operations. Its availability/readiness windows are point-in-time
  observations and have not been promoted into current-liveness evidence.
- Five read-only Skills are published at version 4 and five read Capabilities at version 2. Five
  controls remain Draft/non-selectable without implementation bindings. Fire has no Capability or
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
- The earlier deterministic live read and the latest A2A live read both failed at the external
  execution-mode boundary. Successful deterministic reads, broader end-to-end restart recovery,
  complete successful invocation lineage and a real physical UGV remain unproven.
- The requested `unsafe_test_open` policy bypasses outbound authority membership and the
  HTTPS-required rule only for explicit development/test/integration deployments. It remains
  rejected in Production; HTTPS certificate validation, URL-credential rejection and scheme
  validation remain enabled.
- All physical-write gates are closed. No movement, recon, gimbal, tracking, lifecycle control,
  emergency stop or recovery-side-effect scenario has been attempted. Physical writes, control
  calls and fire calls remain zero.
- A historical disposable local bootstrap incorrectly published five control authorities. Its
  evidence remains under `failed-attempts/` and is excluded from qualification. Current governance
  correctly stages controls non-executable; the one-time remediation driver was not run against
  those historical databases.
- The repository-wide `pnpm verify` did not pass. Main Integration passed 189/189, but the isolated
  P11 evidence-export run timed out; an unchanged standalone rerun later passed 1/1. This does not
  rewrite the failed aggregate gate.
- Main E2E passed 72/72 with one skip, then failed protected Phase 13 baseline drift at
  `22.939% > 15%`. Runtime regression (`1.7548%`) and append P95 (`3.410 ms`) passed. The official
  A2A TCK could not start because the host lacks `python3-venv`; evidence demo 44/44 and all three
  smokes passed.
- The aggregate deployment bootstrap is not qualified. The recorded preflight remains a
  phase-time snapshot; later reports independently prove Catalog/model facts but do not backfill
  every historical preflight field.
- Existing delivery ZIP/SHA/patch files predate this evidence refresh. They must be regenerated
  after the final worktree is frozen and are not current delivery authority.
- `.gitignore` contains an unrelated preserved working-tree change. It is outside this Goal and
  must remain excluded from delivery artifacts.
