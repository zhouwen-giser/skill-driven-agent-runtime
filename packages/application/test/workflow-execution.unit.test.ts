import { describe, expect, it, vi } from 'vitest';

import type {
  WorkflowInstance,
  WorkflowNodeEvent,
  WorkflowPlanRecord,
  WorkflowContinuationSnapshot,
  WorkflowContinuationAttempt,
  WorkflowContinuationAttemptStatus,
  WorkflowContinuationLifecycle,
  RemoteTaskControlEvent,
} from '../../domain/src/index.js';
import { transitionWorkflowContinuationLifecycle } from '../../domain/src/index.js';
import type {
  WorkflowExecutionRepository,
  WorkflowExternalWaitPreparedSnapshot,
  WorkflowExecutor,
  WorkflowPlanRepository,
  SkillRepository,
  WorkflowContinuationRepository,
} from '../src/ports.js';
import { WorkflowExecutionService } from '../src/workflow-execution.js';
import { WorkflowValidator } from '../src/workflow-validator.js';

const validPlan: WorkflowPlanRecord = {
  planId: 'plan-1',
  goalId: 'goal-1',
  goalVersion: 1,
  goalContract: {
    goalId: 'goal-1',
    version: 1,
    title: 'Execute workflow',
    description: 'Execute the validated Workflow.',
    constraints: [],
    successCriteria: ['done'],
  },
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
  it('rejects a plan whose Goal contract does not match its execution identity', async () => {
    const stale = {
      ...validPlan,
      goalContract: { ...validPlan.goalContract, version: 2 },
    };
    const service = createService(new MemoryPlans([stale]), new MemoryExecutions(), {
      execute: vi.fn(),
    });
    await expect(service.confirm(stale.planId)).rejects.toMatchObject({
      code: 'WORKFLOW_GOAL_CONTRACT_MISMATCH',
    });
  });

  it('persists the confirmation timestamp and triggering Task identity', async () => {
    const awaiting = { ...validPlan, confirmationStatus: 'awaiting_confirmation' as const };
    const plans = new MemoryPlans([awaiting]);
    const service = createService(plans, new MemoryExecutions(), { execute: vi.fn() });

    await expect(service.confirm(awaiting.planId, 'task-confirmation')).resolves.toMatchObject({
      planId: awaiting.planId,
      confirmationStatus: 'confirmed',
      confirmationTaskId: 'task-confirmation',
      confirmedAt: '2026-07-12T00:00:00.000Z',
    });
    await expect(plans.findPlan(awaiting.planId)).resolves.toMatchObject({
      confirmationTaskId: 'task-confirmation',
      confirmedAt: '2026-07-12T00:00:00.000Z',
    });
  });

  it('rejects a stale confirmation after the immutable plan was superseded', async () => {
    const superseded = { ...validPlan, confirmationStatus: 'superseded' as const };
    const plans = new MemoryPlans([superseded]);
    const service = createService(plans, new MemoryExecutions(), { execute: vi.fn() });

    await expect(service.confirm(superseded.planId, 'task-stale')).rejects.toMatchObject({
      code: 'WORKFLOW_PLAN_NOT_EXECUTABLE',
    });
    await expect(plans.findPlan(superseded.planId)).resolves.toMatchObject({
      confirmationStatus: 'superseded',
    });
  });

  it('returns the authoritative instance with ordered displayable node events', async () => {
    const instances = new MemoryExecutions();
    const instance: WorkflowInstance = {
      instanceId: 'instance-trace',
      planId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowVersion: 2,
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
      budgetUsage: { replanCount: 0, durationMs: 2, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'succeeded',
      input: {},
      result: 'done',
      errors: {},
      startedAt: '2026-07-13T00:00:00.000Z',
      completedAt: '2026-07-13T00:00:02.000Z',
    };
    await instances.saveInstance(instance);
    await instances.saveNodeEvents([
      {
        eventId: 'event-1',
        instanceId: instance.instanceId,
        sequence: 1,
        nodeId: 'result',
        eventType: 'node_started',
        timestamp: instance.startedAt,
        summary: 'result started.',
      },
      {
        eventId: 'event-2',
        instanceId: instance.instanceId,
        sequence: 2,
        nodeId: 'result',
        eventType: 'node_succeeded',
        timestamp: '2026-07-13T00:00:02.000Z',
        durationMs: 2000,
        summary: 'result succeeded.',
      },
    ]);
    const service = createService(new MemoryPlans([validPlan]), instances, { execute: vi.fn() });
    await expect(service.trace(instance.instanceId)).resolves.toEqual({
      instance,
      events: instances.events,
    });
    await expect(service.traceForPlan(instance.planId)).resolves.toEqual({
      instance,
      events: instances.events,
    });
  });

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
          durationMs: 1000,
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
      { sequence: 2, nodeId: 'result', eventType: 'node_succeeded', durationMs: 1000 },
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
    expect(resumeHumanConfirmation).toHaveBeenCalledWith(
      'instance-paused',
      true,
      undefined,
      expect.any(Function),
    );
    expect(instances.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('activates a durable external continuation reached immediately after confirmation resume', async () => {
    const instances = new MemoryExecutions();
    const continuations = new MemoryContinuations();
    const budgetUsage = {
      replanCount: 0,
      durationMs: 8,
      llmCalls: 0,
      mcpCalls: 1,
      cost: 1,
    };
    const execute = vi.fn().mockResolvedValue({
      status: 'paused',
      errors: {},
      budgetUsage,
      pendingConfirmation: { nodeId: 'confirm', prompt: 'Continue?' },
      events: [],
    });
    const resumeHumanConfirmation = vi.fn().mockResolvedValue({
      status: 'waiting_external',
      errors: {},
      budgetUsage,
      events: [],
      continuation: {
        input: { request: 'after-confirmation' },
        waitingNodeRuns: [
          {
            waitId: 'wait-after-confirmation',
            kind: 'remote_task',
            sourceId: 'binding-after-confirmation',
            nodeId: 'remote',
            nodeRunId: 'instance-confirm-remote~remote~1',
            state: 'waiting',
          },
        ],
        runnableFrontier: [],
        completedNodeRunIds: ['instance-confirm-remote~confirm~1'],
        nodeRunCounts: { confirm: 1, remote: 1 },
        outputs: { confirm: true },
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
        budgetUsage,
      },
    });
    const service = createService(
      new MemoryPlans([validPlan]),
      instances,
      { execute, resumeHumanConfirmation },
      disabledSkills,
      undefined,
      continuations,
    );
    await service.execute({
      instanceId: 'instance-confirm-remote',
      planId: validPlan.planId,
      input: { request: 'after-confirmation' },
    });

    await expect(
      service.resumeHumanConfirmation({
        instanceId: 'instance-confirm-remote',
        confirmed: true,
        continuationAuthority: {
          agentTaskId: 'task-confirm-remote',
          contextId: 'context-confirm-remote',
          workflowControlId: 'control-confirm-remote',
        },
      }),
    ).resolves.toMatchObject({ status: 'waiting_external' });
    expect(continuations.snapshots).toHaveLength(1);
    expect(continuations.snapshots[0]).toMatchObject({
      lifecycle: 'active',
      agentTaskId: 'task-confirm-remote',
      workflowInstanceId: 'instance-confirm-remote',
    });
    expect(instances.instances.at(-1)).not.toHaveProperty('completedAt');
  });

  it('returns a fresh pause checkpoint without waiting for a terminal instance', async () => {
    const instances = new MemoryExecutions();
    const execute = vi.fn().mockResolvedValue({
      status: 'paused',
      errors: {},
      budgetUsage: { replanCount: 0, durationMs: 4, llmCalls: 0, mcpCalls: 0, cost: 1 },
      pendingConfirmation: {
        nodeId: 'child',
        prompt: 'Confirm child v2.',
        kind: 'skill_confirmation',
        parentPlanId: 'plan-1',
        childPlanId: 'plan-child-v2',
        childSkillId: 'skill.child',
        childSkillVersion: 2,
      },
      events: [],
    });
    const service = createService(new MemoryPlans([validPlan]), instances, { execute });
    const first = await service.execute({
      instanceId: 'instance-multi-pause',
      planId: 'plan-1',
      input: {},
    });
    await instances.saveInstance({
      ...first,
      pendingConfirmation: {
        ...first.pendingConfirmation,
        nodeId: 'child',
        prompt: 'Confirm child v3.',
        kind: 'skill_confirmation',
        childPlanId: 'plan-child-v3',
        childSkillVersion: 3,
      },
    });

    await expect(
      service.waitForPauseResolution(first.instanceId, first.pendingConfirmation),
    ).resolves.toMatchObject({
      status: 'paused',
      pendingConfirmation: { childPlanId: 'plan-child-v3', childSkillVersion: 3 },
    });
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
        executionContext: { mode: 'simulation', simulationId: 'simulation-budget-1' },
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
      { mode: 'simulation', simulationId: 'simulation-budget-1' },
      expect.any(Function),
    );
  });

  it('rejects a confirmed plan before execution when a selected Skill required Tool is missing', async () => {
    const execute = vi.fn();
    const policySkill = {
      skillId: 'skill-policy',
      version: 2,
      name: 'Policy',
      summary: 'Policy',
      description: 'Required Tool policy.',
      capabilities: [],
      workflowGuidance: '',
      outputInstruction: '',
      inputSchema: true,
      outputSchema: true,
      toolPolicy: {
        required: [{ serverId: 'mcp.device', toolName: 'read' }],
        optional: [],
        forbidden: [],
      },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled' as const,
      sourceKind: 'admin' as const,
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const service = createService(
      new MemoryPlans([validPlan]),
      new MemoryExecutions(),
      { execute },
      {
        ...disabledSkills,
        findCurrentVersion: () => Promise.resolve(policySkill),
      },
    );

    await expect(
      service.execute({
        instanceId: 'instance-policy',
        planId: validPlan.planId,
        input: {},
        skillIds: [policySkill.skillId],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_SKILL_TOOL_POLICY_VIOLATION' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('defers a referenced child Skill Tool policy to its independently executed child Workflow', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'succeeded',
      result: { status: 'online' },
      errors: {},
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      events: [],
    });
    const childSkill = {
      skillId: 'skill-child-policy',
      version: 2,
      name: 'Child policy',
      summary: 'Child policy',
      description: 'Child policy.',
      capabilities: [],
      workflowGuidance: '',
      outputInstruction: '',
      inputSchema: true,
      outputSchema: true,
      toolPolicy: {
        required: [{ serverId: 'mcp.device', toolName: 'read' }],
        optional: [],
        forbidden: [],
      },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled' as const,
      sourceKind: 'admin' as const,
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const childPlan: WorkflowPlanRecord = {
      ...validPlan,
      planId: 'plan-parent-child-policy',
      definition: {
        workflowDefinitionId: 'workflow-parent-child-policy',
        version: 1,
        goalId: validPlan.goalId,
        goalVersion: validPlan.goalVersion,
        entryNodeId: 'child',
        exitNodeIds: ['child'],
        nodes: [
          {
            nodeId: 'child',
            name: 'Child',
            type: 'skill_call',
            skillId: childSkill.skillId,
            input: {},
          },
        ],
        edges: [],
      },
    };
    const skills: SkillRepository = {
      ...disabledSkills,
      findCurrentVersion: (skillId) =>
        Promise.resolve(skillId === childSkill.skillId ? childSkill : undefined),
    };
    const service = createService(
      new MemoryPlans([childPlan]),
      new MemoryExecutions(),
      { execute },
      skills,
    );

    await expect(
      service.execute({
        instanceId: 'instance-parent-child-policy',
        planId: childPlan.planId,
        input: {},
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      skillVersions: [{ skillId: childSkill.skillId, version: childSkill.version }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('requires replanning after the resolved Skill pause threshold is exceeded', async () => {
    const instances = new MemoryExecutions();
    instances.instances.push({
      instanceId: 'instance-long-pause',
      planId: validPlan.planId,
      workflowDefinitionId: 'workflow-1',
      workflowVersion: 2,
      goalId: 'goal-1',
      goalVersion: 1,
      skillVersions: [{ skillId: 'skill-threshold', version: 1 }],
      budgetLimits: {
        maxReplans: 3,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'paused',
      input: {},
      errors: {},
      startedAt: '2026-07-12T00:00:00.000Z',
      pendingConfirmation: {
        nodeId: 'next',
        prompt: 'Paused.',
        kind: 'task_pause',
        pausedAt: '2026-07-12T00:00:00.000Z',
      },
    });
    const thresholdSkill = {
      skillId: 'skill-threshold',
      version: 1,
      name: 'Threshold',
      summary: 'Threshold',
      description: 'Threshold Skill.',
      capabilities: [],
      workflowGuidance: '',
      outputInstruction: '',
      inputSchema: true,
      outputSchema: true,
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false, pauseReplanThresholdSeconds: 1 },
      status: 'enabled' as const,
      sourceKind: 'admin' as const,
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const service = createService(
      new MemoryPlans([validPlan]),
      instances,
      { execute: vi.fn() },
      {
        ...disabledSkills,
        findVersion: () => Promise.resolve(thresholdSkill),
      },
      { now: () => '2026-07-12T00:00:10.000Z' },
    );

    await expect(service.resumePauseForPlan(validPlan.planId)).resolves.toMatchObject({
      disposition: 'replan_required',
      instance: { instanceId: 'instance-long-pause', status: 'paused' },
    });
  });

  it('honors a persisted Skill wait-current cancellation strategy', async () => {
    const instances = new MemoryExecutions();
    const running: WorkflowInstance = {
      instanceId: 'instance-cancel-policy',
      planId: validPlan.planId,
      workflowDefinitionId: 'workflow-1',
      workflowVersion: 2,
      goalId: 'goal-1',
      goalVersion: 1,
      skillVersions: [{ skillId: 'skill-cancel', version: 2 }],
      budgetLimits: {
        maxReplans: 3,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
      status: 'running',
      input: {},
      errors: {},
      startedAt: '2026-07-12T00:00:00.000Z',
    };
    instances.instances.push(running);
    const requestCancel = vi.fn((instanceId: string, interruptCurrent: boolean) => {
      void interruptCurrent;
      instances.instances.push({
        ...running,
        instanceId,
        status: 'canceled',
        errors: {
          cancellation: {
            code: 'WORKFLOW_CANCELED',
            message: 'No automatic compensation ran.',
          },
        },
        completedAt: '2026-07-12T00:00:01.000Z',
      });
      return true;
    });
    const service = createService(
      new MemoryPlans([validPlan]),
      instances,
      { execute: vi.fn(), requestCancel },
      {
        ...disabledSkills,
        findVersion: () =>
          Promise.resolve({
            skillId: 'skill-cancel',
            version: 2,
            name: 'Cancel',
            summary: 'Cancel',
            description: 'Cancellation policy.',
            capabilities: [],
            workflowGuidance: '',
            outputInstruction: '',
            inputSchema: true,
            outputSchema: true,
            toolPolicy: { required: [], optional: [], forbidden: [] },
            runtimePolicy: { autoConfirmPlan: false, cancelStrategy: 'wait_current' },
            status: 'enabled',
            sourceKind: 'admin',
            validationPassed: true,
            createdAt: '2026-07-12T00:00:00.000Z',
          }),
      },
    );

    await expect(service.cancelForPlan(validPlan.planId)).resolves.toMatchObject({
      status: 'canceled',
      errors: { cancellationPolicy: { code: 'CANCEL_STRATEGY_WAIT_CURRENT' } },
    });
    expect(requestCancel).toHaveBeenCalledWith('instance-cancel-policy', false);
  });

  it('persists external wait state and continues through a fresh executor invocation', async () => {
    const instances = new MemoryExecutions();
    const continuations = new MemoryContinuations();
    const continuationState = {
      input: { request: 'remote' },
      waitingNodeRuns: [
        {
          waitId: 'wait-remote-1',
          kind: 'remote_task' as const,
          sourceId: 'binding-remote-1',
          nodeId: 'result',
          nodeRunId: 'instance-remote~result~1',
          state: 'waiting' as const,
        },
      ],
      runnableFrontier: [],
      completedNodeRunIds: [],
      nodeRunCounts: { result: 1 },
      outputs: {},
      errors: {},
      routes: {},
      loopCounts: {},
      recoveryCounts: {},
      parallelJoinState: [],
      failed: false,
      executionContext: { mode: 'live' as const },
      budgetLimits: {
        maxReplans: 3,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: { replanCount: 0, durationMs: 2, llmCalls: 0, mcpCalls: 1, cost: 0 },
    };
    let receiptSnapshot: WorkflowContinuationSnapshot | undefined;
    const execute = vi.fn<WorkflowExecutor['execute']>(async (...parameters) => {
      const prepareExternalWait = parameters[6];
      if (prepareExternalWait === undefined) throw new Error('TEST_PREPARER_MISSING');
      receiptSnapshot = (
        await prepareExternalWait({
          continuation: continuationState,
          completeness: 'exact_single',
        })
      ).snapshot;
      return {
        status: 'waiting_external',
        errors: {},
        budgetUsage: continuationState.budgetUsage,
        continuation: continuationState,
        events: [
          {
            nodeId: 'result',
            type: 'node_waiting_external',
            timestamp: '2026-07-12T00:00:01.000Z',
            summary: 'Remote Task accepted.',
          },
        ],
      };
    });
    const continueExternal = vi.fn().mockResolvedValue({
      status: 'succeeded',
      result: 'done',
      errors: {},
      budgetUsage: { ...continuationState.budgetUsage, durationMs: 3 },
      events: [
        {
          nodeId: 'result',
          type: 'node_succeeded',
          timestamp: '2026-07-12T00:00:03.000Z',
          summary: 'Remote result restored.',
        },
      ],
    });
    const onExternalWaitPrepared = vi.fn(() => {
      expect(continuations.snapshots).toHaveLength(0);
      return Promise.resolve();
    });
    const onExternalWaitActivated = vi.fn((activated: WorkflowContinuationSnapshot) => {
      expect(continuations.snapshots.some((item) => item.snapshotId === activated.snapshotId)).toBe(
        true,
      );
      return Promise.reject(new Error('TEST_POST_ACTIVATION_NOTIFICATION_FAILED'));
    });
    const service = createService(
      new MemoryPlans([validPlan]),
      instances,
      { execute, continueExternal },
      disabledSkills,
      undefined,
      continuations,
      { onExternalWaitPrepared, onExternalWaitActivated },
    );

    await expect(
      service.execute({
        instanceId: 'instance-remote',
        planId: validPlan.planId,
        input: { request: 'remote' },
        continuationAuthority: {
          agentTaskId: 'task-remote',
          contextId: 'context-remote',
          workflowControlId: 'control-remote',
        },
      }),
    ).resolves.toMatchObject({ status: 'waiting_external' });
    expect(continuations.snapshots).toHaveLength(1);
    expect(continuations.snapshots[0]?.snapshotId).toBe(receiptSnapshot?.snapshotId);
    expect(onExternalWaitPrepared).toHaveBeenCalledOnce();
    expect(onExternalWaitActivated).toHaveBeenCalledOnce();
    expect(instances.instances.at(-1)).toMatchObject({ status: 'waiting_external' });
    await expect(
      service.continueExternal({
        instanceId: 'instance-remote',
        continuationAttemptId: 'attempt-remote',
        resolution: {
          kind: 'completed',
          waitId: 'wait-remote-1',
          nodeRunId: 'instance-remote~result~1',
          result: { content: [], isError: false },
        },
      }),
    ).resolves.toMatchObject({ status: 'succeeded', result: 'done' });
    expect(continueExternal).toHaveBeenCalledOnce();
    expect(continuations.snapshots[0]?.lifecycle).toBe('terminal');
    expect(instances.events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('closes the current successor snapshot when the resumed instance write fails', async () => {
    const instances = new MemoryExecutions();
    const continuations = new MemoryContinuations();
    const usage = { replanCount: 0, durationMs: 2, llmCalls: 0, mcpCalls: 1, cost: 0 };
    const state = (bindingId: string, ordinal: number) => ({
      input: {},
      waitingNodeRuns: [
        {
          waitId: `wait-${bindingId}`,
          kind: 'remote_task' as const,
          sourceId: bindingId,
          nodeId: 'result',
          nodeRunId: `instance-successor~result~${String(ordinal)}`,
          state: 'waiting' as const,
        },
      ],
      runnableFrontier: [],
      completedNodeRunIds: ordinal === 1 ? [] : ['instance-successor~result~1'],
      nodeRunCounts: { result: ordinal },
      outputs: {},
      errors: {},
      routes: {},
      loopCounts: {},
      recoveryCounts: {},
      parallelJoinState: [],
      failed: false,
      executionContext: { mode: 'live' as const },
      budgetLimits: {
        maxReplans: 3,
        maxDurationSeconds: 60,
        maxLlmCalls: 10,
        maxMcpCalls: 10,
        maxCost: 100,
      },
      budgetUsage: usage,
    });
    const service = createService(
      new MemoryPlans([validPlan]),
      instances,
      {
        execute: vi.fn().mockResolvedValue({
          status: 'waiting_external',
          errors: {},
          budgetUsage: usage,
          continuation: state('binding-first', 1),
          events: [],
        }),
        continueExternal: vi.fn().mockResolvedValue({
          status: 'waiting_external',
          errors: {},
          budgetUsage: usage,
          continuation: state('binding-second', 2),
          events: [],
        }),
      },
      disabledSkills,
      undefined,
      continuations,
    );
    await service.execute({
      instanceId: 'instance-successor',
      planId: validPlan.planId,
      input: {},
      continuationAuthority: {
        agentTaskId: 'task-successor',
        contextId: 'context-successor',
        workflowControlId: 'control-successor',
      },
    });
    instances.failNextSave = true;

    await expect(
      service.continueExternal({
        instanceId: 'instance-successor',
        continuationAttemptId: 'attempt-successor',
        resolution: {
          kind: 'completed',
          waitId: 'wait-binding-first',
          nodeRunId: 'instance-successor~result~1',
          result: { content: [], isError: false },
        },
      }),
    ).rejects.toThrow('TEST_INSTANCE_SAVE_FAILED');
    expect(continuations.snapshots.map((snapshot) => snapshot.lifecycle)).toEqual([
      'superseded',
      'terminal',
    ]);
    expect(instances.instances.at(-1)).toMatchObject({ status: 'failed' });
  });
});

function createService(
  plans: WorkflowPlanRepository,
  instances: WorkflowExecutionRepository,
  executor: WorkflowExecutor,
  skills: SkillRepository = disabledSkills,
  clockOverride?: Readonly<{ now(): string }>,
  continuations: WorkflowContinuationRepository = new MemoryContinuations(),
  externalWaitHooks: Readonly<{
    onExternalWaitPrepared?: (prepared: WorkflowExternalWaitPreparedSnapshot) => Promise<void>;
    onExternalWaitActivated?: (snapshot: WorkflowContinuationSnapshot) => Promise<void>;
  }> = {},
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
      skills,
      schemas: {
        checkSchema: () => ({ valid: true, errors: [] }),
        validate: () => ({ valid: true, errors: [] }),
      },
    }),
    clock: clockOverride ?? { now: () => `2026-07-12T00:00:0${String(time++)}.000Z` },
    ids: { nextEventId: () => `event-${String(++event)}` },
    continuationIds: {
      nextSnapshotId: () => `snapshot-${String(++event)}`,
      nextContinuationId: () => `continuation-${String(++event)}`,
    },
    continuations,
    ...externalWaitHooks,
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
  confirmPlan(id: string, correlation?: Readonly<{ taskId?: string; confirmedAt: string }>) {
    const plan = this.plans.get(id);
    if (plan !== undefined)
      this.plans.set(id, {
        ...plan,
        confirmationStatus: 'confirmed',
        ...(correlation === undefined
          ? {}
          : {
              confirmedAt: correlation.confirmedAt,
              ...(correlation.taskId === undefined
                ? {}
                : { confirmationTaskId: correlation.taskId }),
            }),
      });
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
  failNextSave = false;
  findInstance(id: string) {
    return Promise.resolve(
      [...this.instances].reverse().find((instance) => instance.instanceId === id),
    );
  }
  findActiveByPlanId(planId: string) {
    return Promise.resolve(
      [...this.instances]
        .reverse()
        .find(
          (instance) =>
            instance.planId === planId &&
            (instance.status === 'running' ||
              instance.status === 'paused' ||
              instance.status === 'waiting_external'),
        ),
    );
  }
  findLatestByPlanId(planId: string) {
    return Promise.resolve(
      [...this.instances].reverse().find((instance) => instance.planId === planId),
    );
  }
  listActiveByGoalId(goalId: string) {
    return Promise.resolve(
      [...this.instances].filter(
        (instance) =>
          instance.goalId === goalId &&
          (instance.status === 'running' ||
            instance.status === 'paused' ||
            instance.status === 'waiting_external'),
      ),
    );
  }
  countNodeEvents(instanceId: string) {
    return Promise.resolve(this.events.filter((event) => event.instanceId === instanceId).length);
  }
  listNodeEvents(instanceId: string) {
    return Promise.resolve(this.events.filter((event) => event.instanceId === instanceId));
  }
  saveInstance(instance: WorkflowInstance) {
    if (this.failNextSave) {
      this.failNextSave = false;
      return Promise.reject(new Error('TEST_INSTANCE_SAVE_FAILED'));
    }
    this.instances.push(instance);
    return Promise.resolve();
  }
  saveNodeEvents(events: readonly WorkflowNodeEvent[]) {
    this.events.push(...events);
    return Promise.resolve();
  }
}

class MemoryContinuations implements WorkflowContinuationRepository {
  readonly snapshots: WorkflowContinuationSnapshot[] = [];
  readonly attempts: WorkflowContinuationAttempt[] = [];

  saveSnapshot(snapshot: WorkflowContinuationSnapshot) {
    if (snapshot.predecessorSnapshotId !== undefined && snapshot.lifecycle === 'active') {
      const predecessorIndex = this.snapshots.findIndex(
        (candidate) => candidate.snapshotId === snapshot.predecessorSnapshotId,
      );
      const predecessor = this.snapshots[predecessorIndex];
      if (predecessor?.lifecycle === 'active')
        this.snapshots[predecessorIndex] = transitionWorkflowContinuationLifecycle(
          predecessor,
          'superseded',
          snapshot.updatedAt,
        );
    }
    this.snapshots.push(snapshot);
    return Promise.resolve();
  }

  transitionLifecycle(
    snapshotId: string,
    expected: WorkflowContinuationLifecycle,
    next: WorkflowContinuationLifecycle,
    updatedAt: string,
  ) {
    const index = this.snapshots.findIndex((snapshot) => snapshot.snapshotId === snapshotId);
    const snapshot = this.snapshots[index];
    if (snapshot?.lifecycle !== expected)
      return Promise.reject(new Error('TEST_CONTINUATION_CAS_FAILED'));
    const transitioned = transitionWorkflowContinuationLifecycle(snapshot, next, updatedAt);
    this.snapshots[index] = transitioned;
    return Promise.resolve(transitioned);
  }

  findById(snapshotId: string) {
    return Promise.resolve(this.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId));
  }

  findCurrent(workflowInstanceId: string) {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.workflowInstanceId === workflowInstanceId && snapshot.lifecycle === 'active',
        ),
    );
  }

  findLatestForWait(
    workflowInstanceId: string,
    wait: Readonly<{
      kind: 'remote_task' | 'child_workflow';
      sourceId: string;
      nodeId: string;
    }>,
  ) {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.workflowInstanceId === workflowInstanceId &&
            snapshot.waitingNodeRuns.some(
              (candidate) =>
                candidate.kind === wait.kind &&
                candidate.sourceId === wait.sourceId &&
                candidate.nodeId === wait.nodeId,
            ),
        ),
    );
  }

  findCurrentByBinding(bindingId: string) {
    return Promise.resolve(
      [...this.snapshots]
        .reverse()
        .find(
          (snapshot) =>
            snapshot.lifecycle === 'active' &&
            snapshot.waitingNodeRuns.some((wait) => wait.sourceId === bindingId),
        ),
    );
  }

  listInbox(now: string, limit: number, afterEventId?: string) {
    void now;
    void limit;
    void afterEventId;
    return Promise.resolve([] as readonly RemoteTaskControlEvent[]);
  }

  claimControl(input: {
    eventId: string;
    claimToken: string;
    claimedAt: string;
    expiresAt: string;
  }) {
    void input;
    return Promise.resolve(undefined);
  }

  finishControl(input: {
    eventId: string;
    claimToken: string;
    status: 'processed' | 'failed';
    processedAt: string;
    errorCode?: string;
  }) {
    void input;
    return Promise.resolve();
  }

  deferControl(input: { eventId: string; claimToken: string; errorCode: string }) {
    void input;
    return Promise.resolve();
  }

  saveAttempt(attempt: WorkflowContinuationAttempt) {
    this.attempts.push(attempt);
    return Promise.resolve();
  }

  updateAttempt(
    attempt: WorkflowContinuationAttempt,
    expectedStatus: WorkflowContinuationAttemptStatus,
  ) {
    void expectedStatus;
    const index = this.attempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
    if (index >= 0) this.attempts[index] = attempt;
    return Promise.resolve();
  }

  findLatestAttemptByEvent(eventId: string) {
    return Promise.resolve(
      [...this.attempts].reverse().find((attempt) => attempt.eventId === eventId),
    );
  }

  listAttempts(workflowInstanceId: string) {
    return Promise.resolve(
      this.attempts.filter((attempt) => attempt.workflowInstanceId === workflowInstanceId),
    );
  }
}
