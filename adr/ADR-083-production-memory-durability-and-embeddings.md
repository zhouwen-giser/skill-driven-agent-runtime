# ADR-083: Production Memory durability and provider-shaped embeddings

- Status: Accepted
- Date: 2026-07-16
- Supersedes: ADR-038's fixed three-dimensional Memory projection

## Context

The initial global Memory foundation stored every embedding as `vector(3)` and admitted valuable
processed-result candidates without a structured durability decision. That shape cannot support
real embedding providers and can preserve changing MCP/device observations as if they were durable
knowledge. ADR-077 already commits authoritative Task/Goal/Workflow terminal state before Memory
enhancement, but its persisted warnings had no management query route.

## Decision

The Memory domain owns `durability`, `authority`, and a displayable `durabilityReason`. The fixed
Refinement stage must return type, content, summary, confidence and all three production fields in
one strict structured response. Caller-supplied authority is a hint in untrusted model input, not
proof; the model must return an explicit validated authority. A durable result must also match the
application-owned provenance path: management refinement is `admin`, evolution is
`skill_experience`, and processed-result extraction is `model_inferred`. A model cannot elevate
itself by naming a stronger authority.

Only `durable` refinement results may enter new long-term Memory. `volatile` and `unknown` results
are rejected before embedding or deduplication. Current coordinates, battery, online state,
occupancy and device-task state are explicitly classified as volatile MCP evidence and future Tasks
must query MCP again. Skill correction, prompt correction, failure and evaluation experience may be
classified as durable `skill_experience`. Management refinement carries an `admin` hint but still
passes through the same structured durability decision.

The application also recognizes the five named dynamic-state classes independently of the model.
Contradictory durable responses are forced to `volatile` / `mcp` before embedding, and the direct
create boundary applies the same rule. Domain constructors copy, finite-JSON validate, depth/cycle
bound and deeply freeze Memory content; the application copies and freezes each validated
Embedding before repository handoff. TypeScript `readonly` alone is not treated as runtime
immutability.

Migration 0064 converts only `memory_item.embedding` from `vector(3)` to generic `vector`, keeps an
explicit positive dimension column, enforces `vector_dims(embedding)` equality, and indexes active
durable rows by provider and dimension. Search filters active durable rows by the exact provider and
dimension before applying cosine distance. Existing rows migrate to `unknown` / `model_inferred`
and remain directly readable but do not participate in semantic retrieval until explicitly refined.
The old migration is unchanged.

Rollback to `vector(3)` fails with a stable migration error while any non-three-dimensional Memory
exists; operators must re-embed or deliberately remove those rows before downgrade. Empty and
historical-0049 upgrade paths must verify the generic type and all semantic columns.

Memory refinement, embedding, deduplication and persistence remain post-commit enhancements under
ADR-077. Their failures append a warning without changing the committed terminal outcome. A new
read-only management endpoint exposes that authoritative outcome and its enhancement warnings; it
does not create a second state store or execution runtime.

## Consequences

- Real providers may use 3, 8, 1536 or other positive finite dimensions without schema changes.
- Rows from different providers or dimensions are never compared.
- Dynamic device state cannot be admitted by the normal automatic pipeline when Refinement labels
  it volatile or when the deterministic safety policy detects a contradictory durable claim;
  uncertain evidence defaults to no admission.
- Historical unclassified Memory becomes conservative non-retrieval evidence instead of silently
  retaining authority.
- PostgreSQL remains the long-term source of truth, while model output remains validated data and
  LangGraph.js remains the only workflow runtime.
