import { describe, expect, it, vi } from 'vitest';

import {
  RemoteTaskAdmissionRecoveryService,
  type RemoteTaskAdmissionIntent,
  type RemoteTaskAdmissionIntentStore,
} from '../src/index.js';

describe('RemoteTaskAdmissionRecoveryService', () => {
  it('reads only a bounded PostgreSQL recovery batch', async () => {
    const listRecoverable = vi.fn().mockResolvedValue([]);
    const service = new RemoteTaskAdmissionRecoveryService({
      listRecoverable,
    } as unknown as RemoteTaskAdmissionIntentStore);

    await expect(service.listRecoverable(64)).resolves.toEqual([]);
    expect(listRecoverable).toHaveBeenCalledWith(64);
  });

  it.each([0, -1, 1.5, 1_001])('rejects invalid recovery limit %s', (limit) => {
    const listRecoverable = vi.fn();
    const service = new RemoteTaskAdmissionRecoveryService({
      listRecoverable,
    } as unknown as RemoteTaskAdmissionIntentStore);

    expect(() => service.listRecoverable(limit)).toThrow(
      'REMOTE_TASK_ADMISSION_RECOVERY_LIMIT_INVALID',
    );
    expect(listRecoverable).not.toHaveBeenCalled();
  });

  it('fails a dispatching intent as explicit uncertainty without calling a Provider', async () => {
    const intent = admissionIntent('dispatching');
    const markUncertain = vi.fn().mockResolvedValue({
      applied: true,
      intent: { ...intent, status: 'uncertain' },
    });
    const failTask = vi.fn().mockResolvedValue(undefined);
    const service = recoveryService({
      intents: [intent],
      markUncertain,
      failTask,
    });

    await expect(service.reconcile()).resolves.toEqual({
      examined: 1,
      materialized: 0,
      uncertain: 1,
      closedPrepared: 0,
    });
    expect(markUncertain).toHaveBeenCalledWith({
      intentId: intent.intentId,
      invocationId: intent.invocationId,
      reasonCode: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
      at: '2026-08-13T03:00:01.000Z',
    });
    expect(failTask).toHaveBeenCalledWith(
      intent.taskId,
      'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
      expect.stringContaining('will not be replayed'),
    );
  });

  it('materializes one receipt after restart and then seals the journal', async () => {
    const intent = admissionIntent('receipt_recorded');
    const admit = vi.fn().mockResolvedValue({
      binding: { bindingId: intent.envelope.bindingId, version: 1 },
      created: true,
      pollScheduled: true,
    });
    const recordExternalSnapshot = vi.fn().mockResolvedValue({
      applied: true,
      binding: { bindingId: intent.envelope.bindingId },
    });
    const markMaterialized = vi.fn().mockResolvedValue({
      applied: true,
      intent: { ...intent, status: 'materialized' },
    });
    const service = recoveryService({
      intents: [intent],
      admit,
      recordExternalSnapshot,
      markMaterialized,
    });

    await expect(service.reconcile()).resolves.toEqual({
      examined: 1,
      materialized: 1,
      uncertain: 0,
      closedPrepared: 0,
    });
    expect(admit).toHaveBeenCalledOnce();
    expect(recordExternalSnapshot).toHaveBeenCalledOnce();
    expect(markMaterialized).toHaveBeenCalledWith({
      intentId: intent.intentId,
      invocationId: intent.invocationId,
      bindingId: intent.envelope.bindingId,
      snapshotId: 'snapshot-restart',
      at: '2026-08-13T03:00:01.000Z',
    });
  });

  it('leaves fresh prepared, dispatching, and partial receipts untouched during periodic recovery', async () => {
    const preparedBase = admissionIntent('dispatching');
    const prepared = {
      intentId: preparedBase.intentId,
      invocationId: preparedBase.invocationId,
      taskId: preparedBase.taskId,
      ...(preparedBase.capabilityAttemptId === undefined
        ? {}
        : { capabilityAttemptId: preparedBase.capabilityAttemptId }),
      contextId: preparedBase.contextId,
      serverId: preparedBase.serverId,
      operationName: preparedBase.operationName,
      argumentsHash: preparedBase.argumentsHash,
      envelope: preparedBase.envelope,
      status: 'prepared' as const,
      createdAt: preparedBase.createdAt,
      updatedAt: preparedBase.updatedAt,
      version: 1,
    };
    const dispatching = admissionIntent('dispatching');
    const recorded = admissionIntent('receipt_recorded');
    if (recorded.receipt === undefined) throw new Error('TEST_RECEIPT_REQUIRED');
    const partial = {
      ...recorded,
      receipt: {
        ...recorded.receipt,
        continuation: {
          ...recorded.receipt.continuation,
          completeness: 'requires_graph_merge' as const,
        },
      },
    };
    const close = vi.fn();
    const markUncertain = vi.fn();
    const closeReceiptAsUncertain = vi.fn();
    const markMaterialized = vi.fn();
    const admit = vi.fn();
    const recordExternalSnapshot = vi.fn();
    const failTask = vi.fn().mockResolvedValue(undefined);
    const findCurrentByBinding = vi.fn().mockResolvedValue(undefined);
    const service = recoveryService({
      intents: [prepared, dispatching, partial],
      close,
      markUncertain,
      closeReceiptAsUncertain,
      markMaterialized,
      admit,
      recordExternalSnapshot,
      failTask,
      findCurrentByBinding,
    });

    await expect(service.reconcile(100, 'periodic')).resolves.toEqual({
      examined: 3,
      materialized: 0,
      uncertain: 0,
      closedPrepared: 0,
    });
    expect(findCurrentByBinding).toHaveBeenCalledOnce();
    expect(findCurrentByBinding).toHaveBeenCalledWith(partial.envelope.bindingId);
    expect(close).not.toHaveBeenCalled();
    expect(markUncertain).not.toHaveBeenCalled();
    expect(closeReceiptAsUncertain).not.toHaveBeenCalled();
    expect(markMaterialized).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(recordExternalSnapshot).not.toHaveBeenCalled();
    expect(failTask).not.toHaveBeenCalled();
  });
});

