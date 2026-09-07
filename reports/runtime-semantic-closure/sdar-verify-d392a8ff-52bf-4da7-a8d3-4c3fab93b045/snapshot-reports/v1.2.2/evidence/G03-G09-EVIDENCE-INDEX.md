# G03–G09 Evidence Index

| Goal | Acceptance | Implementation | Tests | Report |
| --- | --- | --- | --- | --- |
| G03 | AC-010–AC-015 | `user-goal-planning`, planning processor, Goal Patch, plan repository | planning unit, domain unit, A2A E2E | `G03-USER-GOAL-PLANNING.md` |
| G04 | AC-005, AC-020–AC-025 | Skill outcome schema/registry, scheduler, attempts/contracts | scheduler unit, Skill contracts, PostgreSQL race | `G04-SKILL-GOAL-SCHEDULER.md` |
| G05 | AC-030–AC-037 | layered judges, UserGoalPlanController, terminal transaction | judge/controller unit, terminal integration/race | `G05-LAYERED-OUTCOME-AUTHORITY.md` |
| G06 | AC-040–AC-048 | progress/recovery, budgets, fingerprints, effects | recovery unit, restart/no-replay integration, E2E | `G06-PROGRESS-RECOVERY-NO-REPLAY.md` |
| G07 | AC-050–AC-051 plus client portions | vendored frozen assets, strict client/mock/SSE | fixture and client contracts, protocol hashes | `G07-BUSINESS-EVENTS-FROZEN-CLIENT.md` |
| G08 | AC-052–AC-059 | coordinator, admission/processing, continuity/relation repositories | runtime unit, PostgreSQL integration, runtime E2E | `G08-BUSINESS-EVENTS-RUNTIME.md` |
| G09 | AC-060–AC-067 | impact mapping, plan revision, incident/recovery | impact unit, runtime E2E, real Provider event admission | `G09-EVENT-IMPACT-RECOVERY.md` |

Shared focused gate on 2026-07-22: 36 core unit tests, 7 Business Events contract tests, 8 PostgreSQL
integration tests and 1 runtime E2E test passed. Full release gate and exact commits are recorded by
G10; this index does not elevate the Frozen Mock to real interop evidence.
