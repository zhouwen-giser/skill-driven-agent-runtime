# Local SMPP / Telemetry / SDAR integrated deployment

## Purpose / Outcome

Generate a checksummed source union containing the selected current SMPP/GOWM/GDPS/GSAP/WSGS/Telemetry package and current SDAR, then deploy SDAR Runtime, Control and Console into the existing local environment. Preserve private configuration, upstream data, task semantics and execution gates. Deployment acceptance performs discovery and reads, not device control.

## Requirements Covered

NFR-MNT-001, NFR-SEC-001, FR-ADM deployment visibility and existing GOWM shared-storage authority. New package compatibility and local readiness require actual byte/hash and API evidence; trajectory source guarantees remain the Provider's separately versioned authority.

## Context and Orientation

SDAR starts at main `abc00fa94961f9e4ef9309c7d7e9a2290662995e`, clean tracked source; historical untracked run directories are retained. SMPP local deployment is `cfda8c7f2f651a2c81db3c0e5f169e09100a911f-worktree-572fa8021175`. Selected Telemetry union is `smpp-gowm-gdps-gsap-wsgs-telemetry-f0f78c38011bdec3.tar.gz`, SHA-256 `bd3db61ded086998a76812646d9a3423e5f898b56246234fbde40243feeadb6e`. Its WSGS-aware SMPP union has schemaVersion 2, which the current SDAR packager rejects at `upstream/analysis.tar.gz`. Existing local GOWM has no `ugv_sdar`, Control database or vector extension library. The old private SDAR configuration is preserved under `/mnt/data/sdar-site-20260909`.

## Architecture and Interfaces

Support both legacy SMPP union layout and the WSGS-aware version 2 layout. Validate every nested archive inventory, component descriptor, source manifest and hash without changing upstream bytes. No new runtime dependency or external SDK/domain boundary. GOWM remains shared business authority and alone installs its schema; SDAR startup remains read-only contract validation. Control uses a separate database. PostgreSQL image extension adds only pinned pgvector files to the exact existing image. New local listeners use loopback. Source unions exclude credentials and local data.

## Progress

- [x] 2026-10-13 Read current contracts, package identities and local container labels; reproduce new union rejection.
- [x] Add compatible union validation; nine Python methods, six related deployment unit entries and actual source-union validation pass.
- [x] Prepare owner-managed SDAR/Control storage and pgvector; restricted consumer contract validation passes; preserve PostgreSQL volume/environment and device binding history.
- [x] Deploy official PMS against the actual Runtime identity and update Telemetry to package 13361e5b82c6acd7; APIs and processor are healthy after WAL recovery.
- [x] Review the live 12-tool Catalog and add explicit 12/13 trajectory profiles; 28 focused tests pass with exact-set and zero-Tool-call assertions.
- [x] Freeze source 4112a90b; pass 30 stages on the recorded owned test volume, supplement persistent storage checks, and verify reproducible package/image source.
- [x] Complete the user-selected scoped backups, official owner storage/Registry preparation and actual packaged SDAR deployment.
- [x] Verify actual APIs, Console, shared contract, 12 published capability identities, volume/identity preservation and zero device actions; archive logs and update traceability.
- [ ] Complete the full 13-item site inventory after the owner supplies embodied.inspect_area; this dependency remains OPEN.
- [ ] Complete authorized Git publication and exact CI closeout.

## Discoveries and Surprises

- Existing Telemetry Grafana is restarting because its datasource bind file is unreadable to its entrypoint. Treat upstream readiness independently from SDAR readiness; preserve the existing state and repair only if required for integrated readiness.
- Current upstream package includes older GOWM source 506315b. Current SDAR consumes the narrow owner repair dca0fcd; install its official forward overlays instead of consumer DDL or silently relaxing contract verification.
- Historical SDAR network/image/database settings refer to a removed installation. Reuse keys/model settings privately, but reconcile actual current network and managed connection identity.
- The local lint command encounters pre-existing ignored helper scripts under `.codex` and old untracked run captures. Preserve its failure log; use the complete strict frozen-source gate, which exports project inputs without private operational scripts, for current implementation acceptance. No lint rule or test assertion is weakened.
- The database contains a 137 GB state snapshot history. Full dumps were canceled and retained as incomplete captures. Completed scoped backups cover all DDL/global roles, shared business data and affected installation/task histories; archive readability passes. Full restore qualification is NOT_RUN. The user's backup-scope reply excludes snapshot history; its original data stays in the existing volume.
- Final deployment preflight exposed the historical PMS helper's fixed container/DNS name. Add explicit `--runtime-container`, inspect the Runtime role and derive its actual DNS; default-name, current-name/idempotence and wrong-role tests pass. The first frozen run bcdc623f was intentionally canceled through owned cleanup so this fix is included in the final freeze; it is not acceptance.
- Frozen run 18205ad0 passed 23 stages, including 2692 unit and 553 contract tests, then timed out at the unchanged 660-second integration limit. Run d22ed916 was canceled to include the newly discovered trajectory Catalog compatibility change. Neither is acceptance.
- Cold-start adapter discovery initially exposed five reads and caused protected manifest drift. Restart only the idle Runtime after adapter qualification and refresh SDAR discovery. Current authority is 12 tools (10 original plus two trajectory reads); the legacy profile correctly rejects this set. Add an explicit reviewed profile without weakening equality.

