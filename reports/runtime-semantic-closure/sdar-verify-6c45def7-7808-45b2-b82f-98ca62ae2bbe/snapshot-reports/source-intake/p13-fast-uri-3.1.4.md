# OSS Intake: fast-uri 3.1.4

- Official repository: `https://github.com/fastify/fast-uri`
- Package/module: `fast-uri`
- Exact tag/commit/version: npm `3.1.4`, tag `v3.1.4`, commit
  `6aeece669e4166b2446a89f17c07a3b15dfb7ed4`, integrity
  `sha512-8JnbkQ4juDyvYs4mgFGQqg4yCYtFDtUtmp2QIQq11ZZe5CFQ5wcqm1rqDgAh/QdMySuBnPzMUiJUNZG5N/AiQw==`
- License and NOTICE: BSD-3-Clause; exact-commit/package LICENSE SHA-256
  `b010b0dfdfdb23d7396e03b82cd4621fc9bb8f95d6b0aea70b9c24e12074c786`;
  no NOTICE at the pin.
- Requested use: transitive dependency security override.
- Files or APIs inspected: package metadata, exact LICENSE, Ajv dependency
  resolution and the npm advisory path.
- Capability needed: preserve the existing Ajv URI-format implementation while
  removing the High severity host-confusion vulnerability in `3.1.3`.
- Why current authoritative components cannot provide it: this is not a new
  product capability or authority. Ajv already depends on `fast-uri`; the
  override only selects the patched compatible release.
- Boundary/adapter: transitive under `ajv@8.20.0`, used only behind
  `packages/json-schema-adapter`.
- Maintenance and upgrade plan: retain the exact workspace override until all
  pinned upstream packages resolve `>=3.1.4`; `pnpm audit --prod
  --audit-level high` is a P13 release gate.
- Security/quality findings: `fast-uri@3.1.3` was affected by
  `GHSA-v2hh-gcrm-f6hx` (High). The locked `3.1.4` resolves the finding. No
  source is copied or modified.
- License obligations: retain the BSD-3-Clause license text in generated third
  party notices and binary/documentation distribution.
- Decision and ADR: accepted as a compatible transitive security override;
  see ADR-123.
