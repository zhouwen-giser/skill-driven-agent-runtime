# SDAR v1.2.3 Cognitive Runtime Design Freeze

Status: G00 frozen Domain/authority/schema contract on 2026-07-23

This document normalizes the v1.2.3 task package, Frozen Decisions and AC-G00-01 through AC-G17-09
against current `main@35cb9277396e0316b1c6b8aac57e6fa69a8a29df`. It is additive to the v1.2.2
design in `docs/25_V1_2_2_USER_GOAL_RUNTIME_DESIGN.md`.

## Authority order

| Concern | Authority | Advisory/projection only |
| --- | --- | --- |
| User intent | user-confirmed Goal Contract | Understanding, Task Type, Experience |
| Plan admitted to execution | user-confirmed validated Plan + v1.2.2 validator | Candidate/Shadow plan |
| Skill declaration | exact enabled Skill Version and Outcome Specification | Capability Pattern/history |
| Current readiness | v1.2.2 Provider/Skill readiness | Summary/Card/observed success |
| Workflow execution | LangGraph.js | Skill Goal DAG/session/replay |
| User Goal/A2A terminal | `UserGoalPlanController` | Workflow/Provider completion, Experience |
| Cognitive facts/knowledge | PostgreSQL | Redis, MemoryService, files, Console |
| Model invocation | existing SDAR Model Runtime | direct provider clients |

## KD-01–KD-20 register

The final numbering is the table in `Overall_Design` and Frozen Decisions. The earlier
`Best_Implementation_Design` contains a ten-item numbering with different grouping; it is historical
input and is not used as the final register.

| KD | Frozen decision | Owner / ADR | Replaces or extends |
| --- | --- | --- | --- |
| KD-01 | no Mastra/second runtime | Runtime / ADR-111 | reinforces ADR-001, ADR-007 |
| KD-02 | MemoryService is active projection only | Knowledge / ADR-112 | extends ADR-038, ADR-083 |
| KD-03 | user correction is a first-class fact | Interaction / ADR-112 | extends ADR-109 |
| KD-04 | deterministic Capability Summary | Capability / ADR-113 | new additive projection |
| KD-05 | narrative has no capability authority | Capability / ADR-113 | new additive rule |
| KD-06 | common promotion framework, separate targets | Knowledge / ADR-112 | reuses but does not merge Skill Evolution |
| KD-07 | Candidate excluded from formal Planner | Planning / ADR-111 | new mandatory guard |
| KD-08 | first release promotion is manual | Knowledge / ADR-112 | narrows automatic evolution |
| KD-09 | replay has no physical side effects | Evaluation / ADR-112 | extends no-replay authority |
| KD-10 | progressive disclosure | Retrieval / ADR-113 | new context policy |
| KD-11 | Experience failure falls back to base Planner | Planning / ADR-111 | preserves ADR-109 runtime |
| KD-12 | Capability Pattern is not a Skill | Knowledge / ADR-111 | preserves Skill authority |
| KD-13 | no automatic Skill publication | Knowledge / ADR-111 | limits Skill Evolution publication |
| KD-14 | high-risk knowledge requires human approval | Knowledge / ADR-112 | new promotion gate |
| KD-15 | active changes use version/status transition | Knowledge / ADR-112 | extends immutable status history |
| KD-16 | A2A Card reads activated snapshots | Capability/A2A / ADR-113 | extends adapter projection |
| KD-17 | sessions use CAS/idempotency | Interaction / ADR-113 | extends PostgreSQL CAS patterns |
| KD-18 | only confirmed Contract/Plan enters v1.2.2 | Planning / ADR-111 | preserves ADR-109 |
| KD-19 | transactional Outbox is learning entry | Experience / ADR-112 | new additive fact path |
| KD-20 | user experience never auto-globalizes | Knowledge / ADR-112 | reinforces scope/privacy |

ADR-114 separately owns the post-v1.2.2 additive migration ledger.

## Frozen terminology

