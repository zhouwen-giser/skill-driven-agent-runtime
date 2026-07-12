# ADR-033: Context Goal continuity and relationship decisions

## Status

Accepted on 2026-07-12.

## Decision

- PostgreSQL is authoritative for the one active Goal per `context_id`. A newly queued Task in that context reuses the active Goal and its version; it does not ask the model to invent a duplicate Goal.
- When no active Goal exists, the fixed `goal` model stage first formulates the requested Goal. If a terminal Goal exists in the context, the same stage makes a schema-constrained `related_successor` or `unrelated_new` decision with a displayable summary.
- A related successor stores `previousGoalId`; an unrelated Goal does not. Both decisions create an immutable `goal_transition` record containing source/target identity, relationship, summary, request text, and timestamp.
- New Goal and transition persistence is one PostgreSQL transaction. The existing unique partial index remains the concurrency guard for one active Goal per context.
- Goal history is queryable through the management API and does not store private model reasoning.

## Consequences

- Same-context BullMQ serialization and the database unique index jointly prevent parallel Tasks from creating competing active Goals.
- Multiple Tasks may independently plan work against one Goal version while retaining their own request and Task history.
- Terminal Goal relationships are explicit evidence rather than inferred later from titles or timestamps.
