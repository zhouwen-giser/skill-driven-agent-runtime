import { Message, Task, TaskState } from '@a2a-js/sdk';
import { describe, expect, it, vi } from 'vitest';

import type {
  ExternalTaskProjection,
  ExternalTaskProjectionQuery,
  ExternalTaskProjectionRepository,
} from '../../application/src/index.js';
import type { AgentTask, TaskPhase } from '../../domain/src/index.js';
import { A2AProjectionTaskStore } from '../src/postgres-task-store.js';
import {
  A2A_TERMINAL_RECONCILIATION_PAGE_SIZE,
  A2ATerminalProjectionReconciler,
  DEFAULT_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS,
  MAX_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS,
  MIN_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS,
  resolveA2ATerminalReconciliationIntervalMs,
} from '../src/terminal-projection-reconciler.js';

describe('A2ATerminalProjectionReconciler', () => {
  it('converges every Runtime terminal phase without another A2A request', async () => {
    const phases = ['completed', 'failed', 'canceled', 'invalidated', 'capability_gap'] as const;
    const tasks = new Map<string, AgentTask>(
      phases.map((phase, index) => {
        const task = terminalTask(phase, index);
        return [task.taskId, task];
      }),
    );
    tasks.set('task-non-terminal', task('task-non-terminal', 'executing', '2026-08-13T00:06:00Z'));
    const projections = new FakeProjectionRepository([
      ...[...tasks.values()].map((current, index) => {
        const projection = staleProjection(
          current.taskId,
          current.contextId,
          index === 0 ? TaskState.TASK_STATE_INPUT_REQUIRED : TaskState.TASK_STATE_WORKING,
        );
        return current.phase === 'invalidated' ? { ...projection, document: null } : projection;
      }),
      staleProjection('task-missing', 'context-missing', TaskState.TASK_STATE_WORKING),
    ]);
    const reconciler = new A2ATerminalProjectionReconciler({
      projections,
      tasks: { findById: (taskId) => Promise.resolve(tasks.get(taskId)) },
      taskStore: new A2AProjectionTaskStore(projections, {
        findById: (taskId) => Promise.resolve(tasks.get(taskId)),
      }),
    });

    await expect(reconciler.reconcile()).resolves.toEqual({
      scanned: 7,
      reconciled: 5,
      alreadyConverged: 0,
      nonTerminal: 1,
      missingAuthoritativeTask: 1,
    });

    expect(projections.states()).toMatchObject({
      'task-completed': 'TASK_STATE_COMPLETED',
      'task-failed': 'TASK_STATE_FAILED',
      'task-canceled': 'TASK_STATE_CANCELED',
      'task-invalidated': 'TASK_STATE_FAILED',
      'task-capability_gap': 'TASK_STATE_FAILED',
      'task-non-terminal': 'TASK_STATE_WORKING',
      'task-missing': 'TASK_STATE_WORKING',
    });
    const completed = Task.fromJSON((await projections.find('a2a-v1', 'task-completed'))?.document);
    expect(completed.history).toHaveLength(1);
    expect(completed.artifacts).toHaveLength(1);
    expect(() => Task.fromJSON(projections.document('task-invalidated'))).not.toThrow();
  });

  it('is idempotent after restart and never creates a projection for an unadmitted Task', async () => {
    const admitted = terminalTask('failed', 1);
    const unadmitted = terminalTask('completed', 2);
    const tasks = new Map([
      [admitted.taskId, admitted],
      [unadmitted.taskId, unadmitted],
    ]);
    const projections = new FakeProjectionRepository([
      staleProjection(admitted.taskId, admitted.contextId, TaskState.TASK_STATE_WORKING),
    ]);
    const reconciler = new A2ATerminalProjectionReconciler({
      projections,
      tasks: { findById: (taskId) => Promise.resolve(tasks.get(taskId)) },
      taskStore: new A2AProjectionTaskStore(projections, {
        findById: (taskId) => Promise.resolve(tasks.get(taskId)),
      }),
    });

    expect((await reconciler.reconcile()).reconciled).toBe(1);
    expect((await reconciler.reconcile()).reconciled).toBe(0);
    expect(projections.saveCalls).toBe(1);
    await expect(projections.find('a2a-v1', unadmitted.taskId)).resolves.toBeUndefined();
  });

  it('never resolves interactive planning metadata while rebuilding a terminal Task', async () => {
    const completed = terminalTask('completed', 1);
    const projections = new FakeProjectionRepository([
      staleProjection(completed.taskId, completed.contextId, TaskState.TASK_STATE_INPUT_REQUIRED),
    ]);
    const interaction = vi.fn<
      (taskId: string) => Promise<Readonly<Record<string, unknown>> | undefined>
    >(() => Promise.reject(new Error('CONFIRMED_PLAN_HANDOFF_MUST_NOT_RUN')));
    const reconciler = new A2ATerminalProjectionReconciler({
      projections,
      tasks: { findById: () => Promise.resolve(completed) },
      taskStore: new A2AProjectionTaskStore(projections, {
        findById: () => Promise.resolve(completed),
      }),
      interaction,
    });

    await expect(reconciler.reconcile()).resolves.toMatchObject({ reconciled: 1 });
    expect(interaction).not.toHaveBeenCalled();
    expect(projections.states()[completed.taskId]).toBe('TASK_STATE_COMPLETED');
  });

  it('freezes every page before repairs can reorder status timestamps', async () => {
    const count = A2A_TERMINAL_RECONCILIATION_PAGE_SIZE + 5;
    const tasks = new Map<string, AgentTask>();
    const initial: ExternalTaskProjection[] = [];
    for (let index = 0; index < count; index += 1) {
      const taskId = `task-page-${String(index).padStart(3, '0')}`;
      const current = task(
        taskId,
        'failed',
        `2026-08-13T01:${String(index % 60).padStart(2, '0')}:00Z`,
      );
      tasks.set(taskId, current);
      initial.push(staleProjection(taskId, current.contextId, TaskState.TASK_STATE_WORKING));
    }
    const projections = new ReorderingProjectionRepository(initial);
    const reconciler = new A2ATerminalProjectionReconciler({
      projections,
      tasks: { findById: (taskId) => Promise.resolve(tasks.get(taskId)) },
      taskStore: new A2AProjectionTaskStore(projections, {
        findById: (taskId) => Promise.resolve(tasks.get(taskId)),
      }),
    });

    await expect(reconciler.reconcile()).resolves.toMatchObject({
      scanned: count,
      reconciled: count,
    });
    expect(projections.terminalCount()).toBe(count);
  });

  it('preserves replay history when a reconciliation tick holds a stale projection snapshot', async () => {
    const completed = terminalTask('completed', 1);
    const projections = new FakeProjectionRepository([
      staleProjection(completed.taskId, completed.contextId, TaskState.TASK_STATE_INPUT_REQUIRED),
    ]);
    let releaseLookup: () => void = () => undefined;
    let signalLookupStarted: () => void = () => undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      signalLookupStarted = resolve;
    });
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    let lookupCount = 0;
    const tasks = {
      findById: async () => {
        lookupCount += 1;
        if (lookupCount === 1) {
          signalLookupStarted();
          await lookupGate;
        }
        return completed;
      },
    };
    const taskStore = new A2AProjectionTaskStore(projections, tasks);
    const reconciler = new A2ATerminalProjectionReconciler({
      projections,
      tasks,
      taskStore,
    });

    const tick = reconciler.reconcile();
    await lookupStarted;
    await taskStore.saveCanonical(
      Task.fromJSON({
        id: completed.taskId,
        contextId: completed.contextId,
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          timestamp: '2026-08-13T00:00:01Z',
        },
        history: [
          {
            messageId: 'message-concurrent-replay',
            taskId: 'sdk-generated-retry-task',
            contextId: 'sdk-generated-retry-context',
            role: 'ROLE_USER',
            parts: [{ text: 'Inspect.' }],
          },
        ],
      }),
    );
    releaseLookup();

    await expect(tick).resolves.toMatchObject({ reconciled: 1 });
    const stored = Task.fromJSON(projections.document(completed.taskId));
    expect(stored.history.map((message) => message.messageId)).toEqual([
      `${completed.taskId}:request`,
      'message-concurrent-replay',
    ]);
    expect(
      stored.history.every(
        (message) =>
          message.taskId === completed.taskId && message.contextId === completed.contextId,
      ),
    ).toBe(true);
  });

  it('keeps periodic reconciliation configuration bounded', () => {
    expect(resolveA2ATerminalReconciliationIntervalMs(undefined)).toBe(
      DEFAULT_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS,
    );
    expect(
      resolveA2ATerminalReconciliationIntervalMs(MIN_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS),
    ).toBe(MIN_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS);
    expect(
      resolveA2ATerminalReconciliationIntervalMs(MAX_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS),
    ).toBe(MAX_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS);
    for (const invalid of [
      0,
      MIN_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS - 1,
      MAX_A2A_TERMINAL_RECONCILIATION_INTERVAL_MS + 1,
      1.5,
    ]) {
      expect(() => resolveA2ATerminalReconciliationIntervalMs(invalid)).toThrow(
        'A2A_TERMINAL_RECONCILIATION_INTERVAL_INVALID',
      );
    }
  });
});

