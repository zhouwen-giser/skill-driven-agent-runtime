# Phase P07 Cross-Project Regression Report

## Status

- Phase result: `PARTIALLY_VERIFIED`
- Blocking condition: `BLOCKED_LIVE_CANDIDATE_SUT_AND_TEST_DATABASE`
- Breakpoint disposition: `BP-SDAR-007 = ALREADY_FIXED_ON_MAIN`
- Exit token `CROSS_PROJECT_REGRESSION_PASSED`: **not issued**
- Physical device writes: `0`

The current static and deterministic contract paths did not reproduce an SMPP or Console code
defect. The database-backed controlled SDAR consumer could not start because `TEST_DATABASE_URL`
was unset, and the available Console live SUT was not built from the current repair candidate.
Those gaps prevent a live cross-project completion claim.

## Local source observations

No `fetch`, branch switch, rebase, or external-repository write was performed for P07. These are the
local refs observed on 2026-08-13; they are not proof that the remote repositories did not advance
after their last local fetch.

| Repository | Checked-out branch / HEAD | Local `origin/main` | Observation |
| --- | --- | --- | --- |
| `skill-driven-agent-runtime` | `fix/sdar-breakpoint-repair` / `01be490985fdd410e917a35b6791b2b029fd63a9` | `b7f02dcedc9680758e7e5f779a939a738d8de770` | P07 tests used the shared repair-candidate code tree; this was not a deployed live candidate. |
| `sdar-mcp-provider-platform` | `fix/smpp-breakpoint-repair` / `7e8b1193d020e9973805aa8cb19d3d4c3dbc1afb` | `340abeeff75cd811b40e1bfd9d5a26f5a62f2c45` | `origin/main...HEAD = 1 0`; the checked-out tree and local `origin/main` tree are identical. |
| `sdar-organization-control-plane` | `feature/single-node-console-live-integration` / `1a5ea3c279331a8fd83dd117d73d5a7166c668b7` | `e7fa2348f7d574a0e9363bdf33598f33144a909c` | `origin/main...HEAD = 1 0`; the checked-out tree and local `origin/main` tree are identical. |

The one-commit differences for SMPP and Console are their merge commits; their content trees are
byte-identical to the corresponding local `origin/main` refs. Both external worktrees were clean
after verification.

## Safety boundary

The following variables were all unset during P07:

- `ALLOW_REAL_DEVICE_SIDE_EFFECTS`
- `REAL_DEVICE_TEST_RUN_ID`
- `ALLOW_CLIMATE_POWER_TEST`

No Home Assistant or other real-device runner was started. All Provider execution evidence below is
contract, deterministic fake, or source compatibility evidence. `physicalDeviceWrites=0`.

## Passed evidence

| Area | Gate | Result |
| --- | --- | --- |
| Frozen Registry compatibility | `node scripts/verify-smpp-sdar-registry-projection-contract.mjs --require-canonical` | PASS: 6 canonical assets, 10 checksum vectors, `canonicalByteIdentical=true`, `smppNativeAuthorityVerified=true` |
| SDAR credential-free / private HTTP | Focused Vitest for the HTTP Registry client, outbound endpoint policy, and Node Control environment | PASS: 3 files / 34 tests |
| SMPP Registry projection | Unit, frozen-contract, and HTTP projection tests | PASS: 3 files / 18 tests, including 200/304, projection checksum, and native lineage |
| SDAR Binding / Catalog / read-only authority | Binding service, deterministic read-only admission, and MCP Registry tests | PASS: 3 files / 54 tests |
| SMPP Catalog / Task protocol | Dynamic Catalog, DetailedTask, notification, consumer-validation, and PR16 interop tests | PASS: 5 files / 35 tests |
| SDAR remote terminal consumption | Remote polling and continuation unit tests | PASS: 2 files / 29 tests |
| Production operation conformance | `verify-node-control-operation-conformance.mts` | PASS: 131 operations (94 public, 37 internal), 455 RBAC decisions, 131 contract-covered operation IDs |
| Public Task command routes | Focused Node Control HTTP contract test | PASS: 1 executed / 5 skipped; the executed case exercised pause, resume, cancel, and Goal Patch with governed `202` responses |
| Runtime Task control client | Focused Runtime HTTP client tests | PASS: 1 file / 5 tests |
| Console frozen contract | `node scripts/check-contract.mjs` | PASS: 94 public operations / 29 schemas |
| Console Task command mapping | Focused `live-command-map` tests | PASS: 1 file / 8 tests |
| Console BFF compatibility | `node --test server/app.test.mjs server/config.test.mjs` | PASS: 10/10 tests |
| Console Task/A2A rendering foundation | Live resource and presentation mapper tests | PASS: 2 files / 19 tests |

