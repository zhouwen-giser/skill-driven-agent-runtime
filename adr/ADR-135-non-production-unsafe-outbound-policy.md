# ADR-135: Bound the Global Unsafe Outbound Policy to Non-production Deployments

## Status

Accepted on 2026-08-12 for the current integration and test deployments.

## Context

The externally deployed UGV PMS and frozen MCP Runtime are reachable only through plaintext private
network endpoints at `192.168.1.7:18088` and `192.168.1.7:19100`. The secure Node Control default
requires HTTPS for non-loopback destinations and constrains every Provider and MCP destination to an
operator allowlist. The operator explicitly requires global TLS/SSRF relaxation in the current
integration and test environments rather than an exact-authority exception.

A silent weakening of the default, a process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0`, or a policy that
can start in production would make unrelated outbound clients vulnerable and would falsely imply
Production security readiness. Conversely, applying the switch only in an acceptance wrapper would
leave real Node Control, Runtime MCP, Registry and model transports governed by inconsistent rules.

## Decision

Add the explicit deployment policy `SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY=unsafe_test_open`. The
composition root propagates it to every governed external HTTP transport used by Node Control and
Runtime. While active, credential-free `http:` and `https:` URLs do not require allowlist membership,
and non-loopback plaintext HTTP is admitted. Non-HTTP(S) schemes and URL-embedded credentials remain
forbidden. Authenticated clients continue to use manual redirect handling so a server response does
not silently select another destination.

The environment parser accepts this policy only when `NODE_ENV` is `development` or `test` and
`SDAR_CONTROL_ENVIRONMENT` is `development`, `test` or `integration`. A missing environment marker,
either production marker, or any other environment is a startup error. `safe` remains the default.
The profile retains exact discovered authorities as operational inventory, but they are not a
security boundary in unsafe mode.

“TLS relaxation” here means removal of the HTTPS-required scheme rule so the supplied HTTP endpoints
can be used. It does not disable certificate verification for HTTPS connections. The switch does not
relax authentication, secret handling, input validation, Plan Confirmation, remote-task terminal
authority, uncertain-dispatch suppression, physical-operation bounds or the unconditional fire ban.

All preflight and qualification evidence records the active policy and
`productionEligible: false`. The unsafe profile cannot satisfy the Production security gate even if
all functional integration gates pass.

## Consequences

- Integration and test deployments can reach the supplied PMS and UGV Runtime without per-authority
  TLS/SSRF enforcement.
- Compromise of any endpoint value in unsafe mode can direct an authenticated outbound request to an
  arbitrary HTTP(S) destination, including private or link-local services. This risk is intentional,
  explicit and confined to non-production environments.
- Production keeps the existing secure default and fails during configuration parsing if the escape
  hatch is present.
- Returning to Production qualification requires `safe`, exact allowlists, HTTPS for non-loopback
  endpoints, removal of the unsafe evidence limitation and a fresh security regression run.
