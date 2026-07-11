# ADR-028: Model Provider API-style adapters

## Status

Accepted on 2026-07-12.

## Decision

- Domain-owned Provider `kind` describes deployment/vendor class (`openai_compatible`, `local`, `other_vendor`), while `apiStyle` explicitly selects the wire protocol. These concepts are not inferred from one another.
- V1 supports `openai_chat_completions` for multiple OpenAI-compatible cloud endpoints and local servers, plus `anthropic_messages` as a non-OpenAI vendor protocol.
- The composite adapter is selected only at the infrastructure boundary. Vendor request/response shapes never cross into application or domain layers; all adapters implement the same structured-generation/embedding port.
- The Messages adapter sends schema and correction constraints as data, normalizes text JSON and token usage, strips unrelated provider response fields, and never requests private reasoning.
- Messages-only Providers explicitly reject embedding operations with `MODEL_OPERATION_UNSUPPORTED`; the runtime audits the failure and never silently switches Provider or protocol.
- Provider credentials remain AES-256-GCM encrypted and are passed only to the selected adapter. `apiStyle` is PostgreSQL-authoritative and exposed through the strict management contract.

## Consequences

- A new vendor protocol can be added as another adapter/API-style value without changing decision services or domain models beyond the reviewed configuration enum.
- FR-LLM-001 has OpenAI-compatible, local-compatible, and non-OpenAI Messages contract/e2e evidence.
- This does not claim live access to any commercial external endpoint; all network verification uses local protocol-faithful loopback servers.
