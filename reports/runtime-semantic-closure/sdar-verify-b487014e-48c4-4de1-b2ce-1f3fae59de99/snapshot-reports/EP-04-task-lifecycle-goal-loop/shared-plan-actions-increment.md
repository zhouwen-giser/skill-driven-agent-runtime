# Shared plan actions increment

Date: 2026-07-12

## Scope

This increment verifies FR-EXE-002: A2A and management plan actions share the same authoritative TaskService path.

## Evidence

- TaskService unit tests cover confirmation, rejection transition, and natural-language immutable revision.
- Management contract tests validate Task-level action input and output.
- Real A2A/PostgreSQL E2E creates three planned Tasks, invokes management confirm/reject/revise, and reads the resulting working/canceled/input-required states through the official A2A SDK client.
- Revision produces a different Task-bound plan ID and remains confirmation-bound.

Final gate evidence:

- `pnpm verify`: format, lint, strict typecheck, 39 files/153 unit+contract tests, architecture boundaries, OSS pins, Compose, SBOM/licenses, and production build passed.
- `pnpm test:integration`: 2 files/28 tests passed against local PostgreSQL/pgvector and Redis.
- `pnpm test:e2e`: 1 file/29 tests passed; memory lookup also remains repeatable against retained history.
- `pnpm smoke:server`: server, dynamic Agent Card, and trusted-intranet management health passed.

## Verification boundary

Task, plan, PostgreSQL, model-loopback revision, server, management API, and official A2A SDK read paths are real local components. Model semantics are deterministic simulation. FR-EXE-001 and FR-EXE-003 remain unverified by this increment.
