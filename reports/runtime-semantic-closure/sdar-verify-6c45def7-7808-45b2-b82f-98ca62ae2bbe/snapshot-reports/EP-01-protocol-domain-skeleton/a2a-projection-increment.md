# EP-01 A2A projection increment

Status: passed.

The A2A adapter validates inbound metadata before mapping it to application DTOs and projects internal task phases to official A2A task states. The official SDK `TaskStore` interface now has a PostgreSQL-backed, rebuildable protocol projection; `agent_task` remains the system of record.

Evidence commands:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:unit` — 16 passed
- `pnpm test:contract` — 12 passed
- `pnpm test:integration` — 6 passed against real PostgreSQL and Redis containers

The endpoint lifecycle, official TCK, and EP-01 end-to-end gate remain open and are not claimed as verified.
