# v1.0.11 Bug-fixed Audit

Date: 2026-07-16

The feature commit `2efbef6` and annotated `v1.0.11` are published and remotely verified.

The adversarial audit found and fixed four authority gaps:

- `default_unknown` could be constructed with non-unknown values and accepted snapshots were not runtime-frozen;
- a malformed exact MCP extension silently fell back to annotations or retained administrator input;
- administrator override and its management audit were separate writes, allowing unaudited state or phantom success during concurrent Tool deletion;
- structurally valid but source-contradictory persisted Tool/Invocation JSON could bypass the complete domain invariant.

The repaired boundaries reject contradictory defaults and stored sources, freeze primitive-value
snapshots, fail the whole discovery before replacement on malformed exact declarations, and use one
PostgreSQL transaction for override plus audit. Real regressions prove duplicate-audit failure rolls
back the Tool update and a missing Tool creates no audit row.

Bug-fixed publication: pending / annotated `v1.0.11-bug-fixed`.
