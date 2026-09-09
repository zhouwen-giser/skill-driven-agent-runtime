import { describe, expect, it, vi } from 'vitest';
import type {
  WorkflowChildCall,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import type { WorkflowChildCallRepository } from '../src/ports.js';
import type { WorkflowExecutionService } from '../src/workflow-execution.js';
import { SubworkflowExecutionService } from '../src/subworkflow-execution.js';

const timestamp = '2026-09-07T00:00:00.000Z';
const limits = {
  maxReplans: 1,
  maxDurationSeconds: 60,
  maxLlmCalls: 2,
  maxMcpCalls: 3,
  maxCost: 10,
};
const plan: WorkflowPlanRecord = {
  planId: 'child-plan',
  goalId: 'goal',
  goalVersion: 1,
  goalContract: {
    goalId: 'goal',
    version: 1,
    title: 'Document',
    description: 'Parse document',
    constraints: [],
    successCriteria: ['parsed'],
  },
  definition: {
    workflowDefinitionId: 'child',
    version: 1,
    goalId: 'goal',
    goalVersion: 1,
    entryNodeId: 'result',
    exitNodeIds: ['result'],
    nodes: [
      { nodeId: 'result', name: 'Result', type: 'result', value: { op: 'literal', value: true } },
    ],
    edges: [],
  },
  confirmationStatus: 'confirmed',
  attemptCount: 1,
  createdAt: timestamp,
};
const input = {
  workflowDefinitionId: 'child',
  workflowVersion: 1,
  parentInstanceId: 'parent',
  parentNodeId: 'call',
  parentNodeRunId: 'call-1',
  input: { document: 'example' },
  executionContext: { mode: 'live' as const },
};
function instance(instanceId: string, status: WorkflowInstance['status']): WorkflowInstance {
  return {
    instanceId,
    planId: 'child-plan',
    workflowDefinitionId: 'child',
    workflowVersion: 1,
    goalId: 'goal',
    goalVersion: 1,
    skillVersions: [],
    budgetLimits: limits,
    budgetUsage: { replanCount: 0, durationMs: 7, llmCalls: 1, mcpCalls: 1, cost: 2 },
    status,
    input: input.input,
    errors: {},
    startedAt: timestamp,
    ...(status === 'succeeded' ? { result: { parsed: true }, completedAt: timestamp } : {}),
    ...(status === 'paused'
      ? {
          pendingConfirmation: {
            nodeId: 'confirm',
            prompt: 'Review document',
            kind: 'human_confirmation' as const,
          },
        }
      : {}),
  };
}
function harness(status: WorkflowInstance['status'] = 'succeeded', executionTaskId?: string) {
  const links = new Map<string, WorkflowChildCall>();
  const instances = new Map<string, WorkflowInstance>([['parent', instance('parent', 'running')]]);
  const calls: WorkflowChildCallRepository = {
    save: (link) => {
      links.set(link.parentNodeRunId, link);
      return Promise.resolve(link);
    },
    find: (_parent, run) => Promise.resolve(links.get(run)),
    findByChildInstanceId: (id) =>
      Promise.resolve([...links.values()].find((link) => link.childInstanceId === id)),
    listByParent: () => Promise.resolve([...links.values()]),
  };
  const execute = vi.fn(async (request: Parameters<WorkflowExecutionService['execute']>[0]) => {
    const started = instance(request.instanceId, 'running');
    instances.set(started.instanceId, started);
    await request.onStarted?.(started);
    const result = instance(started.instanceId, status);
    instances.set(result.instanceId, result);
    return result;
  });
  const resume = vi.fn(
    (request: Parameters<WorkflowExecutionService['resumeHumanConfirmation']>[0]) => {
      const result = instance(request.instanceId, request.confirmed ? 'succeeded' : 'canceled');
      instances.set(result.instanceId, result);
      return Promise.resolve(result);
    },
  );
  const savedPlans = new Map<string, WorkflowPlanRecord>();
  const savePlan = vi.fn((value: WorkflowPlanRecord) => {
    savedPlans.set(value.planId, value);
    return Promise.resolve();
  });
  const service = new SubworkflowExecutionService({
    calls,
    plans: {
      findPlan: (id) =>
        Promise.resolve(
          savedPlans.get(id) ??
            (id === plan.planId
              ? { ...plan, ...(executionTaskId === undefined ? {} : { executionTaskId }) }
              : undefined),
        ),
      savePlan,
      findConfirmedDefinition: () => Promise.resolve(plan),
    },
    execution: {
      execute,
      get: (id) => Promise.resolve(instances.get(id)),
      resumeHumanConfirmation: resume,
    },
    clock: { now: () => timestamp },
  });
  return { service, execute, resume, calls, instances, savePlan, savedPlans };
}

describe('persistent ordinary subworkflows', () => {
  it('materializes a Task-owned child plan without changing its confirmed definition', async () => {
    const h = harness('succeeded', 'task-a');
    await h.service.execute(input);
    const saved = h.savePlan.mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      executionTaskId: 'task-a',
      sourceConfirmedPlanId: plan.planId,
      definition: plan.definition,
    });
    expect(saved?.planId).not.toBe(plan.planId);
    expect(plan.executionTaskId).toBeUndefined();
    await h.service.execute(input);
    expect(h.savePlan).toHaveBeenCalledOnce();
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('deduplicates one node run, creates the next loop child, and preserves caller context', async () => {
    const h = harness();
    const signal = new AbortController().signal;
    const request = { ...input, signal };
    expect(await Promise.all([h.service.execute(request), h.service.execute(request)])).toEqual([
      { status: 'completed', output: { parsed: true } },
      { status: 'completed', output: { parsed: true } },
    ]);
    await h.service.execute(request);
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0]?.[0]).toMatchObject({
      signal,
      executionContext: input.executionContext,
    });
    await h.service.execute({ ...request, parentNodeRunId: 'call-2' });
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(
      new Set((await h.calls.listByParent('parent')).map((link) => link.childInstanceId)).size,
    ).toBe(2);
  });
  it('retains the paused instance and resumes it without executing a replacement', async () => {
    const h = harness('paused');
    const paused = await h.service.execute(input);
    expect(paused).toMatchObject({ status: 'paused', prompt: 'Review document' });
    expect(await h.service.execute({ ...input, resumeChild: true })).toEqual({
      status: 'completed',
      output: { parsed: true },
    });
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.resume).toHaveBeenCalledTimes(1);
    expect(h.resume.mock.calls[0]?.[0].instanceId).toBe(
      (await h.calls.find('parent', 'call-1'))?.childInstanceId,
    );
  });
  it.each(['waiting_external', 'failed', 'canceled', 'running'] as const)(
    'does not report %s as successful output',
    async (status) => {
      const h = harness(status);
      expect(await h.service.execute(input)).toMatchObject({
        status: status === 'running' ? 'failed' : status,
      });
      await h.service.execute(input);
      expect(h.execute).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects changed input and missing persistent child state without replay', async () => {
    const h = harness();
    await h.service.execute(input);
    await expect(h.service.execute({ ...input, input: { document: 'changed' } })).rejects.toThrow(
      'WORKFLOW_CHILD_CALL_INPUT_CONFLICT',
    );
    const link = await h.calls.find('parent', 'call-1');
    if (link?.childInstanceId === undefined) throw new Error('Missing link');
    h.instances.delete(link.childInstanceId);
    await expect(h.service.execute(input)).rejects.toThrow('WORKFLOW_CHILD_STATE_UNAVAILABLE');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects pre-canceled calls before creating a child', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort(new Error('parent canceled'));
    await expect(h.service.execute({ ...input, signal: controller.signal })).rejects.toThrow(
      'parent canceled',
    );
    expect(h.execute).not.toHaveBeenCalled();
    expect(await h.calls.listByParent('parent')).toEqual([]);
  });
});
