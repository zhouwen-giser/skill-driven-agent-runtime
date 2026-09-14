# EP: SDAR source union delivery

## Purpose / Outcome
One command creates a verified source union retaining the qualified upstream bytes. No server mutations.
## Requirements Covered
DEV-DEPLOY delivery; NFR-SEC-001 intranet documentation; NFR-SEC-002 credential exclusion as packaging evidence only (runtime encryption unchanged); ADR-153 GOWM shared-storage operational traceability. No baseline/API/schema change.
## Context and Orientation
Existing SDAR source packager and sz-gowm report; qualified telemetry union a2605b5999e8cd2f includes Authority.
## Architecture and Interfaces
`pnpm package:joint -- --upstream PATH [--output DIR]`; Node launcher, Python standard-library archive verifier, existing source packager. Content-addressed delivery directory, atomic publication, exact-match reuse.
## Progress
- [x] 2026-09-09 Implement source union and deployment history.
- [x] 2026-09-09 Regression, full gate and clean unpacked build/config checks passed; candidate union verified. Final delivery identity is recorded externally in reports/united-package-20260909/package-final.json to avoid self-referential archive hashes.
## Discoveries and Surprises
Existing source tar recorded mtimes and owners; normalized metadata is required for repeatable delivery. Custom output directories must be excluded from subsequent Git source capture; a regression preserves this. Deleted working-tree files are skipped. Historical deployment success is distinct from testing a new bundle.
## Decision Log
Source only, linux/amd64 documented default, exact upstream bytes, external credentials, no server access. Python standard library only; no new dependency.
## Implementation Steps
Validate upstream; capture SDAR; verify nested identities; stage and verify union; publish only complete delivery; preserve existing conflicting outputs.
## Validation
Targeted regression and full format/lint/typecheck/unit/integration/contract/e2e/build/smoke. Clean extracted source build/config checks. Evidence in reports/united-package-20260909.
## Idempotence and Recovery
Normalize archive metadata; exact matching output reused. Temporary staging removed on error. Never overwrite conflicting delivery. No database operation.
## Artifacts and Evidence
artifacts/united/<content identity>/ includes archive, checksum, UNION.json, SHA256SUMS and delivery.json.
## Outcomes and Retrospective
Implementation and release checks passed: unit 2534, integration 242, contract 534, E2E 75; full lint rerun and final focused regressions passed. Complete gate logs and first failures retained. Archive publication verifies before completion and emits delivery.json. No fresh-server or full business-task acceptance claimed.

## Packaging operation: upstream refresh (2026-09-09)
The newer local qualified union is 1579eae9c89bfded (SHA256 436c3706708daa5e2a20e4d2c3fecc595584ee2eed85ebcaafa8d38841b184b6). Its format remains schemaVersion 1/live, and its 491-object Authority schema and release seed are byte-identical to the earlier input. The existing --upstream interface accepts it without implementation changes. Update the usage example and regenerate from current local SDAR source; operation results are recorded separately in reports/united-refresh-20260909. This is a packaging-only refresh, not a new implementation milestone, server deployment or full-stack acceptance.
