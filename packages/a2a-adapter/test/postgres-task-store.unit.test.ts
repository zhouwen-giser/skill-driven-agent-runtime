import { Task, TaskState } from '@a2a-js/sdk';
import type { ServerCallContext } from '@a2a-js/sdk/server';
import { describe, expect, it, vi } from 'vitest';

import type {
  ExternalTaskProjection,
  ExternalTaskProjectionQuery,
  ExternalTaskProjectionRepository,
} from '../../application/src/index.js';
import type { AgentTask } from '../../domain/src/index.js';
import { A2AProjectionTaskStore } from '../src/postgres-task-store.js';

describe('A2AProjectionTaskStore Runtime authority', () => {
  it('persists the Runtime terminal state when a late WORKING save arrives', async () => {
    const projections = new CapturingProjectionRepository();
    const authoritative = completedTask();
    const store = new A2AProjectionTaskStore(projections, {
      findById: () => Promise.resolve(authoritative),
    });

    await store.save(a2aTask(TaskState.TASK_STATE_WORKING), callContext());

    expect(projections.saved).toMatchObject({
      taskId: authoritative.taskId,
      state: 'TASK_STATE_COMPLETED',
      statusTimestamp: authoritative.updatedAt,
    });
    expect(Task.fromJSON(projections.saved?.document).history).toHaveLength(1);
  });

  it('reconciles cancel through Runtime without reversing an existing terminal result', async () => {
    const projections = new CapturingProjectionRepository();
    const cancel = vi.fn(() => Promise.resolve());
    const store = new A2AProjectionTaskStore(
      projections,
      { findById: () => Promise.resolve(completedTask()) },
      cancel,
    );

    await store.save(a2aTask(TaskState.TASK_STATE_CANCELED), callContext());

    expect(cancel).toHaveBeenCalledWith('task-1');
    expect(projections.saved?.state).toBe('TASK_STATE_COMPLETED');
  });

  it('does not persist a canceled projection when Runtime reconciliation fails', async () => {
    const projections = new CapturingProjectionRepository();
    const store = new A2AProjectionTaskStore(
      projections,
      { findById: () => Promise.resolve(completedTask()) },
      () => Promise.reject(new Error('RUNTIME_CANCEL_RECONCILIATION_FAILED')),
    );

    await expect(store.save(a2aTask(TaskState.TASK_STATE_CANCELED), callContext())).rejects.toThrow(
      'RUNTIME_CANCEL_RECONCILIATION_FAILED',
    );
    expect(projections.saved).toBeUndefined();
  });

  it('atomically appends concurrent replay history by messageId and normalizes Task identity', async () => {
    const projections = new CapturingProjectionRepository();
    const authoritative = completedTask();
    const store = new A2AProjectionTaskStore(projections, {
      findById: () => Promise.resolve(authoritative),
    });

    await Promise.all([
      store.save(
        a2aTask(TaskState.TASK_STATE_INPUT_REQUIRED, 'message-1', 'Inspect one.'),
        callContext(),
      ),
      store.save(
        a2aTask(TaskState.TASK_STATE_INPUT_REQUIRED, 'message-2', 'Inspect two.'),
        callContext(),
      ),
      store.save(
        a2aTask(TaskState.TASK_STATE_INPUT_REQUIRED, 'message-2', 'Inspect two.'),
        callContext(),
      ),
    ]);

    const loaded = await store.load(authoritative.taskId, callContext());
    expect(loaded?.history.map((message) => message.messageId)).toEqual(['message-1', 'message-2']);
    expect(
      loaded?.history.every(
        (message) =>
          message.taskId === authoritative.taskId &&
          message.contextId === authoritative.contextId &&
          Object.keys(message.metadata ?? {}).length === 0,
      ),
    ).toBe(true);
  });

  it('rejects reuse of one history messageId for different canonical content', async () => {
    const projections = new CapturingProjectionRepository();
    const store = new A2AProjectionTaskStore(projections);
    await store.save(
      a2aTask(TaskState.TASK_STATE_INPUT_REQUIRED, 'message-conflict', 'Inspect one.'),
      callContext(),
    );

    await expect(
      store.save(
        a2aTask(TaskState.TASK_STATE_INPUT_REQUIRED, 'message-conflict', 'Inspect two.'),
        callContext(),
      ),
    ).rejects.toMatchObject({
      code: 'A2A_TASK_HISTORY_MESSAGE_ID_CONFLICT',
    });
  });
});

class CapturingProjectionRepository implements ExternalTaskProjectionRepository {
  saved: ExternalTaskProjection | undefined;

  find(): Promise<ExternalTaskProjection | undefined> {
    return Promise.resolve(this.saved);
  }

  save(projection: ExternalTaskProjection): Promise<void> {
    this.saved = projection;
    return Promise.resolve();
  }

  list(
    _query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>> {
    void _query;
    return Promise.resolve({ items: this.saved === undefined ? [] : [this.saved], total: 0 });
  }
}

function completedTask(): AgentTask {
  return {
    taskId: 'task-1',
    contextId: 'context-1',
    userId: 'operator-1',
    requestText: 'Inspect.',
    requestMetadata: {},
    phase: 'completed',
    phaseMessage: 'Task completed.',
    output: { text: 'Done.', structured: { ok: true } },
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:01:00Z',
  };
}

function a2aTask(state: TaskState, messageId = 'message-1', messageText = 'Inspect.'): Task {
  return Task.fromJSON({
    id: 'task-1',
    contextId: 'context-1',
    status: { state, timestamp: '2026-08-13T00:02:00Z' },
    history: [
      {
        messageId,
        taskId: 'sdk-generated-task',
        contextId: 'sdk-generated-context',
        role: 'ROLE_USER',
        parts: [{ text: messageText }],
        metadata: { private: 'discarded' },
      },
    ],
  });
}

function callContext(): ServerCallContext {
  return {} as ServerCallContext;
}
