# ADR-108: Frozen MCP Tasks Dual-Protocol Boundary

## Status

Accepted on 2026-07-18.

## Context

SDAR v1.2 uses the accepted v1.1 MCP Tasks boundary: an exact v2 beta client plus a bounded Bridge for
the earlier extension-era wire. The frozen SDAR MCP Tasks V1.0 contract instead pins MCP `2026-07-28`,
SEP-2663 flat Tasks, per-request capabilities, stateless discovery/routing, Task Notification,
`runtimeRevision` and objective Provider Evidence. The wire contracts are intentionally incompatible.

Combining both shapes in one handler or translating automatically would hide Provider conformance defects,
make historical plans ambiguous and let Legacy aliases enter the new authority. A separate lifecycle or
Workflow runtime would violate the existing PostgreSQL and LangGraph invariants.

## Decision

- Every MCP Server has an explicit `legacy_v11` or `frozen_v1` protocol mode. Existing rows are Legacy;
  new Frozen registration requires successful pinned `server/discover`. Failure never downgrades.
- A transport router selects `LegacyV11McpClient` or `FrozenV1McpClient`. The Legacy client retains the
  current SDK/Bridge path. The Frozen client uses stateless POST, exact per-request metadata, frozen
  routing headers and frozen schemas and never instantiates or accepts Bridge aliases.
- PostgreSQL stores append-only discovery snapshots and immutable protocol contract snapshots on plans
  and remote bindings. Active bindings prevent mode switching. Redis contains only reconstructable work.
- Domain owns protocol-neutral mode, behavior, contract, observation and Evidence models. Official MCP
  SDK/schema types remain inside `packages/mcp-adapter`.
- Poll, notification, create and reconciliation facts enter one admission service before persistence,
  controls or continuation. Frozen facts deduplicate by `taskId + runtimeRevision`; Legacy keeps its
  existing revision rules.
- Task Notification is mandatory for a conformant Frozen Runtime but never replaces polling. Reconnect
  performs `tasks/get` reconciliation, and stream failure cannot mutate Task authority.
- Provider Evidence uses frozen Evidence A: objective `evidenceType` and validated payload references.
  Skill-local `requirementId` never crosses the Provider wire and is matched locally after validation.
- LangGraph.js remains the only Workflow runtime. Frozen remote completion feeds the existing immutable
  external-wait continuation; no graph mutation, replay or second Task state machine is introduced.

## Consequences

Legacy Providers, historical plans and active Legacy observations remain supported while new Providers can
be tested against an unambiguous frozen contract. The system carries two isolated adapter paths and explicit
schema/persistence/test obligations, but only one application/domain lifecycle and one Workflow runtime.
Component conformance and real interoperability remain separate claims.

## Open-source and Maintenance Boundary

The Frozen client is an SDAR implementation against the pinned official specification and source schema,
not a fork of the official SDK. The exact source commit, blob, SHA-256, license transition and absent NOTICE
are recorded in the OSS Intake and `third_party/sources.lock.yaml`. Any pin or semantic change requires a
new intake, schema diff, ADR review and protocol-version decision.

## Rejected Alternatives

- Upgrade the Legacy handler in place: breaks historical providers and makes active bindings ambiguous.
- Translate old and new fields automatically: masks protocol defects and violates the frozen no-conversion rule.
- Use the beta SDK Bridge for Frozen traffic: imports private aliases and session assumptions.
- Run notification and polling as separate lifecycle owners: permits split-brain terminal continuation.
- Put MCP wire or ORM models in Domain: violates adapter and persistence boundaries.
