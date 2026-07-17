# SDAR v1.2 Phase 3A — Existing Skill Catalog Extension

- Goal: extend the existing in-memory catalog/version path with Skill usage projections
- Dependency class: `V11-INDEPENDENT`
- Base SHA: `467c96b501f82c955940509ffaa31ed6d7aa1180`
- Resulting SHA: pending publication
- v1.1 Gate: OPEN

## Delivered

`SkillRegistryService` remains the sole registration/version service. It now revalidates native usage
on register/import, preserves exact package version continuity, provides immutable current and exact
version reads, includes `usageSpecification` in legacy/native diffs, and returns frozen catalog
snapshots. The snapshots summarize source, visibility, supported/default modes, Task Types, composition,
required context/evidence counts and lifecycle without exposing mutable package or Runtime state.

The existing current-version repository query powers catalog filtering. Visibility flags, execution
mode, derived domain, exact capability tag and lifecycle compose with AND semantics. ADR-096 freezes the
otherwise ambiguous classification rule: the first dot/colon/slash capability segment is its domain and
the full capability is its tag. Lifecycle is only an existing-status projection. New selection candidate
snapshots contain the same usage summary; the field remains optional for old persisted selection records.

## Architecture guardian evidence

Domain owns catalog projections and deterministic filtering. Application only coordinates the existing
Repository and Registry. No parallel catalog, taxonomy state, lifecycle state machine, migration,
Management API, Console, Provider authority, Workflow or Runtime graph was added. Exact package import
still stores only through the existing repository port, and Phase 7 remains responsible for PostgreSQL
authority and audit persistence.

## Verification

- targeted Registry and selection unit tests: 2 files / 12 tests passed;
- all unit tests: 67 files / 417 tests passed;
- strict TypeScript typecheck: passed after final immutable-query changes;
- full repository format check and ESLint: passed;
- architecture: 240 TypeScript source files passed.

Tests cover native/legacy summary and diff, exact immutable read, exact package version conflict, invalid
usage rejection, active/inactive lifecycle, combined visibility/mode/domain/tag filters, exact tag
matching and selection candidate projection. No test was skipped or weakened.
The first full lint identified one value-versus-type import classification; the import was corrected and
the complete format/lint/typecheck gate then passed.

## Limitations and next step

The catalog is in-memory through existing test adapters in this Phase. PostgreSQL, import audit,
Management API and Console are Phase 7 work. Phase 3B adds reviewed `move-to` and `area-patrol` packages
using the Phase 2 boundary and this catalog contract.

## Publication

The designated Phase commit is pending. Its immutable commit and remote SHA will be recorded in the
immediate follow-up evidence commit without amend, rebase or force push.
