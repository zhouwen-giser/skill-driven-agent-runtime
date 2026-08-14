# Phase P06 Aggregate Verification and Performance Report

## Status

- Phase result: `PASSED`
- Breakpoint disposition: `BP-SDAR-006 = FIXED`
- Exit criterion: `FULL_VERIFY_PERFORMANCE_PASSED`
- Verified implementation SHA: `aa4231d2fb98050eaf1fbc5f9c77ef76ca7bf7bd`
- Evidence commit after the run: `9ab42ac6e076d007115d640ed4e3a84b0349b8b4`
- Baseline and current `origin/main`: `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Physical device writes: `0`

The repository-defined `pnpm verify` gate passed without changing the Phase 13 percentile,
sample-count, Runtime-regression, baseline-drift, or Evidence-append thresholds. This is local
release-gate evidence, not a production SLO, HA, or physical-device qualification.

## Final aggregate verification

The official gate started after an explicit clean-worktree check and ran with operator-managed,
Goal-isolated PostgreSQL and Redis. It started at `2026-08-13T16:59:12.617Z`, finished at
`2026-08-13T17:14:31.040Z`, and passed all ten stages in `918423 ms`.

| Stage | Result | Current evidence |
| --- | --- | --- |
| Static, Unit, Contract, conformance, and build | PASS | 268 files / 1928 tests; 169 Management OpenAPI operations |
| Cognitive replay | PASS | No physical Provider call |
| Migrations | PASS | 53 migrations |
| PostgreSQL/Redis integration | PASS | 35 files / 201 tests |
| PostgreSQL/Redis/model/MCP E2E | PASS | 7 files / 73 tests |
| Official A2A TCK | PASS | Official TCK stage exited `0` |
| Canonical Evidence demo | PASS | 44/44 scenarios in the current Phase 12 evidence |
| Infrastructure smoke | PASS | Stage exited `0` |
| Server/Console smoke | PASS | Stage exited `0` |
| Node Control API/worker smoke | PASS | Stage exited `0` |

Machine-readable authority is `reports/verification/summary.json`; every raw stage log and its
SHA-256 is recorded under `reports/verification/raw/`.

## `dirty=true` interpretation

`reports/verification/summary.json` records `dirty=true`. This does not mean the candidate began
dirty. `scripts/verify-full.mjs` writes each tracked raw stage log before it runs
`git status --short`, so evidence generation itself makes the tree dirty before the summary flag is
sampled. The run began after a clean-worktree check, and its generated evidence was subsequently
committed in `9ab42ac6e076d007115d640ed4e3a84b0349b8b4`. No product source changed between the verified
implementation SHA and that evidence commit.

## Performance result

The authoritative raw result is `reports/v1.4.1-evidence/phase-13-performance.json`.

| Gate | Measurement | Unchanged threshold | Result |
| --- | ---: | ---: | --- |
| Runtime pooled P95 | baseline `490.639 ms`; enabled `438.650 ms`; regression `-10.596%` | `<= 10%` | PASS |
| Baseline stability | window medians `360.859`, `366.079`, `386.389 ms`; drift `6.833%` | `<= 15%` | PASS |
| Evidence append P95 | `4.402 ms` over 100 samples | `<= 20 ms` | PASS |

The measurement retained 72 interleaved baseline samples, 72 Evidence-enabled samples, 100 append
samples, two discarded warm-up windows, and three 12-block ABBA/BAAB measurement windows. The
receiver observed 1549 records. Evaluation used pre-display values and no slow sample was removed.

The benchmark boundary used the real local A2A -> Runtime -> PostgreSQL/Redis business path and real
local HTTP Evidence delivery with PostgreSQL ACK. Model and Skill behavior remained deterministic
fixtures, and `physicalSideEffects=false`.

## Preserved first failures

The phase retained all eight formal failed attempts rather than rewriting them after the final pass:

| Attempt | Classification | Resolution boundary |
| ---: | --- | --- |
| 1 | Bootstrap lint | Removed one unused local helper; no behavior or gate change |
| 2 | Windows Bash fixture | Selected Git for Windows Bash; assertion remained active |
| 3 | Default port conflict | Moved to Goal-isolated ports; no unrelated service stopped |
| 4 | Docker address-pool exhaustion | Used operator-managed Goal-owned containers; no network cleanup |
| 5 | PostgreSQL optional-field fixture | Removed an incorrect own-property expectation only |
| 6 | Seeded Prompt owner conflict | Reused the migrated stage owner and appended a governed version |
| 7 | Operation-aware E2E authority fixture | Added explicit model routes and read-only loopback semantics |
| 8 | Transient host-port readiness | Preserved as environment evidence; later isolated host probes and the final gate passed |

Additional current E2E repairs restored Workflow replan confirmation and the exact governed-control
denial evidence. Failed-attempt JSON remains under `reports/sdar-breakpoint-repair/` and
`reports/v1.4.1-evidence/failed-attempts/`.

## Limitations

- The run is local Windows qualification with isolated PostgreSQL/Redis and deterministic
  model/Skill/Provider fixtures; it is not production-load or production-HA evidence.
- Real SMPP and physical-device recovery remain `NOT RUN` as recorded in P05.
- The monolithic Runtime A-close -> Runtime B-terminal drill remains `NOT RUN`; its persistence,
  queue, reconstruction, continuation, and terminal boundaries passed separately.
- No real-device or fire side-effect gate was enabled; `physicalDeviceWrites=0` and `fireCalls=0`.

`FULL_VERIFY_PERFORMANCE_PASSED`
