import { describe, expect, it, vi } from 'vitest';

import { createA2ACancelReconciliationHandler } from '../src/runtime.js';

describe('A2A cancellation reconciliation', () => {
  it('re-enters Task cancellation for every canceled projection save', async () => {
    const cancel = vi.fn(() => Promise.resolve(undefined));
    const reconcile = createA2ACancelReconciliationHandler({ cancel });

    await reconcile('task-canceled');
    await reconcile('task-canceled');

    expect(cancel).toHaveBeenNthCalledWith(1, 'task-canceled');
    expect(cancel).toHaveBeenNthCalledWith(2, 'task-canceled');
  });

  it('propagates reconciliation failures instead of persisting a divergent projection', async () => {
    const reconcile = createA2ACancelReconciliationHandler({
      cancel: () => Promise.reject(new Error('CAPABILITY_ATTEMPT_RECONCILIATION_FAILED')),
    });

    await expect(reconcile('task-canceled')).rejects.toThrow(
      'CAPABILITY_ATTEMPT_RECONCILIATION_FAILED',
    );
  });
});
