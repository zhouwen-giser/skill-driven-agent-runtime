import { describe, expect, it } from 'vitest';

import { createAgentTask, transitionTask } from '../../domain/src/index.js';
import { InMemoryTaskStateNotifier } from '../src/task-state-notifier.js';

describe('InMemoryTaskStateNotifier', () => {
  it('wakes every waiter on a new publish even when timestamp precision is unchanged', async () => {
    const notifier = new InMemoryTaskStateNotifier();
    const initial = task('task-notify-1', '2026-07-16T00:00:00.000Z');
    notifier.publish(initial);
    const waits = [
      notifier.waitForChange(initial.taskId, initial.updatedAt, 1_000),
      notifier.waitForChange(initial.taskId, initial.updatedAt, 1_000),
    ];
    const loading = transitionTask(initial, 'context_loading', 'Loading.', initial.updatedAt);
    notifier.publish(loading);

    await expect(Promise.all(waits)).resolves.toMatchObject([
      { phase: 'context_loading' },
      { phase: 'context_loading' },
    ]);
    notifier.close();
  });

  it('returns a remembered newer snapshot and bounds remembered Task state', async () => {
    const notifier = new InMemoryTaskStateNotifier(1);
    const first = task('task-notify-first', '2026-07-16T00:00:00.000Z');
    const second = task('task-notify-second', '2026-07-16T00:00:01.000Z');
    notifier.publish(first);
    notifier.publish(second);

    await expect(
      notifier.waitForChange(second.taskId, '2026-07-15T23:59:59.000Z', 1_000),
    ).resolves.toEqual(second);
    const evicted = notifier.waitForChange(first.taskId, first.updatedAt, 20);
    await expect(evicted).resolves.toBeUndefined();
    notifier.close();
  });

  it('releases all waiters on close and remains idempotently closed', async () => {
    const notifier = new InMemoryTaskStateNotifier();
    const current = task('task-notify-close', '2026-07-16T00:00:00.000Z');
    const waits = [
      notifier.waitForChange(current.taskId, current.updatedAt, 30_000),
      notifier.waitForChange(current.taskId, current.updatedAt, 30_000),
    ];
    notifier.close();
    notifier.close();

    await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
    notifier.publish(current);
    await expect(
      notifier.waitForChange(current.taskId, current.updatedAt, 30_000),
    ).resolves.toBeUndefined();
  });
});

function task(taskId: string, timestamp: string) {
  return createAgentTask({
    taskId,
    contextId: 'context-notifier',
    userId: 'operator',
    requestText: 'Run notification test.',
    requestMetadata: {},
    timestamp,
  });
}
