# FR-EVAL-005 Warning-only Skill Controls Evidence

Date: 2026-07-13

## Result

Verified. Low-quality Skill evidence creates visible warnings only. Warning evaluation has no mutation capability; administrators retain explicit disable, rollback, and correction/version-publication operations.

## Reproducible evidence

- `pnpm test:unit`: Skill quality policy creates consecutive-low-score and failure-rate warnings while its dependency surface exposes only `findVersion`, never registration or status mutation.
- `pnpm test:integration`: PostgreSQL preserves version-specific observations, warning evidence IDs, thresholds, active status, and Skill status at warning creation.
- `pnpm test:contract`: management HTTP records/lists warnings and exposes separate Skill disable, rollback, version registration, and evolution-correction operations.
- `pnpm test:e2e`: 40/40 pass.
  - Three low observations create an active warning while the warned Skill remains the same enabled administrator v1 and stays in Agent Card.
  - Only a later explicit disable creates disabled v2 and removes it from Agent Card; explicit rollback creates enabled v3 and restores it.
  - Existing correction E2E records operator, before/after/diff, revalidation result, and publishes a corrected version only after all gates pass.
- Full gate: `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm smoke:server`.
  - format, lint, typecheck, 198 combined unit/contract tests (152 unit, 46 contract), architecture, source pins, Compose, SBOM/licenses, build, 31 integration, 40 E2E, and local server smoke passed.

## Verification classification

- Real: warning persistence/readback, no automatic version mutation, dynamic Agent Card, administrator disable/rollback/correction paths, and PostgreSQL histories.
- Deterministic policy: low-score and failure-rate thresholds are unit verified.
- Not claimed: authenticated administrator identity under the accepted trusted-intranet/no-auth V1 baseline.
