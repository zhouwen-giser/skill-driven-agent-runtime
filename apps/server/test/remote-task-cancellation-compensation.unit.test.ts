import { describe, expect, it, vi } from 'vitest';

import {
  RemoteTaskCancellationService,
  type RemoteTaskCancellationQueue,
  type RemoteTaskCancellationRepository,
} from '../../../packages/application/src/index.js';
import type { RemoteTaskBinding } from '../../../packages/domain/src/index.js';
import { requestContinuationActivationFailureCancellation } from '../src/runtime.js';

const timestamp = '2026-08-14T08:00:00.000Z';

describe('continuation activation failure remote Task compensation', () => {
  it('uses the durable cancellation request path with a deterministic compensation identity', async () => {
    const requestCancellation = vi.fn(() =>
      Promise.resolve({ requested: false as const, reason: 'stale' as const }),
    );
    const enqueue = vi.fn<RemoteTaskCancellationQueue['enqueue']>(() => Promise.resolve());
    const service = cancellationService('task_cancel', requestCancellation, enqueue);

    await expect(
      requestContinuationActivationFailureCancellation(service, {
        bindingId: 'binding-compensation-1',
        snapshotId: 'snapshot-compensation-1',
        workflowInstanceId: 'workflow-compensation-1',
      }),
    ).resolves.toEqual({ disposition: 'stale', deliveryScheduled: false });

    expect(requestCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: 'binding-compensation-1',
        idempotencyKey:
          'continuation-activation-failure:snapshot-compensation-1:binding-compensation-1',
        source: 'compensation',
        reasonCode: 'WORKFLOW_CONTINUATION_ACTIVATION_FAILED',
      }),
      7,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['unsupported', 'cooperative', 'unknown'] as const)(
    'does not persist or schedule continuation compensation when frozen cancellation is %s',
    async (taskCancellation) => {
      const requestCancellation = vi.fn();
      const enqueue = vi.fn<RemoteTaskCancellationQueue['enqueue']>(() => Promise.resolve());
      const service = cancellationService(taskCancellation, requestCancellation, enqueue);

      await expect(
        requestContinuationActivationFailureCancellation(service, {
          bindingId: 'binding-compensation-1',
          snapshotId: 'snapshot-compensation-1',
          workflowInstanceId: 'workflow-compensation-1',
        }),
      ).resolves.toEqual({ disposition: 'unsupported', deliveryScheduled: false });

      expect(requestCancellation).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
});

function cancellationService(
  taskCancellation: RemoteTaskBinding['taskCancellation'],
  requestCancellation: RemoteTaskCancellationRepository['requestCancellation'],
  enqueue: RemoteTaskCancellationQueue['enqueue'],
): RemoteTaskCancellationService {
  const binding = {
    bindingId: 'binding-compensation-1',
    protocolStatus: 'working',
    taskCancellation,
    version: 7,
  } as RemoteTaskBinding;
  return new RemoteTaskCancellationService({
    remoteTasks: { findById: () => Promise.resolve(binding) },
    cancellations: {
      requestCancellation,
    } as unknown as RemoteTaskCancellationRepository,
    queue: {
      enqueue,
      state: () => Promise.resolve('missing'),
    },
    clock: { now: () => timestamp },
    ids: {
      nextRequestId: () => 'cancel-request-compensation-1',
      nextAttemptId: () => 'cancel-attempt-compensation-1',
      nextClaimToken: () => 'cancel-claim-compensation-1',
    },
  });
}
