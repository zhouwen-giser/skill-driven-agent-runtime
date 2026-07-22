# SDAR v1.2.3 Frozen Decisions

## Runtime authority

```text
LangGraph.js = only Workflow Runtime
PostgreSQL = only persistent authority
Redis/BullMQ = rebuildable scheduling layer
SDAR Model Runtime = only model invocation entry
UserGoalPlanController = only User Goal / A2A terminal authority
```

## v1.2.2 boundary

- v1.2.3 submits only confirmed Goal Contract and Plan;
- v1.2.2 owns scheduling, Skill Selection, Attempt, Workflow/MCP, Outcome, Recovery and No Replay;
- v1.2.2 must not depend on Experience/Task Type/Capability Pattern;
- Goal Lock remains `goalId + goalVersion`; no external call inside lock.

## Capability

- Capability Summary is deterministic and versioned by catalogHash;
- Narrative is display-only;
- Declared, Observed and Validated capability are distinct;
- Capability Summary and historical success do not represent current Readiness;
- Public Card uses an allowlist and reads an activated Snapshot;
- Capability Pattern is not a Skill;
- v1.2.3 does not automatically publish a Skill.

## Task understanding and interaction

- critical missing dimensions require user clarification/confirmation;
- confirmed User Goal Contract is the intent authority;
- Goal and Plan candidates are immutable revisions;
- all interactive writes use CAS and idempotency;
- unconfirmed Plan cannot create an Attempt or invoke side effects;
- user correction is a first-class fact;
- task/user/tenant/global-candidate scopes are separate.

## Experience

- experience begins from persisted structured Runtime Facts;
- no private chain of thought is stored;
- Observer/Reflector are asynchronous and non-blocking;
- observations distinguish fact, inference, lesson, uncertainty and contradiction;
- Experience is advisory and optional;
- experience failure falls back to the base planner.

## Knowledge lifecycle

```text
candidate → validating → active → deprecated/rejected
```

- Candidate cannot enter formal Planner;
- Task Type, Capability Pattern and Planning Heuristic share promotion infrastructure but separate targets;
- support and contradiction are both retained;
- high-risk knowledge requires replay, shadow, human approval and policy allow;
- new contradictions or version changes can return active knowledge to validating;
- MemoryService stores only active search projections, not complete authority.

## Replay and rollout

- Replay covers understanding, Contract, Plan, Validator and Outcome interpretation only;
- Replay invokes no physical provider or MCP side effect;
- Shadow never affects formal tasks;
- first release uses manual promotion and shadow injection by default;
- rollout order: capture → observe → candidate → shadow → advisory → active low-risk.

## Open-source reuse

- no second runtime is introduced;
- Gemini direct ports require source intake and Apache compliance;
- AutoSkill source copy is blocked until license confirmation;
- Python projects are algorithm references and clean-room rewrites;
- all source use is locked by commit and audited.

## Release

- no direct main edits, force push, automatic merge or tag;
- Draft PR remains protected review artifact;
- final report explicitly states Experience is advisory and no Skill auto-publication exists.
