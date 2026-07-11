---
name: sdar-architecture-guardian
description: Use when designing or reviewing Skill-Driven Agent Runtime modules, dependencies, domain models, adapters, workflows, or major refactors. Enforce the single-runtime and domain-boundary rules.
---

Read `AGENTS.md`, `docs/02_ARCHITECTURE_BASELINE.md`, `docs/04_DOMAIN_MODEL.md` and accepted ADRs.

Before coding, identify the authoritative owner of every new type and state. Reject designs that:

- introduce a second workflow runtime;
- leak A2A/MCP/LangGraph/ORM types into domain modules;
- equate Skill with a fixed workflow;
- execute LLM-generated code;
- mutate a running workflow graph;
- allow Goal Patch to reuse invalidated plan/results;
- create a second source of truth outside PostgreSQL.

After changes, list touched boundaries, invariants, tests and any ADR needed.
