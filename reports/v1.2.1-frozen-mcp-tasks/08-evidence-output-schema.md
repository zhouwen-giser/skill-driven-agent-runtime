# SDAR v1.2.1 Phase 8 Evidence A and Output Schema

Status: **PASSED WITH BASELINE HOST LIMITATION**

Frozen Tool Results now validate `structuredContent` against the discovered Tool `outputSchema` and parse
the bounded `io.sdar/evidence` profile into objective `ProviderEvidenceItem` values. The adapter rejects
invalid profile versions, local `requirementId`, malformed identity/timestamps, unsupported URI schemes,
missing JSON Pointers, duplicate IDs and excessive size/depth.

`SkillEvidenceMatcher` binds Provider items to SDAR-local requirements only by exact `evidenceType` and
creates `validatedEvidence.<requirementId>`. Hard-gate URI evidence requires a lowercase SHA-256 digest.
The Workflow resolver no longer promotes arbitrary Provider `_meta`, `structuredContent.evidence` or raw
output `evidence`; only the matcher-created `validatedEvidence` map can satisfy a Workflow hard gate.
Execution evidence references retain the Provider evidence ID, local requirement, match result,
pointer/URI/hash and Runtime Revision. Child Skill output mappings are unchanged.

## Verification

| Command | Result |
| --- | --- |
| focused Evidence unit tests | passed 11/11 across matcher, Workflow binding and execution recording |
| focused Evidence/lifecycle contracts | passed 18/18 |
| `pnpm test:unit` | passed 76 files, 475 tests |
| `pnpm test:contract` | 153/154 passed; unchanged Windows symlink setup failed with `EPERM` |
| isolated PostgreSQL Repository integration | passed 58/58 against operator-managed port 55442 |
| `pnpm verify:architecture` | passed across 273 TypeScript source files |
| `pnpm build` | passed |
| format/lint/typecheck | passed |

The default integration launcher was not used because it would address fixed port 55432 and the `sdar`
Compose project. The relevant Repository suite instead reused the already isolated Phase 11 PostgreSQL
service on port 55442 and created/dropped its own test database. No operator container was stopped,
recreated or modified. Full E2E and real Provider Evidence interop remain Phase 10/11 gates.

Implementation commits: `c4ecdac`, `7720cb4`, `267df14`, `1768990`.
