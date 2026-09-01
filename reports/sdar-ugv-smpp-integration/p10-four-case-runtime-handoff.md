# P10 Four-Case SDAR Runtime Handoff

The deployed SDAR candidate is source commit `3085454cf59b07c6ceb6440cf4e5544a0483155b`.
Runtime PID `3756664` started at `2026-09-01T08:52:39.145Z`; its built-tree SHA-256 is
`215d28b5e56b5089f2fd819fed7ed7498bd846cfca30f0d17c9dc974bbe0f1b3`.

Management `http://127.0.0.1:10998/api/v1/health`, A2A
`http://127.0.0.1:10999/.well-known/agent-card.json`, Node Control
`http://127.0.0.1:10091/health/live`, and Node Control `/health/ready` returned HTTP 200. The Node
Control readiness response reported both `control_database` and `node_profile` healthy.

The current append-only Binding is `ugv-smpp-real-integration-r2-binding@2`, active/available, with
Registry revision 2/checksum `165a5a0bcf2a93a2915d40c38fe1ec99af11bd0d1640565e34118e9301c44bdc`
and Catalog `2.0.0-rc.1:2`/checksum
`a8748237d2f70036a5abf320db0637cb34e2b018cb200292a4adf25c22d3014a`. A fresh Provider
`server/discover` and `tools/list` returned the Frozen protocol and exactly ten tools. No
`tools/call` occurred.

The governance run passed at `2026-09-01T07:07:38.589Z`. Active Agent Card revision 14013 exposes 13
Skills. Point navigation is `embodied.move_to@1` → `embodied.move@5` →
`a2a.embodied.move@4`, with immutable hashes recorded in the adjacent JSON report. Weapon lifecycle
is visible but invocation readiness remains restricted until strict fresh target and payload evidence
exists.

For the exact single UGV live candidate, Provider-reported dynamic availability `unknown` is preserved
as `unknown` and recorded as `allowed_by_default` only after the Capability/Binding/Catalog/resource,
target, execution-mode and confirmation authorities are exact. Explicit `unavailable`, transport or
protocol errors, multiple/non-exact candidates, and stale authority remain denied.

The public A2A input boundary has two exact projections. A metadata-free request may contain only a
text Part such as `Move the UGV to WGS84 longitude <lon>, latitude <lat>.`; the UGV profile resolves
exactly one labelled longitude and latitude into
`{resourceId:"vehicle:ugv1",target:{x:<lon>,y:<lat>,frame:"WGS84"}}`. A formal request must carry that
same object in its single data Part and `metadata.structured_input`, together with exact
`metadata["io.sdar/requestedCapability"]={exposureId:"a2a.embodied.move",versionConstraint:"4",requestId:<id>}`
and `metadata.idempotency_key=<id>`. The Benchmark materializer currently emits
`target={longitude,latitude,altitudeM}` and generic text without the numeric coordinates; no
Benchmark adapter translates it to either accepted SDAR projection. Direct submission of that
candidate is therefore an explicit P10 integration blocker. Altitude is intentionally not projected
into the frozen point-navigation command, and this handoff does not loosen either contract.

The four P10 frozen behaviors are implemented and focused-qualified without a live Task in this run:

- `UGV-NODE-001`: stale/unavailable/non-exact authority blocks before dispatch.
- `UGV-CORE-001`: normal remote Task binding/continuation still requires Runtime terminal verification.
- `UGV-MCP-003`: response loss uses exact reconciliation of the original Task; no blind redispatch.
- `UGV-XCHAIN-003`: Provider terminal is a receipt, never standalone Goal or physical success.

Reality classification is intentionally bounded: NODE, CORE and XCHAIN have implementation plus
simulated regression evidence; MCP-003 additionally has protocol-faithful contract and real
PostgreSQL integration evidence. This handoff did not execute a P10 live Task.

Clean verification of the exact implementation commit passed from
`2026-09-01T08:23:42.578Z` through `2026-09-01T08:50:31.435Z`: 331 static/unit/contract files with
2875 tests, 40 PostgreSQL/Redis integration files with 228 tests, 7 E2E files with 73 tests, official
A2A TCK, 44/44 canonical Evidence scenarios, migration, build, infrastructure, Server and Node
Control smoke gates. Phase 13 measured 1.21% Runtime regression, 6.85% baseline drift and 7.79 ms
Evidence append P95. After the exact redeploy, all four health endpoints returned HTTP 200, the
current Binding remained revision 2/available with ten operations, the Agent Card exposed 13 Skills,
and the Runtime PostgreSQL authority recorded zero new Agent Tasks, MCP invocations or remote Tasks.
