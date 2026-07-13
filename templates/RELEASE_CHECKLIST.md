# Release Checklist

- [x] Clean checkout installs successfully. Evidence: `reports/EP-07-hardening-acceptance/V1-CLEAN-CHECKOUT.{md,json}`.
- [x] Database migrations pass from empty and prior baseline. Evidence: `reports/EP-07-hardening-acceptance/V1-MIGRATION-PATH.{md,json}`.
- [x] `pnpm verify` passes. Evidence: `reports/verification/summary.{md,json}`.
- [x] All AC reports pass. Evidence: `reports/EP-07-hardening-acceptance/V1-ACCEPTANCE-AUDIT.{md,json}`.
- [x] Traceability Matrix has no gaps. Evidence: all rows are `已验证`; `pnpm verify:acceptance` passes.
- [x] Docker/local start and smoke test pass. Evidence: `V1-LOCAL-DEMO`, full verification, infra and Server/Console smoke reports.
- [x] SBOM, licenses and THIRD_PARTY_NOTICES complete. Evidence: 17 source pins, 288 current-lockfile npm packages, two external services, and `verify:licenses` pass.
- [x] No secret or production endpoint in repository. Evidence: `V1-RELEASE-POSTURE.{md,json}`.
- [x] Risk warnings and limitations visible. Evidence: README, security/operations docs, health, Console and HTTP contracts.
- [x] A2A and Management listeners bind to loopback or an explicitly reviewed trusted interface; public ingress is blocked. Evidence: environment unit tests and NFR-SEC-001 report.
- [x] Any non-loopback bind sets `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE=true` only after documenting firewall/network isolation; this acknowledgement does not add authentication. Evidence: ADR-012 and operations/security docs.
- [x] PostgreSQL and Redis have no public route or published public port. Evidence: loopback-only Compose publishing, static guard and real smoke.
- [x] Documentation and CHANGELOG current. Evidence: README, docs index set, CONTRIBUTING, operations guide, DoD and this checklist.
