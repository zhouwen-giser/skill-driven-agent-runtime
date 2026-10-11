# SMPP TaskBusiness v1.3 contract intake

- Official repository: https://github.com/zhouwen-giser/sdar-mcp-provider-platform
- Exact commit: `0a4a7c36865d4c9920a4e65857c0903e9ef12533`.
- License: Apache-2.0, unmodified exact-commit LICENSE retained. No NOTICE exists at this commit.
- Use: unmodified public JSON Schema and positive catalog reference for adapter validation and isolated fixtures. No Provider code, runtime, dependency or migration is copied.
- Files: `SOURCE.lock.json` contains each upstream path, Git blob and SHA-256.
- Existing authority: FrozenV1McpClient, SmppTaskBusinessClient, Registry, RemoteTaskInputService and BusinessEventSubscriptionService remain authoritative.
- Boundary: external contract validation stays in adapters; Domain owns internal facts. No sibling runtime imports.
- Maintenance: update only after an explicit compatible-version decision and schema diff; never follow sibling HEAD.
- Quality finding: Provider-recorded event time is not a per-sample timestamp; trajectory geometry omits individual observation clocks. Missing provenance remains a gap.
- Obligations: preserve this attribution and LICENSE when distributing these assets; the assets are unmodified.
- Decision: ADR-156. No new production package or maintained fork.
