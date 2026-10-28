# SDAR anonymous ZMQ integration and native single-area patrol — 2026-10-27

## Purpose and requirements

Implement the accepted anonymous SDAR integration: restore scoped service networking, pin both
13-tool catalogs, publish through actual governance, and compose one confirmed navigation followed
by one inspection. Preserve legacy contracts, reports, ownership bindings, volumes and secrets.
Software validation, physical action acceptance and report completeness are separate gates.

## Context and architecture

SMPP baseline 76a6dea; SDAR baseline 8558401. Both use existing isolated worktrees and new codex
branches. The primary SMPP checkout contains protected joint-packaging changes. Current formal
SMPP is readonly 1.1.0; candidate is site-control 1.2.0. Both currently require JWT. SDAR uses an
expired legacy binding and has partial Docker connectivity. No automatic physical dispatch.

Explicit site_anonymous uses default/development-anonymous without a verified responder; optional
JWT remains strictly validated. Anonymous SDAR uses unauthenticated://none. Operator input and
internal administration retain existing authentication. Exact catalog/version/identity checks remain.
Native patrol has exactly two confirmed children, bounded by the original deadline, with no replay.

## Progress

- [x] Inspect worktrees and baseline instructions; preserve existing changes/evidence.
- [x] Restore SDAR pinned dependencies offline without lockfile changes.
- [x] SMPP site_anonymous implemented; 19-command gate passed; b910f93 committed/pushed.
- [x] Restore 46 tagged service-specific rules; verify 10091/10998/10999 and two distinct source refreshes.
- [x] Implement exact 1.1.0/1.2.0 profiles, live identity, governance and renewal.
- [x] Implement native single-area patrol, lifecycle and truthful evidence aggregation.
- [ ] Run both repositories' required gates and isolated PostgreSQL/Redis/ZMQ task chains.
- [ ] Build fixed candidate images and deployment packages; verify anonymous readonly access.
- [ ] Operator confirms and executes field acceptance via formal A2A task chain.
- [ ] Handoff and promotion, commit/push, rollback and evidence delivery.

## Discoveries

Current anonymous mode uses internal-anonymous and changes the historical authorization hash;
development mode accepts identity headers. Neither is a valid substitute for the new explicit mode.
SDAR's existing isolated consumer pins 12 tools and simulation identity; it must remain unchanged.

## Decisions

Use additive contracts and a separately versioned report. Preserve raw Provider evidence. Do not
infer coverage or actual trajectory from requested geometry. Candidate direct bindings and formal
PMS registrations must retain their real lineage. Physical acceptance remains pending until an
operator-confirmed task and its result exist.

## Implementation and validation

Implement authentication first with spoofed-header, invalid-JWT, history-domain, operator and admin
boundary tests. Diagnose both netfilter backends before applying owned rules, resolving current
container identities at execution time. Extend profiles/governance and deterministic patrol using
existing CAS and LangGraph mechanisms. Test success, degradation, failure, cancel, timeout and
restart without duplicate dispatch using isolated storage/queues. Run complete repository gates;
record exact commands, source hashes, exit codes, artifact hashes and preserved failures.

## Idempotence and recovery

Use existing command IDs and CAS publication. Never replay an uncertain physical request. Keep
old writers retired. Network reconciliation manages only its own tagged rules. Candidate ports must
be free. Production queue consumers are exclusive; rollout preserves all storage and authorization
history. Rollback is verified anonymous readonly, with control publications withdrawn.

## Artifacts and evidence

Current increment evidence will be recorded under reports/ugv-zmq-anonymous-patrol-20261027;
private deployment inputs stay outside source control. No secrets in reports.

## Outcomes

In progress. SMPP b910f93 passed all 19 software commands and was pushed; anonymous Runtime
candidate is image sha256:75a229b884398127437f3e4ced06770d10e2d8bd4dc08ec324870c5bb586a8e1.
19110 anonymously exposes the exact 13-tool 1.2.0 catalog and real readonly state/capability data;
invalid JWT returns 401. Internal administration remains unavailable without its existing controls.
The candidate update checked runtimeActive=0, providerActive=0 and pendingCommands=0 first.
Formal 19100/19101 images have not been promoted; no field command was sent.

Network plan 37d13f503094ead8884f334ee44cfe6a0058f610f1ffbbcb042acee5ba0b31d4 restored
46 exact rules. Old control admission was suspended through existing CAS (28 receipts). After
idle checks the original control worker alone restarted; source sync operation
da4e7c1f-439d-4e97-9ead-94a71b42e1ca succeeded. Two later distinct lastSyncAt observations and
three host health 200 results are retained in network-two-refreshes.json (SHA256
92a6e3a50c25a0df5e80f7292087618cf4f5697fdb9079384582d1042aefa535).

