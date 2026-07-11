# ADR-009: Result schema validation boundary

- Status: Accepted
- Date: 2026-07-11

## Context

FR-A2A-010 requires every final result to contain natural-language text and structured data conforming to the selected Skill output schema. Zod covers application-owned static inputs, but Skill versions provide JSON Schema at runtime. Implementing a partial JSON Schema interpreter would create inconsistent validation and security gaps.

## Decision

1. The domain owns `TaskOutput`; the application owns Result Processor orchestration and a protocol-neutral `JsonSchemaValidator` port.
2. Ajv 8.20.0 implements that port inside `packages/json-schema-adapter`. Ajv types and errors may not cross the adapter boundary.
3. Ajv runs in strict mode with remote schema loading and executable custom keywords disabled.
4. Result Processor rejects empty natural-language output, invalid schemas and nonconforming structured data with stable application error codes before Task completion is persisted.
5. A2A continues to project the accepted result as separate `text/plain` and `application/json` parts.

## Consequences

- Skill output schema validation is reproducible and standards-based.
- EP-02 must store validated Skill schemas; EP-03/04 call the same Result Processor after execution.
- No LLM output, schema content or validation keyword is treated as executable source code.
