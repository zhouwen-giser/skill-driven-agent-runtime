# ADR-112: PostgreSQL-authoritative Experience and Governed Knowledge Lifecycle

## Status

Accepted on 2026-07-23. Owns KD-02, KD-03, KD-06, KD-08, KD-09, KD-14, KD-15, KD-19 and KD-20.
It extends the existing Memory and Skill Evolution ADRs; it does not turn MemoryService into a second
knowledge authority or reuse Skill publication as cognitive promotion.

## Context

The runtime must learn from persisted facts without storing private reasoning, delaying A2A terminal
delivery or globalizing a single user's correction. Model output is fallible and must never write active
knowledge directly. Helpful evidence and contradictions both need immutable lineage.

## Decision

- A transactional PostgreSQL outbox is the only entry from v1.2.2 runtime facts into asynchronous
  Experience processing. Redis/BullMQ carries reconstructable work references only.
- User corrections are immutable `PlanningCorrectionFact`/`PlanningInteractionEpisode` records with
  task/user/tenant/global-candidate scope. User scope never becomes global automatically.
- Planning Heuristic, Task Type and Capability Pattern use a common promotion framework with separate
  target tables and adapters.
- The lifecycle is `candidate → validating → active → deprecated/rejected`; active may return to
  validating on contradiction, catalog/policy or exact Skill-version change.
- Initial promotion is manual. Every high-risk activation requires replay, shadow, human approval and a
  policy allow; G00 enforces human approval for every first-release active transition.
- Replay covers understanding, contracts, planning, validation and outcome interpretation without
  physical Provider/MCP side effects. Shadow output never changes a formal task.
- MemoryService stores only rebuildable active search projections with authoritative PostgreSQL refs.
- Raw chain-of-thought/private reasoning, credentials and unnecessary PII are excluded.

## Consequences

Observer/Reflector failure can dead-letter and be manually replayed without changing the original Goal.
Candidates retain support and contradiction references. Projection deletion is recoverable from
PostgreSQL; projection content cannot be used to reconstruct Candidate authority.

## Rejected Alternatives

- Free-text/file playbook as authority: creates an unaudited second store.
- Model-applied deltas: lets an LLM commit authoritative state.
- Single-episode activation or automatic high-risk promotion: violates evidence and human gates.
