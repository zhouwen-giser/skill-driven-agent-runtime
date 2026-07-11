# OSS Intake: A2A JavaScript SDK

- Official repository: `https://github.com/a2aproject/a2a-js`
- Package/module: `@a2a-js/sdk`
- Exact tag/commit/version: npm `1.0.0-beta.0`; git commit `a005d2a118d3c1552ce6ea86b2917f2a9f56fea9`; integrity `sha512-1k2GJdATg0ZJMNVD0jqox+oE5teUaUbJWx5ooSW2i3hA/B00Ev6kK3hZuxcsoZYbYvp8eAyppU3rvjTpglzdcg==`
- License and NOTICE: Apache-2.0; verify packaged `LICENSE` and any `NOTICE` after install.
- Requested use: direct dependency.
- Files or APIs inspected: package metadata, public protocol types, server/client exports and compatibility documentation.
- Capability needed: official A2A Provider protocol objects, Agent Card, messages, task lifecycle and streaming.
- Why current authoritative components cannot provide it: this is the authoritative JavaScript SDK; the stable `0.3.14` channel cannot express the required protocol 1.0 baseline.
- Boundary/adapter: only `packages/a2a-adapter` may import SDK types; domain and application packages use internal DTOs.
- Maintenance and upgrade plan: keep exact beta pin, run 1.0.1 contract fixtures on every upgrade, and prefer a stable 1.0 SDK only after the same gate passes.
- Security/quality findings: requires Node >=20; beta status and protocol patch-level mismatch require explicit compatibility evidence. No authentication is added because V1 is trusted-intranet only.
- License obligations: retain Apache-2.0 license and NOTICE if present; record dependency in SBOM and third-party notices.
- Decision and ADR: accepted conditionally by ADR-002; production use remains gated by EP-00 A2A contract Spike.
