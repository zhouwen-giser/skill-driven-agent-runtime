# SDAR v1.4 Known Limitations

- Core A2A, Runtime management API and Console retain the trusted-intranet no-authentication V1
  baseline. Node Control authentication does not secure those surfaces.
- Node Control is single-node. There is no hierarchical organization control plane, multi-node
  orchestration, leader election or automatic cross-host HA.
- Telemetry is output-only. There is no query API, dashboard or ClickHouse proxy.
- Local capacity and recovery measurements do not establish production SLO, capacity, RTO or RPO.
- TLS/mTLS termination, external secret-manager rotation, encrypted backup storage, named operators
  and production monitoring are deployment responsibilities.
- `@modelcontextprotocol/sdk@1.29.0` retains one documented Moderate transitive Hono serve-static
  advisory. SDAR does not import or compose the affected serve-static path; production audit has
  zero Critical/High findings.
- P14 creates no tag, GitHub Release or deployment.
