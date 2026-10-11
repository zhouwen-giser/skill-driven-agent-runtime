import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeCleanupScope } from '../src/composition/runtime-cleanup-scope.js';
import { RuntimeValueRef } from '../src/composition/runtime-value-ref.js';
import { startServerRuntime } from '../src/runtime.js';

describe('server composition ownership', () => {
  it('fails closed on an unbound late service, while explicit absence remains valid', () => {
    const service = new RuntimeValueRef<string | undefined>('service');
    expect(() => service.value).toThrow('RUNTIME_PORT_NOT_BOUND:service');
    service.value = undefined;
    expect(service.value).toBeUndefined();
    service.value = 'ready';
    expect(service.value).toBe('ready');
  });

  it('closes a partial assembly once, stopping timers before reversing resource acquisition', async () => {
    const scope = new RuntimeCleanupScope();
    const events: string[] = [];
    const pool = scope.register(() => {
      events.push('pool');
      return Promise.resolve();
    });
    const worker = scope.register(() => {
      events.push('worker');
      return Promise.resolve();
    });
    scope.registerSync(() => {
      events.push('timer');
    });
    await worker();
    await scope.dispose();
    await scope.dispose();
    await pool();
    expect(events).toEqual(['worker', 'timer', 'pool']);
  });

  it('preserves cleanup failures and still closes the remaining resources', async () => {
    const scope = new RuntimeCleanupScope();
    const closed = vi.fn(() => Promise.resolve());
    scope.register(closed);
    const failure = new Error('worker close failed');
    scope.register(() => Promise.reject(failure));
    await expect(scope.dispose()).rejects.toMatchObject({ errors: [failure] });
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('closes the actual Pool when startup fails after infrastructure acquisition', async () => {
    const end = vi.spyOn(Pool.prototype, 'end');
    try {
      await expect(
        startServerRuntime({
          postgresUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
          redis: { host: '127.0.0.1', port: 1 },
          masterKeyBase64: randomBytes(3).toString('base64'),
        }),
      ).rejects.toThrow();
      expect(end).toHaveBeenCalledTimes(1);
    } finally {
      end.mockRestore();
    }
  });
});