class FakeProjectionRepository implements ExternalTaskProjectionRepository {
  readonly #items = new Map<string, ExternalTaskProjection>();
  saveCalls = 0;

  constructor(items: readonly ExternalTaskProjection[]) {
    for (const item of items) this.#items.set(item.taskId, item);
  }

  find(
    protocol: ExternalTaskProjection['protocol'],
    taskId: string,
  ): Promise<ExternalTaskProjection | undefined> {
    void protocol;
    const projection = this.#items.get(taskId);
    return Promise.resolve(projection);
  }

  save(projection: ExternalTaskProjection): Promise<void> {
    this.saveCalls += 1;
    this.#items.set(projection.taskId, projection);
    return Promise.resolve();
  }

  list(
    query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>> {
    const matching = [...this.#items.values()]
      .filter((item) => query.taskIdAfter === undefined || item.taskId > query.taskIdAfter)
      .sort((left, right) => left.taskId.localeCompare(right.taskId));
    return Promise.resolve({
      items: matching.slice(query.offset, query.offset + query.limit),
      total: this.#items.size,
    });
  }

  states(): Readonly<Record<string, string>> {
    return Object.fromEntries(
      [...this.#items].map(([taskId, projection]) => [taskId, projection.state]),
    );
  }

  document(taskId: string): unknown {
    return this.#items.get(taskId)?.document;
  }

  all(): readonly ExternalTaskProjection[] {
    return [...this.#items.values()];
  }
}

class ReorderingProjectionRepository extends FakeProjectionRepository {
  override list(
    query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>> {
    const items = [...this.all()].sort((left, right) =>
      (right.statusTimestamp ?? '').localeCompare(left.statusTimestamp ?? ''),
    );
    const taskIdAfter = query.taskIdAfter;
    const matching =
      taskIdAfter === undefined
        ? items
        : items
            .filter((item) => item.taskId > taskIdAfter)
            .sort((left, right) => left.taskId.localeCompare(right.taskId));
    return Promise.resolve({
      items: matching.slice(query.offset, query.offset + query.limit),
      total: items.length,
    });
  }

  terminalCount(): number {
    return [...this.all()].filter((item) => item.state === 'TASK_STATE_FAILED').length;
  }
}

function terminalTask(phase: TaskPhase, index: number): AgentTask {
  const current = task(`task-${phase}`, phase, `2026-08-13T00:0${String(index)}:00Z`);
  if (phase === 'completed')
    return { ...current, output: { text: 'Terminal result.', structured: { ok: true } } };
  if (phase === 'capability_gap')
    return {
      ...current,
      errorCode: 'CAPABILITY_GAP',
      capabilityGap: {
        evaluationSummary: 'No governed capability is available.',
        missingCapability: 'device.inspect',
        suggestedToolContract: {
          name: 'device_inspect',
          description: 'Inspect the requested device.',
          inputSchema: { type: 'object' },
        },
      },
    };
  return { ...current, errorCode: phase === 'canceled' ? 'RUNTIME_CANCELED' : 'TASK_FAILED' };
}

function task(taskId: string, phase: TaskPhase, updatedAt: string): AgentTask {
  return {
    taskId,
    contextId: `context-${taskId}`,
    userId: 'operator-1',
    requestText: 'Inspect.',
    requestMetadata: {},
    phase,
    phaseMessage: `Task is ${phase}.`,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt,
  };
}

function staleProjection(
  taskId: string,
  contextId: string,
  state: TaskState,
): ExternalTaskProjection {
  const projected = Task.fromJSON({
    id: taskId,
    contextId,
    status: {
      state,
      timestamp: '2026-08-13T00:00:00Z',
    },
    history: [
      Message.toJSON(
        Message.fromJSON({
          messageId: `${taskId}:request`,
          taskId,
          contextId,
          role: 'ROLE_USER',
          parts: [{ text: 'Inspect.' }],
        }),
      ),
    ],
  });
  return {
    protocol: 'a2a-v1',
    taskId,
    contextId,
    state: TaskState[state],
    ...(projected.status?.timestamp === undefined
      ? {}
      : { statusTimestamp: projected.status.timestamp }),
    document: Task.toJSON(projected),
  };
}
