# SDAR v1.2 Phase 3B — Formal Skill Packages

- Goal: ship reviewed `embodied.move_to` and `embodied.area_patrol` import artifacts
- Dependency class: `V11-INDEPENDENT`
- Base SHA: `57e2c87a1765e68bb12d8ac0a060c98a940bd983`
- Resulting SHA: `1c914f4fc750f43d786cc0e045ebba98eaeafd88`
- v1.1 Gate: OPEN

## Delivered

Both packages use the Phase 2 `sdar.io/v1alpha1` JSON/Markdown contract and byte-exact SHA-256
declarations. They import as enabled immutable version 1 Skills; package files remain reviewed import
artifacts rather than execution-time authority.

`embodied.move_to` records explicit goals/non-goals, current-position/resource/permission requirements,
guidance/template/procedure modes, an `embodied.move` dynamic Provider binding, forbidden-area and
cancellation/failure guidance, and a required hard-gated `position.observation`. A Provider success
claim without final-position evidence cannot satisfy its evidence policy.

`embodied.area_patrol` records area boundary, Provider-owned resource state, time window and
deterministic subdivision requirements. Its depth-3 composition pins `embodied.move_to@1` as a
recoverable fixed dependency and declares a dynamic `embodied.inspect_area` slot with degraded failure
propagation. Its three modes aggregate coverage, trajectory and anomaly reports; degraded output must
identify missing subregions, effects and evidence and cannot project as full success.

## Golden and negative evidence

Reviewed golden snapshots pin semantic import views and stable package checksums:

- move-to: `f0017113882ab071210f365c89548f87cf755f8d6a3a4057b48c6f87ee7f9940`;
- area-patrol: `696e660c091f0adfc813a746f79db2981205f6615960d3acbbdd4493ebf4022b`.

The negative contract copies a formal package, injects an unknown normative policy, deliberately updates
its checksum, and proves schema validation—not incidental checksum drift—fails closed. Legacy Skill
compatibility remains guidance-only with no invented Task binding or composition.

## Verification

- focused formal package contract: 1 file / 5 tests passed;
- all contract tests: 11 files / 106 tests passed;
- formal package and repository format checks, full ESLint and strict TypeScript typecheck: passed;
- architecture: 241 TypeScript source files passed.

The focused suite traverses the real Node reader, strict package schema, embedded JSON Schema checks,
Domain validation and immutable importer. The first run passed 4/5; its only failure was a case-sensitive
Markdown phrase assertion. The assertion was aligned to the unchanged stable source phrase and all 5
then passed. No package policy or structural assertion was weakened.

## Limitations and next step

Phase 3B does not execute procedures or resolve live Providers. Phase 4 adds deterministic
applicability/context/mode decisions with a mock readiness Port; Phase 5 compiles bounded composition and
three-mode IR through the existing Workflow path.

## Publication

Commit `1c914f4fc750f43d786cc0e045ebba98eaeafd88`
(`feat(v1.2): add move-to and area-patrol skill packages`) was pushed immediately to the tracked origin
branch and the remote SHA matched exactly. This evidence is recorded in a follow-up commit without
amending, rebasing or force-pushing the published Phase commit.
