import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type {
  RemoteTaskAdmissionIntent,
  RemoteTaskAdmissionReceipt,
} from '../../application/src/index.js';
import type { McpInvocation } from '../../domain/src/index.js';
import { PostgresRemoteTaskAdmissionIntentStore } from '../src/index.js';

const preparedAt = '2026-08-13T02:00:00.000Z';
const dispatchedAt = '2026-08-13T02:00:00.100Z';
const receiptAt = '2026-08-13T02:00:00.200Z';
const dispatchHash = `sha256:${'d'.repeat(64)}`;

describe('PostgresRemoteTaskAdmissionIntentStore', () => {
  it('prepares one frozen local envelope and returns an exact idempotent replay', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ...intentRow(), inserted: true }] });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ query } as unknown as Pool);

    await expect(store.prepare(intent())).resolves.toMatchObject({
      created: true,
      intent: { status: 'prepared', version: 1 },
    });
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT DO NOTHING');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'remote-admission-intent-1',
      'mcp-invocation-1',
      'remote-binding-1',
      'agent-task-1',
      'capability-attempt-1',
      'context-1',
      'provider-1',
      'embodied.move',
      'a'.repeat(64),
      JSON.stringify(intent().envelope),
      preparedAt,
      preparedAt,
    ]);
  });

  it('marks dispatch exactly once and treats only the identical retry as success', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          ...intentRow({
            status: 'dispatching',
            dispatch_hash: dispatchHash,
            dispatched_at: dispatchedAt,
            updated_at: dispatchedAt,
            version: 2,
          }),
          transition_applied: false,
        },
      ],
    });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ query } as unknown as Pool);

    await expect(
      store.markDispatching({
        intentId: 'remote-admission-intent-1',
        invocationId: 'mcp-invocation-1',
        dispatchHash,
        at: dispatchedAt,
      }),
    ).resolves.toMatchObject({ applied: true, intent: { status: 'dispatching', version: 2 } });
    expect(query.mock.calls[0]?.[0]).toContain("status='prepared'");
    expect(query.mock.calls[0]?.[0]).toContain('version=version+1');
  });

  it('atomically writes the MCP invocation and remote receipt before admission materializes', async () => {
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          intentRow({
            status: 'dispatching',
            dispatch_hash: dispatchHash,
            dispatched_at: dispatchedAt,
            updated_at: dispatchedAt,
            version: 2,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // mcp_invocation insert
      .mockResolvedValueOnce({
        rows: [
          intentRow({
            status: 'receipt_recorded',
            dispatch_hash: dispatchHash,
            dispatched_at: dispatchedAt,
            recorded_invocation_id: 'mcp-invocation-1',
            remote_receipt_json: receipt(),
            receipt_recorded_at: receiptAt,
            updated_at: receiptAt,
            version: 3,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // COMMIT
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ connect } as unknown as Pool);

    await expect(
      store.recordRemoteReceiptAndInvocation(
        'remote-admission-intent-1',
        invocation(),
        receipt(),
        receiptAt,
      ),
    ).resolves.toMatchObject({
      applied: true,
      intent: {
        status: 'receipt_recorded',
        receipt: { remoteTask: { remoteTaskId: 'provider-task-1' } },
        version: 3,
      },
    });
    expect(clientQuery.mock.calls.map((call) => String(call[0]).trim().split(/\s+/u)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'INSERT',
      'UPDATE',
      'COMMIT',
    ]);
    expect(clientQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE');
    expect(clientQuery.mock.calls[2]?.[0]).toContain('INSERT INTO mcp_invocation');
    expect(clientQuery.mock.calls[3]?.[0]).toContain("status='receipt_recorded'");
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back both the invocation and receipt transition when receipt persistence fails', async () => {
    const persistenceFailure = new Error('SIMULATED_RECEIPT_WRITE_FAILURE');
    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          intentRow({
            status: 'dispatching',
            dispatch_hash: dispatchHash,
            dispatched_at: dispatchedAt,
            updated_at: dispatchedAt,
            version: 2,
          }),
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // invocation insert
      .mockRejectedValueOnce(persistenceFailure) // receipt update
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query: clientQuery, release });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ connect } as unknown as Pool);

    await expect(
      store.recordRemoteReceiptAndInvocation(
        'remote-admission-intent-1',
        invocation(),
        receipt(),
        receiptAt,
      ),
    ).rejects.toBe(persistenceFailure);
    expect(clientQuery.mock.calls.map((call) => String(call[0]).trim().split(/\s+/u)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'INSERT',
      'UPDATE',
      'ROLLBACK',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('materializes only through an active continuation owned by a waiting-external instance', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          ...intentRow({
            status: 'materialized',
            dispatch_hash: dispatchHash,
            dispatched_at: dispatchedAt,
            recorded_invocation_id: 'mcp-invocation-1',
            remote_receipt_json: receipt(),
            receipt_recorded_at: receiptAt,
            materialized_binding_id: 'remote-binding-1',
            materialized_snapshot_id: 'workflow-snapshot-1',
            materialized_at: receiptAt,
            closed_at: receiptAt,
            updated_at: receiptAt,
            version: 4,
          }),
          transition_applied: true,
        },
      ],
    });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ query } as unknown as Pool);

    await expect(
      store.markMaterialized({
        intentId: 'remote-admission-intent-1',
        invocationId: 'mcp-invocation-1',
        bindingId: 'remote-binding-1',
        snapshotId: 'workflow-snapshot-1',
        at: receiptAt,
      }),
    ).resolves.toMatchObject({ applied: true, intent: { status: 'materialized' } });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('JOIN workflow_instance instance');
    expect(sql).toContain("instance.status='waiting_external'");
    expect(sql).toContain("snapshot.lifecycle='active'");
    expect(sql).toContain('wait.binding_id=$3');
  });

  it('replaces only a graph-merge continuation with the exact final snapshot', async () => {
    const continuation = {
      ...receipt().continuation,
      completeness: 'exact_final' as const,
    };
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          ...intentRow({
            status: 'receipt_recorded',
            dispatch_hash: dispatchHash,
            dispatched_at: dispatchedAt,
            recorded_invocation_id: 'mcp-invocation-1',
            remote_receipt_json: { ...receipt(), continuation },
            receipt_recorded_at: receiptAt,
            updated_at: receiptAt,
            version: 4,
          }),
          transition_applied: true,
        },
      ],
    });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ query } as unknown as Pool);

    await expect(
      store.replaceContinuation({
        intentId: 'remote-admission-intent-1',
        invocationId: 'mcp-invocation-1',
        continuation,
        at: receiptAt,
      }),
    ).resolves.toMatchObject({
      applied: true,
      intent: {
        status: 'receipt_recorded',
        receipt: { continuation: { completeness: 'exact_final' } },
      },
    });
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("jsonb_set(\n                  remote_receipt_json,'{continuation}'");
    expect(sql).toContain("completeness'='requires_graph_merge'");
    expect(query.mock.calls[0]?.[1]).toEqual([
      'remote-admission-intent-1',
      'mcp-invocation-1',
      JSON.stringify(continuation),
      receiptAt,
    ]);

    await expect(
      store.replaceContinuation({
        intentId: 'remote-admission-intent-1',
        invocationId: 'mcp-invocation-1',
        continuation: { ...continuation, completeness: 'requires_graph_merge' },
        at: receiptAt,
      }),
    ).rejects.toThrow('REMOTE_TASK_ADMISSION_CONTINUATION_FINAL_REQUIRED');
    expect(query).toHaveBeenCalledOnce();
  });

  it('fails closed on a dispatch with no receipt and never makes it recoverable again', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...intentRow({
              status: 'uncertain',
              dispatch_hash: dispatchHash,
              dispatched_at: dispatchedAt,
              reason_code: 'MCP_REMOTE_ADMISSION_RECEIPT_UNKNOWN',
              closed_at: receiptAt,
              updated_at: receiptAt,
              version: 3,
            }),
            transition_applied: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const store = new PostgresRemoteTaskAdmissionIntentStore({ query } as unknown as Pool);

    await expect(
      store.markUncertain({
        intentId: 'remote-admission-intent-1',
        invocationId: 'mcp-invocation-1',
        reasonCode: 'MCP_REMOTE_ADMISSION_RECEIPT_UNKNOWN',
        at: receiptAt,
      }),
    ).resolves.toMatchObject({ applied: true, intent: { status: 'uncertain' } });
    await expect(store.listRecoverable(100)).resolves.toEqual([]);
    expect(query.mock.calls[0]?.[0]).toContain("status='dispatching'");
    expect(query.mock.calls[1]?.[0]).toContain(
      "status IN ('prepared','dispatching','receipt_recorded')",
    );
  });
});

