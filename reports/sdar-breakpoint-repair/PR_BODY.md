## Goal

Close the SDAR-owned Task-control, public-operation conformance, A2A terminal-projection,
governed-control, in-flight recovery, and aggregate-performance breakpoints without moving Runtime
authority, weakening protected gates, or enabling physical side effects.

P08 has passed. This body remains pre-PR evidence until P09 synchronizes latest Main, reruns the
exact candidate gates, records the final SHA, pushes, and creates the required non-Draft PR. It does
not yet claim `READY_FOR_PROTECTED_REVIEW`.

## Source locks

- Execution baseline main: `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Clean-start P08 preflight SHA: `9841e6527330920d44f19c68214988b56db3c6eb`
- Final P09 candidate: `PENDING_FINAL_COMMIT`
- P09 synchronized main: `PENDING_FETCH_AND_MERGE`
- SMPP: HEAD `7e8b1193d020e9973805aa8cb19d3d4c3dbc1afb`, `origin/main`
  `340abeeff75cd811b40e1bfd9d5a26f5a62f2c45`, equal tree
  `f611988bf9d6aa8e5cebfacf53cfb235ff2a6ec4`
- Console: HEAD `1a5ea3c279331a8fd83dd117d73d5a7166c668b7`, `origin/main`
  `e7fa2348f7d574a0e9363bdf33598f33144a909c`, equal tree
  `c0694842247c48813fff9127fda4744bbd02516c`

## Fixed breakpoints

- BP-SDAR-001: `FIXED`
- BP-SDAR-002: `FIXED`
- BP-SDAR-003: `FIXED`
- BP-SDAR-004: `FIXED`
- BP-SDAR-005: `FIXED`
- BP-SDAR-006: `FIXED`; current P08 full verification/performance passed
- BP-SDAR-007: `FIXED`; P07 is complete

## Node Control Task Control

Pause, resume, cancel, and Goal Patch enter through authenticated/RBAC-controlled public routes,
cross a service-authenticated Runtime boundary, and delegate authoritative phase/Plan decisions to
Runtime.

The durable revision fence binds every command, including omitted-`expectedRevision` commands, to
action/lease identity, actual revision, and pre-dispatch state. Stale owners and queued writers
cannot mutate after losing their claim. Runtime receipt identity and uncertain completion are
reconciled conservatively instead of becoming optimistic success.

Focused closure evidence passed: Runtime revision-authority PostgreSQL 10/10, Runtime management
contracts 79/79, Node Control Task-control unit 22/22, Node Control API contract 6/6, and Node
Control PostgreSQL foundation 15/15.

## Public Operation Conformance

The permanent gate compares frozen inventory and OpenAPI with production routes, authentication,
RBAC, and explicit test coverage. Registered Capability Catalog controls still fail closed with
`503` when Runtime mutation authority is not composed; route conformance is not presented as a
functional Catalog mutation.

## A2A Terminal Convergence

Runtime PostgreSQL remains Task authority. A2A saves canonicalize from Runtime truth, PostgreSQL
rejects terminal regression, and bounded startup/periodic reconciliation repairs existing
projections after notification loss or restart without admitting new A2A Tasks.

## Governed Control Safety

Control execution requires exact Capability, Skill, confirmed Plan, risk, readiness, Binding, and
trusted-human confirmation authority derived server-side. Confirmation is consumed for one exact
dispatch. Ungoverned move/patrol and `vehicle_fire_weapon` discovery stop before Provider transport;
this change creates no fire authority.

## Recovery

Remote admission is journaled before transport and the remote receipt, invocation, and continuation
checkpoint commit atomically. Missing receipts and cancel uncertainty are explicit and never replayed
optimistically. PostgreSQL remains authoritative, Redis remains wake-only, and frozen Provider/SMPP
identity is revalidated before polling.

## P07 cross-project regression

`CROSS_PROJECT_REGRESSION_PASSED`; BP-SDAR-007 is `FIXED`.

- PostgreSQL-backed controlled SMPP consumer: `1/1 PASS`.
- Candidate-built production Runtime/Node Control/Console journey: `98/98 PASS`.
- SMPP and Console remained read-only and clean.
- `physicalDeviceWrites=0`; `fireCalls=0`.

## P08 release qualification

P08 started from a clean worktree at
`9841e6527330920d44f19c68214988b56db3c6eb`; all twelve required commands passed:

- format, lint, and TypeScript: PASS;
- Node Control contract: 77 files / 29 schemas / 131 operations / 20 events / 7 fixtures;
- SMPP Registry projection: 10 vectors;
- v1.4 security: 5391 files / 0 secret findings; licenses passed;
- Node Control: 36 files / 194 tests;
- integration: 35 files / 214 tests plus isolated PostgreSQL 1/1;
- contract: 47 files / 303 tests;
- E2E: 6 files / 72 passed / 1 skipped plus Phase 13 1/1;
- build: PASS;
- `pnpm verify`: 10/10 stages in `948706 ms`.

The aggregate verifier reported bootstrap 272 files / 1965 tests, 55 migrations, 36 integration
files / 215 tests, 7 E2E files / 73 tests, Management OpenAPI 169 operations, A2A TCK 74 passed /
161 skipped / 100% applicable coverage, and Phase 12 Evidence 44/44.

`summary.json` reports `dirty=true` only because the verifier writes managed evidence after the
clean-start check and before sampling status; the candidate did not begin dirty.

## Performance

Phase 13 passed unchanged limits: baseline Runtime P95 `445.599 ms`, Evidence-enabled P95
`453.681 ms`, regression `+1.814%`, baseline median drift `6.786%`, and Evidence append P95
`5.043 ms`. Physical Provider execution was `false`. This is local deterministic-fixture evidence,
not a production SLO.

## P09 status

Pending before PR creation:

- fetch latest `origin/main` and perform the required non-rebase merge when applicable;
- rerun the exact P08 sequence plus `pnpm verify` on the synchronized candidate;
- update and commit final evidence;
- push and prove remote SHA equals local SHA;
- create and inspect the required non-Draft PR.

P08 issues `RELEASE_QUALIFICATION_PASSED`. P09 is incomplete, so protected-review readiness and the
overall completion token are not yet issued.

## Security and compatibility

Strict TLS remains default; private HTTP requires exact acknowledged RFC1918 host and port. Runtime
database authority is not exposed, discovery grants no control authority, Redis cannot create an
outcome, and real-device/fire gates remain closed. Frozen response shapes, Runtime Task authority,
Native Registry projection/checksum/lineage, and A2A ownership are preserved.

## External blockers

No external blocker is currently asserted. P07 completed without modifying either external
repository. Any future confirmed external defect remains an `EXT-*` report and is not patched here.

## Rollback

Use a normal reviewed revert of the repair commits. Do not force-update the branch. Preserve
Task/audit history and avoid reintroducing optimistic remote replay or terminal-projection
regression.

## Non-goals

- No SMPP or Console repository changes.
- No SOCP multi-node implementation.
- No real-device or fire writes; `physicalProvider=false`, `physicalDeviceWrites=0`, `fireCalls=0`.
- No protocol, security, or performance-threshold weakening.
- No production-readiness, production SLO/HA, real SMPP/physical recovery, or monolithic Runtime
  A-close -> Runtime B-terminal claim.
- No automatic merge, tag, release, or deployment.

Protected review remains pending P09. No automatic merge, tag, release, or deployment.
