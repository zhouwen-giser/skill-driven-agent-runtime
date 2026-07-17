import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteTaskBinding,
  createWorkflowContinuationSnapshot,
  type RemoteTaskBinding,
  type RemoteTaskControlEvent,
  type WorkflowContinuationAttempt,
  type WorkflowContinuationLifecycle,
  type WorkflowContinuationSnapshot,
  type WorkflowContinuationSnapshotInput,
  type WorkflowInstance,
} from '../../domain/src/index.js';
import { RemoteTaskContinuationReconciler, RemoteTaskContinuationService } from '../src/index.js';
import type {
  RemoteTaskContinuationJob,
  RemoteTaskContinuationQueue,
  RemoteTaskRepository,
  WorkflowContinuationRepository,
} from '../src/ports.js';
import type { WorkflowExecutionService } from '../src/workflow-execution.js';

const timestamp = '2026-07-16T08:00:00.000Z';

describe('RemoteTaskContinuationService', () => {
  it('continues a completed remote Task exactly once and rejects the duplicate claim', async () => {
    const harness = createHarness();
    const event = completedEvent();
    harness.continuations.addControl(event);

    await expect(harness.service.process(jobFor(event))).resolves.toMatchObject({
      disposition: 'continued',
      instance: { status: 'succeeded' },
    });
    await expect(harness.service.process(jobFor(event))).resolves.toEqual({
      disposition: 'not_claimed',
    });

    expect(harness.continueExternal).toHaveBeenCalledTimes(1);
    expect(harness.continuations.attempts).toHaveLength(1);
    expect(harness.continuations.attempts[0]).toMatchObject({ status: 'succeeded' });
    expect(harness.continuations.control(event.eventId)).toMatchObject({ status: 'processed' });
  });

  it.each([
    [
      'failed',
      failedEvent(),
      {
        kind: 'failed',
        error: {
          code: 'MCP_REMOTE_TASK_FAILED',
          message: 'provider exploded',
          category: 'provider_failed',
          data: { message: 'provider exploded', retryable: false },
        },
      },
    ],
    [
      'cancelled',
      cancelledEvent(),
      {
        kind: 'failed',
        error: {
          code: 'MCP_REMOTE_TASK_CANCELLED',
          message: 'The remote MCP Task was cancelled.',
          category: 'provider_cancelled',
          data: { status: 'cancelled', reason: 'operator request' },
        },
      },
    ],
  ] as const)(
    'maps a terminal %s event to a typed failed resolution',
    async (_label, event, expected) => {
      const harness = createHarness();
      harness.continuations.addControl(event);

      await expect(harness.service.process(jobFor(event))).resolves.toMatchObject({
        disposition: 'continued',
      });

      expect(harness.continueExternal).toHaveBeenCalledWith({
        instanceId: 'instance-1',
        resolution: {
          ...expected,
          waitId: 'wait-1',
          nodeRunId: 'instance-1~node-1~1',
        },
        continuationAttemptId: 'continuation-attempt-1',
      });
    },
  );

  it('passes a completed isError Tool result through without converting it to provider failure', async () => {
    const harness = createHarness();
    const event = completedEvent({
      content: [{ type: 'text', text: 'tool-level failure' }],
      structuredContent: { reason: 'rejected' },
      isError: true,
      metadata: { provider: 'mock' },
    });
    harness.continuations.addControl(event);

    await harness.service.process(jobFor(event));

    const resolution = harness.continueExternal.mock.calls[0]?.[0].resolution;
    expect(resolution).toEqual({
      kind: 'completed',
      waitId: 'wait-1',
      nodeRunId: 'instance-1~node-1~1',
      result: {
        content: [{ type: 'text', text: 'tool-level failure' }],
        structuredContent: { reason: 'rejected' },
        isError: true,
        metadata: { provider: 'mock' },
      },
    });
  });

  it('fails closed before graph continuation when timing outcome evidence is malformed', async () => {
    const harness = createHarness();
    const event = completedEvent({
      content: [],
      structuredContent: {
        outcome: 'deadline_reached',
        retryable: true,
      },
      isError: true,
    });
    harness.continuations.addControl(event);

    await expect(harness.service.process(jobFor(event))).rejects.toMatchObject({
      code: 'PROVIDER_BUSINESS_OUTCOME_INVALID',
    });

    expect(harness.continueExternal).not.toHaveBeenCalled();
    expect(harness.continuations.attempts[0]).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_BUSINESS_OUTCOME_INVALID',
    });
    expect(harness.continuations.control(event.eventId)).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_BUSINESS_OUTCOME_INVALID',
    });
  });

  it.each([
    ['terminal parent', { instance: workflowInstance({ status: 'canceled' }) }],
    ['stale Goal authority', { binding: remoteTaskBinding({ goalVersion: 2 }) }],
  ] as const)('audits %s as stale without entering the graph', async (_label, overrides) => {
    const harness = createHarness(overrides);
    const event = completedEvent();
    harness.continuations.addControl(event);

    await expect(harness.service.process(jobFor(event))).resolves.toMatchObject({
      disposition: 'stale',
    });

    expect(harness.continueExternal).not.toHaveBeenCalled();
    expect(harness.continuations.attempts).toHaveLength(1);
    expect(harness.continuations.attempts[0]).toMatchObject({ status: 'stale' });
    expect(harness.continuations.control(event.eventId)).toMatchObject({ status: 'processed' });
  });

  it('defers input_required evidence when the Phase 5 input lifecycle is unavailable', async () => {
    const harness = createHarness();
    const event = inputRequiredEvent();
    harness.continuations.addControl(event);

    await expect(harness.service.process(jobFor(event))).resolves.toEqual({
      disposition: 'input_deferred',
    });

    expect(harness.findBinding).not.toHaveBeenCalled();
    expect(harness.continuations.claimCalls).toBe(0);
    expect(harness.continueExternal).not.toHaveBeenCalled();
    expect(harness.continuations.control(event.eventId)).toMatchObject({ status: 'pending' });
  });

  it('records both the continuation attempt and control as failed when graph execution throws', async () => {
    const error = Object.assign(new Error('fresh graph invocation crashed'), {
      code: 'LANGGRAPH_CONTINUATION_CRASH',
    });
    const harness = createHarness({ continueError: error });
    const event = completedEvent();
    harness.continuations.addControl(event);

    await expect(harness.service.process(jobFor(event))).rejects.toBe(error);

    expect(harness.continuations.attempts).toHaveLength(1);
    expect(harness.continuations.attempts[0]).toMatchObject({
      status: 'failed',
      errorCode: 'LANGGRAPH_CONTINUATION_CRASH',
    });
    expect(harness.continuations.control(event.eventId)).toMatchObject({
      status: 'failed',
      errorCode: 'LANGGRAPH_CONTINUATION_CRASH',
    });
  });
});

