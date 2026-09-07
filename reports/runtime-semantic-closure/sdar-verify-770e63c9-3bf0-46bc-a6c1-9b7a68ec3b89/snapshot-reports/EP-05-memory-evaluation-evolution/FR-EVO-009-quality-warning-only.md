# FR-EVO-009 verification report

Date: 2026-07-12

## Outcome

Verified. Version-specific quality observations produce persistent warnings for consecutive low scores and materially rising failure rate. Warning creation cannot disable, repair, evolve, or create a Skill version.

## Reproducible evidence

- Unit supplies six observations, proves both warning kinds are created, and verifies the enabled Skill value remains unchanged.
- PostgreSQL integration round-trips observations, contributing evidence references, warning thresholds, and status-at-creation.
- Management contract records normalized observations and lists warnings.
- Real local E2E registers enabled Skill v1, records three low failed evaluations, reads the active low-score warning, proves version history remains exactly one enabled administrator version, and proves the Skill remains visible in Agent Card.
- A transient Docker Hub OAuth EOF occurred on the first integration startup attempt; an immediate rerun against the same pinned environment passed 29/29. This is recorded rather than hidden.
- Full gate passes: format, lint, typecheck, architecture, 137 unit, 29 integration, 40 contract, 36 E2E, production build, and local server smoke.

## Verification classification

- Real: PostgreSQL warning projection, management HTTP, current Skill version history, enabled status, dynamic Agent Card.
- Simulated: normalized evaluator scores are supplied directly because the broader multi-evaluator pipeline remains separate FR-EVAL work.
- Unverified: production score calibration and long-window threshold tuning; V1 uses the explicit deterministic policy in ADR-053.
