import { describe, expect, it, vi } from 'vitest';

import { continueRemoteTaskWorkflowHierarchy } from '../src/remote-task-workflow-hierarchy.js';
import type {
  WorkflowContinuationSnapshot,
  WorkflowControlRecord,
  WorkflowInstance,
} from '../../../packages/domain/src/index.js';

describe('continueRemoteTaskWorkflowHierarchy', () => {
  it('does not treat a round persisted before its control transition as completed re-entry', async () => {
    const continueAfterExternal = vi.fn();
    const projectControl = vi.fn();

    await expect(
      continueRemoteTaskWorkflowHierarchy(
        {
          skillCallWorkflows: { findByChildInstanceId: () => Promise.resolve(undefined) },
          skillCallWorkflow: {
            completeExternalChild: () => Promise.reject(new Error('UNUSED_CHILD')),
          },
          continuations: {
            findCurrent: () => Promise.resolve(undefined),
            findLatestForWait: () => Promise.resolve(undefined),
          },
          execution: {
            get: () => Promise.resolve(undefined),
            continueExternal: () => Promise.reject(new Error('UNUSED_CONTINUATION')),
          },
          controller: {
            get: () => Promise.resolve(control()),
            listRounds: () =>
              Promise.resolve([
                {
                  controlId: 'control-1',
                  roundIndex: 0,
                  planId: 'plan-1',
                  instanceId: 'instance-1',
                  workflowVersion: 1,
                  evaluation: { decision: 'adjust_plan', summary: 'Round persisted.' },
                  createdAt: timestamp,
                },
              ]),
            continueAfterExternal,
          },
          recordRootResume: () => Promise.resolve(),
          projectControl,
        },
        {
          snapshot: snapshot(),
          instance: instance(),
          continuationAttemptId: 'attempt-1',
        },
      ),
    ).rejects.toThrow('WORKFLOW_CONTROL_EXTERNAL_REENTRY_CONFLICT');

    expect(continueAfterExternal).not.toHaveBeenCalled();
    expect(projectControl).not.toHaveBeenCalled();
  });
});

const timestamp = '2026-08-13T00:00:00.000Z';

function control(): WorkflowControlRecord {
  return {
    controlId: 'control-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    status: 'awaiting_confirmation',
    currentPlanId: 'plan-1',
    input: {},
    skillIds: [],
    planningInstruction: 'Test recovery.',
    roundCount: 0,
    replanCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function instance(): WorkflowInstance {
  return {
    instanceId: 'instance-1',
    planId: 'plan-1',
    workflowDefinitionId: 'workflow-1',
    workflowVersion: 1,
    goalId: 'goal-1',
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 1,
      maxMcpCalls: 1,
      maxCost: 1,
    },
    budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 1, cost: 1 },
    status: 'succeeded',
    input: {},
    result: { ok: true },
    errors: {},
    startedAt: timestamp,
    completedAt: timestamp,
  };
}

function snapshot(): WorkflowContinuationSnapshot {
  return {
    schemaVersion: '1.0',
    snapshotId: 'snapshot-1',
    continuationId: 'continuation-1',
    stateVersion: 1,
    lifecycle: 'terminal',
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
    input: {},
    waitingNodeRuns: [],
    runnableFrontier: [],
    completedNodeRunIds: [],
    nodeRunCounts: {},
    outputs: {},
    errors: {},
    routes: {},
    loopCounts: {},
    recoveryCounts: {},
    parallelJoinState: [],
    result: { ok: true },
    failed: false,
    executionContext: { mode: 'live' },
    budgetLimits: instance().budgetLimits,
    budgetUsage: instance().budgetUsage,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
