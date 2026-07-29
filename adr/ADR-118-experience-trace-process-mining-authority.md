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
  a bounded Brotli+base64 envelope with canonical SHA-256 integrity over the exact cohort, variants,
  discovered process pattern and Workflow Pattern. The existing JSON support columns retain a
  bounded 4,096-reference index projection; `pattern_candidate_support` retains every support and
  contradiction reference under the same candidate foreign key and tenant scope. The definition is
  never a `CompiledArtifact` and cannot enter Artifact lifecycle or runtime matching.
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
- Formal v1.2.3 tasks do not guarantee an active Task Type. When the latest formal understanding has
  no candidate, normalization retains `task_type_missing` and derives a deterministic normalized
  request fingerprint only as a compatibility cohort key. That key is not a Task Type record,
  lifecycle state or activation authority. The V1 trusted-intranet deployment identifier supplies
  the persisted tenant partition; this does not add authentication or multi-tenant authorization.
- Product composition occurs only in `apps/server/src/runtime.ts`: persisted Episode/Trace Outbox
  events create source-event-linked durable runs, reconcilers rebuild wake-only Redis jobs, and
  bounded workers claim/process PostgreSQL state. No compiler service is called in the online Goal
  transaction.
- Automatic mining groups at most 1,000 pending source events by tenant/Task Type. The sorted event
  set binds run identity; a PostgreSQL advisory lock and one-active/recent-run-per-60-seconds rule
  prevent timestamp collision, concurrent duplicate scheduling and per-Trace full-cohort mining.
  Events arriving inside the rate window remain pending for the next batch.
- Mining stays in the V1 process but yields cooperatively every 128 traces, uses asynchronous libuv
  Brotli compression and runs with concurrency one. These boundaries preserve offline/background
  semantics without introducing a second process or workflow runtime.

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
