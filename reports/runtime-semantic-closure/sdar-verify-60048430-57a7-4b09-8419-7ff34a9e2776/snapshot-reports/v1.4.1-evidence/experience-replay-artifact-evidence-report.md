# Experience, Replay and Artifact Evidence Report

## Status

`COMPLETED`. The first independent read-only review rejected Phase 8 with
two Blocking and eight Major findings, and the next review found three additional Major findings
plus one Minor. All findings are repaired. The final independent read-only Review reports zero
Blocking, zero Major and zero Minor and declares `CLEAN_FOR_PHASE8_CLOSURE`. The Phase 8
implementation and Review are accepted. Task-package section 30 requires the complete `pnpm verify`
gate only at Phases 0, 3, 7, 9, 12, 13 and 14, so Phase 8 has no remaining full-gate condition.

The generated source matrix records all 22 accepted Phase 8 projectors: coverage is 74/100 verified
and 74/95 Required (77.89%). This report does not claim that either attempted full `pnpm verify`
completed successfully, because Phase 8 completion does not depend on that non-mandatory gate.

## Implemented path

The Server waits for Runtime Core, then reconciles 10 bounded source-owned PostgreSQL partitions:
Experience Task and Pattern, Replay Case and Dataset, plus Artifact, Validation, Retrieval, Usage,
Feedback and Promotion. Task facts keep exact Task scope; shared Pattern, Replay and Artifact
aggregates are never assigned to an arbitrary first Task. Each partition uses a repeatable-read
snapshot and an opaque aggregate-revision hash, so late asynchronous facts rescan even when their
source timestamp predates the checkpoint. The canonical writer persists records, exact
source-scoped Quality Issues and only then the checkpoint under the shared PostgreSQL projection
lease.

The shared `EvidenceProjectionPipeline` isolates each Runtime, Skill, MCP/Capability and Phase 8
source item. A poison item creates a stable, required and blocking durable Projection Issue, enters
restart-safe backoff and cannot starve healthy work; successful replay resolves that exact issue.
Source queries select the latest revision per source identity rather than one global latest row,
and every Catalog entry truthfully uses `durable_projection` because Evidence is appended after its
business-authority transaction.

P03 Goal Experience Episodes, Experience Traces and compressed Workflow Patterns feed 10
Experience records. Replay Dataset/Case/Validation/Result/Metric/Counterexample authorities feed
six Replay records. Compiled Artifact, Lineage, Match, Execution, Feedback, Validation and
Promotion authorities feed six Artifact records. Migration `0145` preserves exact matched Artifact
Version authority; ambiguous historical matches fail closed.

The mapper retains Activity identity and parent/concurrency/branch semantics, exact Dataset
Version and source hashes, no-physical-side-effect Replay proof, exact Artifact version,
policy/authority refs and usage correlation. Cross-record provenance is normalized to structured
`CognitiveSourceRef` values. All 22 Phase 8 record types have explicit exact schemas, including
closed-domain enums, positive versions and fail-closed rejection of undeclared required fields.

Large definitions stay authoritative in PostgreSQL. A 10,000-element Pattern is represented by an
exact immutable `patternDefinitionArtifactRef` plus per-array descriptors containing the fixed
allowlisted URI, JSON pointer, count and SHA-256 over the full pointed array. Inline collections
remain bounded at 256; larger collections are not truncated or disguised as empty. The resolver
validates the compressed envelope and returns the same canonical definition bytes. Pattern
definitions are decompressed only after size and SHA-256 verification, and child IDs are
content-stable under array reorder.

## Current evidence

- Evidence Contract: 100/100 records passed, split as 95 Required plus five diagnostic, under
  registry hash `sha256:a2ce623b2d26371680ba9392a33d10315639e66786d4acbcc244c5627202ba3d`
  and contract hash
  `sha256:a1ffebfde0902dab632c16a8ffdad781926198a9bf69ed3722b52da1206dfd86`.
- Focused Phase 8 Contract: 9/9 passed, including negative rejection of unknown closed enums and
  zero versions.
- Real PostgreSQL Runtime Core/Phase 8 integration: 5/5 passed, including poison-item isolation,
  durable issue/backoff/restart/repair/resolution and latest-per-source revision selection.
- Real PostgreSQL 10,000-element Pattern producer/resolver regression: 1/1 passed, proving exact
  ArtifactRef/descriptor reconstruction without truncation.
- Exact-version P07 PostgreSQL integration: 4/4 passed.
- The supplemental PostgreSQL mapper regression passes 4/4 and the real
  P03→P04→P02→P05→Phase 8 vertical passes 3/3.
- Final independent read-only Review: Blocking 0, Major 0, Minor 0, Accepted; verdict
  `CLEAN_FOR_PHASE8_CLOSURE`.
- An accidental combined Integration run passed the other 32 files / 165 tests. Its only failing
  Node Control file passed 1/1 after removing a startup race and making its migration setup
  independent.
- Latest targeted format, lint and typecheck checks pass. Prettier wrote the touched files before
  those targeted checks, so no whole-repository format-pass claim is made.
- Phase 8 is complete under task-package section 30. Neither attempted full `pnpm verify` is
  represented as a successful full gate.

## Review findings repaired

- Poison Runtime/Skill/MCP/Phase 8 items are isolated through durable Projection Issues,
  restart-safe fair backoff and exact success resolution.
- All 22 Phase 8 schemas reject unknown closed-domain enum values, zero Artifact/Dataset versions
  and undeclared required payload shapes.
- Legal Process Variants and Workflow Patterns with more than 256 children remain fully
  reconstructible; the real 10,000-element producer path proves exact ArtifactRef descriptors.
- Provider Operation identity, exact Plan identity and structured `CognitiveSourceRef` provenance
  are preserved.
- Pattern Catalog source paths and content-stable child identities match the compressed authority.
- Goal Revision joins cannot mix Episodes belonging to different Tasks.
- Late facts and unresolved blocking issues cannot be suppressed by a terminal checkpoint.
- Shared Pattern, Replay and Artifact authorities use global source-owned partitions rather than
  arbitrary Task scope.
- ArtifactRef resolution, persisted Replay-safety proof, exact Artifact versions and exact
  retrieval/usage correlation fail closed.
- Candidate vertical cleanup includes both planning tables and is independent of test order.

The final independent read-only Review accepted the complete remediation with no remaining
Blocking, Major or Minor findings. Generated coverage is 74/100 and 74/95 Required (77.89%);
Phase 8 is `COMPLETED`.
