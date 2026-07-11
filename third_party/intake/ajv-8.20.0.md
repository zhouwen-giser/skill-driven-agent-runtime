# OSS Intake: Ajv 8.20.0

- Official repository: `https://github.com/ajv-validator/ajv`
- Package/module: npm `ajv`
- Exact tag/commit/version: npm `8.20.0`; integrity `sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==`
- License and NOTICE: MIT; package LICENSE inspected, copyright 2015-2021 Evgeny Poberezkin; no NOTICE file in the package.
- Requested use: direct production dependency.
- Files or APIs inspected: package metadata, LICENSE, `Ajv2020`, `compile`, `ValidateFunction.errors`.
- Capability needed: validate structured task results against Skill-owned JSON Schema before persistence or A2A projection.
- Why current authoritative components cannot provide it: Zod validates application-owned static structures but does not execute arbitrary validated JSON Schema supplied by Skill versions; a partial custom interpreter would be unsafe and incomplete.
- Boundary/adapter: Ajv is isolated in `packages/json-schema-adapter`; domain/application receive only a validator port and stable error summaries.
- Maintenance and upgrade plan: exact version pin; upgrades require schema regression suite, SBOM/license refresh and ADR review.
- Security/quality findings: strict mode enabled; schema compilation errors are converted to typed boundary errors; no remote schema loading, custom code keywords or user-defined executable formats.
- License obligations: preserve MIT license in notices and distributions.
- Decision and ADR: approved under ADR-009; no source copied or adapted.
