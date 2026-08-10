# ADR-133: Project Experience, Replay and Artifact Evidence from Runtime PostgreSQL

## Status

Accepted on 2026-08-09; final independent Review accepted on 2026-08-10.

## Context

P03 Experience Trace and compressed Workflow Pattern facts, Replay datasets/results, and P02/P04
Artifact lifecycle facts already have PostgreSQL authorities. Canonical Evidence must reconstruct
their typed children and cross-family lineage without copying authority into Redis, expanding large
definitions inline, or correlating shared aggregates through an arbitrary first Task.

## Decision

`PostgresExperienceReplayArtifactEvidenceSource` exposes 10 source-owned bounded partitions after
the Runtime Core checkpoint: Experience Task and Pattern, Replay Case and Dataset, plus Artifact,
Validation, Retrieval, Usage, Feedback and Promotion. Task facts retain exact Task scope; shared
Patterns and global Replay/Artifact authorities are never assigned to an arbitrary first Task. Each
partition is loaded in a repeatable-read transaction. Authority readers select the latest revision
per source identity, not one global latest row.

Each partition revision is an opaque canonical hash of its complete ordered authority aggregate.
Equality comparison makes late asynchronous P03/P04 facts rescan even when their source timestamp
predates the checkpoint. The checkpoint is saved only after every record and exact source-scoped
Quality Issue is persisted. Missing or ambiguous references remain blocking; arrays are never
silently filtered or truncated.

The shared `EvidenceProjectionPipeline` isolates every Runtime, Skill, MCP/Capability and Phase 8
source item. Failure persists a stable required/blocking Projection Issue, applies restart-safe
backoff and continues bounded healthy work. Exact successful replay resolves that issue. A poison
source therefore cannot starve unrelated projection work.

`ExperienceReplayArtifactEvidenceProjector` emits 10 Experience, six Replay and six Artifact
Catalog types. Repeated activities retain event identity; parent, concurrency, branch, Plan Node,
Skill Goal, Attempt, Capability, Effect and Provider Operation references remain explicit. Pattern
child IDs derive from canonical child content and remain stable under array reorder. Cross-record
provenance uses structured `CognitiveSourceRef`; raw source rows and string shortcuts do not cross
the projection boundary.

The source verifies and Brotli-decompresses P03 Pattern envelopes using byte size and SHA-256.
Pattern definitions use immutable URI
`artifact://runtime/v1/pattern_candidate/<patternId>/1/definition`. Collections up to 256 elements
may remain inline; larger collections use a descriptor containing that exact ArtifactRef URI, JSON
pointer, positive count and SHA-256 over the full pointed array. No collection is truncated or
represented as empty. The allowlisted PostgreSQL resolver revalidates and returns the same
canonical definition. A real 10,000-element Pattern proves this producer/resolver path.

Replay validation persists a strict V1.2 safety proof derived from aggregate metrics and exact
side-effect-attempt failure Evidence. Only that persisted proof can set
`noPhysicalSideEffects=true`. Replay records retain exact Dataset Version and source hashes.
Artifact records retain exact version, canonical `policyId@version` refs, authority refs,
retrieval/usage correlation, validation and promotion lineage. Migration 0145 stores the exact
matched Artifact version and fails closed on ambiguity.

All 22 Phase 8 payload schemas are explicit authority schemas: closed domains use exact enums,
Artifact/Dataset versions are positive, and undeclared required shapes fail closed. Credentials,
secrets and private reasoning are removed before source hashing and payload persistence. PostgreSQL
is the only Evidence authority; Redis is not used. All 100 Catalog records truthfully declare
`durable_projection` because Evidence is appended after its business-authority transaction.

## Consequences

- Migration 0145 is additive and reversible; it introduces no second write authority.
- Source-owned partitions prevent cross-Task leakage and arbitrary ownership of shared aggregates.
- The 100-record contract contains 95 Required and five diagnostic records under registry hash
  `sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d` and
  contract hash `sha256:a1ffebfde0902dab632c16a8ffdad781926198a9bf69ed3722b52da1206dfd86`.
- Focused acceptance is 9/9 Contract, 5/5 real Runtime Core/Phase 8 PostgreSQL and 1/1 real
  10,000-element Pattern producer/resolver.
- The final independent read-only Review is `CLEAN_FOR_PHASE8_CLOSURE`: Blocking 0, Major 0,
  Minor 0. Generated coverage is 74/100 and 74/95 Required (77.89%). Task-package section 30 does
  not require the complete `pnpm verify` gate at Phase 8, so these accepted results close Phase 8.
