# SDAR v1.2.3 Acceptance Matrix

所有 Acceptance 必须映射到自动测试或可重放报告。`pass`、`blocked`、`not-run` 必须区分，禁止用文档声明替代证据。

## G00：需求冻结、ADR 与 Domain Skeleton

- **AC-G00-01** — Latest origin/main contains the minimum v1.2.2 ancestor and baseline commands are recorded.
- **AC-G00-02** — v1.2.3 Domain, states, errors, source references and authority order are frozen.
- **AC-G00-03** — Architecture checks prevent v1.2.2 from depending on Experience/Task Type/Capability Pattern.
- **AC-G00-04** — Third-party source lock and license ledger cover every source used by the implementation.
- **AC-G00-05** — No product behavior is introduced by the skeleton goal.
## G01：Runtime Capability Summary Builder

- **AC-G01-01** — Identical enabled Skill declarations produce identical catalogHash independent of input order.
- **AC-G01-02** — Skill version, visibility or Outcome Specification change produces a new catalogHash.
- **AC-G01-03** — Capability Summary contains effects/evidence/artifacts/context/composition/limitations.
- **AC-G01-04** — Capability Summary never claims current Provider or device readiness.
- **AC-G01-05** — Only one hash-matched Summary Snapshot becomes active under concurrent rebuilds.
- **AC-G01-06** — Level-0 index and Level-1 details obey context budgets.
## G02：Public Capability Card 与 A2A Projection

- **AC-G02-01** — Public Card is generated from an active hash-matched Capability Summary Snapshot.
- **AC-G02-02** — Agent Card request path never invokes an LLM.
- **AC-G02-03** — Narrative failure falls back to a deterministic description.
- **AC-G02-04** — Public Card contains no Tool, Provider, credential, internal Workflow, private experience or real-time resource data.
- **AC-G02-05** — Existing A2A Skill projection remains compatible and A2A TCK baseline passes.
- **AC-G02-06** — Optional io.sdar/capabilityProfile is versioned and validated.
## G03：Generic Task Understanding

- **AC-G03-01** — Ambiguous user requests enter Generic Task Understanding.
- **AC-G03-02** — Explicit requests may proceed to Contract Candidate without unnecessary clarification.
- **AC-G03-03** — Target, scope, criteria, evidence, artifact and authorization gaps are represented as dimensions.
- **AC-G03-04** — High-risk missing authorization is never silently filled by experience.
- **AC-G03-05** — Model output is structured, versioned, source-linked and bounded.
- **AC-G03-06** — Prompt-injected text is treated as data and cannot become system policy.
## G04：Interactive Goal Session

- **AC-G04-01** — Interactive Goal Session persists every turn and immutable Understanding/Contract revision.
- **AC-G04-02** — Questions are tied to missing dimensions and do not repeat answered information.
- **AC-G04-03** — Concurrent actions use CAS and duplicate idempotency keys are harmless.
- **AC-G04-04** — Clarification and revision budgets terminate boundedly.
- **AC-G04-05** — Only a user-confirmed Goal Contract can enter planning.
- **AC-G04-06** — A2A input-required continuation resumes the correct session.
## G05：Interactive Planning Session 与 Plan Patch Compiler

- **AC-G05-01** — Every natural-language plan edit becomes a structured validated patch.
- **AC-G05-02** — Every patch creates a new immutable Plan Candidate revision.
- **AC-G05-03** — Cycles, missing dependencies, bounds overflow and incomplete criterion coverage are rejected.
- **AC-G05-04** — Unconfirmed plans create no SkillAttempt and invoke no MCP side effect.
- **AC-G05-05** — Confirmed Contract/Plan handoff uses goalId+goalVersion and preserves v1.2.2 authority.
- **AC-G05-06** — Interactive Planning Session survives process restart.
- **AC-G05-07** — High-risk plans cannot be auto-confirmed.
## G06：Planning Correction Facts 与 Interaction Episode