describe('RemoteTaskContinuationReconciler', () => {
  it('schedules terminal and input inbox evidence once for lifecycle dispatch', async () => {
    const completed = completedEvent();
    const inputRequired = inputRequiredEvent();
    const queueStates = new Map<string, Awaited<ReturnType<RemoteTaskContinuationQueue['state']>>>([
      ['event-already-scheduled', 'scheduled'],
    ]);
    const enqueue = vi.fn<RemoteTaskContinuationQueue['enqueue']>((job) => {
      queueStates.set(job.eventId, 'scheduled');
      return Promise.resolve();
    });
    const reconciler = new RemoteTaskContinuationReconciler({
      continuations: {
        listInbox: () =>
          Promise.resolve([
            completed,
            inputRequired,
            { ...failedEvent(), eventId: 'event-already-scheduled' },
          ]),
      },
      queue: {
        enqueue,
        state: (eventId) => Promise.resolve(queueStates.get(eventId) ?? 'missing'),
      },
      clock: { now: () => timestamp },
    });

    await expect(reconciler.reconcile()).resolves.toEqual({
      examined: 3,
      scheduled: 2,
      alreadyScheduled: 1,
      deferredInput: 0,
    });
    expect(enqueue).toHaveBeenCalledWith(jobFor(completed));
    expect(enqueue).toHaveBeenCalledWith(jobFor(inputRequired));
  });
});

