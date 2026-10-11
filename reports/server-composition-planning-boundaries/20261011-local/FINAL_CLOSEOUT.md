# Server composition and planning authority acceptance

Status: **REVIEW_FIXES_REVALIDATION_PENDING**, 2026-10-11, Asia/Shanghai. This report tracks the user-approved local refactor scope; current-source full acceptance is pending. Git publication is authorized and follows successful CI; site/provider operations and deployment are **NOT_RUN**.

The server now composes fifteen typed stages in dependency order, retains its original runtime exports, and cleans up partially acquired resources once. UGV admission/input/candidate/authorization/terminal-evidence policies live in the internal Profile package; the MCP adapter owns SMPP client construction. Generic Task, Remote Task and TaskBusiness lifecycle writers remain in the existing kernel.

User Goal and Workflow generators return immutable candidates through read/model/planning-audit ports. Separate formal services validate identity, persist plans and failures, supersede versions with CAS and preserve confirmed-plan idempotence. Initial Task orchestration writes Skill evidence and optionally confirms only after formal commit; Capability binding still precedes Task publication. Interactive/experience paths receive generator objects; revision, Goal Patch, replanning and child workflows retain compatible formal facades. No new migration, dependency or external contract/default is introduced.

PR36 review fixes have passed 66 focused unit cases, typecheck, lint, eight architecture negative fixtures and the owned GOWM driver (two formal E2E and 30 native scenarios). The full gate results below certify the pre-review commit 870e94b6 only; the previous closeout is preserved in PRE_REVIEW.

## Pre-review tested identities

- Runtime source commit: `870e94b6bfa9ba4889e28c90abd2caf2258420e6` (base `a230bac9b61e6cf901a91c094dbfe63704717fce`).
- Final runtime input SHA-256: `65aa5c85b5c13b3b5ace87ebb8f426365fa6976a61b7adcb0fe0e38764a0dbe5`.
- Final frozen baseline SHA-256: `a2eb495293ef1fab9cb7ef457c22627d220cda59541cb5d5303b67a36c4fbf8d`.
- [M4 source identity](M4_SOURCE_IDENTITY.json): all 2024 local runtime files and six external verification inputs match the runtime commit, with no missing/different/extra runtime file. Final evidence/traceability metadata updates have separate classification; [original authoritative requirements, dependencies and schemas](BASELINE_COMPATIBILITY.json) remain unchanged.
- Intermediate M1/M2 snapshots retain the parent Git SHA plus the actual milestone overlay. Their full hashed manifests, rather than the parent SHA alone, identify the tested files. Every run verifies its own frozen runtime and baseline remained unchanged.

## Complete isolated gates

M1–M3 command: `pnpm verify:isolated`. Final command: `pnpm verify:isolated -- --frozen`. The final fresh lockfile installation exits 0; its original log is retained as `M4/sdar-verify-e4e3339a-7a6d-45ee-bc0a-f5018bcab49b/verification/raw/frozen-install.log`. The installed bundled Python 3.12.14 provides the existing official TCK virtual environment. [Actual environment](verification-environment.json) records Linux, Node 22.23.2, pnpm 11.25.0 and Docker 29.3.0.

| Milestone | Exact run / validation | Gate stages | Unit / contract / integration / E2E | Runner / cleanup exit |
| --- | --- | --- | --- | --- |
| M1 | [sdar-verify-8e80b7f4-b164-4987-aa1f-361a129a99b5](M1_VALIDATION.json) | 30/30 | 2633 / 552 / 270 / 77 | 0 / 0 |
| M2 | [sdar-verify-e035b76b-81fd-4413-834a-06a939bec908](M2_VALIDATION.json) | 30/30 | 2633 / 552 / 270 / 77 | 0 / 0 |
| M3 | [sdar-verify-53662b2d-8114-4df1-8c51-889c8d1d7898](M3_VALIDATION.json) | 30/30 | 2650 / 552 / 270 / 77 | 0 / 0 |
| M4 | [sdar-verify-e4e3339a-7a6d-45ee-bc0a-f5018bcab49b](M4_VALIDATION.json) | 30/30 | 2650 / 552 / 270 / 77 | 0 / 0 |

Each validation contains command, exit, runtime/baseline hashes, stage metrics, original log SHA-256 and archived raw path. Format, lint, typecheck, unit, contract, real PostgreSQL/Redis integration, E2E, build, migrations, official TCK, canonical evidence replay and all three smokes passed. The E2E driver runs complementary selections: 76 functional cases plus the unchanged single performance case; all 77 cases execute. Its summary counts eight suite executions because the performance file runs again with the complementary filter.

Official TCK remains the existing `http_json` MUST profile: 74 passed, 161 skipped and 30 deselected. Other transports are not newly certified. [Case results](CASE_RESULTS.json) map sixteen local acceptance groups to actual tested files and hash-checked logs; Git delivery remains pending, and two site/deployment groups are NOT_RUN.

## Same-frozen-source GOWM verification

[Restricted-role verification](GOWM_VALIDATION.json), `sdar-smpp-gowm-d30c19aa-7c08-4828-a288-ad0f2bd409f8`, passes all eight driver steps, two formal navigation/recon E2E cases and 26 native repository boundary scenarios. Owner source is independently pinned to `a1a86186ea866911124de72374e17fe19897fa9e`. Its local input manifest exactly equals the local subset of the M4 frozen manifest; six external verification inputs are recorded separately. The local runtime hash is `a8ab9dfd6e8825fb6883444ad716d151b6eafd7762a1e7c759833d0dc0e96473`, with the same frozen baseline hash and unchanged inputs throughout.

Real generated consumer roles have no native DDL or private SMPP UPDATE permission and can write native observations. Schema/install-history digests before/after formal and boundary cases agree; private SMPP rows before/after the formal cases agree. Both owned containers pass ownership checks and removal with exit 0. Models and MCP providers are loopback protocol fixtures, not physical providers. The native suite's existing project-level `INCOMPLETE` and auxiliary-link upstream contract gap remain open; this scoped refactor does not claim whole-project release readiness.

## Performance and failure history

The pre-refactor frozen source also reproduces the host's performance failure. ADR-161 follows the repository's accepted real tmpfs PostgreSQL benchmark isolation, while functional, migration, recovery and smoke tests use persistent storage. The original 72/72 runtime samples, 100 append samples and all 15% drift / 10% P95 / 20 ms append limits remain unchanged. Every milestone passes the original performance assertion:

| Milestone | Baseline median drift (limit 15%) | Runtime P95 regression (limit 10%) | Append P95 (limit 20 ms) |
| --- | --- | --- | --- |
| M1 | 8.857% | 4.812% | 2.588 ms |
| M2 | 4.142% | -2.028% | 2.751 ms |
| M3 | 3.127% | 2.143% | 2.545 ms |
| M4 | 7.468% | -1.615% | 2.436 ms |

The owned fixture records real database version, resolved Compose hash, immutable image IDs and cleanup. The unchanged historical result JSON has a literal Windows label; [environment evidence](verification-environment.json) records the actual Linux host. Original outputs are retained verbatim.

[Failed attempts](FAILED_ATTEMPTS.md) preserve nine complete failed gate runs, the early GOWM baseline-change failure, performance diagnostics and the source-enumeration helper correction. Those failures remain failures. No behavioral assertion, case or numerical limit was weakened or removed.

## Delivery

Pending commit/push/PR CI/normal merge at this report revision. CI and merge must match the frozen runtime inputs. The ExecPlan records publication after it actually occurs; all site reads/writes, physical provider actions and deployment remain NOT_RUN.
