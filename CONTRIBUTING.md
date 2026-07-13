# Contributing

Read `AGENTS.md`, the requirement baseline, relevant ADRs, and the active ExecPlan before changing behavior. Complex features, migrations, protocol changes, and multi-module refactors require a living ExecPlan under `execplans/`.

## Development rules

- Preserve LangGraph.js as the only Workflow runtime.
- Keep official A2A/MCP SDK types inside adapters.
- Treat model output as validated data; never execute generated source.
- Keep plans immutable during execution and require fresh confirmation after invalidation.
- Add no dependency or copied source without the OSS intake and license workflow.
- Add regression tests for defects. Do not weaken assertions, skip cases, disable strictness, or add placeholder responses.

## Before committing

Run the smallest relevant test while developing, then run:

```powershell
pnpm verify
```

Update the traceability matrix, active ExecPlan, ADRs where appropriate, `PROJECT_STATUS.md`, reports, and `CHANGELOG.md`. Use Conventional Commits. Never commit credentials, production endpoints, local `.env` files, database volumes, or private model reasoning.

## Pull-request evidence

Describe affected requirement IDs, implementation files, test files, exact commands/results, migrations and rollback notes, risk changes, and any real/simulated/unverified boundaries. A green unit suite alone is not release evidence.
