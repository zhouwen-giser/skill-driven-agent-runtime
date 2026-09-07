# OSS Intake: MCP 2026-07-28 Frozen Source

- Official repository: `https://github.com/modelcontextprotocol/modelcontextprotocol`
- Package/module: MCP source schema, SEP-2663 Tasks Extension and SEP-986 Tool Name specification
- Exact tag/commit/version: commit `26897cc322f356487da89113451bd16b520b9288`;
  schema blob `cc44564e33305dbc07e820cdd0a97648f3852019`; protocol `2026-07-28`
- License and NOTICE: exact commit LICENSE is a transition covering Apache-2.0, retained MIT contributions
  and CC-BY-4.0 ordinary documentation; no root NOTICE exists at the pinned commit
- Requested use: source adaptation for the exact source schema; specification/API reference for SEP-2663
  and SEP-986; no new runtime dependency
- Files or APIs inspected: `LICENSE`, `schema/draft/schema.json`, `seps/2663-tasks-extension.md`,
  `seps/986-specify-format-for-tool-names.md`
- Capability needed: frozen stateless request/result shapes, flat Tasks, per-request capability metadata,
  subscriptions and tool-name constraints unavailable in the Legacy v1.1 Bridge contract
- Why current authoritative components cannot provide it: the current beta SDK/Bridge intentionally owns
  only the Legacy handler and contains incompatible session, alias and older extension assumptions
- Boundary/adapter: vendored immutable source under `protocol/source`; derived schemas and all wire parsing
  remain in `protocol/` and `packages/mcp-adapter`; Domain receives SDAR-owned validated models only
- Maintenance and upgrade plan: verify Git blob and SHA-256 on every build; any source-pin or semantic
  change requires a new intake, diff review, ADR and protocol version
- Security/quality findings: explicit no-fallback/no-translation boundary; schema hash is
  `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`; Provider identity metadata is
  audit-only; no SDK code is copied
- License obligations: retain source attribution and applicable license notices, identify modified derived
  schemas, update third-party ledger/notices and SBOM evidence
- Decision and ADR: accepted as pinned source adaptation and specification reference by ADR-108; existing
  MCP SDK dependencies remain confined to the Legacy adapter path
