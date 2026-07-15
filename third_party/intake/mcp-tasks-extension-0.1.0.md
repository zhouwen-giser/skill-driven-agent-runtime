# OSS Intake: Official MCP Tasks Extension

- Official repository: `https://github.com/modelcontextprotocol/ext-tasks`
- Package/module: repository extension `io.modelcontextprotocol/tasks`; package metadata is private `@modelcontextprotocol/ext-tasks@0.1.0` and is not installed as a runtime dependency.
- Exact tag/commit/version: no tag exists; commit `8966bea9c4f4e6d71060cc8284a539086e9e234f` dated 2026-06-09. Frozen schema blobs: `schema/draft/schema.json` `d6ccaff7e3fb2131b5d752dd8b6f34096e58e976`; `schema/draft/schema.ts` `2634c47c2b25ac8fafe7fadaa7dd3f3b732c0abc`.
- License and NOTICE: Apache-2.0; exact LICENSE SHA-256 `72D9DAE54A96D7B2C9ACD13338D3407B7413D5D04076BF82EF0724007742DF75`; no NOTICE is present at the pin.
- Requested use: `reference_contract`; Phase 0 copies no source and adds no package dependency. A later locally adapted schema must retain Apache-2.0 attribution, source commit/blob and modification notice.
- Files/APIs inspected: README, LICENSE, package metadata, draft JSON/TypeScript schemas and request/header examples.
- Capability needed: official extension semantics for `tools/call` task return, `tasks/get`, `tasks/update`, `tasks/cancel`, `resultType`, Task statuses and required Streamable HTTP headers.
- Why current authoritative components cannot provide it: `@modelcontextprotocol/sdk@1.29.0` exposes an older experimental Tasks shape with `tasks/result`/`tasks/list` and no `tasks/update`; it is not the contract required by the v1.1 source package.
- Boundary/adapter: only `packages/mcp-adapter`, protocol-contract tests and Mock MCP Provider may use the frozen wire schemas. Domain/application own independent models and ports.
- Maintenance/upgrade plan: exact commit/blob source gate; schema-diff and compatibility Spike before any pin change; upgrade only through a new Intake and ADR revision. No dependency is added until a published package is independently reviewed.
- Security/quality findings: extension is incubating/draft and primarily aligned with the 2026-06-30 protocol family while SDAR retains the v1 SDK transport. Capability negotiation, strict schemas, bounded payloads, unknown-discriminator rejection and loopback contract tests are mandatory. `tasks/update`/`tasks/cancel` acknowledgements are not Provider terminal-state proof.
- License obligations: retain Apache-2.0 text and copyright/attribution for any adapted schema; record modifications; include copied artifacts in SBOM/notices if Phase 1 vendors them.
- Decision and ADR: accepted as a pinned reference contract by ADR-076. The SDAR-specific availability/time/observation extension is project-owned Apache-2.0 design in `docs/23_V1_1_MCP_TASKS_PROVIDER_EXTENSION.md`.
