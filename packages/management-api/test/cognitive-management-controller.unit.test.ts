import { describe, expect, it, vi } from 'vitest';

import {
  BearerCognitiveManagementAuthorizer,
  CognitiveManagementController,
} from '../src/index.js';

describe('CognitiveManagementController', () => {
  it('requires valid optional bearer authorization before a session write', async () => {
    const applyAction = vi.fn().mockResolvedValue({ outcome: 'applied' });
    const controller = new CognitiveManagementController({
      goalSessions: {
        getByTask: vi.fn().mockResolvedValue({
          session: { sessionId: 'goal-session-1' },
        }),
        applyAction,
      },
      authorizer: new BearerCognitiveManagementAuthorizer('a'.repeat(32)),
    });
    const input = {
      expectedVersion: 2,
      idempotencyKey: 'management-1',
      actorId: 'operator-1',
      reason: 'Approve reviewed contract.',
      action: 'accept' as const,
      payload: {},
    };

    await expect(controller.applyGoalAction('task-1', input)).rejects.toMatchObject({
      code: 'COGNITIVE_MANAGEMENT_UNAUTHORIZED',
    });
    await expect(
      controller.applyGoalAction('task-1', input, `Bearer ${'a'.repeat(32)}`),
    ).resolves.toEqual({ outcome: 'applied' });
    expect(applyAction).toHaveBeenCalledWith({
      sessionId: 'goal-session-1',
      expectedVersion: 2,
      idempotencyKey: 'management-1',
      actorId: 'operator-1',
      action: 'accept',
      payload: { managementReason: 'Approve reviewed contract.' },
    });
  });
});
