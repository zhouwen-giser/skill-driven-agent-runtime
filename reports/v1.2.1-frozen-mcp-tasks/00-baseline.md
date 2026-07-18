# SDAR v1.2.1 Frozen MCP Tasks Phase 0 Baseline

Status: **IN PROGRESS**

- Required main SHA: `922f4288880e0fe3dee6ce402aa9788f4caa80eb`
- Observed main SHA: `922f4288880e0fe3dee6ce402aa9788f4caa80eb`
- PR #5: merged at the observed main SHA on 2026-07-18
- Package version: `1.2.0`
- Migration high water: `0106_skill_execution_record`
- ADR high water: `ADR-107`
- Frozen MCP source commit: `26897cc322f356487da89113451bd16b520b9288`
- Frozen schema blob: `cc44564e33305dbc07e820cdd0a97648f3852019`
- Frozen schema SHA-256: `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`

## Verification evidence

The first Windows `pnpm verify:bootstrap` attempt passed formatting, lint and strict typecheck, then ran
84 unit/contract files. It recorded 576 passing tests and one setup failure: Windows rejected creation of
the unchanged symlink safety fixture with `EPERM`. The failure is not counted as a pass and no assertion
was weakened or skipped.

The mandatory infrastructure gate cannot currently bind fixed PostgreSQL port 55432 because operator-owned
container `sdar-rc2-test-db` already owns it. Its credentials do not match the repository defaults and Redis
56379 is not available. The container was not stopped, inspected for secrets or modified. Static and focused
gates continue while a safe isolated full-gate path is established.

Independent baseline commands pass: format, lint, strict typecheck, 465/465 unit tests, 256-source
architecture, A2A MUST 74/74, 116-operation OpenAPI, 18 baseline acceptance scenarios, 16 v1.1 acceptance
scenarios, 19-source lock verification, project/license/SBOM checks, static Compose/70-migration policy and
the production Server/Console build. The full contract rerun, including an elevated attempt, reaches 111/112
and fails only while creating the Windows symlink fixture; the product rejection assertion itself cannot run.

## Evidence classification

- Real: Git/GitHub merge state, repository source, exact pinned source tree/license/blob/hash, local
  format/lint/typecheck and all tests that completed before the fixture setup failure.
- Simulated: none claimed in Phase 0.
- Unverified: complete baseline `pnpm verify`, Docker-backed integration/E2E/smoke and Frozen Provider
  interoperability.

Phase 0 is not complete until remaining baseline evidence, publication, remote SHA and Draft PR are recorded.
