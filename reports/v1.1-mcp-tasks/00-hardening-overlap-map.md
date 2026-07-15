# v1.1 / v1.0 Hardening Overlap Map

- Last merged/observed tag: `v1.0.4-bug-fixed`
- Last merged/observed SHA: `fa4b0509971fc73c474211b871eeefaf4e76eb54`
- Feature merge base: same SHA
- Unmerged hardening delta at Phase 0 check: none

| Hardening | Expected semantic overlap | Required action |
| --- | --- | --- |
| v1.0.5 | transitive/nested confirmation | preserve before Phase 3/4; remote child cannot bypass it |
| v1.0.6 | atomic terminal outcome | merge bug-fixed before Phase 4 completion |
| v1.0.7 | top-level Skill input | reuse resolved/validated input in availability and Tool call |
| v1.0.8 | complete Goal contract | preserve Goal version/invalidation in bindings/snapshots |
| v1.0.9 | graph-aware composition | preserve lineage and confirmation for remote child waits |
| v1.0.10 | capability-gap terminal contract | do not reinterpret unsupported Task capability as an unbounded retry |
| v1.0.11 | MCP Tool execution semantics | direct overlap; reuse its metadata and synchronous error behavior, do not duplicate |
| v1.0.12 | Memory production hardening | remote results pass normal result/memory authority boundaries |
| v1.0.13 | notification-based A2A waiting | divide notifier and remote poll/continuation responsibilities; required for Phase 6 |

## Conflict surfaces

Likely same symbols/files are `packages/domain/src/mcp.ts`, `packages/application/src/ports.ts`, `packages/application/src/mcp-registry.ts`, `packages/langgraph-runtime/src/workflow-compiler.ts`, `packages/persistence-postgres/src/repositories.ts`, `packages/runtime-redis`, `apps/server/src/runtime.ts`, workflow/task status enums, OpenAPI and migrations.

Phase 3 start, Phase 4 completion, Phase 6 start and PR-ready are mandatory fetch/merge checkpoints. A same-file, same-table, same-interface, same-schema, same-enum, same-OpenAPI or invalidating-design change blocks only the affected phase and requires a blocker report.

## Migration collision

Hardening may occupy 0057+. v1.1 reserves 0100+, but the current high-water runner would skip lower future migrations if 0100 were applied first. ADR-080 therefore prohibits 0100 in a persistent supported database until the complete v1.0.13 chain is present.
