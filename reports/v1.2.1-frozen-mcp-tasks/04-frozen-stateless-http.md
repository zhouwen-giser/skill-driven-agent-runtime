# SDAR v1.2.1 Phase 4 Frozen Stateless HTTP

Status: **PASSED WITH BASELINE HOST LIMITATION**

`FrozenV1McpClient` implements the frozen `2026-07-28` JSON-RPC profile as independent HTTP POST
requests. Every request carries the normative request metadata and routing headers, supports JSON or
SSE responses, correlates response IDs and normalizes the five frozen protocol errors. Discovery is
validated before a persisted snapshot can be constructed; configured request headers remain the only
authentication input and untrusted `serverInfo` is display metadata only.

`McpTransportRouter` selects the Legacy or Frozen client only from explicit protocol authority. It has no
fallback path, and Frozen requests never instantiate or traverse the Legacy SDK Bridge.

## Verification

| Command | Result |
| --- | --- |
| focused Frozen HTTP contract | passed 10/10 |
| `pnpm test:unit` | passed 75 files, 471 tests |
| `pnpm test:contract` | 122/123 passed; unchanged Windows symlink setup failed with `EPERM` |
| `pnpm verify:architecture` | passed across 263 TypeScript source files |
| `pnpm build` | passed |
| format/lint/typecheck | passed |

The focused contract covers no `initialize`, per-request metadata, exact method/name routing headers,
concurrent stateless calls, JSON/SSE correlation, explicit no-fallback routing, discovery validation,
configured authentication isolation and errors `-32001`, `-32003`, `-32004`, `-32601`, `-32602`.
Phase 4 proves transport and discovery behavior, not Task lifecycle semantics.
