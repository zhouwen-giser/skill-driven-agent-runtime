# EP-02 Skill Registry Increment Evidence

Date: 2026-07-11

## Verified

- `pnpm test:unit`: 6 files, 23 tests passed.
- `pnpm test:integration`: 2 files, 8 tests passed against real Docker PostgreSQL and Redis.
- `pnpm test:e2e`: 1 file, 5 tests passed against the single-process server, real PostgreSQL/Redis, and official A2A client.
- `pnpm lint` and `pnpm typecheck` passed after the increment.

The tests reproduce immutable Skill version storage, enable/disable/rollback version chains, invalid JSON Schema rejection, tool-policy overlap rejection, dynamic Agent Card publication from enabled persisted versions, and result validation using the selected current enabled SkillVersion output schema.

## Not yet verified

MCP Registry, encrypted credentials, LLM Schema generation, Skill graph/search/selection, temporary Skills, management APIs, console views, and the complete EP-02 full gate remain open.
