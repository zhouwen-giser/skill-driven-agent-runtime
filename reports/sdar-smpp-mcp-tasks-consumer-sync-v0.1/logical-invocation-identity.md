# Logical Invocation Identity

Contract: `sdar.mcp-logical-invocation/v1`.

The logical identity is SHA-256 over canonical JSON containing the immutable Task, Context, Goal
version, Workflow plan/definition/instance, exact node and node-run, Runtime Server, optional frozen
Provider Binding/provider IDs, operation, canonical argument hash and execution-context hash. Its
wire-safe identity and Frozen idempotency key are both `mcp-logical-<64 lowercase hex>`.

The identity excludes retry UUIDs, transport attempt counters, Benchmark verdicts, fault labels and
expected results. Recomputing it after restart produces the same value; changing any authority field
changes the hash. It is persisted with the admission intent before transport, and Canonical Evidence
uses the same stable ID as its source identity.

Evidence: `packages/domain/test/mcp-task-consumer-sync.unit.test.ts` and the Frozen HTTP response-loss
contract prove determinism and reuse of the exact idempotency profile.
