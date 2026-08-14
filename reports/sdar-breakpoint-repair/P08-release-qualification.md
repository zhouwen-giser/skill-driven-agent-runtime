# Phase P08 Adversarial, Security, and Release Qualification Report

## Status

- Phase result: `RELEASE_QUALIFICATION_PASSED`
- Exit criterion: `RELEASE_QUALIFICATION_PASSED`
- Clean-start tested implementation/evidence preflight SHA:
  `9841e6527330920d44f19c68214988b56db3c6eb`
- Exact P08 command list: `12/12 PASS`
- Final `pnpm verify`: `10/10 PASS` in `948706 ms`
- P07 cross-project regression: `CROSS_PROJECT_REGRESSION_PASSED`
- Physical Provider enabled: `false`
- Physical device writes: `0`
- Fire calls: `0`

P08 ran from a clean worktree at the exact preflight SHA above. All twelve commands required by the
task package passed without reducing security, contract, integration, E2E, performance, or release
thresholds. `reports/verification/summary.json` reports `dirty=true` because the verifier writes its
managed evidence before it samples Git status; the run itself began clean. That post-start evidence
write is not presented as a dirty-start waiver.

This report retains the original P08 qualification at `9841e652...` as historical candidate
evidence. P09 later fetched live `origin/main` at
`b7f02dcedc9680758e7e5f779a939a738d8de770`; `git merge --no-ff origin/main` reported
`Already up to date`. The synchronized P09 candidate at
`c2622c62607aaa02df62ae1f6b71998cf4f92688` passed all twelve commands and final
`pnpm verify` 10/10 in `1000343 ms`.

P09 qualification is complete, but push, remote/local SHA equality, and non-Draft PR creation and
inspection remain pending. Therefore this report does not issue `READY_FOR_PROTECTED_REVIEW` or
`SDAR_BREAKPOINT_REPAIR_COMPLETE`.

## Required P08 gate results

| Required command                       | Result | Exact evidence                                                  |
| -------------------------------------- | ------ | --------------------------------------------------------------- |
| `pnpm format:check`                    | PASS   | Repository formatting gate passed                               |
| `pnpm lint`                            | PASS   | Repository lint gate passed                                     |
| `pnpm typecheck`                       | PASS   | Repository TypeScript gate passed                               |
| `pnpm verify:node-control-contract`    | PASS   | 77 files, 29 schemas, 131 operations, 20 events, and 7 fixtures |
| `pnpm verify:smpp-registry-projection` | PASS   | 10 projection checksum vectors                                  |
| `pnpm verify:v14-security`             | PASS   | Secret scan: 5391 files, 0 findings; license gates passed       |
| `pnpm test:node-control`               | PASS   | 36 files / 194 tests                                            |
| `pnpm test:integration`                | PASS   | 35 files / 214 tests, plus isolated PostgreSQL 1/1              |
| `pnpm test:contract`                   | PASS   | 47 files / 303 tests                                            |
| `pnpm test:e2e`                        | PASS   | 6 files / 72 passed / 1 skipped, plus Phase 13 1/1              |
| `pnpm build`                           | PASS   | Production build gate passed                                    |
| `pnpm verify`                          | PASS   | 10/10 stages in 948706 ms                                       |

The single E2E skip is retained as a skip, not counted as a pass. The separately executed Phase 13
performance scenario passed 1/1 and the aggregate verifier subsequently reported 7 E2E files / 73
tests passed.

## Aggregate verifier evidence

The clean-start `pnpm verify` run reported:

- bootstrap: 272 files / 1965 tests;
- Management OpenAPI inventory: 169 operations;
- database migrations: 55;
- integration: 36 files / 215 tests;
- E2E: 7 files / 73 tests;
- A2A TCK: 74 passed, 161 skipped, 100% applicable coverage;
- canonical Phase 12 Evidence: 44/44 scenarios;
- all ten verifier stages passed in `948706 ms`.

The TCK denominator separates applicable passed cases from inapplicable skipped cases; the 100%
claim applies only to the applicable set.

## Phase 13 performance

The current P08 run retained the unchanged performance gates:

