# ADR-018: Fixed-stage Model Runtime and auditable provider boundary

## Status

Accepted on 2026-07-12.

## Decision

- PostgreSQL owns encrypted Provider configurations, one explicit Provider route per model stage, and append-only invocation audits.
- Core code uses protocol-neutral model ports. OpenAI-compatible/local HTTP DTOs remain in `model-provider-adapter`.
- A stage resolves exactly one enabled Provider. Timeout, transport failure, invalid response, or disabled configuration fails the operation; no fallback lookup exists.
- Credentials are AES-256-GCM encrypted and never copied into requests, raw response audit, errors, or management output.
- Audits retain request/context, sanitized displayable raw response, structured result, model, token counts, duration, status, and error. Adapter parsing discards reasoning/private fields.
- Structured generation requests strict JSON Schema output. Returned JSON remains untrusted and is revalidated by the consuming application service.

## Consequences

OpenAI-compatible cloud and local endpoints share one adapter while future vendor-specific adapters can implement the same port. Prompt versioning and all decision-stage consumers remain subsequent EP-03 increments.
