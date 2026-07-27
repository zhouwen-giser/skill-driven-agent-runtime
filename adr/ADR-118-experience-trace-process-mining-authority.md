# ADR-118: Experience Trace and deterministic process-mining authority

## Status

Accepted for SDAR v1.3 P03 implementation.

## Context

P03 must normalize immutable v1.2.3 Experience facts into replayable traces and discover repeatable
workflow patterns without fabricating missing events, blocking online execution, creating executable
Artifacts or introducing another workflow engine. P02 already created the frozen
`experience_trace` and `pattern_candidate` tables, while v1.2.3 already owns Episode facts, durable
Experience jobs and Redis-reconstructable wake delivery.

## Decision

- The Domain compiler owns the six exact frozen P03 contracts and their invariants. These plain-data
  contracts contain no external SDK type and confer no execution authority.
- `goal_experience_episode` plus its persisted source facts is the normalization input authority.
  The normalizer never consults live provider/readiness state and never uses model output to create,
  order or classify authoritative events.
- `experience_trace` is the sole durable Trace authority. Its `trace` JSON stores a bounded,
  versioned lossless envelope with ordered events, corrections, Outcome and missing-fact codes; the
  frozen relational columns are checked projections. `experience_trace_source` is only an immutable
  foreign-keyed source/deletion projection.
- `pattern_candidate` is the sole durable discovered-pattern authority. Its `definition` JSON stores
  the exact cohort, variants, discovered process pattern and Workflow Pattern. It is never a
  `CompiledArtifact` and cannot enter Artifact lifecycle or runtime matching. Supporting trace rows
  are non-authoritative foreign-keyed projections.
- `compilation_run` is durable delivery/lease evidence, not a Trace or Pattern authority.
  PostgreSQL owns idempotency, bounded attempts, retry/dead-letter state, leases and fencing. Frozen
  BullMQ queues contain run-ID wakes only and are reconstructed from PostgreSQL after Redis loss.
- Normalization is deterministic: canonical JSON plus SHA-256 identifies source, trace and
  fingerprints. Missing facts are reported and lower completeness; they are never synthesized.
  Credentials, authorization material, private reasoning, unnecessary PII and large raw tool
  payloads are rejected or reduced to bounded structural summaries before persistence.
- Mining is deterministic and tenant-scoped. Cohort/algorithm versions and mandatory/optional
  thresholds are persisted. Direct-follows and precedence come from event order/parent evidence.
  Parallelism requires explicit concurrency/partial-order/dependency evidence and is never inferred
  from timestamps alone. Failure and recovery variants remain separate evidence.
- Only `experience.trace_created` and `compiler.pattern_discovered` are emitted, transactionally,
  through the existing cognitive Outbox. Mining is asynchronous/offline and failure cannot alter or
  block Goal, Plan, Workflow, Outcome, Recovery, Provider, MCP or A2A paths.
- User deletion removes the applicable scoped Trace, pattern support and compilation payloads
  transactionally. Tenant identity is derived from persisted source scope, and all cohort reads
  require exact tenant equality.

## Consequences

P03 produces reproducible evidence that later packages can consume without gaining online execution
authority. Redis loss is recoverable, duplicate/crashed workers are harmless, incomplete/failure
facts remain visible, and the existing LangGraph.js/PostgreSQL authority boundaries stay unchanged.
Type-specific child tables may accelerate deletion/support queries but cannot be read as independent
Trace or Pattern truth.

## Rejected alternatives

- Create new trace/pattern alias tables: duplicates the canonical P02 authority.
- Treat PM4Py/Python or an LLM as production mining authority: violates the deterministic,
  single-runtime and no-Python-sidecar constraints.
- Infer parallel execution from equal/overlapping timestamps: misclassifies serial events.
- Bind Workflow Pattern directly to a Skill or emit a Compiled Artifact: exceeds P03 scope and
  bypasses downstream validation/governance.
- Put retries, leases or unique identity only in BullMQ: Redis loss would lose durable work state.
