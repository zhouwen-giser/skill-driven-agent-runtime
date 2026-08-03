# P14 Release Qualification Failed Attempts

## Versioned SBOM was stale

- Command: `pnpm verify:v14-security`
- First result: failed with `GENERATED_EVIDENCE_STALE: sbom.cdx.json`.
- Root cause: `package.json` moved from 1.2.2 to 1.4.0 while the CycloneDX root component still
  recorded 1.2.2.
- Repair: regenerated the locked 286-package SBOM and committed only the root version change.
- Rerun: passed with zero secret findings and all license/frozen-contract gates green.

## Recovery smoke returned HTTP 404

- Command: `pnpm verify:v14-recovery`
- First sandbox result: Docker config and named-pipe access were denied; this was an execution
  environment restriction, not a product result.
- First and second real Docker results: failed at the final Runtime-after-Control-stop smoke with
  `HTTP_404` and `RUNTIME_AFTER_CONTROL_STOP_SMOKE_FAILED`.
- Root cause: `smoke:server` compiled TypeScript but asserted `/console/` without building the
  production Console bundle. It passed only when an earlier gate happened to leave `apps/console/dist`.
- Repair: `smoke:server` now invokes the repository production `build` script before starting the
  Runtime, removing the hidden test-order dependency without weakening assertions.
- Rerun: passed in a new clean worktree, including Control backup/restore, credential
  rotation/revocation, API restart, shutdown and Runtime/Console startup after Control stopped.

## Dependency restoration

- Offline frozen install initially failed because the local pnpm store lacked the locked
  `@a2a-js/sdk@1.0.0-beta.0` tarball.
- A network-enabled `pnpm install --frozen-lockfile` reused all 290 locked packages and completed
  without lockfile changes.

No failed attempt was deleted, relabelled as passed, or resolved by skipping a gate.
