# v1.0.7 Feature Review

Date: 2026-07-16

## Outcome

Formal top-level Skills now enforce their published `inputSchema` on the real A2A Task path. A schema-valid structured value is resolved before planning and becomes the Workflow initial input; missing or illegal required fields pause the same Task for durable supplementary input.

## Runtime evidence

- ADR-078 defines immutable Task/Goal/Skill-version input authority and strict evidence priority.
- `skill_input_resolution` is a fixed structured model stage with Provider route, Prompt, model invocation audit and Console support.
- Explicit `structured_input` A2A metadata remains authoritative over model extraction; long-term Memory is supplied only as non-authoritative evidence.
- Migration 0059 persists resolved, input-required and failed decisions plus durable input-request source support.
- Real A2A/MCP E2E proves metadata conflict resolution, same-Task missing-input continuation, Goal Patch re-resolution and direct `input.deviceId` MCP binding.
- Existing child `skill_call` schema validation remains independent and unchanged.

Feature commit/tag: pending / `v1.0.7`.
