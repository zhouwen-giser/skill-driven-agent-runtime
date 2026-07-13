# Release Checklist

- [ ] Clean checkout installs successfully.
- [ ] Database migrations pass from empty and prior baseline.
- [ ] `pnpm verify` passes.
- [ ] All AC reports pass.
- [ ] Traceability Matrix has no gaps.
- [ ] Docker/local start and smoke test pass.
- [ ] SBOM, licenses and THIRD_PARTY_NOTICES complete.
- [ ] No secret or production endpoint in repository.
- [ ] Risk warnings and limitations visible.
- [ ] A2A and Management listeners bind to loopback or an explicitly reviewed trusted interface; public ingress is blocked.
- [ ] Any non-loopback bind sets `SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE=true` only after documenting firewall/network isolation; this acknowledgement does not add authentication.
- [ ] PostgreSQL and Redis have no public route or published public port.
- [ ] Documentation and CHANGELOG current.