function intent(): RemoteTaskAdmissionIntent {
  return {
    intentId: 'remote-admission-intent-1',
    invocationId: 'mcp-invocation-1',
    taskId: 'agent-task-1',
    capabilityAttemptId: 'capability-attempt-1',
    contextId: 'context-1',
    serverId: 'provider-1',
    operationName: 'embodied.move',
    argumentsHash: 'a'.repeat(64),
    envelope: envelope(),
    status: 'prepared',
    createdAt: preparedAt,
    updatedAt: preparedAt,
    version: 1,
  };
}

function envelope() {
  return {
    bindingId: 'remote-binding-1',
    serverId: 'provider-1',
    operationName: 'embodied.move',
    agentTaskId: 'agent-task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'move',
    workflowNodeRunId: 'move:1',
    mcpInvocationId: 'mcp-invocation-1',
    executionContext: { mode: 'simulation' as const, simulationId: 'p05-no-device-write' },
    createdAt: preparedAt,
  };
}

function receipt(): RemoteTaskAdmissionReceipt {
  return {
    remoteTask: {
      remoteTaskId: 'provider-task-1',
      status: 'working',
      createdAt: receiptAt,
      lastUpdatedAt: receiptAt,
      ttlMs: 60_000,
      expiresAt: '2026-08-13T02:01:00.200Z',
      pollIntervalMs: 100,
      protocolRevision: '2026-07-28',
      tasksSchemaRevision: 'tasks-v1',
      runtimeRevision: 'runtime-1',
    },
    credentialRevision: 'credential-1',
    sessionRevision: 'session-1',
    protocolContract: {
      mode: 'frozen_v1',
      protocolVersion: '2026-07-28',
      baselineSha256: 'b'.repeat(64),
      serverDiscoverySnapshotId: 'snapshot-1',
    },
    taskBehavior: 'server_directed',
    authoritySnapshot: {
      schemaVersion: '1.0',
      capturedAt: receiptAt,
      runtime: {
        serverId: 'provider-1',
        endpoint: 'https://provider-1.test/mcp',
        serverUpdatedAt: 'credential-1',
        toolRevision: 1,
        protocolSnapshotId: 'snapshot-1',
        catalogRevision: 'catalog-revision-1',
        catalogChecksum: 'c'.repeat(64),
        operationCount: 1,
      },
    },
    continuation: {
      snapshot: continuationSnapshot(),
      completeness: 'exact_single',
    },
  };
}