Exact site profiles, v2 reports, governance, renewal and deterministic native patrol are implemented
but the full SDAR software milestone remains open. Focused six-file run passes 63 tests. Real
PostgreSQL/Redis/MCP/ZMQ integration is being extended: initial attempts retained a fixture CWD
error and a Control API Catalog discovery failure; these are NOT_PASS. No formal new Binding or
field acceptance is claimed. Evidence root: /mnt/data/ugv-zmq-anonymous-patrol-20261028.

## Current discoveries and decisions (2026-10-28)

- Parent confirmation reuses governed_control_confirmation with a composition-only exact scope;
  no new table or frozen migration. Child inheritance is restricted to the two admitted actions,
  exact parameters and unexpired original human grant (existing maximum 15 minutes).
- PostgreSQL child ownership and cancellation queries also pinned the old patrol capability;
  add the native family while preserving the legacy branch and all scope/link checks.
- Native child planning must use the native deterministic adapter, including live identity and
  the 300-second/remaining-deadline minimum. Generic child planning would send the time window
  to a strict tool schema, so both initial and child compilation now use the reviewed adapter.

## Lifecycle regression findings (2026-10-28)

- A simulator reused one camera/frame identity across tasks. Unique acquisition IDs now preserve
  the real receiver deduplication and task-correlation guards.
- Deadline cancellation of the underlying device cannot relabel a failed native Task as user
  cancellation. Parent reporting uses the owning Task phase and retains the original raw result.
- Native pause/resume now gates durable external waits and controls only the exact current child.
  The frozen TaskExecution methods acknowledge intent; polling confirms the state. Resume keeps
  the original Task and deadline and cannot compile or redispatch movement.
- Startup preservation follows exact persisted child node-run links to a receipted remote wait.
  Ordinary running graphs and dispatches without receipts still fail after process loss.
- Immutable Agent Card versions have separate lifecycle histories. Superseding an older card after
  creating its successor is valid; the revision-regression guard remains for revisioned aggregates.
- Isolated joint runs now verify pause/resume and SDAR restart with unchanged motion dispatch count.
  Full gate and deployment acceptance remain pending until their final receipts are recorded.

## Joint verification receipt

Run zmqgov-20261028-c256fbc8 passes real isolated PostgreSQL/Redis/formal A2A/MCP/native ZMQ
verification, exit 0 and cleanup empty. Four inspection outcomes, camera, both reconnaissance modes,
manual virtual effect, preview, patrol degradation/pause-resume/restart/cancel/timeout and Canonical
Evidence projection pass. All recorded MCP requests omit Authorization. Failed earlier attempts
remain retained. Full frozen SDAR gate is running; no field or formal control completion is claimed.

## Review closure and candidate findings (2026-10-28)

- Resume while already executing is rejected before transport. A2A now returns a separate agent
  Message with `io.sdar/controlAction` rejection metadata; canonical Task projection stays running.
  A Task metadata receipt would be overwritten by the authoritative projection. The official SDK
  blocking and streaming paths have explicit regressions. No device resume call is made.
- Canonical evidence permits a bare authorizationContextHash string schema only in a JSON Schema
  properties dictionary. Real values, defaults, examples and bare root objects remain forbidden;
  the existing evidence-domain security tests are unchanged and pass.
- Preserve immutable recorded console-validation bytes and declare their Node globals in ESLint.
  Production declaration output gives the deterministic patrol definition a required named type.
- Four complete-gate attempts remain NOT_PASS, including discovered lint, declaration, environment
  inventory and overly broad schema-guard defects; the superseded fourth run cleaned up its owned
  fixtures. These failures are retained. Focused latest regression: four files / 44 tests PASS.
- Independent-storage SDAR candidate is running at 11098/11099/10191 with direct anonymous
  control13 Binding and 14 actual governed publications. No physical Task has been submitted.
  Initial API projection errors preceded Runtime migrations; 29 issues subsequently resolved and
  current unresolved issue count is zero. Candidate health alone is not field acceptance.
- SMPP fixed candidate images and the anonymous formal readonly rollback target are deployed;
  real HTTP login, device, local Task list and retained report reads pass on candidate and LAN.
  SMPP candidate bundle SHA256 c0f0e42fa05250b09c74163c3bd8348bc040ef822b43b4a1da5c3d1949ab594c.

Software full-gate completion, latest candidate image, formal PMS Binding, field confirmation,
production queue handoff and promotion remain open until their evidence receipts exist.
