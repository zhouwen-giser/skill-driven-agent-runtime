# ADR-101: Skill Package Import and Runtime Authority Boundary

## Status

Accepted on 2026-07-17.

## Context

Skill packages are reviewable distribution artifacts containing bounded Markdown and JSON contracts.
Loading package files on every execution would make mutable filesystem content a production authority.

## Decision

- Packages use strict JSON machine files plus bounded UTF-8 `SKILL.md`; no YAML parser, script hook,
  module import or package-local executable is required or allowed.
- The filesystem adapter rejects root escape, traversal, symlinks, non-files, invalid UTF-8, oversized
  content, checksum drift and malformed JSON before Application validation.
- JSON Schema and embedded input/output schemas are validated before a package becomes an immutable
  import candidate. An import candidate is evidence, not an active Skill.
- Phase 7 publishes through the existing Skill Registry transaction and records source metadata,
  package/file checksums, validation time and import audit with exact version identity.
- Runtime reads only the validated PostgreSQL snapshot. Files under `skills/` are never live runtime
  configuration.

## Consequences

Packages remain portable and reviewable while production behavior is versioned, reproducible and
recoverable. A changed package must be revalidated and published as a new version.

## Rejected Alternatives

- Execute package scripts: violates the no-generated-code rule.
- Runtime filesystem loading: permits unreviewed drift and breaks system-of-record semantics.
- Treat checksum success alone as validation: does not prove schema or normative correctness.
