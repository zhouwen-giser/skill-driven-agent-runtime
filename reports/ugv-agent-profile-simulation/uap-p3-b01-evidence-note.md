# UAP-P3-B01 evidence note

P3-B01 runtime evidence passes for the clean, isolated dual-repository startup and authority
bootstrap boundary. The SMPP worktree remained clean and read-only at
`codex/goal-ugv-runtime-telemetry-joint-integration@b5f3ba2076468695c781bea1e5e6d3045e60f70e`.
The task-owned SMPP project started seven services; the task-owned SDAR project started three
infrastructure services and three host processes. No production database, unrelated Compose project
or user container was used or removed. Only the SMPP Adapter owns the Device MCP/MQTT southbound
boundary; SDAR reaches the governed Runtime MCP northbound endpoint.

The host SDAR Server loaded model configuration through the repository-root local `.env` path. The
redacted baseline and final audits observed two exact model Providers, 42 stage routes and zero model
invocations. The `.env` was not sourced, copied, mounted or rendered into Compose, and no secret,
endpoint, Provider name, model name or credential value is included in public evidence. This proves
configuration loading and bootstrap, not external model inference.

The official bootstrap created or reused exactly one Source, one Provider Binding/Catalog, exact
`embodied.move_to@1`, exact `embodied.move@1`, one implementation, one Exposure, current readiness
and one active managed Card. Immediate replay passed without duplicate authority. The readiness
lifecycle command suspended and restored the Skill and proved the Profile public Card was removed
and semantically restored while the separate managed Card retained its Exposure authority. Official
`bootstrap-authority.sh`, repeated `readiness.sh` and `verify.sh` attempts pass.

Earlier failures remain under `attempts/`. They include seed/startup ordering, Source projection,
Provider catalog, readiness revision-zero projection, bounded stability-window handling, and the
expired-readiness bootstrap recovery defect observed as `UAP_CAPABILITY_READINESS_INVALID`. The
recovery now accepts only a structurally exact, hash-valid and coherently partitioned expired or
unavailable `embodied.move@1` snapshot before mutation. It re-evaluates readiness at most twice with
one 10,250 ms wait and fails closed with `UAP_CAPABILITY_READINESS_STABILITY_TIMEOUT` if the exact
stability window does not clear. Periodic 60-second readiness expiry is evaluated on a non-overlapping
five-second schedule; a changed snapshot triggers one serialized managed-Card rebuild. A bounded live
observation at 15:34 UTC saw readiness snapshot v2 advance to v3 and the active Card revision advance
from 2 to 3. Rogue Capability, implementation, reason, timestamp or Exposure/Card authority still fails
before delegated recovery mutation.

That recovery has a deliberate scope limit. After the configured 300-second Provider-authority TTL,
materialization can advance the Binding from revision N to N+1; immutable `embodied.move@1` still
freezes revision N and cannot be rewritten in place. Recovery then requires a task-owned clean database
or a reviewed new Capability version bound to N+1. P3-B01 therefore does not claim unbounded
long-running recovery across Provider authority generations.

All B01 activity kept `ALLOW_UGV_SIMULATION_SIDE_EFFECTS=NO`. Authority bootstrap observed zero
Provider Tool calls, navigation calls, forbidden/weapon calls and model invocations. SMPP qualification
made one correlated read-only Device Tool call and observed zero execution, mutation journal, command
ack, navigation or forbidden-operation rows. No movement, physical-vehicle qualification, P3-B02,
P3-B03, P4 or overall Goal completion is claimed.

The runtime evidence and final B01 gate are complete. The focused matrix passes 10 files/163 tests in
58.05 seconds and independent partitioned replay passes 9 files/160 tests. Both typechecks and builds,
SDAR architecture across 842 TypeScript sources, changed-file ESLint/Prettier, SMPP full lint and both
repository diff checks pass. Fifteen primary artifact hashes are frozen in
`uap-p3-b01-verification.json`, whose status is `PASS_WITH_DISCLOSED_BASELINE_GAPS`.

The baseline qualifier is exact: SDAR full lint exits 1 with 22 errors only in seven committed
out-of-scope Home-Lab files. SDAR full format exits 1 only for
`packages/application/src/skill-usage-planning.ts` and
`packages/persistence-postgres/test/remote-task-catalog-lineage.contract.test.ts`. SMPP full format
exits 1 only for the historical P1-B02 report
`reports/ugv-agent-profile-simulation/attempts/deployment-preflight-uap-p1b02-20260821t032832z.redacted.json`.
No full-repository lint/format pass is claimed. These files are outside the B01 changed scope and the
task-card mandatory gate; B01 is accepted with the disclosures, while B02, B03, P4 and the overall Goal
remain pending.
