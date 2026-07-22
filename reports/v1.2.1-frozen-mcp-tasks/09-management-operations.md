# SDAR v1.2.1 Phase 9 Management and Operations

Status: **PASSED WITH BASELINE HOST AND CLEANUP LIMITATIONS**

The Management API and Console now expose credential-free Frozen Provider and Remote Task protocol
evidence. Provider projections include the immutable protocol mode, current discovery, supported
versions, frozen baseline hash, Task Notification capability and per-Tool task behavior/output-schema
hash. Remote lifecycle projections include TTL/expiry, Runtime and Provider revisions, latest observation
source, poll/notification health and Evidence A summary. The Console renders Protocol, Notification,
Task Revision and Observation Source fields from those real API projections.

Frozen registration and refresh use `server/discover` plus a bounded complete `tools/list`, require
output schemas and profile-1.0 metadata, encrypt configured credentials and persist the Provider, Tool
catalog and immutable discovery snapshot in one PostgreSQL transaction. The transaction rejects any
attempt to overwrite an existing Legacy identity, including a concurrent check/write race. Protocol
diagnosis, baseline audit, immutable mode guard and version-CAS force reconciliation are exposed.
The notification reconnect endpoint is explicit and returns an unavailable error until the Phase 10
local subscription component is composed; it never claims that polling is a Notification stream.

## Verification

| Command | Result |
| --- | --- |
| Frozen registry application unit | passed 3/3 |
| Frozen registry + Management contracts | passed 47/47 |
| `pnpm test:unit` | passed 78 files, 480 tests |
| `pnpm test:contract` | 158/159 passed; unchanged Windows symlink setup failed with `EPERM` |
| isolated PostgreSQL Repository integration | passed 58/58 against operator-managed port 55443 |
| `pnpm verify:management-openapi` | passed 122 operations |
| `pnpm verify:architecture` | passed across 279 TypeScript source files |
| `pnpm build` | passed |
| format/lint/typecheck | passed |

The isolated `sdar-codex-phase9` PostgreSQL/Redis Compose project was started solely for real Repository
verification. No operator-owned container was changed. The isolated project's containers, network and
volumes were removed on 2026-07-22 after the complete local gate passed.

Phase 9 proves Management contracts and real PostgreSQL authority. Phase 10 still owns local Frozen
subscription/runtime composition and full v1.2 component requalification; Phase 11 owns real Provider
interoperability.
