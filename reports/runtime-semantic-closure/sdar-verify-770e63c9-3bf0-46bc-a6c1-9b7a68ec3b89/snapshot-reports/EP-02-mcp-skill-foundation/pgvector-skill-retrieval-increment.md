# pgvector Skill retrieval increment

Date: 2026-07-11

## Evidence

- Migration `0013_skill_embedding` stores rebuildable current-version projections in PostgreSQL `vector` columns with provider/dimension guards.
- Application retrieval embeds the goal and candidate Skill content through a provider-neutral port.
- PostgreSQL integration verifies actual pgvector cosine distance and provider mismatch exclusion.
- Same-process e2e registers multiple Skills, obtains real pgvector candidate scores, invokes a separate structured decider, persists the selection, and returns the metric snapshot and displayable summary.
- Missing provider configuration fails explicitly; no semantic-rank or keyword fallback selects a Skill.

## Verification classification

- Real: pgvector extension, migration, vector persistence/query, SkillVersion/selection persistence, management HTTP.
- Simulated: embedding and final-decider provider responses in isolated tests.
- Unverified: production embedding/model transports and model-call audit, deferred to EP-03.

## Commands and results

`pnpm verify:architecture` passed across 65 TypeScript source files. `pnpm verify:ep01` passed format, lint, typecheck, 45 unit, 13 integration, 19 contract, 10 e2e, build, local server smoke, and the selected A2A HTTP+JSON MUST harness (67 passed, 0 selected failures).
