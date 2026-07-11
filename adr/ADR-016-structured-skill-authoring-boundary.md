# ADR-016: Structured Skill authoring boundary

## Status

Accepted on 2026-07-11.

## Context

FR-SKL-002/003 require LLM-authored input/output JSON Schemas and fail-closed registration. Model SDK objects and unvalidated model output cannot enter the Skill domain, and a convenient permissive fallback would violate the requirement.

## Decision

- Application owns a protocol-neutral `StructuredModelProvider` port. Provider and vendor DTOs remain in future adapters.
- Skill authoring requests one fixed structured response shape and treats every response as untrusted data.
- Zod validates metadata shape; Ajv validates each JSON Schema. Both Schemas must explicitly describe a top-level object and properties.
- A bounded correction loop feeds only displayable validation errors into the next request. V1 uses at most two attempts for this operation.
- Exhaustion returns `SKILL_SCHEMA_GENERATION_FAILED` and persists nothing. Short ambiguous descriptions fail before a model call. There is no default or permissive fallback Schema.
- Registration still passes through `SkillRegistryService`; the authoring service cannot write the repository directly.
- The same-process API exposes authoring only when a ModelProvider is explicitly injected. An unconfigured production runtime returns a stable error rather than simulated output.

## Consequences

Application and domain remain vendor-neutral, generated data cannot bypass publication validation, and tests can simulate deterministic provider responses without claiming production-provider verification. A production OpenAI-compatible/local/vendor adapter, stage routing, Prompt versions, and model-call audit remain EP-03 work.
