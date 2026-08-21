# UAP-P2-B03 evidence note

The formal local Runtime E2E now passes through real isolated PostgreSQL, real loopback Redis,
`startServerRuntime`, the official A2A HTTP+JSON adapter and a strict loopback frozen Provider fixture.
It proves deterministic admission through Skill Usage and the Planner, zero task-scoped MCP calls and
zero navigation before authenticated outer confirmation, one `vehicle_navigate`, `waiting_external`,
a materialized continuation snapshot, restart reconstruction without replay, a fresh final read, the
hard final-position gate and the exact completed A2A artifact.

The qualification read is deliberately taskless and precedes A2A submission. Evidence therefore says
`preConfirmationTaskScopedMcpCallCount=0` and separately records one taskless read; it does not make the
false global claim that no read-only MCP call occurred before confirmation. The local fixture observed
one taskless `vehicle_get_state` plus the task-scoped sequence
`vehicle_get_state` → `vehicle_navigate` → `vehicle_get_state`. This is local P2 evidence, not execution
against the sibling SMPP stack, Device MCP or MQTT.

The six earlier non-E2E attempt JSON files, all eleven Runtime E2E attempt envelopes and the final-gate
Unit/Contract/Integration/lint/format attempts are retained. The failure envelopes distinguish their
later recording time from unavailable original execution times; no missing identifier or timestamp is
invented. Historical default-contract timing, PostgreSQL `template1` and isolated integration fixture
failures are not rewritten by later passes.

The current SMPP intake is
`b5f3ba2076468695c781bea1e5e6d3045e60f70e`. The P1 evidence checkpoint
`90466127aee7c01014eef29a1e346b071de3704e` and P0 contract source
`ce57d3d7ac2f99c0c95fa61bd9746abe862ed507` remain immutable historical ancestors. P2 did not run that
SMPP checkout and retains zero external Tool calls, navigation dispatches and MQTT publishes.

`examples/ugv-agent-profile-workflow.json` remains a generated review/regression fixture, not a plan,
Workflow instance, execution receipt or alternative Runtime authority. The P2 smoke verified local
`.env` LLM loading and database bootstrap with zero model invocations; P3 owns external inference. No
LLM configuration value or secret is recorded.

P2-B03 local integration is accepted. The exact final focused matrix passes 21 files/210 tests;
approved-host Unit passes 244 files/1913 tests plus the 22-test performance phase; approved-host
Contract passes 51 files/318 tests; isolated Integration passes 38 files/219 tests and its evidence
export passes 1/1. Typecheck, build, architecture across 835 TypeScript sources, frozen package 3/3,
SMPP provenance/clean checks, changed-file lint/format and diff checks pass. Full repository lint and
format retain disclosed failures in seven and two unchanged files respectively. Full generic E2E
retains three old Task Service endpoint failures; its exact isolated seven-failure result reproduces
at a pure archive of pre-P2 HEAD `4c0b1f7`. This is therefore
`PASS_WITH_DISCLOSED_BASELINE_GAPS`, not a clean whole-repository gate claim. Final artifact SHA-256
values are recorded in `uap-p2-b03-verification.json`; external P3 remains pending.
