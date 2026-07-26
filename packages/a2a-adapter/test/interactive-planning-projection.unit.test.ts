import { describe, expect, it } from 'vitest';

import { A2AInteractionProjection } from '../src/interactive-planning-projection.js';

describe('A2AInteractionProjection', () => {
  it('projects only the frozen input-required routing metadata for plan review', () => {
    const projection = new A2AInteractionProjection().toInputRequired({
      outcome: 'duplicate',
      session: {
        sessionId: 'planning-session-1',
        state: 'plan_review',
        version: 3,
      },
      candidate: {
        plan: { privateProviderResult: 'must-not-leak' },
      },
    } as never);

    expect(projection).toEqual({
      kind: 'interactive_planning',
      sessionId: 'planning-session-1',
      interactionType: 'plan_confirmation',
      state: 'plan_review',
      expectedVersion: 3,
      allowedActions: ['accept', 'patch', 'reject', 'cancel'],
    });
    expect(JSON.stringify(projection)).not.toContain('privateProviderResult');
  });

  it('projects a Goal clarification question identity without internal Understanding data', () => {
    const projection = new A2AInteractionProjection().toInputRequired({
      outcome: 'duplicate',
      session: {
        sessionId: 'goal-session-1',
        state: 'understand',
        version: 2,
      },
      question: {
        dimensionId: 'dimension.target',
        question: 'Which target?',
        privateUnderstanding: 'must-not-leak',
      },
    } as never);

    expect(projection).toEqual({
      kind: 'interactive_goal',
      sessionId: 'goal-session-1',
      interactionType: 'goal_clarification',
      state: 'understand',
      expectedVersion: 2,
      questionId: 'dimension.target',
      allowedActions: ['answer', 'restart_understanding', 'cancel'],
    });
    expect(JSON.stringify(projection)).not.toContain('privateUnderstanding');
  });
});
