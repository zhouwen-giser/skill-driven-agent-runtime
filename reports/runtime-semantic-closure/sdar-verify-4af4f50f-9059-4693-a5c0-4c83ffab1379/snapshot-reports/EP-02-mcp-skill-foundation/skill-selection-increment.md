# EP-02 Skill Selection Increment Evidence

Date: 2026-07-11

## Simulated verification

- Unit tests inject a protocol-neutral fake LLM decider and semantic retriever.
- They verify that all required metrics reach the decider, non-candidate decisions are rejected, and only enabled explicit alternatives can produce replacement plans.
- Replacement status is structurally fixed to `awaiting_confirmation`; the service exposes no execution operation.

## Real verification

- Real PostgreSQL integration stores performance metrics, candidate snapshots, selection/version/summary, and replacement records under migration `0011_skill_selection`.

## Not yet verified

No production ModelProvider or pgvector semantic retriever is wired, and no real task failure/replanning/confirmation e2e uses this service yet. FR-SKL-012/013 remain developing.

## Full regression gate

Architecture verification passed across 58 source files. `pnpm verify:ep01` passed format, lint, strict typecheck, unit 36, real integration 11, contract 17, real e2e 7, production build, dual-endpoint smoke, and the pinned A2A TCK harness with 67 selected MUST tests passed.