| Metric                       | Result       |
| ---------------------------- | ------------ |
| Baseline Runtime P95         | `445.599 ms` |
| Evidence-enabled Runtime P95 | `453.681 ms` |
| Runtime P95 regression       | `+1.814%`    |
| Baseline median drift        | `6.786%`     |
| Evidence append P95          | `5.043 ms`   |
| Physical Provider enabled    | `false`      |

These are local deterministic-fixture qualification results, not a production SLO or HA claim.

## Pre-P08 repair closure retained

The durable Task revision fence remains `CLOSED/CLEAN`. Focused evidence before the aggregate run
included Runtime revision-authority PostgreSQL 10/10, Runtime management contracts 79/79, Node
Control Task-control unit tests 22/22, Node Control API contracts 6/6, and Node Control PostgreSQL
foundation 15/15. The official P08 run above now supplies clean-start repository qualification on
top of those focused results.

## P07 cross-project evidence retained

P07 is complete and BP-SDAR-007 is `FIXED`:

- isolated PostgreSQL-backed SMPP controlled consumer: `1/1 PASS`;
- candidate-built Runtime/Node Control/Console journey: `98/98 PASS`;
- SMPP HEAD `7e8b1193d020e9973805aa8cb19d3d4c3dbc1afb` and `origin/main`
  `340abeeff75cd811b40e1bfd9d5a26f5a62f2c45` resolve to tree
  `f611988bf9d6aa8e5cebfacf53cfb235ff2a6ec4`;
- Console HEAD `1a5ea3c279331a8fd83dd117d73d5a7166c668b7` and `origin/main`
  `e7fa2348f7d574a0e9363bdf33598f33144a909c` resolve to tree
  `c0694842247c48813fff9127fda4744bbd02516c`;
- `physicalDeviceWrites=0`; `fireCalls=0`.

P07 remains read-only cross-project regression evidence and is not conflated with the P08 release
gate.

## Safety and qualification boundary

- Runtime PostgreSQL remains Task and Workflow authority; Node Control remains a governed facade.
- Redis remains wake/queue-only and cannot manufacture an outcome.
- Production strict TLS remains the default. Private HTTP requires explicit exact RFC1918
  host-and-port acknowledgement.
- The secret scanner inspected 5391 files and reported zero findings; project/license gates passed.
- No Runtime database authority is exposed through Node Control, and discovery grants no control
  authority.
- No `vehicle_fire_weapon` Capability, Skill, confirmation, or execution authority was created.
- Real SMPP/physical recovery, real-device qualification, production SLO/HA, and the monolithic
  Runtime A-close -> Runtime B-terminal drill remain unclaimed.
- `physicalProvider=false`; `physicalDeviceWrites=0`; `fireCalls=0`.

## P09 synchronized-candidate qualification

- Live fetched `origin/main`: `b7f02dcedc9680758e7e5f779a939a738d8de770`.
- Required `git merge --no-ff origin/main`: `Already up to date`.
- Tested P09 SHA: `c2622c62607aaa02df62ae1f6b71998cf4f92688`.
- Exact command list: `12/12 PASS`.
- Standalone v1.4 security: `5396` files scanned / `0` findings; licenses passed.
- Final `pnpm verify`: `10/10 PASS` in `1000343 ms`.
- Final P09 Phase 13: baseline P95 `536.321 ms`, enabled P95 `529.503 ms`, regression
  `-1.271%`, baseline median drift `10.355%`, append P95 `5.339 ms`, and `1736` records received.
- Physical side effects: `false`.
- `physicalDeviceWrites=0`; `fireCalls=0`.

The older `9841e652...` / `948706 ms` result above remains the historical P08 run; it is not
substituted for the synchronized P09 result. Its 5391-file scan and `445.599 ms` baseline remain
P08-only evidence rather than being overwritten by the P09 figures.

## Remaining delivery work

P09 qualification is complete. The branch still needs its final publication commit, push,
remote/local SHA equality proof, and creation and inspection of the required non-Draft PR. The
tested P09 SHA is not claimed as the final PR head SHA. Until publication is complete,
`READY_FOR_PROTECTED_REVIEW` is not issued.
