# ADR-057: Preserve immutable Memory status history

## Status

Accepted — 2026-07-12

## Context

FR-MEM-004 requires active, superseded and invalid states, replacement relationships, versioned conflict handling and no physical overwrite of historical knowledge. The initial Memory model had status fields but no governed transitions or audit record.

## Decision

- Preserve every `memory_item` row and its content. Status changes update only the current lifecycle projection; an append-only `memory_status_transition` records memory ID, before/after status, replacement ID, actor, reason and time.
- Superseding is one PostgreSQL transaction: insert a new active refined Memory, verify each source is still active, mark it superseded, and append the transition. Any conflict rolls back the replacement and all status changes.
- The replacement carries `supersedes` IDs; the old Memory remains addressable with its original content.
- Invalidation permits active or superseded to move to invalid, never invalid back to another state. It atomically updates the projection and appends an audit transition.
- Active semantic/stage retrieval continues to filter `status='active'`, while direct reads and transition history expose superseded/invalid evidence.
- Management endpoints require explicit actor and reason for supersede/invalidate. Under V1's no-auth baseline, actor is an operator-supplied audit label, not an authenticated identity.

## Consequences

Conflicting or obsolete knowledge stops influencing new decisions without deleting evidence. Concurrent stale transitions fail closed with `MEMORY_STATUS_CONFLICT`. V1 does not add authentication or physical cleanup.
