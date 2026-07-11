# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog, and planned commits use Conventional Commits.

## [Unreleased]

### Added

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
