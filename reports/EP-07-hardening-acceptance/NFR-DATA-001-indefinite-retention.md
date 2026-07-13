# NFR-DATA-001 Indefinite Retention

Date: 2026-07-13

## Delivered

- V1 historical Task, Goal, Workflow, model, MCP, Memory, evaluation, and evolution evidence defaults to indefinite retention.
- The PostgreSQL-authoritative retention policy reserves review/archive/delete day fields while domain validation and database CHECK constraints both reject automatic archive or deletion.
- Server composition contains no retention cleanup scheduler or worker. The only periodic server sweep enforces Task wait timeout and does not delete history.
- Management health advertises the machine-readable posture: `default=indefinite`, automatic archive/delete false, policy fields advisory.
- Console Overview and System Config visibly warn that no automatic cleanup scheduler runs.
- Explicit administrator lifecycle operations remain possible where required, but are not background cleanup and preserve immutable audit evidence.

## Verification

Real local unit/contract/static verification:

- 48 targeted retention, management, and Console tests pass.
- Strict typecheck, lint, and 102-operation OpenAPI drift verification pass.
- Unified `pnpm verify` passes with 54 unit/contract files and 221 tests, architecture/source-pin/Compose-static/SBOM gates, and production build.
- Existing domain tests reject automatic cleanup; existing PostgreSQL integration and same-process E2E tests prove policy persistence and retained Memory when infrastructure is available.

Unverified in this environment:

- Docker-backed PostgreSQL constraints and same-process retention E2E could not be rerun because integration infrastructure is unavailable.
- A long-running soak demonstrating absence of time-triggered deletion remains unverified.

NFR-DATA-001 remains `开发中` until the real PostgreSQL/E2E evidence is rerun.
