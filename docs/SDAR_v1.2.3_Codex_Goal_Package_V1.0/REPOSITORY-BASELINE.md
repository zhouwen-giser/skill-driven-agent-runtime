# Repository Baseline

## Baseline

```text
Repository: zhouwen-giser/skill-driven-agent-runtime
Default branch: main
Minimum ancestor: 35cb9277396e0316b1c6b8aac57e6fa69a8a29df
Minimum ancestor message: Merge pull request #7 from zhouwen-giser/feature/v1.2.2-user-goal-planning-business-events
Observed package version: 1.2.2
Observed package manager: pnpm@11.7.0
Node engine: >=20.19.0
```

## Observed stack

```text
TypeScript / Node ESM
@langchain/langgraph
PostgreSQL / pg
Redis / BullMQ
Express
Zod / AJV
A2A JS SDK
MCP SDK
Vitest
```

## Existing gates that must be reused

```text
verify:architecture
verify:a2a-baseline
verify:management-openapi
verify:acceptance
verify:protocol
verify:migrations
verify:sources
verify:licenses
verify:project-license
verify:infra
pnpm verify
```

## Codex baseline duties

G00 must re-read the current repository rather than relying only on this snapshot. If names or package paths changed after this package was built, preserve current repository conventions and record a path/interface mapping in the ExecPlan. Do not fork a parallel architecture merely to match the preferred paths in Goal files.
