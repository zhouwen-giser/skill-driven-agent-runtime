# OSS Intake: MCP TypeScript SDK

- Official repository: `https://github.com/modelcontextprotocol/typescript-sdk`
- Package/module: `@modelcontextprotocol/sdk` with peer `zod@4.4.3`
- Exact tag/commit/version: npm `1.29.0`; git commit `e12cbd7078db388152f6e839abdbe09ba01f3f32`; integrity `sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==`. Zod `4.4.3`, commit `f3c9ec03ba7a28ae72d25cc295f38674bee0f559`, integrity `sha512-ytENFjIJFl2UwYglde2jchW2Hwm4GJFLDiSXWdTrJQBIN9Fcyp7n4DhxJEiWNAJMV1/BqWfW/kkg71UDcHJyTQ==`.
- License and NOTICE: package metadata reports MIT for v1.29.0; repository main is transitioning toward v2 with mixed Apache-2.0/MIT history, so packaged license is authoritative for this pin.
- Requested use: direct dependency.
- Files or APIs inspected: v1 Client/McpServer public APIs and Streamable HTTP client/server transports.
- Capability needed: remote MCP Tool discovery and invocation over Streamable HTTP.
- Why current authoritative components cannot provide it: this is the official TypeScript SDK and is the protocol authority required by the baseline.
- Boundary/adapter: only `packages/mcp-adapter` and Mock MCP infrastructure import SDK types; core uses internal tool definitions and result envelopes.
- Maintenance and upgrade plan: stay on recommended v1.x until v2 is stable; exact pin, contract tests and manual upgrade ADR review.
- Security/quality findings: supports Node >=18; Streamable HTTP is supported. Cancellation remains best-effort and must be tested rather than promised. Zod `4.4.3` also satisfies LangGraph's `^4.2.0` peer range.
- License obligations: retain packaged MIT text, list Zod MIT, include both in SBOM/notices.
- Decision and ADR: accepted by ADR-002 behind the MCP adapter; no Resources, Prompts or stdio in V1 runtime scope.