function recoveryService(
  input: Readonly<{
    intents: readonly RemoteTaskAdmissionIntent[];
    markUncertain?: ReturnType<typeof vi.fn>;
    close?: ReturnType<typeof vi.fn>;
    closeReceiptAsUncertain?: ReturnType<typeof vi.fn>;
    markMaterialized?: ReturnType<typeof vi.fn>;
    admit?: ReturnType<typeof vi.fn>;
    recordExternalSnapshot?: ReturnType<typeof vi.fn>;
    findCurrentByBinding?: ReturnType<typeof vi.fn>;
    failTask?: (taskId: string, errorCode: string, summary: string) => Promise<void>;
  }>,
): RemoteTaskAdmissionRecoveryService {
  const store = {
    listRecoverable: vi.fn().mockResolvedValue(input.intents),
    close: input.close ?? vi.fn(),
    markUncertain: input.markUncertain ?? vi.fn(),
    closeReceiptAsUncertain: input.closeReceiptAsUncertain ?? vi.fn(),
    findByBindingId: vi.fn(),
    markMaterialized: input.markMaterialized ?? vi.fn(),
  } as unknown as RemoteTaskAdmissionIntentStore;
  return new RemoteTaskAdmissionRecoveryService({
    store,
    admission: { admit: input.admit ?? vi.fn() } as never,
    remoteTasks: {
      recordExternalSnapshot: input.recordExternalSnapshot ?? vi.fn(),
    } as never,
    continuations: {
      findCurrentByBinding:
        input.findCurrentByBinding ?? vi.fn().mockResolvedValue(continuationSnapshot()),
      saveSnapshot: vi.fn(),
    } as never,
    clock: { now: () => '2026-08-13T03:00:01.000Z' },
    failTask: input.failTask ?? (() => Promise.resolve()),
    nextObservationId: () => 'observation-recovered',
    nextControlEventId: () => 'control-recovered',
  });
}

