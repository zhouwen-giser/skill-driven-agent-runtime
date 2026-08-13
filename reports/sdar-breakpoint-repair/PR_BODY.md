## Goal

Close the SDAR-owned Task-control, public-operation conformance, A2A terminal-projection,
governed-control, in-flight recovery, and aggregate-performance breakpoints without moving Runtime
authority, weakening protected gates, or enabling physical side effects.

This PR body is pre-delivery evidence. P08 and P09 are still pending, so it does not claim
`RELEASE_QUALIFICATION_PASSED` or protected-review readiness.

## Source locks

- Execution baseline main: `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Historical P06 implementation: `aa4231d2fb98050eaf1fbc5f9c77ef76ca7bf7bd`
- Historical P06 evidence commit: `9ab42ac6e076d007115d640ed4e3a84b0349b8b4`
- Current candidate: `PENDING_FINAL_CANDIDATE_COMMIT`
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
- BP-SDAR-006: `FIXED` by historical P06 evidence
- BP-SDAR-007: `FIXED`; P07 is complete

## Node Control Task Control

Pause, resume, cancel, and Goal Patch enter through authenticated/RBAC-controlled public routes,
cross a service-authenticated Runtime boundary, and delegate authoritative phase/Plan decisions to
Runtime.

The durable revision fence binds every command, including omitted-`expectedRevision` commands, to
action/lease identity, actual revision, and pre-dispatch state. Stale owners and queued writers
cannot mutate a Task after losing their claim. Runtime receipt identity and uncertain completion are
reconciled conservatively instead of becoming optimistic success.

Latest focused closure evidence:

- Runtime revision-authority PostgreSQL: `10/10 PASS`;
- Runtime management contracts: `79/79 PASS`;
- Node Control Task-control unit suite: `22/22 PASS`;
- Node Control API contract suite: `6/6 PASS`;
- Node Control PostgreSQL foundation: `15/15 PASS`;
- current-tree TypeScript, lint, formatting, and diff hygiene: `PASS`.

These are focused implementation-closure results, not the official P08 sequence.

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
- SDAR live lock: HEAD `9ab42ac6e076d007115d640ed4e3a84b0349b8b4`, tree
  `4597d7bd75580ecc6f97e5da2439638c455ce425`, tracked-diff SHA-256
  `152f2de21e2f53c776b46371457af9491a390e8147dde86b00d5b7bfb1c00dec`.
- SMPP and Console remained read-only and clean.
- `physicalDeviceWrites=0`; `fireCalls=0`.

## Historical P06 performance / full verification

The P06 `pnpm verify` run passed 10/10 stages at
`aa4231d2fb98050eaf1fbc5f9c77ef76ca7bf7bd` in `918423 ms`. Phase 13 passed unchanged limits with
Runtime P95 regression `-10.596%`, baseline median drift `6.833%`, and Evidence append P95
`4.402 ms`.

Source changed after P06. This result is historical evidence only and is not current P08 or final
candidate qualification.

## P08/P09 status

All exact P08 commands remain `NOT_RUN` on the current committed candidate:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm verify:node-control-contract
pnpm verify:smpp-registry-projection
pnpm verify:v14-security
pnpm test:node-control
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
pnpm verify
```

P09 fetch/`--no-ff` merge, exact-candidate rerun, final evidence update, push equality, and this
non-Draft PR's creation/inspection remain pending. The pending state is not limited to the security
alias.

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
- No real-device or fire writes; `physicalDeviceWrites=0`, `fireCalls=0`.
- No protocol, security, or performance-threshold weakening.
- No production-readiness, production SLO/HA, real SMPP/physical recovery, or monolithic Runtime
  A-close -> Runtime B-terminal claim.
- No automatic merge, tag, release, or deployment.

Protected review remains pending P08/P09. No automatic merge, tag, release, or deployment.
