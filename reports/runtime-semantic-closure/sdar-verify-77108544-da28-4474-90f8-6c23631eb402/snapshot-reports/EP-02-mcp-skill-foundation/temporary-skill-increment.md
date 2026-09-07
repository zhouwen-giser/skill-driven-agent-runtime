# Temporary Skill increment evidence

Date: 2026-07-11

## Verified

- Domain isolation: Temporary Skills, Experiences, and formalization candidates are separate from formal Skill/SkillVersion models and tables.
- Creation rejects invalid JSON Schema and Tool references not present on an enabled MCP Server.
- Completion atomically expires the task-scoped object and persists its Experience in PostgreSQL.
- A single success cannot create a formalization candidate; two equivalent successes create only an `awaiting_simulation` candidate.
- Recursive canonical JSON hashing makes Schema object key order irrelevant to the capability fingerprint.
- Same-process management HTTP and real PostgreSQL/Redis/loopback MCP e2e verify create, expire, repeat-success threshold, and that the formal Skill list is unchanged.

## Commands and results

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test:unit`: 40 passed.
- `pnpm test:integration`: 12 passed.
- `pnpm test:contract`: 17 passed.
- `pnpm test:e2e`: 8 passed.
- `pnpm verify:architecture`: passed across 61 TypeScript source files.
- `pnpm verify:ep01`: passed, including format, lint, typecheck, 40 unit, 12 integration, 17 contract, 8 e2e, build, local server smoke, and the selected A2A HTTP+JSON MUST harness (67 passed, 0 selected failures).

## Verification classification and remaining gaps

- Real verification: PostgreSQL migration/repository transaction, same-process management API, Redis-backed runtime startup, and official MCP SDK loopback discovery.
- Simulated verification: deterministic hash/ID/clock ports in application unit tests.
- Not yet verified: automatic Agent capability-gap detection, execution of a Temporary Skill inside a confirmed Workflow, task-completion callback integration, and EP-05 simulation/evaluation/publication. Therefore FR-SKL-014 and FR-SKL-015 remain `开发中`, not `已验证`.
