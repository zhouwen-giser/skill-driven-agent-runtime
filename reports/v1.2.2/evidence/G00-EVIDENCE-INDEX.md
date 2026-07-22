# G00 Evidence Index

## Goal

```text
Goal ID: G00
SDAR baseline SHA: 0f52a6dd277f8ca850b47467814680c8fee09901
Branch: feature/v1.2.2-user-goal-planning-business-events
External Provider observed SHA: 196620a
Started At: 2026-07-22T15:35:00+08:00
Completed At: 2026-07-22T16:01:00+08:00
Content Commit: 414d167
```

## Changed files

Only `skill-driven-agent-runtime` files listed by content commit `414d167`. The external Provider has no
SDAR write.

## Commands

| Command | Result | Duration/report |
| --- | --- | --- |
| package `sha256sum -c` | 21/21 passed | terminal evidence, G00 baseline |
| `git fetch --prune origin` + ancestor checks | passed | G00 baseline |
| `pnpm install --frozen-lockfile` | passed | pnpm 11.7.0, 290 packages |
| explicit disposable-infra `pnpm verify` | 7/7 passed | 143,043 ms; `reports/verification/summary.*` |
| external Provider status/ancestor/assets/hash reads | passed read-only | `EXTERNAL-DEPENDENCY-STATUS.md` |

## Tests

```text
Unit+Contract: 650 passed
Integration: 84 passed
E2E: 60 passed
Acceptance: existing 18 + V1.1 16 inventories passed
Interop: v1.2.2 Business Events real interop not run; G10 external gate
```

## Acceptance mapping

| Acceptance | Result |
| --- | --- |
| AC-077 Provider repository read-only | passed for G00 observations; final before/after audit remains G10 |
| AC-078 no automatic merge/tag | passed for G00; final audit remains G10 |
| AC-001–AC-076 | mapped in `docs/26_V1_2_2_TRACEABILITY.md`; implementation pending owning Goals |

## External dependency

```text
EXT-BE-SKELETON: candidate_present_review_pending
EXT-BE-RUNTIME-CANDIDATE: candidate_present_interop_not_run
Provider defects: none
```

## Failures encountered

Environment attempts and root causes are recorded in `G00-BASELINE.md`. No assertion was weakened and no
external/operator database was reset.

## Evidence boundary

Real: PostgreSQL/pgvector, Redis/BullMQ, HTTP/A2A, migration, build and smoke. Deterministic simulated:
model/Provider behavior inside existing SDAR regression tests. External Provider: repository/assets read
only; real Business Events interop unverified.

## Remaining blockers

```text
G07: exact Skeleton/review lock
G10: reproducible Runtime Candidate and real interop
```
