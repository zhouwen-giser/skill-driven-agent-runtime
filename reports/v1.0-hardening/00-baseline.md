# SDAR v1.0 Runtime Hardening Baseline

- Status: **blocked**
- Captured at: `2026-07-10T17:22:01+08:00`
- Last rechecked at: `2026-07-15T12:35:08+08:00`
- Branch: `release/v1.0-hardening`
- Baseline commit: `7c2fea66687624743f286d9c8cb23b54e5a36036`
- Node: `v22.23.1`
- pnpm: `11.7.0` (repository package manager: `pnpm@11.7.0`)
- Package version: `0.0.0`
- Latest forward migration: `0053_mcp_tool_enhancement_stage.up.sql`

## Resume attempt on 2026-07-15

The release-age blocker has cleared: `pnpm install --frozen-lockfile` passed and verified all 348 lockfile entries against the active supply-chain policy.

`pnpm verify` then executed the current baseline at commit `3653aef34162312f38cb5aa40a62033d9f747847`. The static gate reached and passed:

- formatting;
- lint and strict TypeScript typecheck;
- 54 unit/contract test files and 242 tests;
- the 165-file architecture boundary check;
- A2A 1.0.1 baseline/TCK evidence (74 applicable passed, 161 scoped skips, 0 failures/errors);
- 102 management OpenAPI operations;
- 18 acceptance scenarios;
- 17 pinned OSS sources.

The unchanged baseline then failed inside `pnpm verify:bootstrap` before build and all Docker-backed gates:

```text
Error: COMPOSE_BASELINE_MISSING: pgvector/pgvector@sha256:
```

Root cause: commit `d2b851bfe141973a2c089d815e21262ae31ced14` changed `compose.yaml` from pinned image digests plus `platform: linux/amd64` to `pgvector/pgvector:pg17-trixie` and `redis:latest`, but did not update `scripts/verify-compose.mjs`. The accepted verifier still requires both digest pins and the platform declaration, and separately rejects mutable tags such as `redis:latest`. This is a pre-existing baseline inconsistency, not a Runtime Hardening change.

Docker Engine 29.6.1 and Docker Compose 5.3.1 are now installed, but the current user is not a member of the `docker` group and cannot access `/var/run/docker.sock`. Rootless setup also cannot proceed because `uidmap` requires sudo installation.

The generated current failure evidence is stored in `reports/verification/summary.md` and `reports/verification/summary.json`.

## Initial gate result on 2026-07-10

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

1. Reconcile `compose.yaml` with the accepted reproducible-image verifier in a baseline repair outside v1.0.1. The current `redis:latest` cannot satisfy the existing supply-chain rule.
2. Add user `zhouwen` to the `docker` group (or otherwise provide non-root access to the Docker daemon) and start a fresh login/session.
3. Re-run `pnpm install --frozen-lockfile` and `pnpm verify` on the repaired baseline; proceed only if both pass.
