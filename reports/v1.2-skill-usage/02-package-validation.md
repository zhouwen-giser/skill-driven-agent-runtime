# SDAR v1.2 Phase 2 — Skill Package Validation

- Goal: deterministic, fail-closed validation and loading of Skill usage packages
- Dependency class: `V11-INDEPENDENT`
- Base SHA: `72af560b87589cd1cedcfc6affd6eb3fdc61f548`
- Resulting SHA: `0ddcd4867201a7cfc11ba481b6c92cc4cb5d0b11`
- v1.1 Gate: OPEN

## Delivered

The Domain owns package-neutral manifest, document, read-result and import-candidate contracts. The
Application owns `SkillPackageSourceReader`, `SkillPackageValidator` and `SkillPackageImporter` ports and
orchestration. The Node filesystem adapter is the only layer that sees paths and files. It canonicalizes
the package root, admits only unique normalized relative JSON/Markdown paths, rejects symlinks and root
escapes, decodes fatal UTF-8, enforces 256 KiB per-file and 1 MiB aggregate limits, verifies SHA-256 for
every declared artifact and produces a stable package checksum.

`schemas/skill-package.schema.json` is strict Draft 2020-12 JSON Schema. Validation rejects unknown
fields, malformed embedded input/output schemas and Domain-level usage contradictions before an
immutable exact `SkillVersion` import candidate is exposed. The importer does not write a registry or
database. JSON plus bounded `SKILL.md` is intentional; no YAML dependency or executable package file is
admitted.

`createSkillVersion` now snapshots and recursively freezes all previously shallow nested JSON/policy
members and fails closed on cyclic, non-plain, non-finite or over-depth JSON. This closes an immutability
hole exposed by package-boundary review and applies equally to legacy callers.

## Security and architecture evidence

Contracts cover valid immutable import, unknown schema fields, Domain contradictions, traversal,
symlinks, checksum drift, malformed JSON, invalid UTF-8, per-file and aggregate limits, executable file
extensions and invalid embedded schemas. Package files are import artifacts only; PostgreSQL remains the
future production authority. No SDK, ORM, Provider, Workflow, migration, API, Console or LangGraph type
was introduced. The existing single Runtime and v1.1 integration path are untouched. No ADR is required
because EP-10 D10-004/D10-005 already freeze these boundaries.

## Verification

- complete self-managed Compose `CI=true pnpm verify`: passed in 149,172 ms;
- static/unit/contract/build stage: 77 files / 513 tests passed;
- real PostgreSQL/Redis integration: 9 files / 80 tests passed;
- local E2E: 2 files / 49 tests passed;
- architecture: 239 TypeScript source files passed;
- A2A MUST 74/74, 110 OpenAPI operations, 68 migration pairs, builds and both smoke stages passed;
- after adding the final aggregate-size and executable-extension test-only cases: focused 10/10,
  strict typecheck and targeted ESLint passed.

The ignored operator `.env` was temporarily isolated with an EXIT trap for the self-managed gate and
restored unchanged. Model and Provider behavior in the inherited suites remains deterministic local
simulation; no external Provider interoperability is claimed.

## Limitations and next step

Phase 2 intentionally does not publish packages, mutate the existing registry, persist snapshots or
expose API/Console operations. Phase 3A extends the existing in-memory catalog/version interfaces;
Phase 3B supplies the formal `move-to` and `area-patrol` packages.

## Publication

Commit `0ddcd4867201a7cfc11ba481b6c92cc4cb5d0b11`
(`feat(v1.2): validate and load skill usage packages`) was pushed immediately to the tracked origin
branch and the remote SHA matched exactly. This evidence is recorded in a follow-up commit without
amending, rebasing or force-pushing the published Phase commit.