## Decision Log

- 2026-10-13 User authorizes generating an integrated package and local deployment. This supersedes NOT_RUN for this local deployment only; real device actions and remote deployment remain outside this task.
- ADR-164 records versioned nested-package validation and owner-managed local storage preparation. Preserve all existing data/credentials and keep recovery images and dumps outside archives.
- 2026-10-13 Exclude snapshot history from the backup scope per the user's answer; preserve original live data. Scoped backup and original volume form the recovery basis.
- 2026-10-13 Add explicit trajectory profiles while preserving external protocol, default profile, TaskBusiness authority, confirmation, side-effect and replay gates.

## Implementation Steps

1. Extend `deploy/united/bundle.py` with explicit legacy/version-2 traversal and strict nested identity checks; extend `bundle_test.py` without weakening existing checks.
2. Run focused packaging tests, then `pnpm verify:isolated -- --frozen` on stable source. Generate deterministic package twice and verify extracted source, metadata and secret exclusions.
3. Build current SDAR image and a pinned pgvector derivative of the exact current GOWM PostgreSQL image. Save database dump, image/container/config/network identity and managed account data privately before any database change.
4. Use the pinned GOWM owner's installer for SDAR schema and required grants. Create independent Control storage through the existing site preparation path. Configure official PMS Registry against the actual SMPP identity and preserve existing configuration values.
5. Start only required SDAR services; verify health, ready, Console, A2A Card, actual MCP discovery and public identity. Do not execute a navigation/recon/fire task. Validate upstream data/identity preservation and expose exact local URLs.

## Validation

Focused Python package regressions and related deployment unit tests, format/lint/typecheck; full frozen 30-stage gate. Package checksum/inventory/source comparison and repeatability. Owned disposable database check before local image activation where necessary. Database backup/readback, installed-contract verification, Control isolation, repeated deployment preserving volumes, HTTP readiness and read-only integration assertions. Commands, exit codes and raw-log hashes under `reports/local-smpp-integrated-20261013/`.

## Idempotence and Recovery

Private state and backup images live outside source archives. Never delete a volume or reset a database. Owner installer rejects modified applied checksums and repeats unchanged steps safely. A database image containing vector must remain available after vector types are installed. Rollback stops only new SDAR services and restores compatible recorded images/configuration; preserve schema/history and upstream data. Do not force-drain active tasks or rewrite bindings during preflight.

## Artifacts and Evidence

Selected upstream archives remain original. New package and SHA/manifest under `artifacts/united/`; local release and private state paths are recorded in the final report. Baseline/reproducer, focused/full gates, image/source identity, deployment receipts, before/after preservation and API checks use actual logs. Credentials, raw configuration and dumps are never committed.

## Outcomes and Retrospective

LOCAL_DEPLOYED_WITH_CAPABILITY_GAP. Code/full isolation gate and local core deployment are verified. Full site bootstrap fails only the retained inspection dependency; patrol is not published. No physical task is run. All earlier failures, including P07 overrun and aggregate timeout, remain NOT_PASS. The isolated memory-backed test condition is explicit; persistent GOWM and all persistent integration cases have separate actual evidence. Whole-project/evolution/device-generation-history and production durability remain open.

Final verification: run 7ba9d4f2 passes 30 stages (2695/553/272/77), input c7f7867c… and baseline 93014ef9…, fresh install/cleanup exit 0. Main fixture uses the owned 2GiB memory-backed PG volume; code/assertions/timeouts unchanged. Persistent GOWM 8/2/32 and persistent P07/final cross-service case supplement the preserved 271 passing persistent aggregate cases. Actual API/source/owner/storage evidence is linked by VALIDATION.json and DEPLOYMENT.json. Twelve unrelated container restarts are observed; identity/images and all original volumes are preserved.

PR40 review (2026-10-14): a valid P2 identifies omitted internal inventories for the deepest WSGS application and GOWM archive. Add strict inventory checks at both boundaries and six missing/stale/coverage negative subcases with all outer hashes rebuilt consistently; legacy behavior remains unchanged. The former 30-stage/source delivery receipts are PRE_REVIEW for this change. New frozen source/package/container and full gates are required before final publication.