- **AC-G06-01** — Understanding, Contract and Plan corrections preserve before/instruction/patch/after/validation.
- **AC-G06-02** — Correction types and scope are normalized and queryable.
- **AC-G06-03** — A task-specific correction does not become a global rule automatically.
- **AC-G06-04** — Final Outcome may append a new Interaction Episode revision without mutating prior history.
- **AC-G06-05** — Only low-risk preferences may enter user-scoped Memory projection.
- **AC-G06-06** — User deletion and tenant boundaries are enforceable.
## G07：Experience Outbox、Job 与 Goal Episode

- **AC-G07-01** — Runtime fact and Outbox event commit atomically.
- **AC-G07-02** — Goal terminal creates an Episode asynchronously without delaying A2A terminal.
- **AC-G07-03** — Episode creation is idempotent across duplicate events and worker restarts.
- **AC-G07-04** — Missing critical authority facts do not create default experience.
- **AC-G07-05** — PostgreSQL is job authority and Redis loss is recoverable.
- **AC-G07-06** — Credentials, private reasoning and unnecessary PII are excluded.
- **AC-G07-07** — Dead-letter jobs are inspectable and manually replayable.
## G08：Experience Observer 与 Typed Extractors

- **AC-G08-01** — Observer produces source-linked structured observations from Goal Episodes.
- **AC-G08-02** — Each typed extractor validates with Zod/JSON Schema and may fail independently.
- **AC-G08-03** — Facts, inferences, candidate lessons, uncertainty and contradiction are distinct.
- **AC-G08-04** — Insufficient evidence yields no-op rather than fabricated knowledge.
- **AC-G08-05** — Untrusted transcript/tool text cannot become instructions.
- **AC-G08-06** — Observer/Extractor failure never affects the original Goal.
- **AC-G08-07** — Batch and token/byte limits are enforced.
## G09：Experience Reflector、Identity 与 Knowledge Curator

- **AC-G09-01** — Reflector and Curator create only candidate deltas, never active knowledge.
- **AC-G09-02** — Identity comparison uses semantic and lexical signals plus reusable job boundaries.
- **AC-G09-03** — Recent intent changes and materially different deliverables prevent incorrect merge.
- **AC-G09-04** — Low-confidence identity defaults conservatively to no merge.
- **AC-G09-05** — Helpful and harmful evidence retain Episode/Outcome references.
- **AC-G09-06** — Invalid Curator output is a no-op and does not mutate knowledge.
- **AC-G09-07** — Candidate lineage, merge and supersede history are auditable.
## G10：Task Type Induction

- **AC-G10-01** — Task Type fingerprint combines objective, criteria, artifacts, capabilities, DAG shape, corrections and outcome.
- **AC-G10-02** — Deterministic clustering precedes model naming and abstraction.
- **AC-G10-03** — Task Type contains recognition, negative examples, dimensions, criteria, capabilities and goal/dependency patterns.
- **AC-G10-04** — One Episode cannot produce an active Task Type.
- **AC-G10-05** — Candidate Task Types do not affect formal understanding before promotion.
- **AC-G10-06** — Current user constraints override or invalidate a Task Type template.
## G11：Capability Pattern Induction 与 Gap Candidate

- **AC-G11-01** — Declared, Observed and Validated capabilities remain separate.
- **AC-G11-02** — Capability Pattern captures applicability, effects, evidence, artifacts, prerequisites, failures and limits.
- **AC-G11-03** — Capability Pattern maps to exact current Skill versions or an explicit gap.
- **AC-G11-04** — Observed success never bypasses Provider readiness or Skill compatibility.
- **AC-G11-05** — Skill/catalog/policy changes revalidate affected patterns.
- **AC-G11-06** — Capability Gap cannot automatically publish a Skill.
## G12：Knowledge Promotion Framework

- **AC-G12-01** — Planning Heuristic, Task Type and Capability Pattern share a common promotion framework but separate targets.
- **AC-G12-02** — Candidate, validating, active, deprecated and rejected transitions are CAS-guarded and audited.
- **AC-G12-03** — Promotion evidence includes support, contradiction, users/goals, replay, shadow and acceptance outcomes.
- **AC-G12-04** — High-risk knowledge requires replay, shadow, human approval and policy allow.
- **AC-G12-05** — New contradiction or version change sends active knowledge back to validating.
- **AC-G12-06** — Only active knowledge is projected to MemoryService and projection is rebuildable.
- **AC-G12-07** — Knowledge promotion cannot invoke Skill publication.
## G13：Planning Knowledge Retrieval 与 Progressive Disclosure

