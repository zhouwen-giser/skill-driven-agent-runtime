# OSS Intake: node-postgres

- Official repository: `https://github.com/brianc/node-postgres`
- Package/module: `pg@8.22.0`, development types `@types/pg@8.20.0`
- Exact tag/commit/version: pg npm `8.22.0`, commit `b617619f9fb6fbd231731823e2732a2927ded4be`, integrity `sha512-8wih1vVIBMxoUM2oB4soJsD9tDnDpLv4OXBJ+EJzFsvycD+lfyIreC2gGHq78f8jbLLt+bvlPTFdFZfJkOuzAA==`; types integrity `sha512-bEPFOaMAHTEP1EzpvHTbmwR8UsFyHSKsRisLIHVMXnpNefSbGA1bD6CVy+qKjGSqmZqNqBDV2azOBo8TgkcVow==`.
- License and NOTICE: MIT for pg and DefinitelyTyped definitions; packaged license files included in generated notices.
- Requested use: direct PostgreSQL adapter dependency.
- Files or APIs inspected: `Pool`, parameterized query, transaction and result APIs.
- Capability needed: PostgreSQL system-of-record repositories and migration/integration tests.
- Why current authoritative components cannot provide it: the domain defines repository ports but deliberately owns no database driver; pg is the narrow official ecosystem client selected instead of introducing an ORM before its need is proven.
- Boundary/adapter: only `packages/persistence-postgres` may import `pg`; rows are validated and mapped to domain-owned types before crossing the port.
- Maintenance and upgrade plan: exact pin and lockfile; empty/upgrade migration, repository and transaction integration tests on every upgrade.
- Security/quality findings: Node >=16, compatible with SDAR Node >=20. All values must use parameterized queries; no SQL string interpolation of external data.
- License obligations: retain MIT licenses and include packages in SBOM/third-party notices.
- Decision and ADR: accepted as the PostgreSQL adapter implementation under ADR-005 and ADR-007; no ORM types enter core layers.
