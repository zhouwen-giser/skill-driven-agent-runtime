# OSS Intake: SDAR MCP Tasks Provider Runtime Business Events Protocol Assets

- Official repository: `https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime`
- Package/module: Business Events Profile 1.0 protocol schemas, fixtures, golden vectors, profile and Adapter proto
- Exact tag/commit/version: commit `8a81b1b02971fb124ed96372c440c449f9087c99` (contains required ancestor `ee14d2fa2b5130d3c7c016c71737175a124d5134`)
- License and NOTICE: Apache-2.0; exact `LICENSE` SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`; no NOTICE file is present
- Requested use: unmodified vendored protocol source and conformance fixtures
- Files or APIs inspected: three `sdar-business-events-*.schema.json` files, 13 valid/invalid fixtures, four golden vectors, `SDAR_BUSINESS_EVENTS_PROFILE_V1_0.md`, and `adapter.proto`
- Capability needed: strict Provider V0.5.2 Business Events discovery/listen/ack/continuity/relation client contract without guessing the external wire
- Why current authoritative components cannot provide it: SDAR owns consumer behavior, but the independent Provider repository owns the frozen wire assets and golden vectors
- Boundary/adapter: exact source files live under `protocol/business-events/provider-v1.0`; runtime code remains SDAR-owned behind `packages/mcp-adapter`
- Maintenance and upgrade plan: verify every vendored hash against `SOURCE.json`; upgrades require a new exact Provider commit, OSS intake and ADR update
- Security/quality findings: assets are declarative JSON/Markdown/Proto only; no Provider runtime source or generator is copied; JSON is validated with bounded local schemas and no remote references
- License obligations: retain the exact Apache-2.0 license and source attribution; modified derivatives must be marked, while vendored files remain byte-for-byte unmodified
- Decision and ADR: approved as `source_adaptation`/unmodified protocol vendoring by ADR-110; no production dependency or second runtime is introduced