- **AC-G13-01** — Retrieval applies scope, active status, applicability, catalog and policy filters.
- **AC-G13-02** — Vector and text retrieval are fused by tested RRF behavior.
- **AC-G13-03** — Relation expansion is bounded and preserves contradiction/supersede semantics.
- **AC-G13-04** — Planning session dedupe prevents repeated context injection.
- **AC-G13-05** — Progressive disclosure loads index before selected full definitions and exact Skills.
- **AC-G13-06** — Retrieval respects tenant/user scope and the 20K context budget.
- **AC-G13-07** — P95 retrieval target is measured and reported.
## G14：Experience-enriched Planning 与 Fallback

- **AC-G14-01** — Experience enrichment wraps rather than replaces the base User Goal Planner.
- **AC-G14-02** — Off/shadow/advisory/active modes have distinct tested semantics.
- **AC-G14-03** — Experience repository failure, timeout, conflict or low confidence falls back to the base planner.
- **AC-G14-04** — An invalid experience-enhanced plan gets at most one bounded no-experience replan.
- **AC-G14-05** — Experience cannot alter confirmed Contract, policy, readiness or terminal authority.
- **AC-G14-06** — Every usage is linked to Plan Candidate, user acceptance, validator and final outcome.
## G15：Management API、Console 与 A2A 全面集成

- **AC-G15-01** — Management APIs implement auth, actor, reason, CAS, idempotency and audit.
- **AC-G15-02** — Console supports understanding, Contract review, Plan DAG review and knowledge governance.
- **AC-G15-03** — A2A input-required actions route to the correct session and revision.
- **AC-G15-04** — Console cannot directly modify Provider state, Outcome or active execution plan.
- **AC-G15-05** — OpenAPI and frontend contracts are synchronized.
- **AC-G15-06** — Public and internal data remain separated.
## G16：Evaluation、Replay 与 Shadow Harness

- **AC-G16-01** — Replay datasets preserve accepted Contract/Plan, corrections, outcome, catalogHash and knowledge context.
- **AC-G16-02** — Mutation/development and promotion/holdout samples are separated.
- **AC-G16-03** — Baseline, champion and candidate comparison enforces hard-failure non-regression.
- **AC-G16-04** — Shadow planning never affects the formal task.
- **AC-G16-05** — Replay invokes no real device or MCP side effect.
- **AC-G16-06** — Every promotion has a reproducible provenance report.
- **AC-G16-07** — Candidate with insufficient samples remains incubating/candidate.
## G17：Hardening、灰度与 Release

- **AC-G17-01** — All v1.2.2 baseline and v1.2.3 verification commands pass from a clean checkout.
- **AC-G17-02** — Redis loss, worker crash, database restart and model outage recover or degrade as specified.
- **AC-G17-03** — Tenant isolation, PII deletion propagation, prompt injection and Card privacy tests pass.
- **AC-G17-04** — Capacity, backpressure, retention and SLO evidence is published.
- **AC-G17-05** — Capture→Observe→Candidate→Shadow→Advisory→Active-low-risk rollout is implemented.
- **AC-G17-06** — Sources lock, license ledger, THIRD_PARTY_NOTICES and SBOM pass.
- **AC-G17-07** — A2A MUST TCK and management OpenAPI gates pass.
- **AC-G17-08** — Release report states Experience is advisory, no Python sidecar exists and no Skill is auto-published.
- **AC-G17-09** — Working tree is clean; Draft PR is ready for protected review; no merge or tag is performed.

## Master final gates

- **AC-MASTER-01** — G00～G17 全部完成或只有用户明确接受的外部阻断。
- **AC-MASTER-02** — `pnpm verify`、A2A TCK、OpenAPI、Migration、Architecture、Sources、License、SBOM 全绿。
- **AC-MASTER-03** — 在线任务闭环与离线学习闭环 E2E 可重放。
- **AC-MASTER-04** — v1.2.2 执行、Outcome、Recovery、Business Events 和 No Replay 无回归。
- **AC-MASTER-05** — Draft PR 证据完整、工作树干净、不自动 Merge/Tag。