The Console and SDAR copies of the following contract artifacts have identical SHA-256 values:

- Node Control public OpenAPI;
- Runtime Control internal OpenAPI;
- public operation inventory;
- Task Summary, Management Operation, Command Request, and Problem Details schemas.

## Requirement mapping

| P07 requirement | Result | Evidence boundary |
| --- | --- | --- |
| `sdar-registry-v1` latest/bootstrap 200/304 | VERIFIED_DETERMINISTIC | SMPP projection HTTP tests and byte-identical canonical bundle |
| Registry checksum and native lineage | VERIFIED_DETERMINISTIC | 10 shared vectors, canonical bundle verification, lineage-header tests |
| Credential-free SMPP Source | VERIFIED_DETERMINISTIC | Explicit `unauthenticated://none` path resolves no secret and sends no authorization header |
| Explicit private HTTP | VERIFIED_DETERMINISTIC | Exact dual-allowlisted RFC1918 host and port admitted; default/public/metadata paths rejected |
| Binding and Catalog | VERIFIED_DETERMINISTIC | Current binding, Catalog revision/checksum, and readiness drift checks passed |
| Read-only MCP invocation | VERIFIED_DETERMINISTIC | Read-only admission and mock Catalog invocation passed; no physical Provider was contacted |
| Remote terminal and reconciliation | VERIFIED_DETERMINISTIC | SMPP terminal notification plus SDAR polling/continuation suites passed |
| Console Task command compatibility | VERIFIED_STATIC_AND_CONTRACT | Frozen contracts are byte-identical; production SDAR routes and Console mappings passed |
| Console A2A terminal display | VERIFIED_STATIC_AND_DETERMINISTIC | Task phase fields and terminal presentation mapping passed; live browser display was not rerun |
| Affected P08/P09 live journey | NOT_VERIFIED | No current-candidate live SUT was available |

## Blocked evidence

### Database-backed controlled SDAR consumer

`tests/sdar-interop/controlled-sdar-consumer.test.ts` stopped before test collection with:

```text
Error: TEST_DATABASE_URL is required
Test Files 1 failed
Tests no tests
```

This is an environment blocker, not a passing or failing SMPP interop assertion. It leaves the
database-backed Registry -> Catalog -> Tool/Task -> notification -> `tasks/get` journey unverified.

### Candidate Console live SUT

The available Console integration clone was at
`816f25f86910a94cba260e9f84e98de92074b75f`, which predates the current SDAR Task-control repair.
Running live commands against it would only reproduce the historical environment, not qualify the
candidate. Therefore no live command, live read, browser terminal-display, or P08/P09 journey claim
is made.

`EXT-SDAR-NODE-CONTROL-TASK-CONTROL-001` is not reproducible in the current candidate's production
route registry or deterministic HTTP contract tests: all four public routes are registered and
delegate through Runtime authority. Its live deployment-level closure remains unverified until a
candidate-built Runtime and Node Control SUT is started.

## External findings

No current SMPP-owned or Console-owned code defect was reproduced, so this phase does not create an
`EXT-SMPP-*` or `EXT-CONSOLE-*` report. The open items are qualification-environment gaps:

- `TEST_DATABASE_URL` is unavailable for the controlled SDAR consumer;
- a live Console stack built from the repair candidate is unavailable;
- remote freshness beyond the observed local `origin/main` refs was deliberately not checked
  because P07 was instructed not to fetch.

## Conclusion

BP-SDAR-007 remains `ALREADY_FIXED_ON_MAIN`: credential-free SMPP and exact allowlisted private HTTP
are present and their current static/deterministic regressions pass. Cross-project live
qualification remains:

```text
PARTIALLY_VERIFIED
BLOCKED_LIVE_CANDIDATE_SUT_AND_TEST_DATABASE
physicalDeviceWrites=0
```

