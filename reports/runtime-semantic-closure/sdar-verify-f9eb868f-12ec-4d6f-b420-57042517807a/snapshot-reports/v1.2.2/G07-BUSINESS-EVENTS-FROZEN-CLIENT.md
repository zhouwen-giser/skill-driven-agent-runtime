# G07 Business Events Frozen Client Skeleton

## Summary

Status: **completed**. SDAR vendors the exact Provider protocol/fixture assets from commit
`8a81b1b02971fb124ed96372c440c449f9087c99` behind its MCP adapter and implements a strict, bounded
Profile 1.0 consumer. This report is client-contract evidence, not real-runtime interop evidence.

## Protocol and OSS boundary

- `protocol/business-events/provider-v1.0/SOURCE.json` pins 23 exact hashes, the Apache-2.0 license and
  required ancestor `ee14d2fa2b5130d3c7c016c71737175a124d5134`.
- No Provider runtime/generation source was copied. ADR-110 and the OSS intake report approve only
  unmodified schemas, fixtures, golden vectors, profile prose and Adapter proto.
- Business Event SSE/parser/cursor types remain isolated from Frozen MCP Task notifications.

## Client contract

- Strict discovery/profile/header/Ack validation, decimal sequence preservation and bounded POST SSE.
- Current and replayable-closed generation handling, typed Reset/continuity, stable relation pagination,
  expiration and incomplete-negative fail-closed behavior.
- A frozen mock covers Task Event, continuity/drain, relation, malformed Ack, Reset and expiration. The
  feature remains disabled unless an explicit Provider connection is registered.

## Validation

All 8 valid Provider fixtures were accepted and all 5 invalid fixtures rejected. The SDAR contract
suite passed 5 discovery/header/Ack/drain/reset/relation/error cases. Protocol hash verification passed
all 23 source files.

## Acceptance

AC-050, AC-051 and the client portion of AC-052/AC-056/AC-057/AC-058 are verified.

## Reproduction

```text
pnpm exec vitest run --project contract packages/mcp-adapter/test/business-events-client.contract.test.ts packages/mcp-adapter/test/business-events-provider-fixtures.contract.test.ts
pnpm verify:protocol
```

