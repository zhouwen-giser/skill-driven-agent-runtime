import { describe, expect, it } from 'vitest';

import type { MemoryRetentionPolicy } from '../../domain/src/index.js';
import { MemoryRetentionPolicyService } from '../src/index.js';

describe('MemoryRetentionPolicyService', () => {
  it('persists review/archive/delete fields while forbidding automatic cleanup in V1', async () => {
    let stored: MemoryRetentionPolicy = {
      reviewAfterDays: 90,
      archiveAfterDays: 365,
      deleteAfterDays: 730,
      automaticArchiveEnabled: false,
      automaticDeleteEnabled: false,
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const service = new MemoryRetentionPolicyService({
      repository: {
        get: () => Promise.resolve(stored),
        update: (policy) => {
          stored = policy;
          return Promise.resolve();
        },
      },
      clock: { now: () => '2026-07-12T00:01:00.000Z' },
    });
    await expect(
      service.updatePolicy({
        reviewAfterDays: 30,
        archiveAfterDays: 180,
        deleteAfterDays: 365,
        automaticArchiveEnabled: false,
        automaticDeleteEnabled: false,
      }),
    ).resolves.toMatchObject({ reviewAfterDays: 30, archiveAfterDays: 180, deleteAfterDays: 365 });
    await expect(
      service.updatePolicy({
        reviewAfterDays: 30,
        archiveAfterDays: 180,
        deleteAfterDays: 365,
        automaticArchiveEnabled: true,
        automaticDeleteEnabled: false,
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_AUTOMATIC_CLEANUP_FORBIDDEN' });
    await expect(service.getPolicy()).resolves.toEqual(stored);
  });
});
