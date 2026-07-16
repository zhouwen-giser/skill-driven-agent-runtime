import { Message, TaskState } from '@a2a-js/sdk';
import {
  DefaultExecutionEventBus,
  RequestContext,
  ServerCallContext,
  type AgentExecutionEvent,
} from '@a2a-js/sdk/server';
import { describe, expect, it } from 'vitest';

import {
  InMemoryTaskStateNotifier,
  type SubmitTaskCommand,
  type SubmitTaskResult,
  type TaskFollowUpCommand,
} from '../../application/src/index.js';
import {
  createAgentTask,
  createConversationContext,
  type AgentTask,
} from '../../domain/src/index.js';
import {
  MIN_A2A_SAFETY_POLL_INTERVAL_MS,
  TaskServiceAgentExecutor,
} from '../src/task-service-executor.js';

describe('TaskServiceAgentExecutor notification wait', () => {
  it.each([
    ['completed', TaskState.TASK_STATE_COMPLETED],
    ['awaiting_user_input', TaskState.TASK_STATE_INPUT_REQUIRED],
    ['capability_gap', TaskState.TASK_STATE_FAILED],
  ] as const)('immediately wakes for %s Task state', async (phase, expectedState) => {
    const tasks = new FakeTasks();
    const notifier = new InMemoryTaskStateNotifier();
    const executor = new TaskServiceAgentExecutor({
      tasks,
      notifier,
      safetyPollIntervalMs: 5_000,
      waitTimeoutMs: 10_000,
    });
    const { bus, events } = eventCollector();
    const execution = executor.execute(request(`task-${phase}`), bus);
    await waitUntil(() => events.some((event) => event.kind === 'task'));
    const changed = tasks.change(`task-${phase}`, phase);
    const startedAt = performance.now();
    notifier.publish(changed);
    await execution;
    const wakeLatencyMs = performance.now() - startedAt;

    expect(wakeLatencyMs).toBeLessThan(500);
    expect(statuses(events).at(-1)).toBe(expectedState);
    expect(tasks.getCalls).toBe(1);
    process.stdout.write(
      `${JSON.stringify({ event: 'a2a.wait.notification-latency', environment: 'vitest-node-local', phase, databaseReads: tasks.getCalls, wakeLatencyMs: Math.round(wakeLatencyMs) })}\n`,
    );
    executor.close();
  });

  it('returns a current working snapshot at timeout with low database read frequency', async () => {
    const tasks = new FakeTasks('executing');
    const notifier = new InMemoryTaskStateNotifier();
    const executor = new TaskServiceAgentExecutor({
      tasks,
      notifier,
      safetyPollIntervalMs: MIN_A2A_SAFETY_POLL_INTERVAL_MS,
      waitTimeoutMs: 250,
    });
    const { bus, events } = eventCollector();
    const startedAt = performance.now();
    await expect(executor.execute(request('task-timeout'), bus)).resolves.toBeUndefined();
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(200);
    expect(elapsedMs).toBeLessThan(1_000);
    expect(tasks.getCalls).toBeLessThanOrEqual(3);
    expect(statuses(events).at(-1)).toBe(TaskState.TASK_STATE_WORKING);
    process.stdout.write(
      `${JSON.stringify({ event: 'a2a.wait.single-performance', environment: 'vitest-node-local', waitWindowMs: 250, safetyPollIntervalMs: MIN_A2A_SAFETY_POLL_INTERVAL_MS, databaseReads: tasks.getCalls, elapsedMs: Math.round(elapsedMs) })}\n`,
    );
    executor.close();
  });

  it('recovers a missed notification through low-frequency safety polling', async () => {
    const tasks = new FakeTasks('executing');
    const notifier = new InMemoryTaskStateNotifier();
    const executor = new TaskServiceAgentExecutor({
      tasks,
      notifier,
      safetyPollIntervalMs: MIN_A2A_SAFETY_POLL_INTERVAL_MS,
      waitTimeoutMs: 2_000,
    });
    const { bus, events } = eventCollector();
    const execution = executor.execute(request('task-missed-notification'), bus);
    await waitUntil(() => events.some((event) => event.kind === 'task'));
    tasks.change('task-missed-notification', 'completed');
    const startedAt = performance.now();
    await execution;
    const recoveryLatencyMs = performance.now() - startedAt;

    expect(recoveryLatencyMs).toBeGreaterThanOrEqual(50);
    expect(recoveryLatencyMs).toBeLessThan(500);
    expect(tasks.getCalls).toBeLessThanOrEqual(2);
    expect(statuses(events).at(-1)).toBe(TaskState.TASK_STATE_COMPLETED);
    process.stdout.write(
      `${JSON.stringify({ event: 'a2a.wait.missed-notification-recovery', environment: 'vitest-node-local', safetyPollIntervalMs: MIN_A2A_SAFETY_POLL_INTERVAL_MS, databaseReads: tasks.getCalls, recoveryLatencyMs: Math.round(recoveryLatencyMs) })}\n`,
    );
    executor.close();
  });

  it('reduces reads for concurrent waiters and releases them on close', async () => {
    const taskCount = 20;
    const tasks = new FakeTasks('executing');
    const notifier = new InMemoryTaskStateNotifier();
    const executor = new TaskServiceAgentExecutor({
      tasks,
      notifier,
      safetyPollIntervalMs: MIN_A2A_SAFETY_POLL_INTERVAL_MS,
      waitTimeoutMs: 250,
    });
    const startedAt = performance.now();
    await Promise.all(
      Array.from({ length: taskCount }, (_, index) => {
        const { bus } = eventCollector();
        return executor.execute(request(`task-concurrent-${String(index)}`), bus);
      }),
    );
    const elapsedMs = performance.now() - startedAt;
    const databaseReads = tasks.getCalls;
    expect(databaseReads).toBeLessThanOrEqual(taskCount * 4);

    const closingTasks = new FakeTasks('executing');
    const closingNotifier = new InMemoryTaskStateNotifier();
    const closingExecutor = new TaskServiceAgentExecutor({
      tasks: closingTasks,
      notifier: closingNotifier,
      safetyPollIntervalMs: 5_000,
      waitTimeoutMs: 30_000,
    });
    const { bus, events } = eventCollector();
    const pending = closingExecutor.execute(request('task-close'), bus);
    await waitUntil(() => events.some((event) => event.kind === 'task'));
    const closeStartedAt = performance.now();
    closingExecutor.close();
    await pending;
    const closeElapsedMs = performance.now() - closeStartedAt;
    expect(closeElapsedMs).toBeLessThan(500);
    expect(closingTasks.getCalls).toBe(0);

    process.stdout.write(
      `${JSON.stringify({ event: 'a2a.wait.performance', environment: 'vitest-node-local', concurrentWaiters: taskCount, waitWindowMs: 250, safetyPollIntervalMs: MIN_A2A_SAFETY_POLL_INTERVAL_MS, databaseReads, elapsedMs: Math.round(elapsedMs), closeElapsedMs: Math.round(closeElapsedMs) })}\n`,
    );
    executor.close();
  });

  it('rejects the former busy-poll interval and non-positive wait windows', () => {
    const notifier = new InMemoryTaskStateNotifier();
    expect(
      () =>
        new TaskServiceAgentExecutor({
          tasks: new FakeTasks(),
          notifier,
          safetyPollIntervalMs: 10,
        }),
    ).toThrow(expect.objectContaining({ code: 'A2A_TASK_WAIT_CONFIGURATION_INVALID' }));
    expect(
      () =>
        new TaskServiceAgentExecutor({
          tasks: new FakeTasks(),
          notifier,
          waitTimeoutMs: 0,
        }),
    ).toThrow(expect.objectContaining({ code: 'A2A_TASK_WAIT_CONFIGURATION_INVALID' }));
    notifier.close();
  });

  it('rejects new execution after close without submitting a Task', async () => {
    const tasks = new FakeTasks();
    const executor = new TaskServiceAgentExecutor({
      tasks,
      notifier: new InMemoryTaskStateNotifier(),
    });
    executor.close();
    const { bus } = eventCollector();

    await expect(executor.execute(request('task-after-close'), bus)).rejects.toMatchObject({
      code: 'A2A_TASK_EXECUTOR_CLOSED',
    });
    expect(tasks.submitCalls).toBe(0);
  });
});

