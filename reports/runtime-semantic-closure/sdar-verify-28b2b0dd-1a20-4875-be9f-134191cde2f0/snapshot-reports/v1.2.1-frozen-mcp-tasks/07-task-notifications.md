# SDAR v1.2.1 Phase 7 Task Notifications

Status: **PASSED WITH BASELINE HOST LIMITATION**

Frozen HTTP now exposes a cancellable POST SSE stream for `subscriptions/listen`. Requests carry the
normative metadata and routing headers, never send `Mcp-Name` or `Last-Event-ID`, deduplicate and sort at
most 256 interests, and release the stream reader when consumption stops.

`FrozenRemoteTaskSubscriptionManager` requires the Ack as the first message, correlates its subscription
ID to the listen request, admits only a stable authorized subset and rejects notifications outside that
subset. Reconnect performs one authoritative `tasks/get` reconciliation per accepted Task. Create, poll,
notification and reconciliation now converge through the lifecycle Runtime Revision authority, so an
identical notification/poll race produces one admitted observation while regressions, content mismatch and
terminal rollback fail closed.

## Verification

| Command | Result |
| --- | --- |
| focused subscription contracts | passed 7/7 |
| focused subscription + lifecycle contracts | passed 19/19 |
| `pnpm test:unit` | passed 75 files, 471 tests |
| `pnpm test:contract` | 147/148 passed; unchanged Windows symlink setup failed with `EPERM` |
| `pnpm verify:architecture` | passed across 269 TypeScript source files |
| `pnpm build` | passed |
| format/lint/typecheck | passed |

This is client component evidence. Provider-side authorization-at-send, bounded producer queue overflow and
multi-replica generation are not claimed here; they remain mandatory local Provider component cases in
Phase 10. Real Provider streaming remains Phase 11.
