# FR-LLM-005 Retrieval Context Reconciliation

Date: 2026-07-13

## Result

Verified. The EP-03 trace row was stale after EP-05 completed stage-specific long-term Memory retrieval. Skill metadata, historical success/failure experience Memory, and other long-term Memory are retrieved with pgvector-backed projections and supplied as constrained context to fixed LLM stages. Retrieval never becomes the final selector.

## Evidence

- `PersistedSkillSemanticRetriever` embeds Skill name, summary, description, capabilities, workflow guidance, and output instruction, persists the projection, and obtains PostgreSQL pgvector cosine scores.
- `SkillSelectionService` combines those scores with immutable Skill metadata and operational metrics, persists the candidate snapshot, and accepts only the structured LLM-selected candidate.
- `MemoryService.searchForStage` uses distinct query templates and type allowlists. Skill selection includes `skill_learning`, `success_experience`, and `failure_experience`; other stages retrieve the relevant historical/long-term Memory types.
- Structured intent, Skill selection, Workflow planning, exception, and Goal evaluation requests include source-linked Memory hits. Model invocation audit retains the rendered request and structured result; Skill selection records retain candidates, selected Skill and displayable decision summary.
- `reports/EP-05-memory-evaluation-evolution/FR-MEM-003-stage-retrieval.md` records a real PostgreSQL/pgvector, management/model-audit, Task-lifecycle gate: 29 integration and 37 E2E tests passed with local deterministic embedding/model semantics.
- Current deterministic regression: eight affected unit/contract files, 69 tests passed. Current unified `pnpm verify` passes with 54 files/240 tests.

## Classification

- Real historical evidence: PostgreSQL/pgvector projections and retrieval, persisted selection/model audit, management visibility, and Task lifecycle.
- Simulated external semantics: deterministic local embedding relevance and model decisions.
- Unverified: production-provider semantic ranking quality, which is provider-owned and not a claim of FR-LLM-005.

No retrieval score or rule selects the final Skill, Workflow, exception route, or Goal outcome. The fixed schema-constrained LLM remains the final decision maker and invented candidates fail closed.