- **Candidate**: immutable, source-linked proposal. It cannot enter the formal Planner.
- **Validating**: Candidate undergoing deterministic thresholds, replay, shadow and required review.
- **Active**: promoted version eligible for scoped retrieval; it may return to validating.
- **Declared capability**: exact Skill declaration/Outcome Specification projection.
- **Observed capability**: source-linked historical behavior; never current readiness.
- **Validated capability**: promoted evidence under the current catalog/policy; still not readiness.
- **Task scope**: applies to one task only.
- **User scope**: applies to one user within the tenant boundary; never auto-globalized.
- **Tenant scope**: applies only to one tenant partition.
- **Global candidate**: cross-tenant proposal still requiring privacy-safe promotion; not active global truth.

## Source authority and data classification

`CognitiveSourceRef` records kind, opaque ID, revision, authority, classification, capture time and an
optional `sha256:` content hash. Authority values are runtime fact, user instruction/confirmation,
domain rule, model candidate, promoted knowledge and Skill declaration. A model candidate is never
relabelled as a runtime fact.

Data classification is `public | internal | user_scoped | restricted`. Credentials, raw Provider
headers, private reasoning and unnecessary PII are prohibited. Public Card projection accepts only an
explicit public allowlist. User deletion must remove scoped projections and propagate to cognitive facts
where retention law/policy permits; immutable audit tombstones may retain only non-PII identifiers.

## State machines

```text
Task Understanding:
  created → clarification_required | confirmation_required | contract_candidate | rejected

Interactive Goal:
  understand → goal_review → confirmed
             ↘ rejected | canceled | budget_exhausted

Interactive Planning:
  plan_review → confirmed
              ↘ rejected | canceled | budget_exhausted

Experience Job:
  pending → leased → completed
              ↘ retry_wait → pending
              ↘ dead_letter → manual replay as a new/reattempted job

Knowledge:
  candidate → validating → active → validating | deprecated
      ↘ rejected      ↘ candidate | rejected
```

All revisions are immutable. Session/status writes use expected version plus an idempotency key. Active
knowledge requires an audited transition; G00 factories require human approval for first-release
activation.

## Stable errors and reasons

Domain error families are `COGNITIVE_ID_INVALID`, `COGNITIVE_SOURCE_REF_INVALID`,
`COGNITIVE_FEATURE_FLAGS_INVALID`, `COGNITIVE_EVENT_INVALID`,
`COGNITIVE_STATE_TRANSITION_INVALID`, `COGNITIVE_REVISION_INVALID`, `COGNITIVE_SCOPE_INVALID`,
`COGNITIVE_DATA_CLASSIFICATION_INVALID`, `CAPABILITY_SUMMARY_INVALID`,
`TASK_UNDERSTANDING_INVALID`, `INTERACTIVE_SESSION_INVALID`, `EXPERIENCE_EPISODE_INVALID`,
`KNOWLEDGE_CANDIDATE_INVALID` and `KNOWLEDGE_PROMOTION_FORBIDDEN`.

Knowledge transition reasons are `evaluation_started`, `promotion_approved`, `promotion_rejected`,
`contradiction_detected`, `catalog_changed`, `policy_changed`, `skill_version_changed` and
`manual_deprecation`. Later Goals may add narrower reason codes through an additive ADR/schema revision;
they may not reinterpret existing codes.

## Feature flags and queues

The frozen first-release defaults are Summary/Card on, understanding for ambiguous tasks, manual
interaction, Capture/Observer on, induction shadow, promotion manual and injection shadow. Queue names
are versioned under `sdar.cognitive.*.v1`; PostgreSQL outbox/job rows remain authority when Redis is lost.

## DDL and reset rule

`0108_v123_cognitive_skeleton` creates the complete table/state/constraint skeleton without composing a
service or activating behavior. It extends the byte-stable v1.2.2 clean baseline. Only an ordered prefix
of known `01xx_v123_*.up.sql` markers is accepted. Development/test reset requires the existing explicit
environment, database-name and confirmation guards; production reset is forbidden. Unreleased v1.2.3
experimental rows may be reset, while in-database revisions/status history remain immutable.

## Open-source boundary

Six sources are exact-commit design references in `third_party/sources.lock.yaml` and the G00 intake
reports. G00 copies no upstream source. AutoSkill source/long-prompt copying is prohibited because its
locked commit has no LICENSE. No Python product runtime or new product dependency is introduced.
