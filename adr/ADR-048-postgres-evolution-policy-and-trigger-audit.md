# ADR-048: PostgreSQL Evolution policy and trigger audit

## Status

Accepted — 2026-07-12

## Context

FR-EVO-002 requires a configurable minimum count before the LLM may decide whether to induce a Skill, plus a visible trigger log. The previous threshold was a constructor constant and candidate rows recorded only threshold-reaching outcomes.

## Decision

- PostgreSQL stores one authoritative `EvolutionPolicy` with an integer success threshold of at least two.
- Management GET/PUT endpoints read and update the policy through a domain validator.
- Temporary Skill completion reads the current policy after atomically saving each successful Experience.
- Every successful completion writes an immutable trigger record with capability fingerprint, Experience ID, accumulated successful count, configured threshold and one of `below_threshold`, `candidate_created` or `candidate_existing`.
- A formalization candidate freezes the threshold used when it was created. Later policy changes do not rewrite candidate or trigger history.
- The LLM induction stage remains unreachable while the count is below the policy threshold.

## Consequences

Operators can change the threshold without restart and can reproduce why induction did or did not run. The singleton policy is global in the trusted-intranet V1 baseline; no tenant or user-specific policy is introduced.