function createHarness(
  overrides: Readonly<{
    binding?: RemoteTaskBinding;
    instance?: WorkflowInstance;
    snapshot?: WorkflowContinuationSnapshot;
    continueError?: Error;
  }> = {},
) {
  const binding = overrides.binding ?? remoteTaskBinding();
  const instance = overrides.instance ?? workflowInstance();
  const continuations = new InMemoryContinuationRepository(
    overrides.snapshot ?? continuationSnapshot(),
  );
  const findBinding = vi.fn<Pick<RemoteTaskRepository, 'findById'>['findById']>((bindingId) =>
    Promise.resolve(bindingId === binding.bindingId ? binding : undefined),
  );
  const get = vi.fn<Pick<WorkflowExecutionService, 'get'>['get']>((instanceId) =>
    Promise.resolve(instanceId === instance.instanceId ? instance : undefined),
  );
  const continueExternal = vi.fn<
    Pick<WorkflowExecutionService, 'continueExternal'>['continueExternal']
  >((input) => {
    void input;
    if (overrides.continueError !== undefined) return Promise.reject(overrides.continueError);
    return Promise.resolve(workflowInstance({ status: 'succeeded', completedAt: timestamp }));
  });
  const service = new RemoteTaskContinuationService({
    continuations,
    remoteTasks: { findById: findBinding },
    execution: { get, continueExternal },
    serial: { run: (_contextId, operation) => operation() },
    clock: { now: () => timestamp },
    ids: {
      nextClaimToken: () => 'claim-1',
      nextAttemptId: () => 'continuation-attempt-1',
    },
  });
  return { service, continuations, findBinding, get, continueExternal };
}

class InMemoryContinuationRepository implements WorkflowContinuationRepository {
  readonly attempts: WorkflowContinuationAttempt[] = [];
  readonly #controls = new Map<string, RemoteTaskControlEvent>();
  readonly #claimTokens = new Map<string, string>();
  readonly snapshot: WorkflowContinuationSnapshot;
  claimCalls = 0;

  constructor(snapshot: WorkflowContinuationSnapshot) {
    this.snapshot = snapshot;
  }

  addControl(event: RemoteTaskControlEvent): void {
    this.#controls.set(event.eventId, event);
  }

  control(eventId: string): RemoteTaskControlEvent | undefined {
    return this.#controls.get(eventId);
  }

  saveSnapshot(): Promise<void> {
    return Promise.resolve();
  }

  transitionLifecycle(
    _snapshotId: string,
    _expected: WorkflowContinuationLifecycle,
    _next: WorkflowContinuationLifecycle,
    _updatedAt: string,
  ): Promise<WorkflowContinuationSnapshot> {
    void _snapshotId;
    void _expected;
    void _next;
    void _updatedAt;
    return Promise.resolve(this.snapshot);
  }

  findById(snapshotId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(snapshotId === this.snapshot.snapshotId ? this.snapshot : undefined);
  }

  findCurrent(workflowInstanceId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(
      workflowInstanceId === this.snapshot.workflowInstanceId ? this.snapshot : undefined,
    );
  }

  findCurrentByBinding(bindingId: string): Promise<WorkflowContinuationSnapshot | undefined> {
    return Promise.resolve(
      this.snapshot.waitingNodeRuns.some(
        (wait) => wait.kind === 'remote_task' && wait.sourceId === bindingId,
      )
        ? this.snapshot
        : undefined,
    );
  }

  listInbox(): Promise<readonly RemoteTaskControlEvent[]> {
    return Promise.resolve(
      [...this.#controls.values()].filter((event) => event.status === 'pending'),
    );
  }

  claimControl(
    input: Parameters<WorkflowContinuationRepository['claimControl']>[0],
  ): Promise<RemoteTaskControlEvent | undefined> {
    this.claimCalls += 1;
    const current = this.#controls.get(input.eventId);
    if (current?.status !== 'pending') return Promise.resolve(undefined);
    const claimed: RemoteTaskControlEvent = {
      ...current,
      status: 'claimed',
      claimedAt: input.claimedAt,
    };
    this.#controls.set(input.eventId, claimed);
    this.#claimTokens.set(input.eventId, input.claimToken);
    return Promise.resolve(claimed);
  }

  finishControl(
    input: Parameters<WorkflowContinuationRepository['finishControl']>[0],
  ): Promise<void> {
    const current = this.#controls.get(input.eventId);
    if (current?.status !== 'claimed' || this.#claimTokens.get(input.eventId) !== input.claimToken)
      throw new Error('CONTROL_CLAIM_STALE');
    this.#controls.set(input.eventId, {
      ...current,
      status: input.status,
      processedAt: input.processedAt,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
    });
    return Promise.resolve();
  }

  saveAttempt(attempt: WorkflowContinuationAttempt): Promise<void> {
    this.attempts.push(attempt);
    return Promise.resolve();
  }

