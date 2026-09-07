# NFR-SEC-001 Trusted-Network Boundary

Date: 2026-07-13

## Delivered

- V1 intentionally has no A2A, management API, or Console authentication/authorization.
- Both HTTP listeners default to `127.0.0.1`.
- Startup validation rejects any non-loopback bind unless `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE=true` is explicit.
- The acknowledgement is a trusted-network/firewall review marker, never authentication or permission.
- Every management response carries `X-SDAR-Security-Warning: trusted-intranet-only-no-auth`; health and Console repeat the risk.
- README, security guide, and Release Checklist require network isolation and prohibit public PostgreSQL/Redis exposure.

## Verification

- Current focused regression: 4 files/56 tests passed across environment validation, A2A/management HTTP, and Console.
- Environment tests prove loopback defaults, fail-closed `0.0.0.0`/private binding, and explicit acknowledgement.
- Management HTTP proves the warning header and machine-readable no-auth/trusted-intranet posture.
- Console proves the persistent no-auth/public-exposure warning.
- Release Checklist explicitly checks trusted binding, blocked public ingress, documented firewall isolation, and no public PostgreSQL/Redis route.
- Current unified `pnpm verify`: 54 files/240 tests and all architecture/protocol/OpenAPI/source/migration/license/build gates passed.

## Classification

- Real local: environment parsing, loopback HTTP endpoints, response headers, health payload, and Console rendering contract.
- Documented operator gate: firewall/network isolation checklist; no production network was contacted or changed.
- Unverified current: Docker-backed Server smoke and OS network-namespace inspection.

The original acceptance requires the deployment checklist to contain network-isolation items. It does not require an OS namespace experiment. The runtime and release artifacts directly enforce and display the intentional no-auth boundary, so NFR-SEC-001 is **verified**.
