# FR-ADM-001 No-Authentication Console Reconciliation

Date: 2026-07-13

## Exact acceptance

The V1 management API and Console are unauthenticated and restricted to a trusted intranet. Acceptance requires access without login and a deployment warning describing the risk.

## Evidence

- The production management HTTP endpoint and Console contain no authentication middleware or login route.
- Real loopback HTTP contracts access management and Console resources without credentials and assert the trusted-intranet/no-auth warning headers.
- A real in-app browser loaded the built Console, navigated its accessible main sections without login, observed the persistent public-exposure warning, and reported zero browser errors/warnings.
- Environment validation defaults both listeners to loopback and fails closed for non-loopback binding without explicit risk acknowledgement.
- README, security guidance, ADR-012, and the release checklist state trusted-intranet-only operation, firewall isolation, and no public exposure.
- Current regression: 4 files and 57 tests passed. Unified `pnpm verify` passes 54 files/241 tests and production builds.

## Classification

FR-ADM-001 is verified against its exact access-and-warning acceptance. Current Docker-backed Server smoke and real-API browser CRUD remain release/other-management requirements and are not prerequisites for this no-auth boundary.
