# SDAR v1.2 Phase 7 — Versioned Skill Usage Persistence and Management API

- Dependency class: `V11-MAIN-BASELINE-DEPENDENT`
- Phase input SHA: `8d94dbc8cca66f372af1f9474ac3cee5eaf3739c`
- Resulting SHA: pending Phase 7 publication
- Migration high-water: `0105_skill_usage_specification`
- Gate: passed

## Runnable increment

Migration 0105 extends the existing `skill_version` authority with one nullable, immutable-at-version
`usage_specification_json` snapshot and adds a checksum-bound `skill_package_import_audit` row keyed by
the same `(skill_id, version)`. The Registry, exact-version reads and lifecycle-copy path remain the only
Skill authority; no parallel registry, lifecycle or taxonomy was introduced. Legacy versions retain the
Phase 1 guidance projection.

The Server now wires the bounded Phase 2 package reader and validator into the existing Registry. The
Management API and OpenAPI expose read-only package validation, revalidated atomic import, exact-version
read and filtered visibility/mode catalog operations. Existing diff, enable/disable and rollback routes
remain lifecycle authority. Console controls call those real endpoints and current Skill rows show native
mode/visibility fields or an explicit legacy-guidance label.

One real E2E exercises:

```text
formal package files
  -> bounded reader/checksums/schema validation
  -> Management API import
  -> exact-next-version Registry guard
  -> PostgreSQL usage + import audit transaction
  -> exact version / catalog / lifecycle copy
```

A second import of the stale package version fails with `SKILL_IMPORT_VERSION_CONFLICT`. Validation is
read-only, import re-reads and revalidates, active/normative changes create a new version, and Runtime
authority reads only PostgreSQL. Package Markdown is not returned by the validation API.

## Migration and rollback

The explicit isolated post-v1.1 migration chain now reaches 0105. The default released profile still
stops at 0064. Verification passed for empty and 0049 released upgrades, 0064-to-0105 isolated upgrade,
empty rollback/reapply, explicit profile/isolation guards and ledger-gap fail-closed behavior. Rollback
refuses when any native Usage or package import evidence exists with
`MIGRATION_0105_ROLLBACK_REQUIRES_NO_SKILL_USAGE_EVIDENCE`; after evidence removal, down/up succeeds.
There are 69 reversible migration pairs. Migration 0106 remains reserved for Phase 11 execution records.

## Verification

- full `pnpm format:check`, `pnpm lint` and strict `pnpm typecheck`: passed;
- focused usage/Registry/package/API/Console tests: 5 files, 83 tests passed;
- real PostgreSQL repository integration: 1 file, 56 tests passed;
- real Server/API/filesystem/PostgreSQL/Redis E2E file: 48 tests passed;
- Management OpenAPI: 114 implemented operations matched;
- architecture: 246 TypeScript sources passed;
- released and isolated migration path verifiers: passed through 0064 and 0105 respectively;
- production Server and Console build: passed.

The PostgreSQL/Redis/API/filesystem paths are real local infrastructure. Model and external production
Provider interoperability are outside this phase. A complete `pnpm verify` is not mandatory until Phase
10 and was not claimed here.

## Recovery

Phase 8 is the next entry point: bind Skill Task Types and Provider policies to the final v1.1 readiness
authority without persisting live Provider/resource state in Skill. Draft PR #5 remains Draft and no
merge is authorized.
