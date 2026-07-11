import { describe, expect, it, vi } from 'vitest';

import type {
  Goal,
  GoalEvaluationResult,
  SkillVersion,
  WorkflowControlRecord,
  WorkflowControlRound,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import type {
  GoalEvaluator,
  GoalRepository,
  SkillRepository,
  WorkflowControlRepository,
  WorkflowPlanRepository,
} from '../src/ports.js';
import { WorkflowControllerService } from '../src/workflow-controller.js';

describe('Workflow outer controller', () => {
  it('creates a new immutable version outside execution and auto-confirms only an opted-in Skill', async () => {
    const fixture = createFixture({ maxReplans: 2, autoConfirm: true });
    fixture.evaluator.decisions.push(
      {
        decision: 'replan',
        summary: 'Need another observation.',
        replanInstruction: 'Read again.',
      },
      { decision: 'achieved', summary: 'Goal satisfied.' },
    );

    const result = await fixture.controller.start(startInput());

    expect(result).toMatchObject({ status: 'achieved', roundCount: 2, replanCount: 1 });
    expect(fixture.planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowDefinitionId: 'workflow-control',
        workflowVersion: 2,
        goalId: 'goal-control',
        goalVersion: 1,
      }),
    );
    expect(fixture.execution.confirm).toHaveBeenCalledTimes(1);
    expect(fixture.execution.execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ planId: 'plan-initial', replanCount: 0 }),
    );
    expect(fixture.execution.execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ planId: 'plan-control-1-1', replanCount: 1 }),
    );
    expect(fixture.controls.rounds.map((round) => round.workflowVersion)).toEqual([1, 2]);
    expect(fixture.goals.goal.status).toBe('achieved');
  });

  it('pauses a normal replan for confirmation and continues the same persisted control', async () => {
    const fixture = createFixture({ maxReplans: 2, autoConfirm: false });
    fixture.evaluator.decisions.push(
      { decision: 'replan', summary: 'Revise.', replanInstruction: 'Use another route.' },
      { decision: 'achieved', summary: 'Done.' },
    );

    const waiting = await fixture.controller.start(startInput());
    expect(waiting).toMatchObject({
      status: 'awaiting_confirmation',
      currentPlanId: 'plan-control-1-1',
      roundCount: 1,
      replanCount: 1,
    });
    expect(fixture.execution.execute).toHaveBeenCalledTimes(1);
    await fixture.execution.confirm('plan-control-1-1');
    const completed = await fixture.controller.continueAfterConfirmation('control-1');
    expect(completed.status).toBe('achieved');
    expect(fixture.execution.execute).toHaveBeenCalledTimes(2);
  });

  it('terminates and marks the Goal unachievable when maxReplans is exhausted', async () => {
    const fixture = createFixture({ maxReplans: 0, autoConfirm: true });
    fixture.evaluator.decisions.push({
      decision: 'replan',
      summary: 'Still incomplete.',
      replanInstruction: 'Try again.',
    });

    const result = await fixture.controller.start(startInput());

    expect(result).toMatchObject({
      status: 'replan_budget_exhausted',
      roundCount: 1,
      replanCount: 0,
    });
    expect(fixture.planner.plan).not.toHaveBeenCalled();
    expect(fixture.goals.goal.status).toBe('unachievable');
  });

  it('can replan after a failed immutable instance using only its persisted latest state', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.execution.execute.mockResolvedValueOnce({
      ...instance('instance-0', 'plan-initial', 0, 1),
      status: 'failed',
      errors: { runtime: { code: 'TOOL_FAILED', message: 'Tool failed.' } },
    });
    fixture.evaluator.decisions.push(
      {
        decision: 'replan',
        summary: 'Recover from failure.',
        replanInstruction: 'Use a safe retry.',
      },
      { decision: 'achieved', summary: 'Recovered.' },
    );

    await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
      status: 'achieved',
      replanCount: 1,
    });
    expect(fixture.controls.rounds[0]?.evaluation.summary).toBe('Recover from failure.');
  });
});

function startInput() {
  return {
    controlId: 'control-1',
    contextId: 'context-control',
    goalId: 'goal-control',
    goalVersion: 1,
    initialPlanId: 'plan-initial',
    input: { request: 'run' },
    skillIds: ['skill-control'],
    planningInstruction: 'Complete the Goal.',
  };
}

function createFixture(input: { maxReplans: number; autoConfirm: boolean }) {
  const plans = new MemoryPlans([plan('plan-initial', 1, 'confirmed')]);
  const controls = new MemoryControls();
  const goals = new MemoryGoals();
  const skill = skillVersion(input.maxReplans, input.autoConfirm);
  const skills = memorySkills(skill);
  const evaluator = new SequenceEvaluator();
  const planner = {
    plan: vi.fn(async (request: { planId: string; workflowVersion: number }) => {
      const next = plan(request.planId, request.workflowVersion, 'awaiting_confirmation');
      await plans.savePlan(next);
      return next;
    }),
  };
  const execute = vi.fn((request: { instanceId: string; planId: string; replanCount?: number }) =>
    Promise.resolve(
      instance(request.instanceId, request.planId, request.replanCount ?? 0, input.maxReplans),
    ),
  );
  const execution = {
    execute,
    confirm: vi.fn(async (planId: string) => {
      await plans.confirmPlan(planId);
      const confirmed = await plans.findPlan(planId);
      if (confirmed === undefined) throw new Error('PLAN_NOT_FOUND');
      return confirmed;
    }),
  };
  let tick = 0;
  const controller = new WorkflowControllerService({
    controls,
    plans,
    goals,
    skills,
    planner,
    execution,
    evaluator,
    clock: { now: () => `2026-07-12T00:00:${String(tick++).padStart(2, '0')}.000Z` },
    ids: {
      nextPlanId: (controlId, replanCount) => `plan-${controlId}-${String(replanCount)}`,
      nextInstanceId: (_controlId, roundIndex) => `instance-${String(roundIndex)}`,
    },
  });
  return { controller, controls, goals, evaluator, execution, planner };
}

