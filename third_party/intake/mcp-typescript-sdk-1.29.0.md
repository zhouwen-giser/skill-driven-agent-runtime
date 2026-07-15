# OSS Intake: MCP TypeScript SDK

- Official repository: `https://github.com/modelcontextprotocol/typescript-sdk`
- Package/module: `@modelcontextprotocol/sdk` with peer `zod@4.4.3`
- Exact tag/commit/version: npm `1.29.0`; git commit `e12cbd7078db388152f6e839abdbe09ba01f3f32`; integrity `sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==`. Zod `4.4.3`, commit `f3c9ec03ba7a28ae72d25cc295f38674bee0f559`, integrity `sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==`.
- License and NOTICE: exact `v1.29.0` repository/package license is MIT, SHA-256 `22F8D69B51B1231102C966D1291D5056491F1882C5828B859E499E092FB9A594`; no NOTICE is present. The repository main/v2 work is not the accepted pin.
- Requested use: direct dependency.
- Files or APIs inspected: v1 Client/McpServer public APIs, Streamable HTTP client/server transports, low-level `Client.request`, and the installed `experimental.tasks` surface.
- Capability needed: legacy remote MCP Tool discovery/invocation and the official legacy loopback Server fixture. ADR-081 supersedes its proposed use as the Tasks extension client.
- Why current authoritative components cannot provide it: this is the official TypeScript SDK and is the protocol authority required by the baseline.
- Boundary/adapter: only `packages/mcp-adapter` and Mock MCP infrastructure import SDK types; core uses internal tool definitions and result envelopes.
- Maintenance and upgrade plan: retain the exact v1 package during the staged adapter migration only for legacy compatibility and loopback Server test support. ADR-081 adds an exact official v2 beta Client for production extension-era negotiation. Removal or upgrade requires contract tests and ADR review.
- Security/quality findings: supports Node >=18; Streamable HTTP and low-level validated requests are supported. The SDK 1.29.0 high-level experimental Tasks API implements the older 2025-11-25 shape (`tasks/result`, `tasks/list`, no `tasks/update`) and is therefore explicitly forbidden for the v1.1 contract. Cancellation is cooperative and must be observed rather than promised. Zod `4.4.3` also satisfies LangGraph's `^4.2.0` peer range.
- License obligations: retain packaged MIT text, list Zod MIT, include both in SBOM/notices.
- Decision and ADR: accepted by ADR-002 behind the MCP adapter; ADR-081 supersedes the client-version portion of ADR-076 after the compatibility Spike proved that a `2025-11-25` connection cannot enable the extension. No Resources, Prompts or stdio are added to runtime scope.
