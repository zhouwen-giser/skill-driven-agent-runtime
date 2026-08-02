# P09 Failed Attempts

| Attempt | Failure | Root cause | Repair / disposition |
|---|---|---|---|
| first focused command | `vitest` not recognized through `pnpm exec` | this Windows install exposes the checked-in module entry but not that shim | used `node node_modules/vitest/vitest.mjs`; 42 focused tests passed |
| first format check | parser rejected `async` interface member | implementation modifier was placed on a type signature | removed modifier from the interface and made the concrete method async |
| first real Integration | `TRUNCATE` FK rejection | new and existing child tables were not safely isolated by the cleanup | scoped deletes and explicit immutable-table truncate replaced broad cleanup |
| rollback proof | invalid event type committed | Runtime event table does not enumerate event types in SQL | used a deterministic missing-Task FK failure; Task and Binding both rolled back |
| repeated focused Integration | expected Agent Card revision 1 but observed 2 | revision sequence is intentionally monotonic across cleanup | assertion reads the active revision and verifies stability without resetting sequence |
| architecture gate | `ARCH_CONTROL_WRITES_RUNTIME_DATABASE` | Node Control imported the Runtime write repository | introduced the restricted Runtime-Control read-only Binding query adapter |
| first full verify | `model_invocation_task_id_fkey` in P09 cleanup | P09 deleted every Task in the shared serial integration database | cleanup now deletes only `task.p09.capability`; aggregate Integration 138/138 and full verify passed |

No failed attempt is represented as passing product evidence.
