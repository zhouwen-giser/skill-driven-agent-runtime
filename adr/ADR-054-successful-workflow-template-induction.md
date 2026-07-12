# ADR-054: Induce and prefer successful Workflow templates

## Status

Accepted — 2026-07-12

## Context

FR-EVO-010 requires frequently successful dynamic Workflows to become reusable, versioned templates whose provenance and later effects remain traceable. Reuse must not bypass Schema validation, plan confirmation, or the immutable Workflow-instance rule.

## Decision

- Record each successful Evolution Experience as a template occurrence keyed by a normalized Goal and a hash of node/edge structure.
- Induce a template after three successful occurrences with the same Goal key and structure. Preserve the three source Experience IDs and total successful source count.
- Create a new template version when another structure reaches the threshold for the same Goal key; never mutate an executing Workflow.
- Prefer enabled templates for exact or deterministic lexical-similarity matches (Jaccard score at least 0.6), breaking ties by similarity, successful-use count, then version.
- Supply the preferred template to the fixed Workflow-planning model as data. The model may adjust it, but the returned complete DSL still passes the normal Schema/domain validator and creates a new immutable plan that requires the normal confirmation policy.
- Persist each planned reuse against template ID/version, plan and adjusted Workflow identity. After evaluation, record success/failure, duration, aggregate use count, successful-use count, and average duration.
- PostgreSQL is authoritative for occurrences, versioned templates, and usage evidence. Management HTTP exposes inventory and per-template uses.

## Consequences

Repeated and lexically similar requests can reuse proven structure without introducing a second runtime or executable model output. The similarity method is intentionally deterministic and auditable; broader embedding-based semantic matching is not claimed. Concurrent aggregate updates remain transactional in the repository.
