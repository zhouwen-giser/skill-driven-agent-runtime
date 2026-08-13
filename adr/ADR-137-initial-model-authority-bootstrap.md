# ADR-137: Bootstrap Initial Model Authority Without Overwriting PostgreSQL

## Status

Accepted on 2026-08-12 for Runtime deployments that explicitly enable a configured initial Model
Provider.

## Context

Model Providers, fixed-stage routes, and immutable Prompt versions are PostgreSQL-authoritative
under ADR-018 and ADR-019. A new deployment previously required an administrator to create all
three kinds of records after the Runtime started. The UGV integration supplies a real Provider in
deployment environment configuration and requires a complete fixed-stage baseline before model
conformance can run.

The existing management services use intentional upsert and publication operations. Reusing them
unconditionally during every startup could overwrite administrator state, re-encrypt credentials,
or leave a partial Provider/route graph after failure. A code-level Prompt fallback would also
violate ADR-019.

## Decision

- The Server composition root parses the explicit deployment environment and maps it to a generic
  initial-Provider input. Application and Domain code do not read environment variables and do not
  contain UGV identities.
- When initialization is enabled, Runtime encrypts credential headers with the existing
  AES-256-GCM master-key authority. A PostgreSQL bootstrap repository obtains a transaction-scoped
  advisory lock, rechecks the whole `model_provider` table, and creates the configured structured
  Provider plus one `structured_generation` route for every fixed `ModelStage` only when that table
  is empty.
- Embedding support is never inferred from a chat model. An explicitly configured embedding model
  becomes a second logical Provider (with its own Provider ID) and receives the `embedding` route
  for every fixed stage. Migration `0155_v14_model_operation_routes` makes route identity
  `(stage, operation)`, so stages such as `goal` and `skill_selection` can use distinct models for
  structured generation and vectorization.
- The configured Provider set and all operation routes commit in one transaction. If any Provider
  already exists, including a disabled Provider, initialization is a strict no-op. Environment
  configuration never repairs, replaces, re-encrypts, or selects among existing Providers;
  operators continue through the management API.
- Migration `0153_v14_initial_model_prompts` creates one enabled, immutable version-1 Prompt with
  content `{{instruction}}` for each fixed ModelStage whose stage has no Prompt. Existing candidate,
  disabled, or enabled Prompt ownership wins. These rows are PostgreSQL data, not an in-process
  default or transport fallback. Forward migration `0154_v14_initial_model_prompt_pointer_repair`
  repairs current pointers created by an earlier migration statement while retaining immutable
  Prompt rows.
- `MODEL_STAGES` is the shared Domain enumeration for TypeScript validation and initialization. SQL
  stage constraints remain migration-owned and are verified against it.
- Inline and file-backed API keys are mutually exclusive. Only the composition root reads the file;
  credential material and file paths are absent from startup summaries and public Provider reads.

## Consequences

- A clean database becomes structured-model ready after migrations and one enabled startup
  configuration, without a management-API bootstrap race. It becomes embedding-ready only when an
  explicit embedding Provider is configured; absence remains a visible missing route rather than a
  silent chat-model fallback.
- With both structured and embedding configuration present, the initial authority consists of two
  Providers, 21 `structured_generation` routes, 21 `embedding` routes and 21 current default
  Prompts. These are fixed-stage counts, not runtime-discovered defaults.
- Restart and concurrent startup do not churn Provider ciphertext, timestamps, Prompt versions, or
  routes.
- A partially or manually configured database is preserved rather than guessed at. Operators must
  complete or change that state through explicit management actions.
- Prompt migration rollback removes only its ledger marker and retains immutable Prompt data and
  current pointers, because deleting or disabling them could invalidate invocation/evaluation
  lineage. Reapplication remains idempotent.

## Evidence

- `apps/server/test/environment.unit.test.ts`
- `apps/server/test/model-runtime-bootstrap-configuration.unit.test.ts`
- `packages/application/test/model-runtime-bootstrap.unit.test.ts`
- `packages/persistence-postgres/test/initial-model-prompts.contract.test.ts`
- `packages/persistence-postgres/test/model-operation-routes.contract.test.ts`
- `packages/persistence-postgres/test/repositories.integration.test.ts`
- `reports/sdar-ugv-smpp-integration/model-configuration.redacted.json`
- `reports/sdar-ugv-smpp-integration/model-stage-conformance.json`
