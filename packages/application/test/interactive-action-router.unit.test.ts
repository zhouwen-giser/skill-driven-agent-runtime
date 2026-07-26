import { describe, expect, it, vi } from 'vitest';

import { InteractiveActionRouter } from '../src/index.js';

describe('InteractiveActionRouter', () => {
  it('routes an A2A continuation to the current planning session and revision first', async () => {
    const planningView = {
      session: { sessionId: 'planning-session-1', version: 4, state: 'plan_review' },
    };
    const applyPlanning = vi.fn().mockResolvedValue({
      ...planningView,
      outcome: 'applied',
    });
    const getGoal = vi.fn();
    const router = new InteractiveActionRouter({
      planningSessions: {
        getByTask: vi.fn().mockResolvedValue(planningView),
        applyAction: applyPlanning,
      },
      goalSessions: {
        getByTask: getGoal,
        applyAction: vi.fn(),
      },
    });

    await expect(
      router.route({
        taskId: 'task-1',
        idempotencyKey: 'input-request-1',
        actorId: 'a2a:user',
        content: 'accept',
      }),
    ).resolves.toMatchObject({ kind: 'planning', view: { outcome: 'applied' } });
    expect(applyPlanning).toHaveBeenCalledWith({
      sessionId: 'planning-session-1',
      expectedVersion: 4,
      idempotencyKey: 'input-request-1',
      actorId: 'a2a:user',
      action: 'accept',
      payload: {},
    });
    expect(getGoal).not.toHaveBeenCalled();
  });

  it('routes clarification content to the current Goal session revision', async () => {
    const applyGoal = vi.fn().mockResolvedValue({
      outcome: 'applied',
      session: { sessionId: 'goal-session-1', version: 3 },
    });
    const router = new InteractiveActionRouter({
      planningSessions: {
        getByTask: vi.fn().mockResolvedValue(undefined),
        applyAction: vi.fn(),
      },
      goalSessions: {
        getByTask: vi.fn().mockResolvedValue({
          session: { sessionId: 'goal-session-1', version: 2, state: 'understand' },
        }),
        applyAction: applyGoal,
      },
    });

    await router.route({
      taskId: 'task-1',
      idempotencyKey: 'input-request-2',
      actorId: 'a2a:user',
      content: 'Inspect pump-17.',
    });

    expect(applyGoal).toHaveBeenCalledWith({
      sessionId: 'goal-session-1',
      expectedVersion: 2,
      idempotencyKey: 'input-request-2',
      actorId: 'a2a:user',
      action: 'answer',
      payload: { answer: 'Inspect pump-17.' },
    });
  });
});
