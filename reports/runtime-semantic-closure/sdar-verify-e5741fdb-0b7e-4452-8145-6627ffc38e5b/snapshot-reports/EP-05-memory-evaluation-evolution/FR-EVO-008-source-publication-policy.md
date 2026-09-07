# FR-EVO-008 verification report

Date: 2026-07-12

## Outcome

Verified. System evolution candidates automatically publish only after the all-pass gate, while A2A-requested Skill drafts remain PostgreSQL drafts and outside Agent Card until an explicit management publication operation succeeds.

## Reproducible evidence

- Unit rejects direct `a2a_draft` authoring, proves no registry mutation, then publishes the persisted draft through the dedicated management workflow and records source/publisher/version.
- PostgreSQL integration proves draft-only creation and the constrained draft-to-published transition with publisher and SkillVersion identity.
- Contract covers management draft read and publish endpoints.
- Real A2A E2E submits `sdar_action=create_skill_draft`, proves the requested Skill is absent from Agent Card, proves generic direct authoring with `a2a_draft` is rejected, publishes through `/api/v1/skill-drafts/:draftId/publish`, and then observes the enabled `a2a_draft` Skill in Agent Card.
- System automatic publication remains covered by FR-EVO-005/006 E2E with `sourceKind: experience_evolution` and no administrator call.
- Full gate passes: format, lint, typecheck, architecture, 136 unit, 29 integration, 39 contract, 35 E2E, production build, and local server smoke.

## Verification classification

- Real: A2A draft creation, PostgreSQL state transition, management HTTP publication, model-driven schema authoring, formal Skill registry, dynamic Agent Card.
- Simulated: local structured authoring model output.
- Unverified: publisher identity authenticity under the intentional no-auth V1 management baseline.
