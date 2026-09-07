# SDAR v1.2.1 Phase 1 Shared Protocol Package

Status: **PASSED**

The package pins MCP protocol `2026-07-28`, source commit
`26897cc322f356487da89113451bd16b520b9288`, schema Git blob
`cc44564e33305dbc07e820cdd0a97648f3852019`, 180,695 source bytes and SHA-256
`9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`.

## Artifacts

- unmodified attributed source Schema under `protocol/source`;
- nine derived SDAR JSON Schemas for stateless requests, discovery, routing, Tasks, notifications,
  task-execution profile, Availability, Evidence and structured mismatch reports;
- nine valid and twelve explicit invalid fixtures covering missing per-request authority, Legacy fields,
  nested Task, missing result discriminator, remoteRevision-only metadata, reserved Legacy methods,
  missing routing name, boolean Evidence, forbidden requirementId and URI scheme abuse;
- deterministic eleven-file lock plus frozen-document hash;
- fetch-time byte/SHA-1/SHA-256 verification and local offline drift/fixture verification.

## Verification

| Command | Result |
| --- | --- |
| `node protocol/scripts/verify-protocol-package.mjs` | passed: 11 locks, 9 valid, 12 invalid |
| focused Vitest contract | passed 1/1 |
| `pnpm verify:sources` | passed 20 exact pins |
| `pnpm format:check` | passed |
| `pnpm lint` | passed |
| `pnpm typecheck` | passed |

No SDK dependency, Domain wire type, runtime handler, compatibility translation or Provider claim was
added. This is local protocol-package evidence, not SDAR component conformance or real interoperability.
