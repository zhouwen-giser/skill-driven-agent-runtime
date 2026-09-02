# EP: UGV 10-Tool Capability, Skill and A2A Expansion

## Purpose / Outcome

The `ugv-agent-profile` publishes governed Skill, Capability and A2A Exposure authority for every
operation in the current ten-operation UGV Provider catalog. Historical point-navigation authority
remains immutable. Read-only and control tasks reuse the existing managed-capability, Skill Usage,
LangGraph.js and Frozen MCP Tasks runtime. No acceptance step invokes a physical Tool.

## Requirements Covered

- FR-SKL-001/002/004: versioned Skill registration, exact Tool policy and lifecycle.
- FR-ADM-001/002: published Capability/implementation/readiness and A2A exposure.
- FR-MCP-004/006/007: exact Provider Binding, catalog and invocation authority.
- FR-A2A-001/002: Agent Card projection and Task follow-up mapping.
- NFR-SEC-002: durable one-shot physical/weapon authority and secret-safe evidence.

## Context and Orientation

`apps/server/src/ugv-agent-profile.ts` currently exposes only `embodied.move_to@1` and
`embodied.move@4`. Generic Skill Usage and managed-capability execution already exist in the same
Runtime. `apps/node-control-acceptance/src/ugv-smpp-capability-governance-driver.ts` already contains
most non-weapon governance mechanics but publishes only a narrow subset. PostgreSQL is the sole
governance and runtime authority.

## Architecture and Interfaces

- Add a reviewed UGV catalog contract for the ten Provider operations and the thirteen public
  Capability surfaces (four navigation mission shapes share one Provider Tool).
- Route only the historical point-navigation Skill through its deterministic UGV terminal authority;
  route the other reviewed UGV Skills through the existing managed Skill Usage path.
- Add `authorityKind` to governed confirmations and add durable direct-emergency instruction evidence.
- Add `confirm_weapon_action` to the A2A follow-up contract and task-scoped management endpoints.
- Default and non-UGV profiles continue to deny `vehicle_fire_weapon`. UGV weapon admission requires
  exact target evidence plus a one-shot weapon confirmation.

## Progress

- [x] 2026-09-01: inspected current Runtime, Binding/Catalog, governance drivers and accepted ADRs.
- [x] 2026-09-01: froze the public mapping and confirmation decisions with the operator.
- [x] 2026-09-01: implemented the reviewed catalog and append-only governance bootstrap.
- [x] 2026-09-01: composed profile-aware generic execution while preserving point navigation.
- [x] 2026-09-01: implemented migrations 0176/0177, weapon/emergency authority, Management/A2A
      adapters and the operational Console evidence surface.
- [x] 2026-09-01: completed the exact-commit clean full-suite rerun after the Console and OpenAPI
      additions.
- [x] 2026-09-01: published redacted zero-Tool-call governance evidence and updated traceability.
- [x] 2026-09-01: read-only verified Benchmark's deterministic formal-A2A input remediation against
      the deployed Runtime contract without creating a Task or invoking a Provider Tool.
- [x] 2026-09-01: rebuilt and rolled Runtime, Node Control API and Worker to the latest source while
      preserving and verifying the existing PostgreSQL/Redis authority and migration ledgers.
- [x] 2026-09-02: separated anonymous trusted-intranet initial A2A admission from authenticated
      plan/physical confirmation, published append-only Exposure successors and rolled the latest
      exact build without creating a Task or invoking a Provider Tool.
- [x] 2026-09-02: treated the short-lived dynamic availability attached to a selected operation as
      immutable selection evidence after its selection boundary, while retaining a fresh exact
      availability recheck immediately before governed invocation; refreshed current Binding
      observation validity and rolled the repaired Runtime with zero Task or Tool calls.
- [x] 2026-09-02: corrected failed remote-Task terminal handling so an authoritative Provider
      failure enters the deterministic `unachievable` path with its stable reason code, without
      invoking the success-only physical terminal proof or adding any redispatch path; rolled and
      read-only qualified the repaired Runtime.
- [x] 2026-09-02: separated benign Provider `unknown` readiness from explicit
      recovering/stale/unhealthy/uncorrelated unknown authority at preparation, pre-invocation and
      governed dispatch boundaries; added focused regressions without creating a Task or Tool call.

## Discoveries and Surprises

- Provider unavailability was caused by concurrent simulation requests and is externally resolved;
  SDAR must not add a readiness bypass.
