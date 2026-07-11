import { describe, expect, it, vi } from 'vitest';

import type {
  WorkflowInstance,
  WorkflowNodeEvent,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import type {
  WorkflowExecutionRepository,
  WorkflowExecutor,
  WorkflowPlanRepository,
  SkillRepository,
} from '../src/ports.js';
import { WorkflowExecutionService } from '../src/workflow-execution.js';
import { WorkflowValidator } from '../src/workflow-validator.js';

const validPlan: WorkflowPlanRecord = {
  planId: 'plan-1',
  goalId: 'goal-1',
  goalVersion: 1,
  definition: {
    workflowDefinitionId: 'workflow-1',
    version: 2,
    goalId: 'goal-1',
    goalVersion: 1,
    entryNodeId: 'result',
    exitNodeIds: ['result'],
    nodes: [
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result',
        value: { op: 'literal', value: 'done' },
      },
    ],
    edges: [],
  },
  sourceConfirmedPlanId: 'plan-source',
  confirmationStatus: 'confirmed',
  attemptCount: 2,
  createdAt: '2026-07-12T00:00:00.000Z',
};

describe('Workflow execution application service', () => {
  it('executes a repository-confirmed corrected plan without another confirmation', async () => {
    const plans = new MemoryPlans([validPlan]);
    const instances = new MemoryExecutions();
    const execute = vi.fn().mockResolvedValue({
      status: 'succeeded',
      result: 'done',
      errors: {},
      budgetUsage: { replanCount: 0, durationMs: 2, llmCalls: 0, mcpCalls: 0, cost: 0 },
      events: [
        {
          nodeId: 'result',
          type: 'node_started',
          timestamp: '2026-07-12T00:00:01.000Z',
          summary: 'result node started.',
        },
        {
          nodeId: 'result',
          type: 'node_succeeded',
          timestamp: '2026-07-12T00:00:02.000Z',
          summary: 'result node succeeded.',
        },
      ],
    });
    const executor: WorkflowExecutor = { execute };
    const service = createService(plans, instances, executor);

    await expect(
      service.execute({ instanceId: 'instance-1', planId: 'plan-1', input: { x: 1 } }),
    ).resolves.toMatchObject({ status: 'succeeded', result: 'done' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(instances.instances.map((instance) => instance.status)).toEqual([
      'running',
      'succeeded',
    ]);
    expect(instances.events).toMatchObject([
      { sequence: 1, nodeId: 'result', eventType: 'node_started' },
      { sequence: 2, nodeId: 'result', eventType: 'node_succeeded' },
    ]);
  });

  it('blocks an unconfirmed plan before executor invocation', async () => {
    const plans = new MemoryPlans([
      { ...validPlan, planId: 'unconfirmed', confirmationStatus: 'awaiting_confirmation' },
    ]);
    const execute = vi.fn();
    const executor: WorkflowExecutor = { execute };
    const service = createService(plans, new MemoryExecutions(), executor);

    await expect(
      service.execute({ instanceId: 'instance-2', planId: 'unconfirmed', input: {} }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_PLAN_NOT_CONFIRMED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('persists a failed terminal instance when the runtime throws', async () => {
    const instances = new MemoryExecutions();
    const executor: WorkflowExecutor = {
      execute: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('node exploded'), { code: 'NODE_EXPLODED' })),
    };
    const service = createService(new MemoryPlans([validPlan]), instances, executor);

    await expect(
      service.execute({ instanceId: 'instance-3', planId: 'plan-1', input: {} }),
    ).rejects.toThrow('node exploded');
    expect(instances.instances.at(-1)).toMatchObject({
      status: 'failed',
      errors: { runtime: { code: 'NODE_EXPLODED', message: 'node exploded' } },
    });
  });

  it('persists an interrupt and resumes the same instance without replaying earlier events', async () => {
    const instances = new MemoryExecutions();
    const execute = vi.fn().mockResolvedValue({
      status: 'paused',
      errors: {},
      budgetUsage: { replanCount: 0, durationMs: 4, llmCalls: 0, mcpCalls: 1, cost: 1 },
      pendingConfirmation: { nodeId: 'confirm', prompt: 'Continue?' },
      events: [
        {
          nodeId: 'tool',
          type: 'node_succeeded',
          timestamp: '2026-07-12T00:00:01.000Z',
          summary: 'mcp_tool node succeeded.',
        },
      ],
    });
    const resumeHumanConfirmation = vi.fn().mockResolvedValue({
      status: 'succeeded',
      result: 'done',
      errors: {},
      budgetUsage: { replanCount: 0, durationMs: 8, llmCalls: 0, mcpCalls: 1, cost: 1 },
      events: [
        {
          nodeId: 'confirm',
          type: 'node_succeeded',
          timestamp: '2026-07-12T00:00:02.000Z',
          summary: 'human_confirmation node succeeded.',
        },
      ],
    });
    const service = createService(new MemoryPlans([validPlan]), instances, {
      execute,
      resumeHumanConfirmation,
    });

    await expect(
      service.execute({ instanceId: 'instance-paused', planId: 'plan-1', input: {} }),
    ).resolves.toMatchObject({
      status: 'paused',
      pendingConfirmation: { nodeId: 'confirm', prompt: 'Continue?' },
    });
    await expect(
      service.resumeHumanConfirmation({ instanceId: 'instance-paused', confirmed: true }),
    ).resolves.toMatchObject({ status: 'succeeded', result: 'done' });
    expect(resumeHumanConfirmation).toHaveBeenCalledWith('instance-paused', true, undefined);
    expect(instances.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('resolves and persists the current Skill budget override before execution', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'failed',
      errors: { budget: { code: 'WORKFLOW_MCP_CALL_BUDGET_EXHAUSTED', message: 'exhausted' } },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      terminationReason: 'mcp_calls_exhausted',
      events: [],
    });
    const tightSkill = {
      skillId: 'skill-tight',
      version: 4,
      name: 'Tight',
      summary: 'Tight',
      description: 'Tight budget Skill.',
      capabilities: [],
      workflowGuidance: '',
      outputInstruction: '',
      inputSchema: true,
      outputSchema: true,
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false, maxMcpCalls: 0, maxCost: 5 },
      status: 'enabled' as const,
      sourceKind: 'admin' as const,
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const skills = {
      ...disabledSkills,
      findCurrentVersion: (id: string) =>
        Promise.resolve(id === tightSkill.skillId ? tightSkill : undefined),
    };
    const instances = new MemoryExecutions();
    const service = createService(new MemoryPlans([validPlan]), instances, { execute }, skills);

    await expect(
      service.execute({
        instanceId: 'instance-budget',
        planId: 'plan-1',
        input: {},
        skillIds: ['skill-tight'],
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      skillVersions: [{ skillId: 'skill-tight', version: 4 }],
      budgetLimits: { maxMcpCalls: 0, maxCost: 5 },
      terminationReason: 'mcp_calls_exhausted',
    });
    expect(execute).toHaveBeenCalledWith(
      validPlan.definition,
      {},
      expect.objectContaining({ maxMcpCalls: 0, maxCost: 5 }),
      undefined,
      'instance-budget',
    );
  });
});

function createService(
  plans: WorkflowPlanRepository,
  instances: WorkflowExecutionRepository,
  executor: WorkflowExecutor,
  skills: SkillRepository = disabledSkills,
) {
  let time = 0;
  let event = 0;
  return new WorkflowExecutionService({
    plans,
    instances,
    executor,
    validator: new WorkflowValidator({
      tools: {
        exists: () => Promise.resolve(false),
        getInputSchema: () => Promise.resolve(undefined),
      },
      skills: disabledSkills,
      schemas: {
        checkSchema: () => ({ valid: true, errors: [] }),
        validate: () => ({ valid: true, errors: [] }),
      },
    }),
    clock: { now: () => `2026-07-12T00:00:0${String(time++)}.000Z` },
    ids: { nextEventId: () => `event-${String(++event)}` },
    skills,
    systemBudgetDefaults: {
      maxReplans: 3,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
  });
}

const disabledSkills: SkillRepository = {
  find: () => Promise.resolve(undefined),
  findCurrentVersion: () => Promise.resolve(undefined),
  findVersion: () => Promise.resolve(undefined),
  listVersions: () => Promise.resolve([]),
  listEnabledVersions: () => Promise.resolve([]),
  listCurrentVersions: () => Promise.resolve([]),
  saveVersionAndSetCurrent: () => Promise.resolve(),
};

class MemoryPlans implements WorkflowPlanRepository {
  readonly plans: Map<string, WorkflowPlanRecord>;
  constructor(plans: readonly WorkflowPlanRecord[]) {
    this.plans = new Map(plans.map((plan) => [plan.planId, plan]));
  }
  findPlan(id: string) {
    return Promise.resolve(this.plans.get(id));
  }
  findConfirmedDefinition(id: string, version: number) {
    return Promise.resolve(
      [...this.plans.values()].find(
        (plan) =>
          plan.confirmationStatus === 'confirmed' &&
          plan.definition?.workflowDefinitionId === id &&
          plan.definition.version === version,
      ),
    );
  }
  confirmPlan(id: string) {
    const plan = this.plans.get(id);
    if (plan !== undefined) this.plans.set(id, { ...plan, confirmationStatus: 'confirmed' });
    return Promise.resolve();
  }
  saveAttempt() {
    return Promise.resolve();
  }
  savePlan(plan: WorkflowPlanRecord) {
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }
  savePlanAndSupersede(plan: WorkflowPlanRecord, sourcePlanId: string) {
    const source = this.plans.get(sourcePlanId);
    if (source !== undefined)
      this.plans.set(sourcePlanId, { ...source, confirmationStatus: 'superseded' });
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }
}

class MemoryExecutions implements WorkflowExecutionRepository {
  readonly instances: WorkflowInstance[] = [];
  readonly events: WorkflowNodeEvent[] = [];
  findInstance(id: string) {
    return Promise.resolve(
      [...this.instances].reverse().find((instance) => instance.instanceId === id),
    );
  }
  countNodeEvents(instanceId: string) {
    return Promise.resolve(this.events.filter((event) => event.instanceId === instanceId).length);
  }
  saveInstance(instance: WorkflowInstance) {
    this.instances.push(instance);
    return Promise.resolve();
  }
  saveNodeEvents(events: readonly WorkflowNodeEvent[]) {
    this.events.push(...events);
    return Promise.resolve();
  }
}
