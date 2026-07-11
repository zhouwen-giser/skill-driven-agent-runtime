# ADR-010: Skill Version Authority and Publication

## Status

Accepted on 2026-07-11.

## Context

Agent Card publication and result validation previously accepted an in-memory capability list and a caller-supplied output schema. That made protocol behavior reproducible, but did not establish the persistent SkillVersion as the authority required by FR-SKL-006, FR-SKL-007, FR-A2A-006, and FR-A2A-010.

## Decision

- Store immutable `skill_version` rows and a stable `skill.current_version` pointer in PostgreSQL.
- Treat every edit, enable/disable operation, and rollback as creation of a new version.
- Publish only current versions whose status is `enabled` to the Agent Card.
- Resolve result validation schemas from the current enabled SkillVersion; execution callers cannot supply a competing schema.
- Validate JSON Schema and domain invariants before atomically inserting the version and updating the current pointer.
- Keep the domain and application models independent of PostgreSQL, Ajv, A2A, and future MCP SDK types.
- Version history and top-level field differences are queryable. Rollback copies the selected immutable version into a new current version linked to the previously current version.

## Consequences

Publication and result validation now share one persistent authority and survive process restart. Rollback preserves history by creating a new version rather than mutating an old row. Concurrent version allocation still needs an explicit locking strategy before management APIs permit concurrent writers; that work remains in EP-02.

## Evidence

- `packages/application/test/skill-registry.unit.test.ts`
- `packages/persistence-postgres/test/repositories.integration.test.ts`
- `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts`
- `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`