- The current `vehicle_get_targets` output permits opaque target objects, so lifecycle publication is
  possible but weapon invocation must remain restricted until strict target evidence validates.
- The latest candidate Runtime uses Binding revision 2 and Catalog `2.0.0-rc.1:2`; no implementation
  may freeze the earlier revision.
- PostgreSQL instances that already ran migration 0176 exposed a compatibility defect when older
  writers omitted `authority_kind`. Migration 0177 restores a database default while current writers
  still persist the field explicitly; historical rows remain `physical_control`.
- A UGV provider policy cannot use an exact-key allowlist without turning additive contract fields
  into product-code drift. Required authority fields remain typed and exact; unknown/additive fields
  are retained and no speculative "dangerous field" blacklist is introduced.
- An unchanged live MCP discovery must refresh observation freshness without rewriting the immutable
  Frozen server/catalog anchor. Runtime refresh now returns the just-observed discovery while the
  persisted semantic revision remains unchanged.
- The canonical Runtime/Node Control checksum includes the Provider catalog identity. UGV governance
  now verifies that same canonical checksum instead of a local reduced projection.
- Discovery timestamps are evidence freshness, not contract identity. Mid-run drift detection hashes
  the semantic Binding/catalog identity and ignores observation timestamps.
- Five governed-control Management operations existed in the implementation but were absent from the
  OpenAPI authority. The contract now covers all 174 Management operations.
- Switching UGV to the managed Agent Card exposed an adapter early return that skipped safe runtime
  extensions. Managed cards now retain their governed Skill projection and receive the same
  natural-language admission/artifact extension decoration as other card sources.
- The canonical Evidence rollback integration test had a fixed upper migration bound at 0175. The
  test now discovers every dependent down migration from 0149 onward, including 0176/0177, before
  proving reapplication from immutable 0142.
- The adjacent Evidence Export rollback test also had to unwind 0177 and 0176 before testing the
  0175/0174 boundary. Leaving later ledger rows in place correctly caused the next Runtime migration
  check to reject a non-contiguous ledger; the regression now preserves cross-suite continuity.
- Benchmark P10 commit `183708c729ec7d3b7b7a84c40bbaca21e17b9389` preserves the frozen
  `{longitude,latitude,altitudeM}` source artifact while projecting longitude/latitude into identical
  A2A Data Part and `metadata.structured_input` values shaped as
  `{resourceId:'vehicle:ugv1',target:{x,y,frame:'WGS84'}}`. It binds requested Exposure version 4 and
  its stable request identity without projecting altitude. This matches the current Runtime formal
  contract; actual P10 execution remains a separately authorized qualification step.
- A physical-control Exposure policy that set `allowAnonymous=false` rejected the initial public A2A
  message before Task persistence, even though execution confirmation had a separate authenticated
  authority. The repaired frozen policy permits only initial trusted-intranet admission anonymously;
  plan confirmation and one-shot physical confirmation remain mandatory and authenticated.
- The Provider's dynamic availability is intentionally short-lived (approximately one second). It
  was valid when the exact operation was selected but expired while model planning ran, and two
  later workflow-authority guards incorrectly reinterpreted that historical selection observation
  as current readiness. Selection evidence is now immutable after selection; the independent
  governed pre-invocation authority remains responsible for current readiness.
- A P10 Provider Task failed authoritatively with `UGV_START_OBSERVATION_TIMEOUT`, but the UGV Goal
  evaluator then applied the physical-success terminal authority to the failed Workflow and replaced
  the faithful error with `TASK_CAPABILITY_TERMINAL_GUARD_FAILED`. Failed Workflow instances now
  produce a deterministic `unachievable` evaluation and preserve the stable Provider reason; only a
  succeeded Workflow enters final-position and frozen-Capability success proof.
- P10 NODE stale injection returned `availability=unknown` with explicit
  `reasonCode=UGV_TOOL_RECOVERING`. Three Runtime boundaries previously inspected only the enum and
  therefore mislabeled that known not-ready condition `allowed_by_default`. A profile-owned injected
  policy now classifies bounded reason-code segments while generic Application and PostgreSQL code
  remain Provider-neutral.

## Decision Log

- Preserve `embodied.move_to@1` / `embodied.move@4` / `a2a.embodied.move@3` for point navigation.
- Publish separate route, distance and return-home Capability surfaces to keep schemas and terminal
  evidence unambiguous.
