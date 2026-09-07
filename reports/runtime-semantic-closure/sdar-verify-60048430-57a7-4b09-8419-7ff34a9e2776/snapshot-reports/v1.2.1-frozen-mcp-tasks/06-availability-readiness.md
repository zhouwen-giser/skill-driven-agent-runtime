# SDAR v1.2.1 Phase 6 Availability and Readiness

Status: **PASSED WITH BASELINE HOST LIMITATION**

Frozen Availability uses only `io.sdar/taskExecution/checkAvailability` with profile `1.0`, `checks`,
`requestId`, `state`, `knownValue` and root JSON Pointer `""`. Request/result correlation, restricted
windows and guaranteed reservations fail closed. Legacy method and field aliases are not translated.

Frozen Tool profiles derive only the frozen readiness vocabulary: task behavior, dynamic availability,
scheduling, max elapsed, observations, input required, supported idempotency modes and Task Notifications.
Removed `cancellation:*` and `execution:*` attributes cannot enter this path.

The reviewed `embodied.move_to` and `embodied.area_patrol` packages now require `observations` and
`task_notifications`. Their normative file hashes, package checksums and golden import snapshots were
regenerated and verified through the real Reader→Validator→Importer path. No blanket
`task_behavior:task_required` requirement was added.

## Verification

| Command | Result |
| --- | --- |
| focused Frozen Availability contract | passed 6/6 |
| formal Skill package contracts | passed 5/5 |
| combined focused contracts | passed 11/11 |
| `pnpm test:unit` | passed 75 files, 471 tests |
| `pnpm test:contract` | 140/141 passed; unchanged Windows symlink setup failed with `EPERM` |
| `pnpm verify:architecture` | passed across 267 TypeScript source files |
| `pnpm build` | passed |
| format/lint/typecheck | passed |

Phase 6 proves component contracts and reviewed package integrity. Runtime Notification delivery remains
Phase 7 and real Provider interoperability remains Phase 11.
