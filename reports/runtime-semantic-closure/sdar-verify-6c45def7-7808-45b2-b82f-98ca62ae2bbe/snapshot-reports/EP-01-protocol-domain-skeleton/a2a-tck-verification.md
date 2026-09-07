# EP-01 official A2A TCK verification

Official TCK source: `a2aproject/a2a-tck` commit `5996b79f9cefa6fc390980e383e358a66fb9e49e`, executed with its frozen `uv.lock`. The external uv runner is pinned to `0.11.28`.

## Reproducible protocol result

`pnpm test:a2a-tck` builds and starts the explicitly test-only protocol SUT, runs the official HTTP+JSON MUST selection, and copies all generated reports into `a2a-tck-http-json-must-protocol-harness/`.

JUnit result: 235 collected, 67 passed, 168 skipped, 0 failed, 0 errors. Skips cover transports not declared by the HTTP+JSON-only Agent Card and capability/state-conditional scenarios. The TCK compatibility summary counts deselected SHOULD/MAY and conditional skips differently; the JUnit failure/error counts and command exit code are the gate evidence.

This is simulated protocol validation. The TCK-only SUT returns deterministic fixture artifacts required by the official data-model tests and is not wired into the production TaskService.

## Real production-composition diagnostic

The production composition root was separately tested with real PostgreSQL, Redis/BullMQ and HTTP. JUnit result: 235 collected, 63 passed, 167 skipped, 5 failed, 0 errors. All five failures request immediate completed artifact/message fixture responses (`DM-ART-001` and `DM-MSG-001`); production correctly remains at mandatory plan confirmation until Workflow/Result Processor work is available.

Transport format, camelCase serialization, AIP-193 errors, HTTP status mappings, list/get/send behavior and projection persistence passed after the TCK-driven fixes. Production TCK is therefore not yet green and is not reported as such.

## Version scope

The pinned TCK embeds specification branch `v1.0.0`; A2A wire negotiation uses major/minor `1.0`, and the embedded specification says patch versions do not affect protocol compatibility. This supports the 1.0 wire contract but is not a literal upstream 1.0.1-labeled TCK. The exact 1.0.1 evidence gap remains recorded until upstream publishes or identifies such a fixture.
