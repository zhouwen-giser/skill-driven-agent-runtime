import { describe, expect, it } from 'vitest';

import { EvolutionPolicyService } from '../src/index.js';

describe('EvolutionPolicyService', () => {
  it('validates and persists a configurable repeated-success threshold', async () => {
    let stored = { successThreshold: 2, updatedAt: '2026-07-12T00:00:00.000Z' };
    const service = new EvolutionPolicyService({
      repository: {
        get: () => Promise.resolve(stored),
        update: (policy) => {
          stored = policy;
          return Promise.resolve();
        },
        saveTrigger: () => Promise.resolve(),
        listTriggers: () => Promise.resolve([]),
      },
      clock: { now: () => '2026-07-12T00:01:00.000Z' },
    });
    await expect(service.updatePolicy(3)).resolves.toEqual({
      successThreshold: 3,
      updatedAt: '2026-07-12T00:01:00.000Z',
    });
    await expect(service.getPolicy()).resolves.toEqual(stored);
    await expect(service.updatePolicy(1)).rejects.toMatchObject({
      code: 'EVOLUTION_SUCCESS_THRESHOLD_INVALID',
    });
  });
});
