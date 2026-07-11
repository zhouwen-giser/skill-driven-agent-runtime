# Repository Instructions for Codex

## Mission

Build and verify the Skill-Driven Agent Runtime defined by the requirement baseline. This repository is an evidence-driven implementation project, not an architecture-only exercise.

## Authoritative material

Resolve conflicts in this order:

1. `source/Agent通用模板Server需求规格说明书_V1.0.docx`
2. `docs/01_REQUIREMENTS_BASELINE.md` and `docs/17_TRACEABILITY_MATRIX.md`
3. accepted ADRs
4. the active ExecPlan
5. examples and reference-project notes

Never silently change the baseline. Record ambiguities in `docs/18_KNOWN_ASSUMPTIONS_AND_GAPS.md` and make the smallest defensible decision through an ADR.

## ExecPlans

For complex features, significant refactors, compatibility spikes, migrations, or work spanning multiple modules, use an ExecPlan as defined in `PLANS.md`. Keep its Progress, Discoveries, Decisions, Validation and Outcomes sections current. Execute the prepared plans in `execplans/` and update them as living documents.

## Architecture invariants

- Node.js and TypeScript, strict mode, modular monolith, one process in V1.
- LangGraph.js is the only workflow execution runtime.
- Official A2A JavaScript SDK and official MCP TypeScript SDK are isolated behind adapters.
- Core layers own their models. External SDK types may not cross adapter boundaries.
- Goal, Skill, Workflow DSL, evaluation, memory and evolution are first-class domain modules.
- LLM output is data, never executable source code. Do not eval, import, compile or run LLM-generated JavaScript/TypeScript.
- Workflow expressions use a restricted AST/interpreter, not arbitrary code strings.
- Plan generation and execution are separate. Tool calls must not occur before required confirmation.
- A Goal patch invalidates the old plan, confirmation, workflow and intermediate results.
- A workflow instance is immutable during execution. Replanning creates a new version outside the graph.
- Same `context_id` tasks are serialized.
- Queued tasks use BullMQ/Redis. Running tasks are not recovered or automatically retried after a process failure.
- PostgreSQL is the system of record; pgvector is used for semantic retrieval; Redis is ephemeral runtime state/queue/cache.
- Do not add authentication or multi-tenant isolation to V1 unless an ADR explicitly treats it as a non-breaking optional middleware. Preserve the trusted-intranet baseline and show warnings.

## Open-source reuse rules

Read `docs/03_OPEN_SOURCE_REUSE_STRATEGY.md`, `docs/13_OPEN_SOURCE_LICENSE_LEDGER.md` and `third_party/sources.lock.yaml` before adding dependencies or copying code.

- Direct runtime dependencies: LangGraph.js, official A2A JS SDK, official MCP TS SDK, BullMQ, PostgreSQL/pgvector and Redis clients.
- Mastra, VoltAgent, OpenHands, Dify, Google ADK, BeeAI and Microsoft Agent Framework are references unless an OSS Intake and ADR approve a narrow dependency.
- Never copy Dify source. Its modified license requires special review.
- Exclude Mastra `ee/` paths and non-open OpenHands commercial repositories.
- Preserve copyright/license notices for any copied or modified permissive code.
- Pin every accepted dependency or reference commit. No unpinned source is release-ready.

## Code standards

- Prefer small modules with explicit interfaces and dependency injection.
- No `any` except at a validated external boundary with a documented reason.
- Validate external data with JSON Schema/Zod/Ajv before entering the domain.
- Use typed error classes and stable error codes. Never swallow errors.
- Public APIs require examples and contract tests.
- Database changes require migrations, rollback notes and repository tests.
- Secrets must be encrypted at rest using AES-256-GCM or an equivalently reviewed construction; the master key comes from environment configuration and is never persisted.
- Log structured summaries, not chain-of-thought. Do not expose private model reasoning.

## Test and evidence rules

Every change must run the smallest relevant test. Every ExecPlan milestone must run the full gate:

- format check
- lint
- TypeScript typecheck
- unit tests
- integration tests
- protocol/contract tests
- end-to-end tests
- production build
- local smoke test

Do not make tests green by weakening assertions, skipping cases, deleting requirements, using static placeholder responses or disabling strictness. Add regression tests for every fixed defect.

Each requirement must map to implementation, test and verification evidence in `docs/17_TRACEABILITY_MATRIX.md`.

## UI rules

The console is an operational product, not a static mock. It must expose real API data for MCP, Skills, Workflows, Tasks, Prompts, Memory, Evaluation and system configuration. Use an original React UI; Dify and VoltAgent may be used only as interaction references.

## Progress and reporting

- Update `PROJECT_STATUS.md` whenever an EP changes state.
- Record significant design decisions in `adr/`.
- Keep `CHANGELOG.md` current.
- Report commands, results and remaining failures precisely.
- When blocked, include attempted approaches, evidence, root cause, options and the minimum user input needed.

## Definition of complete

Do not declare the project complete until `docs/16_DEFINITION_OF_DONE.md`, `docs/17_TRACEABILITY_MATRIX.md` and all acceptance reports show every required item verified. “Implemented” without a reproducible test is incomplete.
