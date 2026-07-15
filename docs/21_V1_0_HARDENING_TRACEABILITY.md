# SDAR v1.0.1–v1.0.13 Runtime Hardening Traceability

Authoritative task package: `docs/SDAR_v1.0.1-v1.0.13_Runtime_Hardening_Codex_Task_Package.md`  
Active ExecPlan: `execplans/EP-08-runtime-hardening-v1.0.1-v1.0.13.md`  
Accepted baseline: `bc4b44a7c8187d8d5e3f589f7bb9490a67cf0ad6` (`pnpm verify` passed, operator-managed real PostgreSQL/Redis)

The table is updated only from reproducible implementation/test evidence. `pending` never means implicitly satisfied by older V1 behavior.

| Version | Problem / target                      | Design decision | Implementation | Migration | Tests   | Feature commit / tag | Bug-fixed commit / tag | Gate                        | Known limitations                       | Status  |
| ------- | ------------------------------------- | --------------- | -------------- | --------- | ------- | -------------------- | ---------------------- | --------------------------- | --------------------------------------- | ------- |
| v1.0.1  | Workflow runtime data binding         | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.2  | real `skill_call` child workflows     | pending         | pending        | pending   | pending | pending              | pending                | pending                     | nested confirmation finalized in v1.0.5 | pending |
| v1.0.3  | A2A input-required continuation       | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.4  | simulation/replay MCP headers         | pending         | pending        | pending   | pending | pending              | pending                | pending                     | MCP Server enforcement remains external | pending |
| v1.0.5  | nested Skill confirmation             | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.6  | atomic authoritative terminal outcome | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.7  | top-level Skill input resolution      | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.8  | complete Goal execution contract      | pending         | pending        | pending   | pending | pending              | pending                | pending                     | pending                                 | pending |
| v1.0.9  | Skill Graph composition planning      | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.10 | terminal capability-gap contract      | pending         | pending        | pending   | pending | pending              | pending                | pending                     | original Task never resumes             | pending |
| v1.0.11 | MCP Tool execution semantics          | pending         | pending        | pending   | pending | pending              | pending                | pending                     | MCP Tasks not implemented               | pending |
| v1.0.12 | Memory durability/embedding hardening | pending         | pending        | pending   | pending | pending              | pending                | full `pnpm verify` required | pending                                 | pending |
| v1.0.13 | A2A state notification wait           | pending         | pending        | pending   | pending | pending              | pending                | `pnpm verify` + both demos  | pending                                 | pending |

## Baseline Evidence

| Command                          | Result                                                             | Evidence classification                                 |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | passed; 348 entries satisfy supply-chain policy                    | real local install                                      |
| `pnpm verify:bootstrap`          | passed; 54 files / 242 unit+contract tests plus build/static gates | real local execution; Compose daemon/config deferred    |
| `pnpm verify:migrations`         | passed; empty and historical 0049 upgrade paths                    | real PostgreSQL                                         |
| `pnpm test:integration`          | passed; 2 files / 36 tests                                         | real PostgreSQL/Redis                                   |
| `pnpm test:e2e`                  | passed; 1 file / 41 tests                                          | real PostgreSQL/Redis with deterministic Mock Model/MCP |
| `pnpm smoke:infra`               | passed; pgvector 0.8.5 and Redis read/write                        | real PostgreSQL/Redis                                   |
| `pnpm smoke:server`              | passed                                                             | real Server/Console bundle over loopback                |
| `pnpm verify`                    | passed in 74065 ms at `bc4b44a`                                    | aggregate of the above                                  |
