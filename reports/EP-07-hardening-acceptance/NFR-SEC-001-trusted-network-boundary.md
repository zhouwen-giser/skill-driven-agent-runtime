# NFR-SEC-001 Trusted-Network Boundary

Date: 2026-07-13

## Delivered

- V1 intentionally has no A2A, management API, or Console authentication/authorization.
- Both HTTP listeners default to `127.0.0.1`.
- Startup environment validation rejects any non-loopback A2A or management bind unless `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE=true` is explicit.
- The acknowledgement is documented as a trusted-network/firewall review marker and never as authentication or permission.
- Every management response carries `X-SDAR-Security-Warning: trusted-intranet-only-no-auth`; health and Console repeat the risk.
- README, security guide, ADR, and Release Checklist require network isolation and prohibit public PostgreSQL/Redis exposure.

## Verification

Real local unit/contract/static verification:

- Environment tests prove localhost defaults, rejection of `0.0.0.0`/private-interface binding without acknowledgement, and explicit acknowledged configuration.
- Management contract proves the warning header and machine-readable trusted-intranet/no-auth posture.
- Console static test proves the no-auth/public-exposure warning remains visible.
- 50 targeted tests, strict typecheck, and lint pass.
- Unified `pnpm verify` passes with 54 unit/contract files and 224 tests plus all architecture, OpenAPI, source-pin, Compose-static, SBOM/license, and production-build gates.

Unverified in this environment:

- Server smoke with a real PostgreSQL/Redis runtime and an OS-level firewall/network namespace inspection cannot run while Docker infrastructure is unavailable.
- No production system was contacted or changed.

NFR-SEC-001 remains `开发中` until local server smoke and isolated-network deployment evidence pass reproducibly.