function invocation(): McpInvocation {
  return {
    invocationId: 'mcp-invocation-1',
    taskId: 'agent-task-1',
    capabilityAttemptId: 'capability-attempt-1',
    contextId: 'context-1',
    executionMode: 'simulation',
    simulationId: 'p05-no-device-write',
    serverId: 'provider-1',
    toolName: 'embodied.move',
    executionSemantics: {
      effect: 'side_effecting',
      execution: 'task_capable',
      cancellation: 'task_cancel',
      idempotency: 'client_request_key',
      replay: 'simulation_only',
      source: 'mcp_declared',
    },
    arguments: { target: { x: 1, y: 2 } },
    result: { remoteTask: receipt().remoteTask },
    status: 'succeeded',
    startedAt: dispatchedAt,
    completedAt: receiptAt,
    durationMs: 100,
  };
}

function intentRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    intent_id: 'remote-admission-intent-1',
    invocation_id: 'mcp-invocation-1',
    binding_id: 'remote-binding-1',
    task_id: 'agent-task-1',
    capability_attempt_id: 'capability-attempt-1',
    context_id: 'context-1',
    server_id: 'provider-1',
    operation_name: 'embodied.move',
    arguments_hash: 'a'.repeat(64),
    local_envelope_json: envelope(),
    status: 'prepared',
    dispatch_hash: null,
    dispatched_at: null,
    recorded_invocation_id: null,
    remote_receipt_json: null,
    receipt_recorded_at: null,
    materialized_binding_id: null,
    materialized_snapshot_id: null,
    materialized_at: null,
    reason_code: null,
    closed_at: null,
    created_at: preparedAt,
    updated_at: preparedAt,
    version: 1,
    ...overrides,
  };
}

function continuationSnapshot() {
  return {
    schemaVersion: '1.0' as const,
    snapshotId: 'workflow-snapshot-1',
    continuationId: 'workflow-continuation-1',
    stateVersion: 1,
    lifecycle: 'active' as const,
    agentTaskId: 'agent-task-1',
    contextId: 'context-1',
    workflowControlId: 'workflow-control-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowDefinitionHash: 'b'.repeat(64),
    inputHash: 'c'.repeat(64),
    workflowInstanceId: 'instance-1',
    input: {},
    waitingNodeRuns: [
      {
        waitId: 'remote-binding-1',
        kind: 'remote_task' as const,
        sourceId: 'remote-binding-1',
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
    executionContext: { mode: 'simulation' as const, simulationId: 'p05-no-device-write' },
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 1,
      maxMcpCalls: 2,
      maxCost: 1,
    },
    budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 0 },
    createdAt: receiptAt,
    updatedAt: receiptAt,
  };
}
