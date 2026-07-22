# SDAR v1.2.1 Phase 11 Real Provider Runtime Interoperability

Status: **PASSED LOCALLY — PUBLICATION CHECKS PENDING**

## Tested chain

The merged Provider baseline was refreshed to `origin/main@217e0892c1d827c32c2a5342709fd3e77cfdb259`
(merged PR #15). The remaining frozen-contract fixes were implemented on the independent Provider branch
`fix/frozen-interop-contract-alignment` and committed as
`b30d839` after the real run. The functional Runtime sources used by the run are identical to that commit;
the later changes only finalized the Provider ExecPlan/report and strengthened its Runtime-stack E2E.
Draft Provider PR [#16](https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime/pull/16)
publishes the branch at documentation-only head `50a2b49` against `main@217e089`.

```text
SDAR FrozenV1 components from feature/v1.2.1-frozen-mcp-tasks-protocol
→ stateless Streamable HTTP on 127.0.0.1:18080
→ Provider Runtime candidate b30d839
→ isolated PostgreSQL 17 database sdar_interop on 127.0.0.1:55434
→ reference TypeScript Adapter over gRPC on 127.0.0.1:17001
```

The Provider's final `pnpm verify:v2` passed in 340.8 seconds: frozen 74/74, Runtime closure 29/29,
unit 79/79, contract 9/9, integration 199/199, recovery 9/9, security 29/29, E2E 6/6,
TypeScript/Python Adapter conformance, capacity, SBOM, Kubernetes, reproducible container image and RC2
regressions. The high-severity dependency-audit threshold passes with one moderate advisory remaining.

## Cross-implementation result

The real strict SDAR client passed all previously blocking paths:

- official-shape `tools/list` discovery of `echo_sync`, `durable_task` and `flex_task` with no top-level
  `resultType` extension;
- Availability with explicit `reservationMode: "none"`;
- base-only flat CreateTaskResult for `input_required`, completed business failure and failed technical
  failure;
- mandatory immediate `tasks/get` exposing MRTR, `result.isError=true`, or JSON-RPC error respectively;
- a real Ack-first SSE Task Notification for the completed business-failure Task.

The run also found one SDAR consumer defect: it incorrectly fingerprinted the base-only CreateTaskResult
as if it were a DetailedTask and rejected the first same-revision `tasks/get`. The lifecycle now records
projection kind and permits exactly one `create → detailed` upgrade at the same Runtime Revision. Subsequent
same-revision DetailedTask drift, regression and terminal rollback remain rejected. A focused lifecycle
contract passes 15/15 and the real matrix passes after the correction.

## Classification and remaining work

The three original open items were Provider omissions: missing Availability reservation semantics and
status-specific MRTR/terminal payloads leaking into CreateTaskResult. The merged PR #15 had already fixed
get/Notification equality. The refreshed run additionally found the Provider `tools/list` extension and
the SDAR create/detailed projection-state bug; both now have strict regressions.

G3 Provider Runtime Component Conformant and G4 Interop Certified pass for the tested local candidate
contents. G5 remains pending until the SDAR change is committed, the complete clean exact-commit SDAR gate
passes, both branches are published, and remote PR checks are green. No merge or stable release is claimed
by this report.
