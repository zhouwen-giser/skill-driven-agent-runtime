# SDAR v1.2.1 Phase 5 Frozen Task Lifecycle

Status: **PASSED WITH BASELINE HOST LIMITATION**

The Frozen adapter now rejects Legacy Bridge shapes and requires the exact result discriminators for
synchronous Tool results, flat Task creation, Detailed Task reads and empty update/cancel acknowledgements.
Task creation performs one immediate `tasks/get` reconciliation without repeating `tools/call`.

TTL is derived from `createdAt + ttlMs`, supports `null` and revisioned dynamic changes, and expired Tasks
fail closed before outcome admission. Runtime revisions are compared numerically, identical revisions must
have identical content, and terminal state cannot roll back. Exported lifecycle authority can be restored
after restart without losing revision or MRTR dedupe facts.

MRTR accepts only keyed `elicitation/create` requests and keyed frozen response actions. Partial responses
are supported; unknown, answered and superseded keys are ignored. Persistable submission identities prevent
duplicate A2A input from producing another `tasks/update`. A cancel Ack records cooperative intent only;
later `completed`, `failed` and `cancelled` outcomes all remain valid.

## Verification

| Command | Result |
| --- | --- |
| focused Frozen lifecycle contract | passed 12/12 |
| `pnpm test:unit` | passed 75 files, 471 tests |
| `pnpm test:contract` | 134/135 passed; unchanged Windows symlink setup failed with `EPERM` |
| `pnpm verify:architecture` | passed across 265 TypeScript source files |
| `pnpm build` | passed |
| format/lint/typecheck | passed |

Restart coverage in this phase restores serialized adapter lifecycle authority in the contract harness; it
is component-level evidence, not a claim of real Provider or process-restart interoperability. Phase 5 does
not implement Availability or Notifications, which remain Phase 6 and Phase 7 respectively.
