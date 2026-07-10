# SDAR v1.0 Runtime Hardening Baseline

- Status: **blocked**
- Captured at: `2026-07-10T17:22:01+08:00`
- Branch: `release/v1.0-hardening`
- Baseline commit: `7c2fea66687624743f286d9c8cb23b54e5a36036`
- Node: `v22.23.1`
- pnpm: `11.7.0` (repository package manager: `pnpm@11.7.0`)
- Package version: `0.0.0`
- Latest forward migration: `0053_mcp_tool_enhancement_stage.up.sql`

## Gate result

Both required baseline commands failed before any test gate ran:

1. `pnpm install --frozen-lockfile` — exit code 1.
2. `pnpm verify` — exit code 1 during its dependency-status install check.

The repository's active pnpm supply-chain policy rejected two pinned lockfile entries with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`:

| Package | Published (UTC) | Gate cutoff observed (UTC) |
| --- | --- | --- |
| `langsmith@0.8.1` | `2026-07-09T17:24:56.000Z` | `2026-07-09T09:20:02.908Z` |
| `prettier@3.9.5` | `2026-07-09T16:17:00.997Z` | `2026-07-09T09:20:02.908Z` |

No policy was relaxed, no lockfile was regenerated, and no dependency version was changed. The failure occurred before format, lint, typecheck, unit, contract, migration, integration, E2E, build, or smoke gates.

Docker is also unavailable in this execution environment (`docker: command not found`). Even after the release-age window clears, the real PostgreSQL/Redis, migration, E2E, and smoke gates required by `pnpm verify` cannot complete until Docker Engine and the Docker Compose CLI are available.

Environment remediation audit at `2026-07-10T17:23:41+08:00` found no Docker, Podman, nerdctl, containerd executable, or Docker socket. Ubuntu packages `docker.io` and `docker-compose-v2` are available, but non-interactive sudo is not authorized (`sudo: 需要密码`), so Codex cannot install them without user action. No fake Docker shim or reduced test substitute was introduced.

The checked-in `reports/verification/summary.md` is historical evidence for commit `663bd1929932c0749d9ce56f22a96a186a2b47a3` on Windows and must not be represented as the result of this baseline attempt.

## Existing test inventory

- Static source inventory: 57 `*.test.ts` / `*.test.tsx` files.
- Static lexical inventory: 301 `it(...)` / `test(...)` declarations.
- Executed in this attempt: 0 tests, because dependency verification failed first.
- Historical checked-in full gate: 54 files / 242 tests at commit `663bd1929932c0749d9ce56f22a96a186a2b47a3`; this is not current baseline verification.

## Public API and Workflow DSL summary

- Management OpenAPI: `schemas/management-api.openapi.yaml`, 102 declared `operationId` entries covering Task, Goal, Workflow, Prompt, Model, MCP, Skill, Memory, Evaluation, Evolution, and system operations.
- Workflow DSL: JSON Schema 2020-12 in `schemas/workflow-dsl.schema.json`.
- Current node kinds: `llm`, `mcp_tool`, `result`, `condition`, `parallel`, `loop`, `subworkflow`, `human_confirmation`, `error_handler`, and `skill_call`.
- Expressions are restricted to literals, references, boolean/comparison operators, and `not`; arbitrary JavaScript is not part of the DSL.

## Blocking conclusion

The task package explicitly requires stopping when the unmodified baseline fails. No v1.0.1 implementation, feature commit, or tag is permitted from this state.

Minimum conditions to resume:

1. Re-run after the 24-hour release-age window has elapsed for both pinned packages (the later observed publication time implies no earlier than `2026-07-11T01:24:56+08:00`, subject to registry metadata and local clock).
2. Provide a working Docker Engine and Docker Compose CLI to this environment.
3. Re-run `pnpm install --frozen-lockfile` and `pnpm verify` without changing the baseline; proceed only if both pass.
