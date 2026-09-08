import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresUserGoalRuntimeRepository } from '../src/user-goal-runtime-repository.js';

describe('Business Event persisted channel projection', () => {
  it('preserves distinct devices and explicit non-device identity for the same Provider', async () => {
    const pool = new Pool();
    const query = vi.spyOn(pool, 'query');
    const repository = new PostgresUserGoalRuntimeRepository(pool);
    try {
      for (const device of ['device-a', 'device-b', null]) {
        query.mockResolvedValueOnce({
          rows: [row(device, device === null ? null : 'service')],
        } as never);
        const subscription = await repository.findBusinessEventSubscription('subscription');
        expect(subscription?.deviceIdentity).toEqual(
          device === null ? null : { deviceId: device, smppServiceKey: 'service' },
        );
      }
      query.mockResolvedValueOnce({ rows: [row('device-a', null)] } as never);
      await expect(repository.findBusinessEventSubscription('subscription')).rejects.toThrow(
        'BUSINESS_EVENT_SUBSCRIPTION_DEVICE_IDENTITY_INVALID',
      );
    } finally {
      query.mockRestore();
      await pool.end();
    }
  });
});

function row(device_id: string | null, smpp_service_key: string | null) {
  return {
    subscription_id: 'subscription',
    provider_id: 'server',
    stream_id: 'stream',
    generation: 1,
    status: 'current',
    last_durably_admitted_sequence: '1',
    last_processed_sequence: '0',
    last_replayable_sequence: null,
    created_at: '2026-09-08T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
    device_id,
    smpp_service_key,
  };
}
