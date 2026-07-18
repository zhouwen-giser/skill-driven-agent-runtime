# SDAR v1.2 Phase 1 — Skill Usage Domain Contract

- Goal: immutable, bounded and backward-compatible Skill Usage contracts
- Dependency class: `V11-INDEPENDENT`
- Base SHA: `59287cc3f704e9878b5ccf2299f94842a7ee7840`
- Resulting SHA: `53e7b26120f9b65cd1cc01329c9ccc8bebe488f7`
- v1.1 Gate: OPEN

## Delivered

`packages/domain/src/skill-usage.ts` owns `SkillUsageSpecification`, execution modes, visibility,
normative/adaptive/observed separation, context requirements, Task/Provider bindings, fixed dependencies,
capability slots, four failure policies, evidence gates, patch candidates and usage-source projection.
`SkillVersion` accepts the optional additive snapshot and existing versions without it remain valid.
Skill Graph exact-version snapshots preserve a native usage specification without changing its generic
depth-8 graph authority. Legacy projection admits guidance only and does not invent template, procedure,
Task binding or composition capability.

The constructor rejects unknown enums at runtime, contradictory visibility and Provider policies,
unsupported/default mode mismatch, duplicate IDs, oversized arrays/text/objects, non-finite/cyclic or
non-plain JSON, executable artifact extensions, private-reasoning fields, evidence hard gates that are
not required, and usage depth beyond 5. Accepted snapshots are recursively frozen. `SkillPatchCandidate`
is candidate-only and has no publication operation.

## Architecture guardian evidence

Touched boundaries are the Domain-owned Skill version and its exact graph snapshot. No Adapter or
external type crosses the boundary; no Workflow, Provider, persistence or Runtime state was introduced.
The v1.2 usage depth constants (default 3, hard 5) intentionally coexist with the older generic graph and
Skill-call limits of 8. No ADR is needed for this Phase because the repository design already freezes the
additive compatibility decision; Phase 6 publishes the cross-module production ADR set.

## Verification

- targeted Skill Usage unit: 1 file / 12 tests passed;
- all unit: 67 files / 414 tests passed;
- strict typecheck: passed;
- full repository ESLint: passed;
- configured source format check: passed;
- architecture: 234 TypeScript source files passed.

An initial typecheck correctly caught the usage field on the wrong snapshot interface; it was moved from
`SkillRelation` to `SkillVersionSnapshot`, and the native/legacy snapshot regression test now protects the
boundary. The first full lint found type-aware fail-closed checks and test-style issues; all were corrected
and the full repository lint passed. No test was skipped or weakened.

## Limitations and next step

This Phase defines data authority only. Package filesystem/schema validation, import, catalog filters,
applicability/mode decisions, composition behavior, persistence and Runtime wiring remain unimplemented.
Phase 2 adds JSON Schema and a safe package reader/validator/import model without allocating a migration.

## Publication

Commit `53e7b26120f9b65cd1cc01329c9ccc8bebe488f7`
(`feat(v1.2): add immutable skill usage contracts`) was pushed immediately to the tracked origin branch.
This evidence is recorded in a follow-up commit without amending or rebasing the published Phase commit.