function admissionIntent(status: 'dispatching' | 'receipt_recorded'): RemoteTaskAdmissionIntent {
  const createdAt = '2026-08-13T03:00:00.000Z';
  return {
    intentId: 'remote-admission-intent-restart',
    invocationId: 'mcp-invocation-restart',
    taskId: 'task-restart',
    contextId: 'context-restart',
    serverId: 'provider-restart',
    operationName: 'embodied.move',
    argumentsHash: 'a'.repeat(64),
    envelope: {
      bindingId: 'remote-binding-restart',
      serverId: 'provider-restart',
      operationName: 'embodied.move',
      agentTaskId: 'task-restart',
      contextId: 'context-restart',
      goalId: 'goal-restart',
      goalVersion: 1,
      workflowPlanId: 'plan-restart',
      workflowDefinitionId: 'workflow-restart',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'instance-restart',
      workflowNodeId: 'move',
      workflowNodeRunId: 'move:1',
      mcpInvocationId: 'mcp-invocation-restart',
      executionContext: { mode: 'simulation', simulationId: 'p05-restart' },
      createdAt,
    },
    status,
    dispatchHash: `sha256:${'d'.repeat(64)}`,
    dispatchedAt: createdAt,
    ...(status === 'receipt_recorded'
      ? {
          receiptRecordedAt: createdAt,
          receipt: {
            remoteTask: {
              protocolMode: 'frozen_v1' as const,
              remoteTaskId: 'provider-task-restart',
              status: 'working' as const,
              createdAt,
              lastUpdatedAt: createdAt,
              ttlMs: 60_000,
              expiresAt: '2026-08-13T03:01:00.000Z',
              pollIntervalMs: 100,
              protocolRevision: '2026-07-28',
              tasksSchemaRevision: 'tasks-v1',
              runtimeRevision: 'runtime-2',
            },
            reconciledTask: {
              protocolMode: 'frozen_v1' as const,
              remoteTaskId: 'provider-task-restart',
              status: 'working' as const,
              createdAt,
              lastUpdatedAt: '2026-08-13T03:00:00.500Z',
              ttlMs: 60_000,
              expiresAt: '2026-08-13T03:01:00.000Z',
              protocolRevision: '2026-07-28',
              tasksSchemaRevision: 'tasks-v1',
              runtimeRevision: 'runtime-3',
            },
            credentialRevision: 'credential-restart',
            sessionRevision: 'session-restart',
            protocolContract: {
              mode: 'frozen_v1' as const,
              protocolVersion: '2026-07-28',
              baselineSha256: 'b'.repeat(64),
            },
            taskBehavior: 'task_required' as const,
            continuation: {
              snapshot: continuationSnapshot(),
              completeness: 'exact_single' as const,
            },
          },
        }
      : {}),
    createdAt,
    updatedAt: createdAt,
    version: status === 'receipt_recorded' ? 3 : 2,
  };
}

function continuationSnapshot() {
  return {
    schemaVersion: '1.0' as const,
    snapshotId: 'snapshot-restart',
    continuationId: 'continuation-restart',
    stateVersion: 1,
    lifecycle: 'active' as const,
    agentTaskId: 'task-restart',
    contextId: 'context-restart',
    workflowControlId: 'control-restart',
    goalId: 'goal-restart',
    goalVersion: 1,
    workflowPlanId: 'plan-restart',
    workflowDefinitionId: 'workflow-restart',
    workflowDefinitionVersion: 1,
    workflowDefinitionHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    workflowInstanceId: 'instance-restart',
    input: {},
    waitingNodeRuns: [
      {
        waitId: 'remote-binding-restart',
        kind: 'remote_task' as const,
        sourceId: 'remote-binding-restart',
        nodeId: 'move',
        nodeRunId: 'move:1',
        state: 'waiting' as const,
      },
    ],
    runnableFrontier: [],
    completedNodeRunIds: [],
    nodeRunCounts: { move: 1 },
    outputs: {},
    errors: {},
    routes: { move: '__end__' },
    loopCounts: {},
    recoveryCounts: {},
    parallelJoinState: [],
    failed: false,
    executionContext: { mode: 'simulation' as const, simulationId: 'p05-restart' },
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 1,
      maxMcpCalls: 2,
      maxCost: 1,
    },
    budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 0 },
    createdAt: '2026-08-13T03:00:00.000Z',
    updatedAt: '2026-08-13T03:00:00.000Z',
  };
}