- Direct authenticated emergency-stop intent is a one-shot PostgreSQL authority, not model metadata.
- Weapon confirmation is shared by A2A and Management adapters through one Application service.
- The Console reads only a non-sensitive confirmation projection (target/resource, hashes, expiry,
  revocation and consumption); it never reads credentials or Provider response bodies.
- `availability=unknown` is eligible for UGV default admission only when it carries no explicit
  recovering/stale/unhealthy/uncorrelated condition. The raw unknown result and reason remain
  evidence; the policy never rewrites it as available.

## Implementation Steps

1. Add the reviewed catalog contract, Task Types and profile Skill projection.
2. Generalize profile routing so only the historical point Skill enters UGV-specific planning.
3. Extend the governance driver with append-only Skill/Capability/Exposure publication and Agent Card.
4. Add migration and high-risk confirmation services/adapters.
5. Add focused regression suites, run gates and update evidence/docs.

## Validation

- `pnpm typecheck`
- focused Vitest suites for UGV profile, governance, control authority and A2A mapping
- focused PostgreSQL migration/repository integration
- A2A and Management contract/E2E suites
- `pnpm verify:architecture`
- `pnpm build`
- changed-file ESLint, Prettier and `git diff --check`

Completed evidence before final rerun:

- focused UGV/profile/governance/control/A2A suites: 11 files / 116 tests passed;
- focused Task/A2A/Management/high-risk authority suites: 4 files / 151 tests passed;
- confirmation query/repository/Management/Console suites: 4 files / 125 tests passed;
- real PostgreSQL governed-control integration: 3/3 passed;
- migration verification: 70 Runtime migrations through 0177 plus 12 Control migrations passed;
- typecheck, full lint, production build and 870-source architecture gate passed;
- one loaded-host P10 P99 failure reproduced as environmental noise; the unchanged focused suite
  passed 22/22 at 266.646 ms (threshold 750 ms).
- managed Agent Card extension contract: 12/12 passed;
- real PostgreSQL / Runtime / A2A UGV composition: 1/1 passed;
- Evidence rollback/reapply integration through migrations 0176/0177: 13/13 passed.
- ordered Evidence rollback/export migration continuity regression: 2 files / 21 tests passed;
- exact commit `3085454cf59b07c6ceb6440cf4e5544a0483155b`: clean `pnpm verify` passed 331
  static/unit/contract files (2875 tests), 40 integration files (228 tests), 7 E2E files (73 tests),
  official A2A TCK, canonical Evidence 44/44, migration/build and all smoke gates;
- Phase 13 passed at 1.21% Runtime regression, 6.85% baseline median drift and 7.79 ms Evidence append
  P95.
- Benchmark formal-input remediation follow-up: 11 UGV governance/profile/A2A/control contract files
  passed 175/175; `pnpm typecheck`, the 870-source architecture gate, production build, Markdown
  formatting and `git diff --check` passed. The deployed Agent Card was observed read-only at HTTP
  200 with `a2a.embodied.move@4`; Node Control live/ready returned HTTP 200/200. No Task or Tool call
  was issued.
- Deployment refresh: source `07efbf5ab7606e0ea575faf968d9d9819fcea45b`, dist SHA-256
  `215d28b5e56b5089f2fd819fed7ed7498bd846cfca30f0d17c9dc974bbe0f1b3`; Runtime PID 572558,
  Node Control API PID 572344 and Worker PID 572444. Runtime migration ledger 71 entries through 0177
  and Control ledger 12 entries through 0012 remained contiguous; Binding revision 2, ten Runtime
  operations, 13 published UGV Exposures and active Card revision 14013 remained exact.
- Public-initial-admission repair: implementation `0ee57562eaf1a95408f061966a54199d3eb7bc7a`
  passed 4 focused files / 83 tests and the complete clean `pnpm verify` gate: 331
  static/unit/contract files (2876 tests), 40 integration files (228 tests), 7 E2E files (73 tests),
  official A2A TCK, canonical Evidence 44/44, all builds/migrations/smokes and Phase 13. Governance
  appended `a2a.embodied.move@5` and the other twelve Exposure successors, activated Card revision
  14014 and retained Binding revision 2 / Catalog checksum `a8748237...014a`. The deployed dist hash
  is `78ff100f40743bb17cde1c3aa7305ba3bfbe354b04a6ba523e768ff9ed1c43d5`.
