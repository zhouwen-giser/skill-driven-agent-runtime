import { describe, expect, it } from 'vitest';

import {
  assertWorkflowContinuationSuccessor,
  createWorkflowContinuationAttempt,
  createWorkflowContinuationSnapshot,
  MAX_WORKFLOW_CONTINUATION_JSON_BYTES,
  transitionWorkflowContinuationAttempt,
  transitionWorkflowContinuationLifecycle,
  type WorkflowContinuationSnapshot,
} from '../src/index.js';

const timestamp = '2026-07-16T08:00:00.000Z';
const laterTimestamp = '2026-07-16T08:00:01.000Z';
const hash = 'a'.repeat(64);

describe('Workflow continuation domain', () => {
  it('snapshots a bounded external-wait frontier and freezes nested state', () => {
    const snapshot = createWorkflowContinuationSnapshot(snapshotInput());

    expect(snapshot).toMatchObject({
      schemaVersion: '1.0',
      lifecycle: 'building',
      stateVersion: 1,
      waitingNodeRuns: [
        {
          waitId: 'wait-1',
          kind: 'remote_task',
          sourceId: 'binding-1',
          nodeId: 'remote-node',
          nodeRunId: 'instance-1~remote-node~1',
          state: 'waiting',
        },
      ],
      runnableFrontier: [{ nodeId: 'other-branch', nextRunOrdinal: 1 }],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs)).toBe(true);
    expect(Object.isFrozen(snapshot.outputs['completed-node'])).toBe(true);
    expect(Object.isFrozen(snapshot.parallelJoinState[0]?.arrivals)).toBe(true);
  });

  it('requires stable hashes, finite JSON and an aggregate byte bound', () => {
    expect(() =>
      createWorkflowContinuationSnapshot({ ...snapshotInput(), schemaVersion: '2.0' }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_VERSION_INVALID' }));
    expect(() =>
      createWorkflowContinuationSnapshot({
        ...snapshotInput(),
        workflowDefinitionHash: 'not-a-hash',
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_HASH_INVALID' }));
    expect(() =>
      createWorkflowContinuationSnapshot({
        ...snapshotInput(),
        outputs: { invalid: Number.POSITIVE_INFINITY },
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_JSON_INVALID' }));
    expect(() =>
      createWorkflowContinuationSnapshot({
        ...snapshotInput(),
        outputs: { oversized: 'x'.repeat(MAX_WORKFLOW_CONTINUATION_JSON_BYTES) },
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_JSON_TOO_LARGE' }));

    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() =>
      createWorkflowContinuationSnapshot({ ...snapshotInput(), outputs: cyclic }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_JSON_INVALID' }));
  });

  it('rejects aliased node runs, invalid frontier ordinals and incomplete join evidence', () => {
    expect(() =>
      createWorkflowContinuationSnapshot({
        ...snapshotInput(),
        completedNodeRunIds: ['instance-1~remote-node~1', 'instance-1~branch-a~1'],
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_STATE_INVALID' }));
    expect(() =>
      createWorkflowContinuationSnapshot({
        ...snapshotInput(),
        runnableFrontier: [{ nodeId: 'other-branch', nextRunOrdinal: 2 }],
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_STATE_INVALID' }));
    expect(() =>
      createWorkflowContinuationSnapshot({
        ...snapshotInput(),
        parallelJoinState: [
          {
            joinKey: 'join-1@loop-1',
            joinNodeId: 'join-1',
            requiredPredecessorNodeIds: ['branch-a', 'branch-b'],
            arrivals: [
              {
                predecessorNodeId: 'branch-b',
                predecessorNodeRunId: 'not-completed',
              },
            ],
          },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_STATE_INVALID' }));
  });

  it('enforces initial/successor versions and one-way lifecycle transitions', () => {
    const initial = createWorkflowContinuationSnapshot(snapshotInput());
    const active = transitionWorkflowContinuationLifecycle(initial, 'active', laterTimestamp);
    expect(active.lifecycle).toBe('active');
    expect(() =>
      transitionWorkflowContinuationLifecycle(active, 'building', laterTimestamp),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_TRANSITION_INVALID' }));

    const successor = createWorkflowContinuationSnapshot({
      ...snapshotInput(),
      snapshotId: 'snapshot-2',
      stateVersion: 2,
      predecessorSnapshotId: initial.snapshotId,
    });
    expect(() => {
      assertWorkflowContinuationSuccessor(initial, successor);
    }).not.toThrow();
    expect(() => {
      assertWorkflowContinuationSuccessor(initial, {
        ...successor,
        stateVersion: 3,
      });
    }).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_VERSION_INVALID' }));
  });

  it('enforces claimed/running/terminal attempt evidence without replay transitions', () => {
    const claimed = createWorkflowContinuationAttempt({
      attemptId: 'attempt-1',
      eventId: 'event-1',
      snapshotId: 'snapshot-1',
      continuationId: 'continuation-1',
      workflowInstanceId: 'instance-1',
      snapshotStateVersion: 1,
      claimToken: 'claim-1',
      status: 'claimed',
      createdAt: timestamp,
    });
    const running = transitionWorkflowContinuationAttempt(claimed, 'running', laterTimestamp);
    const failed = transitionWorkflowContinuationAttempt(
      running,
      'failed',
      '2026-07-16T08:00:02.000Z',
      'PROCESS_EXECUTION_LOST',
    );
    expect(failed).toMatchObject({
      status: 'failed',
      startedAt: laterTimestamp,
      completedAt: '2026-07-16T08:00:02.000Z',
      errorCode: 'PROCESS_EXECUTION_LOST',
    });
    expect(() => transitionWorkflowContinuationAttempt(failed, 'running', laterTimestamp)).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_TRANSITION_INVALID' }),
    );
    expect(() =>
      createWorkflowContinuationAttempt({
        ...claimed,
        status: 'failed',
        completedAt: laterTimestamp,
      }),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_CONTINUATION_ATTEMPT_INVALID' }));
  });
});

function snapshotInput(): WorkflowContinuationSnapshot {
  return {
    schemaVersion: '1.0',
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    stateVersion: 1,
    lifecycle: 'building',
    agentTaskId: 'task-1',
    contextId: 'context-1',
    workflowControlId: 'control-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'plan-1',
    workflowDefinitionId: 'definition-1',
    workflowDefinitionVersion: 1,
    workflowDefinitionHash: hash,
    inputHash: hash,
    workflowInstanceId: 'instance-1',
    input: { request: 'continue' },
    waitingNodeRuns: [
      {
        waitId: 'wait-1',
        kind: 'remote_task',
        sourceId: 'binding-1',
        nodeId: 'remote-node',
        nodeRunId: 'instance-1~remote-node~1',
        state: 'waiting',
      },
    ],
    runnableFrontier: [{ nodeId: 'other-branch', nextRunOrdinal: 1 }],
    completedNodeRunIds: ['instance-1~branch-a~1'],
    nodeRunCounts: { 'branch-a': 1 },
    outputs: { 'completed-node': { ok: true } },
    errors: {},
    routes: { 'branch-a': 'join-1' },
    loopCounts: {},
    recoveryCounts: {},
    parallelJoinState: [
      {
        joinKey: 'join-1@root',
        joinNodeId: 'join-1',
        requiredPredecessorNodeIds: ['branch-a', 'branch-b'],
        arrivals: [
          {
            predecessorNodeId: 'branch-a',
            predecessorNodeRunId: 'instance-1~branch-a~1',
          },
        ],
      },
    ],
    failed: false,
    executionContext: { mode: 'live' },
    budgetLimits: {
      maxReplans: 3,
      maxDurationSeconds: 300,
      maxLlmCalls: 20,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount: 0, durationMs: 100, llmCalls: 1, mcpCalls: 1, cost: 2 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
