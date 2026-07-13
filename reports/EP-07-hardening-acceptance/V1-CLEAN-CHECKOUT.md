# V1 Clean-checkout Verification

Status: **passed** on commit `2e398d912a6d3a5dde88d54c3c57ef72d57ef171`.

An isolated directory under the Windows temporary root was created after validating its absolute path and `sdar-clean-*` name. The repository was cloned with `--no-local`, installed with the frozen pnpm lockfile, and verified with `pnpm verify:bootstrap`. The temporary checkout was then removed.

Evidence: Node v22.14.0, pnpm 11.7.0; format, lint, strict typecheck, 54 unit/contract files with 242 tests, 165-file architecture enforcement, A2A 1.0.1 baseline/TCK evidence, 102 OpenAPI operations, all 18 AC mappings, 17 source pins, 52 migration pairs, 288 current-lockfile npm packages plus two external services, and backend/Console production builds all passed.

Three earlier attempts correctly failed and were not counted as evidence. They exposed missing LF checkout policy, stale virtual-store packages in SBOM generation, and peer-layout-dependent license paths. `.gitattributes` and deterministic current-lockfile/package-relative evidence generation fixed the root causes. The successful run contacted no production or external system.