- Selected-operation temporal-authority repair: implementation
  `baeb32579c15b09ae88c3d09c15a07157b772f94` passed 4 focused files / 43 tests, typecheck, scoped
  lint/format, the 870-source architecture gate and production build. The Runtime was rolled as PID
  1090891 with dist SHA-256 `2a20752a4f2504cfb5906ed25b8d54c607bd618117666685b2139281e8332d00`;
  a formal Binding refresh preserved revision 2 / Catalog `2.0.0-rc.1:2` while extending observed
  availability through `2026-09-02T06:36:36.587Z`. Qualification created zero Tasks and Tool calls.
- Remote-terminal failure propagation repair: implementation
  `8ff8e0a6cd91d9c737eeddbfd109f440a1c2a961` passed 4 focused files / 67 tests, typecheck, scoped
  lint/format, the 870-source architecture gate and production build. The exact historical incident
  retained one read call, one navigate admission, one remote Task and zero redispatch. Read-only
  qualification rolled Runtime PID 1410562 from dist SHA-256
  `7784704199fd65e838eab190dd0f7cf747f25c419b4acb718398f7b851253c4a`; Management, A2A and Node
  Control returned HTTP 200, and no Task, Provider Tool call or device mutation was created.
- Explicit stale-readiness repair: focused UGV preparation, generic pre-invocation and PostgreSQL
  governed-authority suites passed 6 files / 73 tests; the isolated real PostgreSQL/Runtime/A2A
  composition passed 1/1; typecheck, scoped lint/format, the 872-source architecture gate and
  production build passed. A `UGV_TOOL_RECOVERING` unknown now fails with the existing exact
  preparation error before Plan confirmation, while a benign unknown remains `allowed_by_default`
  and explicit unavailable stays denied.
- The repair is deployed from implementation `3d2277799fa36b9493d112e9eeeba8a3a2ee9e27` as Runtime
  PID 4097010, started `2026-09-02T11:03:05Z`, with dist content SHA-256
  `733e786db26db29bb01930c8817b95af06749eb182da5d9fd0f92bc4f614c87b`. Management/A2A/Node
  Control health is HTTP 200, Binding revision 2 / Catalog `2.0.0-rc.1:2` remains current, and
  before/after authority counts prove zero new Task, MCP invocation or active Remote Task.
- Clean full verification remains non-functionally blocked. Static/unit/contract/build, replay,
  migrations, 228 integrations and the functional E2E batch passed; isolated Phase 13 attempts
  failed respectively on append P95 `20.478ms > 20ms` and baseline-window drift
  `16.487% > 15%` (the latter runner then timed out). The limits and assertions remain unchanged.
  Exact redacted evidence is in
  `reports/sdar-ugv-smpp-integration/p10-node-stale-admission-handoff.redacted.json`.

## Idempotence and Recovery

Governance compares immutable canonical content. Exact latest versions are reused; changed content
creates `latest+1` successors. Failed publication leaves drafts/history intact and never rewrites an
active version. Confirmation issuance is idempotent by exact Task/attempt/Plan/arguments/actor scope.

## Artifacts and Evidence

- This ExecPlan and the accepted follow-up ADR.
- Focused test output and a redacted governance report proving `tools/call=0`.
- Updated `docs/17_TRACEABILITY_MATRIX.md`, `PROJECT_STATUS.md` and `CHANGELOG.md`.

## Outcomes and Retrospective

The product implementation and read-only deployment bootstrap are complete. All ten Provider
operations map to thirteen append-only public surfaces, with read-only, ordinary physical, direct
emergency and restricted weapon authority kept distinct. The deployed Runtime exposes active Agent
Card revision 14013, preserves point navigation as `embodied.move_to@1` / `embodied.move@5` /
`a2a.embodied.move@4`, and records zero Provider `tools/call` since deployment. Exact commit
`3085454cf59b07c6ceb6440cf4e5544a0483155b` passed the full clean gate. Source
`07efbf5ab7606e0ea575faf968d9d9819fcea45b` is deployed as Runtime PID 572558 with the same immutable
dist hash; Node Control API/Worker were rolled from the same build and both PostgreSQL ledgers are
current. The ten-tool expansion is closed, and Benchmark's exact remediation removes the previously
observed SDAR product-authority input mismatch. No A2A Task was submitted during this verification;
live P10 qualification remains independently unexecuted.

The follow-up temporal-authority fix preserves short-lived availability as historical selection
evidence across model planning while keeping the current pre-invocation authority unchanged. The
latest Runtime and Binding observation identities are recorded in
`reports/sdar-ugv-smpp-integration/p10-selected-operation-temporal-authority-handoff.redacted.json`;
no new P10 Task or physical operation was performed during qualification.
