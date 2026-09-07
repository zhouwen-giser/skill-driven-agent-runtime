# NFR-DATA-001 Indefinite Retention

Date: 2026-07-13

## Delivered

- V1 historical Task, Goal, Workflow, model, MCP, Memory, evaluation, and evolution evidence defaults to indefinite retention.
- The PostgreSQL-authoritative retention policy reserves review/archive/delete day fields while domain validation and database CHECK constraints both reject automatic archive or deletion.
- Server composition contains no retention cleanup scheduler or worker. The only periodic server sweep enforces Task wait timeout and does not delete history.
- Management health advertises `default=indefinite`, automatic archive/delete false, and advisory policy fields.
- Console Overview and System Config visibly warn that no automatic cleanup scheduler runs.
- Explicit administrator lifecycle operations are not background cleanup and preserve immutable audit evidence.

## Verification

- Current domain, management, and Console regression: 3 files/49 tests passed.
- Strict typecheck, lint, OpenAPI drift, architecture, and production build pass through the current unified gate.
- Historical EP-05 real evidence is recorded in `FR-MEM-006-retention-policy.md`: migration 0045, PostgreSQL persistence/CHECK constraints, management HTTP, retained Memory, 30 integration tests, 39 E2E tests, production build, and local smoke all passed.
- Current `pnpm verify`: 54 files/240 unit+contract tests and all static/build gates passed.

## Classification

- Real historical: PostgreSQL migration/constraints/storage, management API, retained Memory, and local Server smoke.
- Real current: domain prohibition, management health posture, Console warning, static absence of a cleanup scheduler, and unified verification.
- Unverified current rerun: Docker-backed integration/E2E.
- Not required by the SRS acceptance: a long-running soak; the product contains no cleanup scheduler or automatic delete path.

The original SRS acceptance requires no automatic deletion task and reserved retention-policy fields. Both are directly evidenced, so NFR-DATA-001 is **verified**.