function plan(
  planId: string,
  version: number,
  confirmationStatus: WorkflowPlanRecord['confirmationStatus'],
): WorkflowPlanRecord {
  return {
    planId,
    goalId: 'goal-control',
    goalVersion: 1,
    definition: {
      workflowDefinitionId: 'workflow-control',
      version,
      goalId: 'goal-control',
      goalVersion: 1,
      entryNodeId: 'result',
      exitNodeIds: ['result'],
      nodes: [
        { nodeId: 'result', name: 'Result', type: 'result', value: { op: 'literal', value: true } },
      ],
      edges: [],
    },
    confirmationStatus,
    attemptCount: 1,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}

function instance(
  instanceId: string,
  planId: string,
  replanCount: number,
  maxReplans: number,
): WorkflowInstance {
  return {
    instanceId,
    planId,
    workflowDefinitionId: 'workflow-control',
    workflowVersion: replanCount + 1,
    goalId: 'goal-control',
    goalVersion: 1,
    skillVersions: [{ skillId: 'skill-control', version: 1 }],
    budgetLimits: {
      maxReplans,
      maxDurationSeconds: 60,
      maxLlmCalls: 10,
      maxMcpCalls: 10,
      maxCost: 100,
    },
    budgetUsage: { replanCount, durationMs: 1, llmCalls: 0, mcpCalls: 0, cost: 0 },
    status: 'succeeded',
    input: {},
    result: true,
    errors: {},
    startedAt: '2026-07-12T00:00:00.000Z',
    completedAt: '2026-07-12T00:00:01.000Z',
  };
}

function skillVersion(maxReplans: number, autoConfirmPlan: boolean): SkillVersion {
  return {
    skillId: 'skill-control',
    version: 1,
    name: 'Control',
    summary: 'Control',
    description: 'Control Skill.',
    capabilities: [],
    workflowGuidance: '',
    outputInstruction: '',
    inputSchema: true,
    outputSchema: true,
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan, maxReplans },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}

class SequenceEvaluator implements GoalEvaluator {
  decisions: GoalEvaluationResult[] = [];
  evaluate() {
    const decision = this.decisions.shift();
    if (decision === undefined) throw new Error('NO_EVALUATION');
    return Promise.resolve(decision);
  }
}

class MemoryControls implements WorkflowControlRepository {
  controls = new Map<string, WorkflowControlRecord>();
  rounds: WorkflowControlRound[] = [];
  find(id: string) {
    return Promise.resolve(this.controls.get(id));
  }
  save(control: WorkflowControlRecord) {
    this.controls.set(control.controlId, control);
    return Promise.resolve();
  }
  saveRound(round: WorkflowControlRound) {
    this.rounds.push(round);
    return Promise.resolve();
  }
  listRounds(id: string) {
    return Promise.resolve(this.rounds.filter((round) => round.controlId === id));
  }
}

class MemoryPlans implements WorkflowPlanRepository {
  plans: Map<string, WorkflowPlanRecord>;
  constructor(plans: WorkflowPlanRecord[]) {
    this.plans = new Map(plans.map((item) => [item.planId, item]));
  }
  findPlan(id: string) {
    return Promise.resolve(this.plans.get(id));
  }
  findConfirmedDefinition(id: string, version: number) {
    return Promise.resolve(
      [...this.plans.values()].find(
        (item) =>
          item.confirmationStatus === 'confirmed' &&
          item.definition?.workflowDefinitionId === id &&
          item.definition.version === version,
      ),
    );
  }
  confirmPlan(id: string) {
    const item = this.plans.get(id);
    if (item !== undefined) this.plans.set(id, { ...item, confirmationStatus: 'confirmed' });
    return Promise.resolve();
  }
  saveAttempt() {
    return Promise.resolve();
  }
  savePlan(item: WorkflowPlanRecord) {
    this.plans.set(item.planId, item);
    return Promise.resolve();
  }
}

class MemoryGoals implements GoalRepository {
  goal: Goal = {
    goalId: 'goal-control',
    contextId: 'context-control',
    version: 1,
    title: 'Control',
    description: 'Complete the control Goal.',
    constraints: [],
    successCriteria: ['Done'],
    status: 'active',
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
  findById(id: string) {
    return Promise.resolve(id === this.goal.goalId ? this.goal : undefined);
  }
  findActiveByContextId(id: string) {
    return Promise.resolve(
      id === this.goal.contextId && this.goal.status === 'active' ? this.goal : undefined,
    );
  }
  save(goal: Goal) {
    this.goal = goal;
    return Promise.resolve();
  }
}

function memorySkills(skill: SkillVersion): SkillRepository {
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: (id) => Promise.resolve(id === skill.skillId ? skill : undefined),
    findVersion: () => Promise.resolve(undefined),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([skill]),
    listCurrentVersions: () => Promise.resolve([skill]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}
