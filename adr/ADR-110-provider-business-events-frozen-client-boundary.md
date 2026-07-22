# ADR-110: Provider Business Events Frozen Client Boundary

## Status

Accepted on 2026-07-22.

## Context

SDAR v1.2.2 must consume the independently implemented Provider Business Events V0.5.2 contract
without guessing wire shapes or importing Provider runtime authority. The Provider repository now has a
clean merged candidate at commit `8a81b1b02971fb124ed96372c440c449f9087c99`, Apache-2.0 licensing,
the required baseline ancestor, frozen schemas, fixtures, golden vectors and Level 2 component evidence.
Real SDAR interoperability remains a separate G10 claim.

## Decision

- Vendor only the exact protocol schemas, conformance fixtures, golden vectors, concise profile,
  Adapter proto and license under `protocol/business-events/provider-v1.0`.
- Record every file hash plus the exact Provider commit in `SOURCE.json` and
  `third_party/sources.lock.yaml`; contract tests reject drift.
- Keep all client transport, validation, Inbox/Cursor, continuity, relation and impact logic SDAR-owned.
  No Provider runtime implementation, persistence code, worker, source adapter or generator is copied.
- Business Events use the existing bounded POST SSE transport infrastructure but retain distinct method,
  schema, subscription, generation, cursor, readiness and metrics state from Task Notifications.
- PostgreSQL remains the SDAR durable Inbox and cursor authority. Redis/BullMQ may only carry
  reconstructable processing work.
- `BUSINESS_EVENTS_ENABLED=false` remains the default. Mock conformance is not real interoperability.

## Consequences

The wire contract is reproducible and auditable without creating a second runtime or coupling SDAR to
Provider implementation types. Any upstream change is an explicit re-intake. Profile 1.0 cannot be
declared Frozen until G10 real interoperability passes.

