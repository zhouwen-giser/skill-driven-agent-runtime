# ADR-136: Model Credential-free SMPP Sources and MCP Providers Explicitly

## Status

Accepted on 2026-08-12 for generic deployments whose external Registry or MCP Provider deliberately
requires no request credential.

## Context

The current UGV deployment removed Registry and Runtime authentication. Existing SDAR contracts
required every SMPP Source and MCP Provider Binding to carry a `secret://...` reference. Supplying a
dummy token would misrepresent the external contract and might emit an unwanted `Authorization`
header. Treating an absent or unresolved SecretRef as credential-free would be worse: a missing
secret could silently downgrade authentication.

This choice crosses the Node Control domain, HTTP adapters and durable PostgreSQL constraints. It
therefore needs one explicit authority rather than acceptance-driver special cases.

## Decision

Add the exact opaque value `unauthenticated://none` as the only non-SecretRef credential authority
for SMPP Registry Sources and MCP Provider Bindings. It is selected deliberately in deployment
configuration and persisted like any other immutable credential reference.

When this exact authority is present:

- the Registry adapter does not invoke a credential resolver and omits `Authorization`;
- the Runtime catalog client emits no credential headers;
- token and token-file configuration must remain absent;
- reports may state authentication mode `none` but never copy credential-reference values;
- redirect handling and endpoint admission policy remain unchanged.

Every other credential reference must retain the existing `secret://...` syntax. An empty value,
an unresolved SecretRef, an unsupported scheme, or a failed resolver remains an error and never
falls back to credential-free access.

Control migration `0011_explicit_unauthenticated_credentials` replaces the Source and Binding CHECK
constraints with the exact disjunction (`secret://...` or `unauthenticated://none`). Its down path
must refuse rollback while any historical credential-free row exists, because immutable Binding
revision history means that merely creating a SecretRef-backed successor does not remove the old
sentinel. Rollback therefore requires a separately reviewed export/removal/rebuild that clears all
sentinel rows; it may never silently rewrite or discard their authority.

This ADR does not make an unauthenticated external service Production-secure. TLS/SSRF policy,
trusted-network boundaries and environment qualification are evaluated independently. The UGV
integration profile remains non-production while ADR-135's `unsafe_test_open` mode is active.

## Consequences

- SDAR can accurately consume intentionally public Registry projections and MCP Providers without
  inventing credentials or introducing a UGV-specific client.
- Missing secrets cannot become an authentication downgrade.
- Existing authenticated Source and Binding rows remain compatible.
- Rollback requires a separately reviewed data export/removal/rebuild that clears every historical
  explicit credential-free Source and Binding row; the migration reports this precondition instead
  of losing state.
