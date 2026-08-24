import {
  DefaultExecutionEventBusManager,
  type AgentExecutionEvent,
  type ExecutionEventBus,
  type ExecutionEventBusManager,
} from '@a2a-js/sdk/server';

/**
 * Cleans up the SDK-generated event bus when an idempotent initial retry
 * projects the already-authoritative Task under a different Task id, or when
 * a stable conflict completes with a Message and therefore no projected Task.
 * Interrupted buses whose requested and projected Task ids match retain the
 * official SDK lifecycle for follow-up sends and resubscription.
 */
export class ReplaySafeExecutionEventBusManager implements ExecutionEventBusManager {
  readonly #delegate = new DefaultExecutionEventBusManager();
  readonly #tracked = new Set<string>();
  readonly #projectedTaskIds = new Map<string, string>();

  createOrGetByTaskId(taskId: string): ExecutionEventBus {
    const bus = this.#delegate.createOrGetByTaskId(taskId);
    if (this.#tracked.has(taskId)) return bus;
    this.#tracked.add(taskId);
    bus.on('event', (event) => {
      const projectedTaskId = taskIdentity(event);
      if (projectedTaskId !== undefined) this.#projectedTaskIds.set(taskId, projectedTaskId);
    });
    bus.once('finished', () => {
      const projectedTaskId = this.#projectedTaskIds.get(taskId);
      if (projectedTaskId === taskId) return;
      queueMicrotask(() => {
        if (this.#delegate.getByTaskId(taskId) === bus) this.cleanupByTaskId(taskId);
      });
    });
    return bus;
  }

  getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.#delegate.getByTaskId(taskId);
  }

  cleanupByTaskId(taskId: string): void {
    this.#delegate.cleanupByTaskId(taskId);
    this.#tracked.delete(taskId);
    this.#projectedTaskIds.delete(taskId);
  }
}

function taskIdentity(event: AgentExecutionEvent): string | undefined {
  switch (event.kind) {
    case 'task':
      return event.data.id;
    case 'statusUpdate':
    case 'artifactUpdate':
      return event.data.taskId;
    case 'message':
      return event.data.taskId;
  }
}
