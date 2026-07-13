# NFR-OBS-002 Private Reasoning Boundary

Date: 2026-07-13

## Boundary

- OpenAI-compatible responses are parsed through a closed displayable response projection; undeclared message `reasoning` and top-level `private_reasoning` fields do not cross the Provider Adapter.
- Anthropic Messages responses may contain vendor thinking/signature blocks, but the Adapter selects only a validated text block and normalized usage. Private blocks are discarded before Model Runtime auditing.
- Model Runtime stores the rendered Prompt request, Prompt identity/version, sanitized displayable raw response, strict structured result, Token counts, duration, and errors.
- A2A Task projection includes the necessary phase summary and final text/structured artifact only. Request metadata, Goal/Plan internals, model audit evidence, and private reasoning are absent.
- The management model-invocation operation returns Prompt identity, rendered request, sanitized raw response, and structured decision for operator audit.

## Verification

Real local contract/unit verification:

- 48 targeted tests across both Provider adapters, Model Runtime, A2A mapping, and management API passed.
- The OpenAI and Anthropic loopback servers inject explicit `reasoning`, `private_reasoning`, thinking, and signature fields; assertions prove none appear in the sanitized raw response.
- A2A SDK serialization is asserted not to contain request text/metadata or internal Goal/Plan identifiers.
- Management contract assertions prove Prompt identity/version, rendered request, sanitized raw response, and structured decision remain visible.
- Strict typecheck passed.
- Unified `pnpm verify` passes with 53 unit/contract files and 220 tests, plus format, lint, strict typecheck, architecture, OpenAPI, source-pin, Compose/bootstrap static, SBOM/license, and production-build gates.

Implemented but unverified:

- The real same-process E2E assertion is extended to reject private reasoning in persisted management audits, but Docker-backed E2E is not currently runnable.

NFR-OBS-002 remains `开发中` until the same-process real E2E assertion passes reproducibly.
