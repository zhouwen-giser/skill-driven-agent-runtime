# P13 Read-only Review

Review scope: P13 implementation and remediation commits through `ec10587`, frozen security/RBAC
contracts, public/internal HTTP boundaries, recovery smoke and operational runbooks. This final
Review phase was read-only.

## Blocking

None.

## Major

None open. Two Major findings were closed before this final pass:

- Loopback classification now uses actual IP parsing, so an allowlisted DNS name such as
  `127.0.0.1.evil.example` cannot bypass the non-loopback HTTPS rule.
- Four frozen CSV matrices now use byte-preserving Git attributes and exact CRLF blobs, so a clean
  Windows checkout matches every frozen MANIFEST size/hash.

## Minor

None open.

## Accepted

- Public credentials are distinct and matched in constant time. Node Administrator is the only
  write role; Operator, Viewer, Security Administrator and Organization use explicit bounded read
  profiles. Unsupported secret-management or task-control operations are not fabricated.
- Organization tenant identity comes from the configured service credential; a conflicting tenant
  header fails closed. Runtime service authentication remains separate from all public roles.
- Ingress size/rate limits and egress authority/CIDR/TLS/user-info rules fail with stable Problems.
- Domain/API/event/audit surfaces carry SecretRefs and statuses only. Runtime adapters own secret
  resolution; secret scan reports zero credential findings.
- Existing write paths retain reason, expected revision/If-Match, idempotency and immutable
  Operation/Audit evidence. Public writes are confined to the trusted Node Administrator identity.
- Control and Runtime databases remain separate authorities. The real restore drill never restores
  over the source, and Control outage does not transfer Runtime/LKG authority.
- Runbooks clearly distinguish local evidence from production SLO, HA, capacity, RTO/RPO and secret
  manager/mTLS responsibilities.
- Exact clean full verification passes after retained failure/remediation evidence.

Verdict: 0 Blocking, 0 Major, 0 Minor. P13 is acceptable for evidence publication.
