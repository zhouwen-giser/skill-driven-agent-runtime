# v1.0.9 Bug-fixed Review

Date: 2026-07-16

## Outcome

The independent audit closed malformed-context and graph-volume trust gaps without changing the model-decision or LangGraph execution architecture.

## Corrections

- Every inherited or PostgreSQL-loaded context now proves unique Skill/relation/allowlist IDs, exact selected-root reachability, acyclicity and the configured depth/size bounds before it can authorize planning or execution.
- Detached Skill schemas and relation metadata reject cyclic, non-JSON or deeper-than-64 values.
- Composition caps accepted evidence at 128 relations and uses the existing PostgreSQL source/type index with a remaining-capacity limit instead of reading the full graph.
- Planner regressions prove disconnected and duplicate injected children fail before a model call. PostgreSQL regression proves a structurally valid but disconnected context row fails on repository read.

## Gate

The required full operator-managed `pnpm verify` passed in 87,491 ms. Compose daemon/config validation was explicitly deferred and every infrastructure script reported Docker lifecycle disabled.

Feature commit/tag: `8f7bba9` / `v1.0.9`.

Bug-fixed commit/tag: reconciled after publication / `v1.0.9-bug-fixed`.
