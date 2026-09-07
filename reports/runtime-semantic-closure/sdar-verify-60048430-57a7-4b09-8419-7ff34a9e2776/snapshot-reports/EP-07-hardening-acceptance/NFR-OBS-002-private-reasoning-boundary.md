# NFR-OBS-002 Private Reasoning Boundary

Date: 2026-07-13

## Boundary

- OpenAI-compatible responses use a closed displayable projection; undeclared message `reasoning` and top-level `private_reasoning` never cross the Provider Adapter.
- Anthropic Messages may contain thinking/signature blocks, but only a validated text block and normalized usage cross the Adapter.
- Model Runtime audits rendered Prompt request, Prompt identity/version, sanitized displayable raw response, strict structured result, Token counts, duration, and errors.
- A2A projection contains necessary phase summaries and final artifacts only; request metadata, Goal/Plan internals, model audit evidence, and private reasoning are absent.
- Management model-invocation operations and Console expose Prompt identity, rendered request, sanitized raw response, and structured decision.

## Verification

- Current focused regression: 6 files/63 tests passed across both real loopback Provider contracts, Model Runtime, official A2A SDK mapping, management HTTP, and Console.
- Provider loopbacks inject explicit `reasoning`, `private_reasoning`, thinking, and signature fields; assertions prove none appear in sanitized raw responses.
- A2A SDK serialization is asserted to contain the necessary process summary and exclude request metadata, hidden reasoning, and internal Goal/Plan identifiers.
- Management contract assertions prove Prompt identity/version, rendered request, sanitized raw response, and structured decision remain visible.
- Current unified `pnpm verify`: 54 files/240 tests plus all architecture/protocol/OpenAPI/source/migration/license/build gates passed.

## Classification

- Real local: loopback Provider HTTP, Adapter parsing, Model Runtime audit projection, official A2A SDK serialization, management HTTP, and Console rendering contract.
- Unverified current: same-process PostgreSQL-backed E2E rerun while Docker is unavailable.

The original acceptance is specifically that external output contains no hidden reasoning. That boundary is directly exercised at every ingress/egress surface and does not require persistence to determine which fields cross it. NFR-OBS-002 is **verified**.