class FakeTasks {
  readonly #tasks = new Map<string, AgentTask>();
  readonly #initialPhase: AgentTask['phase'];
  getCalls = 0;
  submitCalls = 0;

  constructor(initialPhase: AgentTask['phase'] = 'queued') {
    this.#initialPhase = initialPhase;
  }

  submit(command: SubmitTaskCommand): Promise<SubmitTaskResult> {
    this.submitCalls += 1;
    const timestamp = new Date().toISOString();
    const created = createAgentTask({
      taskId: command.taskId ?? 'task-generated',
      contextId: command.contextId ?? 'context-executor',
      userId: command.userId ?? 'operator',
      requestText: command.messageText,
      requestMetadata: command.metadata,
      timestamp,
    });
    const task = { ...created, phase: this.#initialPhase };
    this.#tasks.set(task.taskId, task);
    return Promise.resolve({
      task,
      context: createConversationContext({
        contextId: task.contextId,
        userId: task.userId,
        timestamp,
      }),
      createdContext: true,
    });
  }

  get(taskId: string): Promise<AgentTask> {
    this.getCalls += 1;
    const task = this.#tasks.get(taskId);
    if (task === undefined) return Promise.reject(new Error('TASK_NOT_FOUND'));
    return Promise.resolve(task);
  }

  followUp(command: TaskFollowUpCommand): Promise<AgentTask> {
    return this.get(command.taskId);
  }

  cancel(taskId: string): Promise<AgentTask> {
    return Promise.resolve(this.change(taskId, 'canceled'));
  }

  change(taskId: string, phase: AgentTask['phase']): AgentTask {
    const current = this.#tasks.get(taskId);
    if (current === undefined) throw new Error('TASK_NOT_FOUND');
    const changed: AgentTask = {
      ...current,
      phase,
      phaseMessage: `Task is ${phase}.`,
      updatedAt: new Date(Date.now() + 1).toISOString(),
      ...(phase === 'capability_gap'
        ? {
            errorCode: 'CAPABILITY_GAP',
            capabilityGap: {
              evaluationSummary: 'Capability is missing.',
              missingCapability: 'device read',
              suggestedToolContract: {
                name: 'read_device',
                description: 'Read a device.',
                inputSchema: { type: 'object' },
              },
            },
          }
        : {}),
    };
    this.#tasks.set(taskId, changed);
    return changed;
  }
}

function request(taskId: string): RequestContext {
  return new RequestContext(
    Message.fromJSON({
      messageId: `message-${taskId}`,
      role: 'ROLE_USER',
      parts: [{ text: 'Run executor test.', mediaType: 'text/plain' }],
    }),
    taskId,
    'context-executor',
    new ServerCallContext({ requestedVersion: '1.0' }),
  );
}

function eventCollector(): Readonly<{
  bus: DefaultExecutionEventBus;
  events: AgentExecutionEvent[];
}> {
  const bus = new DefaultExecutionEventBus();
  const events: AgentExecutionEvent[] = [];
  bus.on('event', (event) => events.push(event));
  return { bus, events };
}

function statuses(events: readonly AgentExecutionEvent[]): TaskState[] {
  return events.flatMap((event) =>
    event.kind === 'statusUpdate' && event.data.status !== undefined
      ? [event.data.status.state]
      : [],
  );
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_WAIT_TIMEOUT');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
