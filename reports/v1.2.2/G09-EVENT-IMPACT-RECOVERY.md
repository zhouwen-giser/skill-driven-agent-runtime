# G09 Business Event Impact, Recovery and Plan Revision

## Summary

Status: **completed**. Durable Task/Resource Events are mapped through local execution authority to the
current Skill Goal, User Goal Plan and criteria, then routed through bounded recovery. Provider relation
means correlation, not proof of impact.

## Implementation and invariants

- Task events resolve task binding → attempt → Skill Goal → User Goal Plan → criterion. Resource events
  combine Provider relation pages with local bindings; only complete relations support a negative
  decision.
- Rules decide direct evidence invalidation and known dependencies first. A bounded semantic fallback
  can classify evidence only; low confidence cannot authorize `none` or any side effect.
- Current-plan impact can create an immutable, confirmation-pending revision with one bounded
  `EventHandlingSkillGoal`. Cross-Goal impact reserves and attaches an idempotent Incident AgentTask;
  interrupted attachment is repaired by dedupe key.
- Continuity loss uses conservative recovery. Emergency Skills are isolated candidates and all actions
  still pass policy/confirmation. Completed effects remain no-replay authorities.

## Validation

The impact suite passed 6 mapping, incomplete-relation, handling-Goal, incident dedupe/crash-repair and
Emergency Skill isolation cases. Business Events runtime E2E proves the HTTP → durable Inbox → impact
boundary. Real Provider Task and Resource Events were admitted in the separate interop run.

## Acceptance

AC-060 through AC-067 are verified.

## Reproduction

```text
pnpm exec vitest run --project unit packages/application/test/business-event-impact.unit.test.ts
pnpm exec vitest run --project e2e apps/server/test/business-events-runtime.e2e.test.ts
pnpm exec tsx scripts/run-v122-real-provider-interop.mjs
```