  updateAttempt(
    attempt: WorkflowContinuationAttempt,
    expectedStatus: WorkflowContinuationAttempt['status'],
  ): Promise<void> {
    const index = this.attempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
    if (index < 0 || this.attempts[index]?.status !== expectedStatus)
      throw new Error('CONTINUATION_ATTEMPT_STALE');
    this.attempts[index] = attempt;
    return Promise.resolve();
  }

  listAttempts(workflowInstanceId: string): Promise<readonly WorkflowContinuationAttempt[]> {
    return Promise.resolve(
      this.attempts.filter((attempt) => attempt.workflowInstanceId === workflowInstanceId),
    );
  }
}

function remoteTaskBinding(
  overrides: Partial<Parameters<typeof createRemoteTaskBinding>[0]> = {},
): RemoteTaskBinding {
  return createRemoteTaskBinding({
    bindingId: 'binding-1',
    serverId: 'server-1',
    operationName: 'long-tool',
    remoteTaskId: 'remote-1',
    agentTaskId: 'task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'instance-1~node-1~1',
    mcpInvocationId: 'invocation-1',
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'schema-1',
    lastProviderUpdatedAt: timestamp,
    executionContext: { mode: 'live' },
    credentialRevision: 'credential-sha256-1',
    sessionRevision: '2026-07-28/schema-1',
    pollIntervalMs: 200,
    createdAt: timestamp,
    ...overrides,
  });
}

function continuationSnapshot(
  overrides: Partial<WorkflowContinuationSnapshotInput> = {},
): WorkflowContinuationSnapshot {
  return createWorkflowContinuationSnapshot({
    schemaVersion: '1.0',
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    stateVersion: 1,
    lifecycle: 'active',
    agentTaskId: 'task-1',
    contextId: 'context-1',
    workflowControlId: 'control-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowDefinitionHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    workflowInstanceId: 'instance-1',
    input: { prompt: 'run' },
    waitingNodeRuns: [
      {
        waitId: 'wait-1',
        kind: 'remote_task',
        sourceId: 'binding-1',
        nodeId: 'node-1',
        nodeRunId: 'instance-1~node-1~1',
        state: 'waiting',
      },
    ],
    runnableFrontier: [],
    completedNodeRunIds: [],
    nodeRunCounts: { 'node-1': 1 },
    outputs: {},
    errors: {},
    routes: {},
    loopCounts: {},
    recoveryCounts: {},
    parallelJoinState: [],
    failed: false,
    executionContext: { mode: 'live' },
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 10, llmCalls: 0, mcpCalls: 1, cost: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  });
}

function workflowInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    instanceId: 'instance-1',
    planId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowVersion: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 10, llmCalls: 0, mcpCalls: 1, cost: 0 },
    status: 'waiting_external',
    input: { prompt: 'run' },
    errors: {},
    startedAt: timestamp,
    ...overrides,
  };
}

function completedEvent(
  result: Readonly<{
    content: readonly unknown[];
    structuredContent?: unknown;
    isError: boolean;
    metadata?: Readonly<Record<string, unknown>>;
  }> = { content: [{ type: 'text', text: 'done' }], isError: false },
): RemoteTaskControlEvent {
  return controlEvent('task.completed', { status: 'completed', result });
}

function failedEvent(): RemoteTaskControlEvent {
  return controlEvent('task.failed', {
    status: 'failed',
    error: { message: 'provider exploded', retryable: false },
  });
}

function cancelledEvent(): RemoteTaskControlEvent {
  return controlEvent('task.cancelled', { status: 'cancelled', reason: 'operator request' });
}

function inputRequiredEvent(): RemoteTaskControlEvent {
  return controlEvent('task.input_required', {
    status: 'input_required',
    inputRequests: { approval: { type: 'boolean' } },
  });
}

function controlEvent(
  type: RemoteTaskControlEvent['type'],
  payload: unknown,
): RemoteTaskControlEvent {
  return {
    eventId: `event-${type}`,
    bindingId: 'binding-1',
    type,
    remoteRevision: 'revision-2',
    resultHash: 'c'.repeat(64),
    payload,
    status: 'pending',
    createdAt: timestamp,
  };
}

function jobFor(event: RemoteTaskControlEvent): RemoteTaskContinuationJob {
  return { eventId: event.eventId, bindingId: event.bindingId, eventType: event.type };
}
