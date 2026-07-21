# SDAR v1.2.1 Phase 11 Real Provider Runtime Interoperability

Status: **BLOCKED — EXTERNAL FROZEN WIRE MISMATCH**

The external component gate was evaluated against the locally available remote-tracking ref
`zhouwen-giser/sdar-mcp-tasks-provider-runtime origin/main@c5594e4`. That ref contains the merged Frozen
Runtime and its 74/74 component report. An exact Git archive was started as Runtime `2.0.0-rc.1` with the
repository TypeScript reference Adapter and a separate PostgreSQL database. The tested chain was real:

```text
SDAR FrozenV1 components
→ stateless Streamable HTTP on 127.0.0.1:18080
→ Provider Runtime origin/main@c5594e4
→ PostgreSQL on the isolated Phase-9 server
→ reference TypeScript Adapter over gRPC on 127.0.0.1:17001
```

Discovery, Tool profiles/output schemas, synchronous execution, admission rejection, a flat working Task,
immediate `tasks/get`, true TTL, a reference-Adapter-driven working-to-completed transition, Evidence A and
Ack-first Notification transport all crossed the real chain. Protocol version `2026-07-28`, MCP source
commit and schema blob match SDAR.

## Blocking incompatibilities

1. `io.sdar/taskExecution/checkAvailability` omits required `reservationMode` from every result. SDAR
   rejects it as `FROZEN_AVAILABILITY_RESPONSE_INVALID`; defaulting the field locally would violate the
   frozen Schema.
2. For `input_required_frozen`, `tools/call` returns `resultType: "task"` with `inputRequests`. Frozen
   CreateTaskResult permits only the flat Task base; MRTR belongs to the immediate full `tasks/get`.
   SDAR rejects it as `FROZEN_CREATE_TASK_RESULT_INVALID`.
3. `business_failure` and `technical_failure` similarly put terminal `result`/`error` into
   CreateTaskResult. Those terminal payloads must be returned by `tasks/get`, so both are rejected as
   invalid creation results.
4. For Task `93a7ae16-e246-48f7-a5e1-a0692573d815`, `tasks/get` and `notifications/tasks` both publish
   Runtime Revision `29`, but only the Notification adds `eventId` and `observedAt`. The frozen contract
   requires the same `taskId + runtimeRevision` to represent the completely identical DetailedTask. The
   unified SDAR admission correctly rejects this as `FROZEN_TASK_REVISION_CONTENT_MISMATCH`.

These are Provider wire defects, not missing SDAR aliases. The 74/74 self-report does not include the
cross-implementation assertions above and therefore cannot authorize an Interop Certified claim. SDAR
must not weaken `reservationMode`, CreateTask or revision-content validation to accommodate them.

## Resolution required in the external repository

- always emit a contract-valid `reservationMode`;
- return base-only flat CreateTaskResult and expose input/terminal payloads from the mandatory immediate
  `tasks/get`;
- construct `tasks/get` and Notification from one byte-equivalent DetailedTask projection for each Runtime
  Revision;
- add these four SDAR cross-client regressions to the external 74-case gate, rerun its exact-commit audit,
  and provide a new merged Provider commit.

Runtime and Adapter processes were stopped, the disposable database was dropped, and the extracted
temporary archive/junction was removed on 2026-07-22 after verifying that the junction target remained
intact. Phase 11 remains incomplete, and this report makes no Interop Certified claim.
