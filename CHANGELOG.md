# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and planned commits use Conventional Commits.

## [Unreleased]

### Added

- Fixed-stage structured LLM final decisions for intent, Goal, Skill selection, Workflow planning, execution exceptions and Goal evaluation, including queue-path failure without fallback and richer persisted Skill candidate evidence.
- Native LangGraph human-confirmation interrupt/resume with PostgreSQL paused state, ephemeral fail-closed checkpoints, continuous budgets/events, and real MCP no-replay evidence.
- Immutable natural-language and administrator DSL/DAG plan revisions with atomic confirmation invalidation, persisted lineage, real A2A Task binding, management APIs, and confirmed LangGraph execution evidence.
- PostgreSQL-authoritative outer Goal evaluation/replanning with strict structured decisions, immutable next-version plans, ordered round evidence, confirmation pause/continue, all-Skill auto-confirm gating, and max-replan termination.
- Workflow budget resolution from system defaults and current Skill overrides, concurrency-safe LangGraph duration/LLM/MCP/cost enforcement, deadline cancellation, stable termination reasons, and persisted Skill-version/limit/usage evidence.
- Confirmed-plan LangGraph.js compilation with a type-strict expression interpreter, all-ten-node execution coverage, immutable PostgreSQL Workflow instances/node events, management confirmation/execution APIs, subworkflow recursion guards, and real MCP execution including no-second-confirmation repair evidence.
- Workflow planning with authoritative JSON Schema output, bounded same-model validation correction, persisted candidate/error history, immutable Goal-version identity, and repository-proven confirmation inheritance.
- Domain-owned Workflow DSL, draft-2020-12 Schema, restricted expression AST, strict graph/catalog validator, negative security corpus, and real MCP/Skill validation e2e.
- PostgreSQL Prompt version lifecycle with inactive automatic candidates, administrator publication, disable/rollback-as-new-version, stage runtime resolution, invocation linkage, and effect summaries.
- Database-configured fixed-stage Model Runtime with AES-GCM Provider credentials, OpenAI-compatible/local HTTP structured and embedding calls, sanitized token/duration audits, and explicit no-fallback failure behavior.
- PostgreSQL/pgvector Skill projections and semantic candidate scoring with provider/dimension guards, same-process selection API, and a separately injected final-decider boundary.
- Fail-closed structured Skill authoring with a vendor-neutral ModelProvider port, bounded Schema correction, explicit-Schema validation, optional same-process management wiring, and PostgreSQL/Agent Card e2e evidence.
- Task-scoped Temporary Skills with enabled-MCP-Tool validation, atomic expiration/Experience persistence, canonical capability fingerprints, and a repeated-success `awaiting_simulation` formalization gate that cannot publish formal Skills.
- Skill candidate metric snapshots and an LLM-decision port that prevents semantic retrieval from becoming the final selector.
- Persistent Skill selection records and alternative-only replacement plans fixed at `awaiting_confirmation`.
- Domain-owned persistent Skill Graph with six typed relation kinds, hierarchical cycle prevention, management CRUD, OpenAPI, and real e2e evidence.
- MCP remote health checks that persist enabled/unreachable state, and remotely validated AES-GCM credential rotation without Tool rediscovery.
- Skill immutable version-chain, field-diff, and rollback-as-new-version management APIs.
- Same-process management HTTP API for real MCP and Skill operations, with OpenAPI, strict Zod input validation, credential-free responses, redacted errors, and explicit trusted-intranet/no-auth warnings.
- Persistent MCP invocation audit records with task/context correlation, arguments, displayable results/errors, status, timestamps, and duration.
- Persistent dependency warnings for enabled SkillVersions affected by removed or schema-changed MCP Tools, without automatic Skill disablement.
- Editable validated Tool enhancement metadata preserved across manual refreshes while original input schemas remain authoritative.
- Remote-only MCP Registry with runtime register/delete/manual refresh, official Streamable HTTP discovery/calls, current original-schema validation, and loopback contract/e2e coverage.
- AES-256-GCM credential envelopes backed by an environment master key and PostgreSQL MCP Server/Tool persistence.
- Explicit JSON Schema draft-07 support for official MCP Tool schemas alongside SDAR 2020-12 schemas.
- Persistent immutable Skill/SkillVersion registration, schema publication gates, enable/disable and rollback versioning.
- Enabled PostgreSQL SkillVersions as the dynamic Agent Card authority and selected SkillVersion output schema as the result-validation authority.
- Unit, PostgreSQL integration, and A2A end-to-end evidence for the first EP-02 vertical increment.
- EP-00 pnpm workspace with strict TypeScript, ESLint, Prettier, Vitest and unified bootstrap verification.
- Exact dependency pins and OSS Intake records for A2A JS SDK, LangGraph.js, MCP TypeScript SDK, esbuild and reference-only projects.
- A2A 1.0 wire-shape, MCP Streamable HTTP and LangGraph bounded-loop compatibility Spikes with reproducible tests.
- Machine-readable and human-readable EP-00 bootstrap verification reports.
- Digest-pinned PostgreSQL 17/pgvector 0.8.4 and Redis 8.2.7 Compose services with health checks, bootstrap migration and rollback notes.
- Real loopback A2A REST/streaming endpoint contracts and MCP remote cancellation propagation contract.
- CycloneDX SBOM, installed-package license report and generated third-party notices with freshness verification.
- A2A stream-disconnection contract proving task execution continues and can be polled to completion.
- LangGraph parallel-join and compiled-subgraph compatibility coverage.
- Reproducible `pnpm smoke:infra` command covering pgvector migration/vector operations and Redis write/read; current host Docker denial is reported as unverified evidence.
- EP-00 real infrastructure smoke passed unchanged after Docker access was restored: pgvector 0.8.4, migration, vector operation and Redis write/read verified.
- EP-01 domain-owned Task/ConversationContext/Goal models, deterministic task state machine, stable errors and application TaskService ports.
- Automated architecture gate enforcing Domain/Application independence from A2A, MCP, LangGraph, Express, ORM and queue SDK types.
- PostgreSQL Context/Task/Event repositories with idempotent protocol-domain migration and rollback.
- BullMQ queue/Worker adapter with attempts=1, in-process same-context serialization and queued-job restart retention verified against real Redis.
- Validated A2A message/domain mappings and a PostgreSQL-backed SDK TaskStore projection that keeps the domain task as the system of record.
- Single-process server composition root connecting the official A2A endpoint, TaskService, PostgreSQL repositories and BullMQ worker through the mandatory plan-confirmation boundary.
- Whitelisted A2A follow-up actions for plan revision/confirmation, supplementary input, pause and resume, persisted through the domain state machine and verified with the official client.
- ADR-008 documenting the domain-authoritative A2A projection and metadata-based follow-up command contract.
- Reproducible official A2A HTTP+JSON MUST TCK runner, test-only protocol SUT, production diagnostic reports, and TCK-driven fixes for JSON content types, AIP-193 errors, camelCase serialization and projection decoupling.
- Request-time dynamic Agent Card capability provider plus a unified EP-01 gate covering format, lint, typecheck, unit, integration, contract, e2e, build, built-server smoke and official TCK.
- Domain-owned Skill draft intake for explicit A2A create/update requests, persisted in PostgreSQL before queueing and excluded from dynamic Agent Card capabilities.
- Ajv-backed Result Processor boundary with strict Skill output-schema validation, stable errors, authoritative Task completion and dual text/data A2A artifacts.
- Production A2A stream-disconnect continuation, polling and standard resubscribe coverage, plus forced active-connection shutdown for deterministic server lifecycle.
