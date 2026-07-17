import { describe, expect, it, vi } from 'vitest';

import type {
  DslExecutionReadiness,
  McpTaskOperationSemantics,
  TaskAvailabilityCheckResult,
  TaskAvailabilitySnapshot,
  WorkflowPlanAttempt,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { compileWorkflow, type WorkflowRuntimePorts } from '../../langgraph-runtime/src/index.js';
import {
  McpTaskReadinessService,
  StructuredTaskRiskDecider,
  WorkflowPlannerService,
  WorkflowValidator,
  type StructuredModelProvider,
  type WorkflowPlanRepository,
} from '../src/index.js';

const taskSemantics: McpTaskOperationSemantics = {
  execution: 'task_required',
  availability: 'dynamic',
  supportsScheduling: true,
  supportsMaxElapsed: true,
  supportsObservations: true,
  cancellation: 'task_cancel',
  revision: '1.0',
};

describe('MCP Task readiness vertical acceptance', () => {
  it('turns restricted planning into manual confirmation, refreshes, then calls Provider', async () => {
    const harness = createHarness([
      forecast('restricted', {
        validUntil: '2026-07-16T22:10:00.000Z',
        earliestStartTime: '2026-07-16T22:02:00.000Z',
      }),
      forecast('available'),
    ]);
    const plan = await harness.planner.plan(planInput());
    expect(plan).toMatchObject({
      confirmationStatus: 'awaiting_confirmation',
      executionReadiness: { disposition: 'confirmation_required' },
    });
    if (plan.definition === undefined) throw new Error('E2E_PLAN_DEFINITION_MISSING');
    const definition = plan.definition;

    const toolCall = vi.fn().mockResolvedValue({ content: [], isError: false });
    const runtime = compileWorkflow(
      definition,
      'confirmed',
      runtimePorts(async (input) => {
        if (input.taskExecution === undefined) throw new Error('E2E_TASK_EXECUTION_MISSING');
        await harness.readiness.assertPreInvocation({
          planId: plan.planId,
          planAttempt: plan.attemptCount,
          definition,
          planConfirmed: true,
          workflowInstanceId: input.executionId,
          workflowNodeId: input.workflowNodeId,
          workflowNodeRunId: input.workflowNodeRunId,
          serverId: input.tool.serverId,
          operationName: input.tool.toolName,
          arguments: input.arguments as Readonly<Record<string, unknown>>,
          taskExecution: input.taskExecution,
          executionContext: input.executionContext,
        });
        await toolCall(input.arguments);
        return { kind: 'immediate', result: { content: [], isError: false } };
      }),
    );
    await expect(
      runtime.invoke({}, budget, costs, undefined, 'instance-e2e-1', { mode: 'live' }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(toolCall).toHaveBeenCalledOnce();
    expect(harness.evidence.items.map((item) => item.readiness.checkPhase)).toEqual([
      'planning',
      'pre_invocation',
    ]);
  });

  it('makes an available-to-disabled change produce zero Tool calls', async () => {
    const harness = createHarness([forecast('available'), forecast('disabled')]);
    const plan = await harness.planner.plan(planInput());
    expect(plan.executionReadiness?.disposition).toBe('ready');
    if (plan.definition === undefined) throw new Error('E2E_PLAN_DEFINITION_MISSING');
    const definition = plan.definition;
    const toolCall = vi.fn();
    const runtime = compileWorkflow(
      definition,
      'confirmed',
      runtimePorts(async (input) => {
        if (input.taskExecution === undefined) throw new Error('E2E_TASK_EXECUTION_MISSING');
        await harness.readiness.assertPreInvocation({
          planId: plan.planId,
          planAttempt: plan.attemptCount,
          definition,
          planConfirmed: true,
          workflowInstanceId: input.executionId,
          workflowNodeId: input.workflowNodeId,
          workflowNodeRunId: input.workflowNodeRunId,
          serverId: input.tool.serverId,
          operationName: input.tool.toolName,
          arguments: input.arguments as Readonly<Record<string, unknown>>,
          taskExecution: input.taskExecution,
          executionContext: input.executionContext,
        });
        await toolCall(input.arguments);
        return { kind: 'immediate', result: { content: [], isError: false } };
      }),
    );
    await expect(
      runtime.invoke({}, budget, costs, undefined, 'instance-e2e-2', { mode: 'live' }),
    ).rejects.toMatchObject({ code: 'MCP_TASK_PRECALL_NOT_READY' });
    expect(toolCall).not.toHaveBeenCalled();
  });
});

function createHarness(sequence: readonly TaskAvailabilityCheckResult[]) {
  const repository = new MemoryPlanRepository();
  const evidence = new MemoryEvidence();
  const model = new PlanningModel();
  let read = 0;
  let readinessId = 0;
  let snapshotId = 0;
  const readiness = new McpTaskReadinessService({
    operations: { getTaskOperationSemantics: () => Promise.resolve(taskSemantics) },
    provider: {
      checkTaskAvailability: () => {
        const value = sequence[read++];
        if (value === undefined) throw new Error('E2E_AVAILABILITY_SEQUENCE_EXHAUSTED');
        return Promise.resolve({
          kind: 'results',
          protocolRevision: '2026-07-28',
          availabilitySchemaRevision: '1.0',
          results: [value],
        });
      },
    },
    evidence,
    riskDecider: new StructuredTaskRiskDecider(model),
    clock: { now: () => '2026-07-16T22:00:00.000Z' },
    ids: {
      nextReadinessId: () => `readiness-e2e-${String(++readinessId)}`,
      nextSnapshotId: () => `snapshot-e2e-${String(++snapshotId)}`,
    },
  });
  return {
    readiness,
    evidence,
    planner: new WorkflowPlannerService({
      model,
      validator: new WorkflowValidator({
        tools: {
          exists: () => Promise.resolve(true),
          getInputSchema: () =>
            Promise.resolve({
              type: 'object',
              additionalProperties: false,
              required: ['route'],
              properties: { route: { type: 'string' } },
            }),
        },
        skills: emptySkills(),
        schemas: new AjvJsonSchemaValidator(),
      }),
      repository,
      workflowSchema: { type: 'object' },
      clock: { now: () => '2026-07-16T22:00:00.000Z' },
      maxAttempts: 2,
      readiness,
    }),
  };
}

class PlanningModel implements StructuredModelProvider {
  generateStructured(input: Parameters<StructuredModelProvider['generateStructured']>[0]) {
    return Promise.resolve(
      input.stage === 'workflow_planning'
        ? workflow()
        : {
            action: 'proceed',
            acceptedRiskNodeIds: ['patrol'],
            summary: 'Proceed only after operator confirmation.',
          },
    );
  }
}

function workflow() {
  return {
    workflowDefinitionId: 'workflow-e2e',
    version: 1,
    goalId: 'goal-e2e',
    goalVersion: 1,
    entryNodeId: 'patrol',
    exitNodeIds: ['patrol'],
    nodes: [
      {
        nodeId: 'patrol',
        name: 'Patrol',
        type: 'mcp_tool' as const,
        tool: { serverId: 'provider', toolName: 'vehicle_patrol' },
        arguments: { route: 'A' },
        taskExecution: {
          mode: 'require_task' as const,
          availabilityCheck: 'required' as const,
          timing: {
            start: { mode: 'immediate' as const, startToleranceMs: 0 },
            maxElapsedMs: null,
          },
        },
      },
    ],
    edges: [],
  };
}

function planInput() {
  return {
    planId: 'plan-e2e',
    workflowDefinitionId: 'workflow-e2e',
    workflowVersion: 1,
    goalId: 'goal-e2e',
    goalVersion: 1,
    goalContract: {
      goalId: 'goal-e2e',
      version: 1,
      title: 'Patrol',
      description: 'Run a Provider-authoritative patrol.',
      constraints: ['Respect Provider admission.'],
      successCriteria: ['Patrol accepted.'],
    },
    planningInstruction: 'Plan a Provider-authoritative patrol.',
  };
}

function forecast(
  availability: TaskAvailabilityCheckResult['availability'],
  overrides: Partial<TaskAvailabilityCheckResult> = {},
): TaskAvailabilityCheckResult {
  return {
    nodeId: 'patrol',
    operationName: 'vehicle_patrol',
    availability,
    riskLevel:
      availability === 'available' ? 'low' : availability === 'disabled' ? 'critical' : 'high',
    nextAvailableWindows: [],
    reservationMode: 'none',
    possibleEffects: [],
    ...overrides,
  };
}

function runtimePorts(callMcpTool: WorkflowRuntimePorts['callMcpTool']): WorkflowRuntimePorts {
  return {
    executeLlm: () => Promise.resolve({}),
    callMcpTool,
    executeSkill: () => Promise.resolve({ status: 'completed', output: {} }),
    executeSubworkflow: () => Promise.resolve({}),
    requestHumanConfirmation: () => Promise.resolve(true),
    decideExecutionError: () =>
      Promise.resolve({ strategy: 'terminate', summary: 'Terminate on unhandled error.' }),
    now: () => '2026-07-16T22:00:00.000Z',
    nowMilliseconds: () => Date.parse('2026-07-16T22:00:00.000Z'),
  };
}

const budget = {
  maxReplans: 2,
  maxDurationSeconds: 60,
  maxLlmCalls: 4,
  maxMcpCalls: 4,
  maxCost: 10,
};
const costs = { llm: 1, mcp: 1, skill: 1, subworkflow: 1 };

class MemoryPlanRepository implements WorkflowPlanRepository {
  readonly attempts: WorkflowPlanAttempt[] = [];
  readonly plans = new Map<string, WorkflowPlanRecord>();
  findPlan(planId: string) {
    return Promise.resolve(this.plans.get(planId));
  }
  findConfirmedDefinition() {
    return Promise.resolve(undefined);
  }
  confirmPlan() {
    return Promise.resolve();
  }
  saveAttempt(attempt: WorkflowPlanAttempt) {
    this.attempts.push(attempt);
    return Promise.resolve();
  }
  savePlan(plan: WorkflowPlanRecord) {
    this.plans.set(plan.planId, plan);
    return Promise.resolve();
  }
  savePlanAndSupersede(plan: WorkflowPlanRecord) {
    return this.savePlan(plan);
  }
}

class MemoryEvidence {
  readonly items: {
    readiness: DslExecutionReadiness;
    snapshots: readonly TaskAvailabilitySnapshot[];
  }[] = [];
  saveEvaluation(readiness: DslExecutionReadiness, snapshots: readonly TaskAvailabilitySnapshot[]) {
    this.items.push({ readiness, snapshots });
    return Promise.resolve();
  }
  listByPlan() {
    return Promise.resolve(this.items);
  }
  findLatestPlanning() {
    return Promise.resolve(this.items.find((item) => item.readiness.checkPhase === 'planning'));
  }
}

function emptySkills() {
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: () => Promise.resolve(undefined),
    findVersion: () => Promise.resolve(undefined),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([]),
    listCurrentVersions: () => Promise.resolve([]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}
