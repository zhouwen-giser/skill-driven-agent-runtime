# ADR-152: A2A streams and online Task Type projection

## Status

Accepted for the revised development scope on 2026-09-07 by `execplans/EP-RUNTIME-SEMANTIC-CLOSURE.md`.
Implementation and focused verification are in progress. A2A 1.0.1/HTTP+JSON scope and ADR-104/111/112/113 remain authoritative.

## Context

Streams emit one Task followed by status-only updates and may omit outputs. Task Understanding reads
static profile arrays rather than promoted PostgreSQL Task Types. Public capability admission and
semantic type knowledge must remain separate from authoritative execution permission.

## Proposed decision

- Keep the official SDK stream sequence: one initial Task, then standard Artifact/status updates. Emit
  schema-validated text/data artifacts before final status; use stable artifact identity and per-stream
  projection deduplication. Do not publish a second Task into a stream whose SDK pattern forbids it.
- Submission, follow-up and subscription share a projection observer. Durable Task revision, interaction
  revision/hash and result identity/hash detect changes, including metadata-only changes. Do not rely on
  same-millisecond updatedAt. PostgreSQL remains authoritative; no new event log or Task state machine.
- Request wait limits and subscription lifetime are explicit separate concerns. A long Task may return
  its ID within a bounded request, while standard subscription observes future updates until a valid
  boundary/disconnect. Observer disconnect or timeout never cancels the Task.
- Pure Task/interaction reads may not advance planning handoff. Add a read-only snapshot projection;
  command/reconciliation paths retain ensureHandoff. Standard status-message metadata contains only
  allowed current interaction actions, version and summaries, never private reasoning or secrets.
- Existing cognitive PostgreSQL Task Type definitions/promotion are the only semantic type authority.
  Add a bounded active-version index projection through the existing TaskTypeIndexSource seam, retaining
  exact revision/hash and full constraints/evidence when loading selected details.
- Use bounded metadata/full-text and existing semantic retrieval with final structured model selection;
  lexical hints rank candidates but are not the only inclusion rule. Validate selected IDs/revisions
  against the supplied active set. Missing dimensions request information; conflicting constraints or
  unavailable registered capabilities exclude candidates. Negative examples inform constrained model
  adjudication and structured checks; substring heuristics do not become a new semantic authority.
- Freeze the selected type/capability catalog evidence per Understanding revision. At unconfirmed handoff,
  changed type or capability authority requires renewed validation. A type's later deprecation alone does
  not mutate an already confirmed Workflow; Goal/Skill/Capability invalidation follows existing owners.
- Knowledge retrieval failure or an empty type catalog may fall back to ordinary untyped Goal planning as
  ADR-111 requires. This fallback cannot bypass mandatory Task Capability/Provider/confirmation checks.
  Explicit requireKnownMatch profiles remain explicit and return typed clarification rather than
  silently expanding permissions.
- Managed generic configuration reads registered active types rather than an eight-item vehicle set.
  Preserve explicit UGV qualification profiles. Existing static definitions may be imported with truthful
  `configured` origin and source hash, never forged induction evidence; activation follows existing
  promotion/approved configuration authority. Candidate/validating/rejected types are not online types.
- Pure-text messages can produce candidate public Capability IDs and structured inputs through a bounded
  model resolver over current Exposure/Skill schemas. Application validates the candidate and freezes
  exact binding via the existing TaskCapabilityService. Adapter/model never invents a Provider, resource,
  credentials or execution authority. Missing/ambiguous resources require input; no ugv1 default for
  arbitrary requests. Side effects still wait for existing confirmation and pre-invocation checks.
- Preserve the distinction between A2A lifecycle Task, semantic Cognitive Task Type and exact MCP
  operation-name Skill taskBindings.taskType. Do not migrate or fuzzy-match the third into the second.

## Compatibility and migration

Prefer existing Task revision and PostgreSQL JSON snapshot fields. Add versioned readers/indexes and
configured-source origin support as needed, with additive migrations and historical snapshot retention.
Task Type promotion/deprecation must refresh the rebuildable active search projection without restart;
readers always verify authoritative status/revision before use. No new A2A state/transport/authentication
requirement or model routing/failover policy is introduced by this proposal.

## Validation

Official SDK tests exercise pure stream completion, follow-up, subscribe/disconnect/reconnect, refusal,
metadata-only input requests and no side-effecting GET. PostgreSQL tests activate a non-UGV Task Type,
recognize held-out paraphrases without restart and exclude candidates/deprecated versions. End-to-end
scenarios cover document summarization, data/report analysis and existing device-read workflows using
local Model/MCP fixtures, while exact capability/confirmation and no-replay constraints remain enforced.
Real-provider semantic qualification is a separate evidence class, not inferred from deterministic mocks.

## Implementation decisions under the revised plan

The SDK public DefaultRequestHandler is subclassed only at the RequestHandler boundary; admission and protocol validation stay in the fixed official SDK. A pure observer reads Task revision, interaction hash and result hash, and never publishes subscription events into the SDK persistence bus. PostgreSQL Task reads use a read-only projection; planning command/recovery paths retain explicit handoff.

Configured definitions have a genuine source hash and no invented exemplar Episodes. The existing KnowledgePromotionService records configuration authority approval and policy checks through its existing evaluation/status-transition transaction. These records explicitly state that configuration approval is not replay/induction evidence. Inferred definitions retain their original evidence gates. Rebuildable vector projection uses existing reconciliation; bounded full-text recall can operate before vectors are populated. Repeating configuration does not reactivate deprecated/rejected revisions.

A durable clarification receipt owns request identity, version and partial input, without another Task state machine. After input arrives, the existing Task Capability authority validates current Exposure, requester, Schema and Provider requirements. Binding, input attempt, Task queue phase and consumed receipt commit atomically. No server resource default is introduced.

The committed capability binding also constrains the subsequent ordinary Skill selection to exact implementation versions. Its input snapshot enters the existing exact-input resolver; text/model inference cannot replace clarified authority. Ordinary requests run online Understanding even when concrete, while only ambiguous requests or explicit interactive entry policy add Goal review. Blocking missing dimensions and authorization confirmation retain their existing mandatory handoff. This separates semantic recognition from redundant confirmation without weakening authority.

Task list filters and pagination use current PostgreSQL Task phase/timestamp, then map the same pure Task/interaction/result view as GET and subscriptions. Stored SDK projections retain protocol history only; read paths never update stale projection state. Configured activation obtains the exact governance candidate by identity, independent of management-list pagination.
