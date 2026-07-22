import { describe, expect, it, vi } from 'vitest';

import type {
  Goal,
  GoalEvaluationResult,
  ProcessedResultRecord,
  RuntimeAchievedOutcomeInput,
  RuntimeCanceledOutcomeInput,
  RuntimeEnhancementWarning,
  RuntimeTerminalControlStatus,
  RuntimeTerminalOutcomeKind,
  RuntimeTerminalOutcomeRecord,
  RuntimeUnachievableOutcomeInput,
  SkillVersion,
  WorkflowControlRecord,
  WorkflowControlRound,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import type {
  GoalEvaluator,
  GoalRepository,
  RuntimeTerminalOutcomeRepository,
  SkillRepository,
  WorkflowControlRepository,
  WorkflowPlanRepository,
} from '../src/ports.js';
import { WorkflowControllerService } from '../src/workflow-controller.js';
import { UserGoalPlanController } from '../src/user-goal-plan-controller.js';

describe('Workflow outer controller', () => {
  it('rejects same-version Goal content drift before workflow execution', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.goals.goal = {
      ...fixture.goals.goal,
      constraints: ['Never execute this stale plan.'],
    };

    await expect(fixture.controller.start(startInput())).rejects.toMatchObject({
      code: 'WORKFLOW_CONTROL_GOAL_CONTRACT_MISMATCH',
    });
    expect(fixture.execution.execute).not.toHaveBeenCalled();
  });

  it('creates a new immutable version outside execution and auto-confirms only an opted-in Skill', async () => {
    const fixture = createFixture({ maxReplans: 2, autoConfirm: true });
    fixture.evaluator.decisions.push(
      {
        decision: 'adjust_plan',
        summary: 'Need another observation.',
        actionInstruction: 'Read again.',
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
    expect(fixture.execution.execute.mock.calls.map(([request]) => request.input)).toEqual([
      { request: 'run' },
      { request: 'run' },
    ]);
    expect(fixture.controls.rounds.map((round) => round.workflowVersion)).toEqual([1, 2]);
    expect(fixture.goals.goal.status).toBe('achieved');
  });

  it('projects a paused child Skill checkpoint before waiting for its independent decision', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Goal satisfied.' });
    const terminal = instance('instance-0', 'plan-initial', 0, 1);
    const { completedAt: _completedAt, result: _result, ...running } = terminal;
    void _completedAt;
    void _result;
    fixture.execution.execute.mockResolvedValueOnce({
      ...running,
      status: 'paused',
      pendingConfirmation: {
        nodeId: 'child',
        prompt: 'Confirm child.',
        kind: 'skill_confirmation',
        parentPlanId: 'plan-initial',
        childPlanId: 'plan-child',
        childSkillId: 'skill.child',
        childSkillVersion: 2,
      },
    });
    fixture.execution.waitForPauseResolution.mockResolvedValueOnce(terminal);

    await fixture.controller.start(startInput());

    expect(fixture.taskOutcomes.requestSkillConfirmation).toHaveBeenCalledWith('task-control', {
      childPlanId: 'plan-child',
      childSkillId: 'skill.child',
      childSkillVersion: 2,
    });
  });

  it('does not evaluate the Goal while externally waiting and resumes the same control round', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    const terminal = instance('instance-0', 'plan-initial', 0, 1);
    const { completedAt: _completedAt, result: _result, ...active } = terminal;
    void _completedAt;
    void _result;
    const waiting: WorkflowInstance = { ...active, status: 'waiting_external' };
    fixture.execution.execute.mockResolvedValueOnce(waiting);

    await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
      controlId: 'control-1',
      status: 'running',
      roundCount: 0,
    });
    expect(fixture.evaluator.inputs).toHaveLength(0);
    expect(fixture.execution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        continuationAuthority: {
          agentTaskId: 'task-control',
          contextId: 'context-control',
          workflowControlId: 'control-1',
        },
      }),
    );

    fixture.execution.get.mockResolvedValueOnce(terminal);
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Remote work completed.' });
    await expect(
      fixture.controller.continueAfterExternal('control-1', terminal.instanceId),
    ).resolves.toMatchObject({ status: 'achieved', roundCount: 1 });
    expect(fixture.execution.execute).toHaveBeenCalledTimes(1);
    expect(fixture.evaluator.inputs).toHaveLength(1);
  });

  it('projects every fresh child checkpoint after a stale confirmation is invalidated', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Goal satisfied.' });
    const terminal = instance('instance-0', 'plan-initial', 0, 1);
    const { completedAt: _completedAt, result: _result, ...running } = terminal;
    void _completedAt;
    void _result;
    const firstPause: WorkflowInstance = {
      ...running,
      status: 'paused',
      pendingConfirmation: {
        nodeId: 'child',
        prompt: 'Confirm child v2.',
        kind: 'skill_confirmation',
        parentPlanId: 'plan-initial',
        childPlanId: 'plan-child-v2',
        childSkillId: 'skill.child',
        childSkillVersion: 2,
      },
    };
    const secondPause: WorkflowInstance = {
      ...firstPause,
      pendingConfirmation: {
        ...firstPause.pendingConfirmation,
        nodeId: 'child',
        prompt: 'Confirm child v3.',
        kind: 'skill_confirmation',
        childPlanId: 'plan-child-v3',
        childSkillVersion: 3,
      },
    };
    fixture.execution.execute.mockResolvedValueOnce(firstPause);
    fixture.execution.waitForPauseResolution
      .mockResolvedValueOnce(secondPause)
      .mockResolvedValueOnce(terminal);

    await fixture.controller.start(startInput());

    expect(fixture.taskOutcomes.requestSkillConfirmation).toHaveBeenNthCalledWith(
      1,
      'task-control',
      expect.objectContaining({ childPlanId: 'plan-child-v2', childSkillVersion: 2 }),
    );
    expect(fixture.taskOutcomes.requestSkillConfirmation).toHaveBeenNthCalledWith(
      2,
      'task-control',
      expect.objectContaining({ childPlanId: 'plan-child-v3', childSkillVersion: 3 }),
    );
  });

  it('pauses a normal replan for confirmation and continues the same persisted control', async () => {
    const fixture = createFixture({ maxReplans: 2, autoConfirm: true });
    fixture.evaluator.decisions.push(
      { decision: 'replace_skill', summary: 'Revise.', actionInstruction: 'Use another Skill.' },
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
    expect(fixture.execution.confirm).not.toHaveBeenCalled();
    expect(fixture.taskOutcomes.prepareSkillReplacement).toHaveBeenCalledWith('task-control');
    expect(fixture.taskOutcomes.reportReplacementPlan).toHaveBeenCalledWith(
      'task-control',
      expect.objectContaining({
        planId: 'plan-control-1-1',
        skillId: 'skill-replacement',
        skillVersion: 1,
      }),
    );
    await fixture.execution.confirm('plan-control-1-1');
    const completed = await fixture.controller.continueAfterConfirmation('control-1');
    expect(completed.status).toBe('achieved');
    expect(fixture.execution.execute).toHaveBeenCalledTimes(2);
  });

  it('terminates and marks the Goal unachievable when maxReplans is exhausted', async () => {
    const fixture = createFixture({ maxReplans: 0, autoConfirm: true });
    fixture.evaluator.decisions.push({
      decision: 'invoke_additional_skill',
      summary: 'Still incomplete.',
      actionInstruction: 'Try an additional diagnostic Skill.',
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
        decision: 'adjust_plan',
        summary: 'Recover from failure.',
        actionInstruction: 'Use a safe retry.',
      },
      { decision: 'achieved', summary: 'Recovered.' },
    );

    await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
      status: 'achieved',
      replanCount: 1,
    });
    expect(fixture.controls.rounds[0]?.evaluation.summary).toBe('Recover from failure.');
  });

  it('evaluates a thrown execution failure only when its failed instance was persisted', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    const failed = {
      ...instance('instance-0', 'plan-initial', 0, 1),
      status: 'failed' as const,
      errors: { runtime: { code: 'MODEL_INVOCATION_FAILED', message: 'Model failed.' } },
    };
    fixture.execution.execute.mockRejectedValueOnce(new Error('MODEL_INVOCATION_FAILED'));
    fixture.execution.get.mockResolvedValueOnce(failed);
    fixture.evaluator.decisions.push(
      {
        decision: 'adjust_plan',
        summary: 'Use persisted failure evidence.',
        actionInstruction: 'Generate a replacement plan.',
      },
      { decision: 'achieved', summary: 'Recovered.' },
    );

    await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
      status: 'achieved',
      replanCount: 1,
    });
    expect(fixture.evaluator.inputs[0]?.instance).toBe(failed);
  });

  it.each([
    [
      'request_input' as const,
      { question: 'Which device should be inspected?' },
      'awaiting_input' as const,
    ],
    [
      'capability_gap' as const,
      {
        missingCapability: 'Read pressure.',
        suggestedToolContract: {
          name: 'read_pressure',
          description: 'Read pressure.',
          inputSchema: { type: 'object' },
        },
      },
      'capability_gap' as const,
    ],
  ])(
    'stops after evaluation decision %s without planning or executing another node',
    async (decision, detail, status) => {
      const fixture = createFixture({ maxReplans: 2, autoConfirm: true });
      fixture.evaluator.decisions.push({
        decision,
        summary: 'More evidence is required.',
        ...detail,
      });

      await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
        status,
        roundCount: 1,
        replanCount: 0,
      });
      expect(fixture.planner.plan).not.toHaveBeenCalled();
      expect(fixture.execution.execute).toHaveBeenCalledTimes(1);
      expect(fixture.goals.goal.status).toBe('active');
      expect(fixture.taskOutcomes.reportCapabilityGap).toHaveBeenCalledTimes(
        decision === 'capability_gap' ? 1 : 0,
      );
    },
  );

  it('binds answered input to its waiting round and creates a fresh unconfirmed plan', async () => {
    const fixture = createFixture({ maxReplans: 2, autoConfirm: true });
    fixture.evaluator.decisions.push({
      decision: 'request_input',
      summary: 'A device identifier is required.',
      question: 'Which device?',
    });
    await fixture.controller.start(startInput());

    const continued = await fixture.controller.continueAfterInput({
      controlId: 'control-1',
      taskId: 'task-control',
      inputRequestId: 'input-request-1',
      controlRoundIndex: 0,
      content: 'device-17',
    });

    expect(continued).toMatchObject({
      status: 'awaiting_confirmation',
      currentPlanId: 'plan-control-1-1',
      roundCount: 1,
      replanCount: 1,
      input: {
        request: 'run',
        supplementaryInputs: [{ inputRequestId: 'input-request-1', content: 'device-17' }],
      },
    });
    expect(fixture.execution.execute).toHaveBeenCalledTimes(1);
    expect(fixture.execution.confirm).not.toHaveBeenCalled();
    expect(fixture.taskOutcomes.reportInputContinuationPlan).toHaveBeenCalledWith(
      'task-control',
      expect.objectContaining({ planId: 'plan-control-1-1' }),
    );
  });

  it('keeps authoritative achievement when every independent post-commit enhancement fails', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Committed first.' });
    fixture.experiences.record.mockRejectedValueOnce(codedError('EVOLUTION_WRITE_FAILED'));
    fixture.memories.recordEvolution.mockRejectedValueOnce(codedError('MEMORY_WRITE_FAILED'));
    fixture.taskOutcomes.enhanceResultMemory.mockRejectedValueOnce(
      codedError('RESULT_MEMORY_WRITE_FAILED'),
    );
    fixture.taskOutcomes.enhanceTaskQuality.mockRejectedValueOnce(
      codedError('TASK_QUALITY_WRITE_FAILED'),
    );
    fixture.taskOutcomes.enhanceTemporarySkill.mockResolvedValueOnce('candidate-1');
    fixture.taskOutcomes.enhanceSkillEvolution.mockRejectedValueOnce(
      codedError('SKILL_EVOLUTION_WRITE_FAILED'),
    );

    await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
      status: 'achieved',
      terminalOutcomeId: 'terminal-outcome-task-task-control',
    });
    await expect(
      fixture.terminalOutcomes.find('terminal-outcome-task-task-control'),
    ).resolves.toMatchObject({
      enhancementWarnings: expect.arrayContaining([
        expect.objectContaining({ source: 'evolution_experience' }),
        expect.objectContaining({ source: 'evaluation_memory' }),
        expect.objectContaining({ source: 'result_memory' }),
        expect.objectContaining({ source: 'task_quality' }),
        expect.objectContaining({ source: 'skill_evolution' }),
      ]),
    });
    expect(fixture.goals.goal.status).toBe('achieved');
  });

  it('does not commit any terminal projection when result-model audit fails during preparation', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Would be achieved.' });
    fixture.taskOutcomes.prepareAchieved.mockRejectedValueOnce(
      codedError('MODEL_AUDIT_WRITE_FAILED'),
    );

    await expect(fixture.controller.start(startInput())).rejects.toMatchObject({
      code: 'MODEL_AUDIT_WRITE_FAILED',
    });
    expect(fixture.terminalOutcomes.outcomes.size).toBe(0);
    expect(fixture.goals.goal.status).toBe('active');
    expect(fixture.controls.controls.get('control-1')).toMatchObject({ status: 'failed' });
  });

  it('never reverses a committed terminal control when an error escapes after commit', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Committed.' });
    const commit = fixture.terminalOutcomes.commitAchieved.bind(fixture.terminalOutcomes);
    vi.spyOn(fixture.terminalOutcomes, 'commitAchieved').mockImplementationOnce(async (input) => {
      await commit(input);
      throw codedError('AFTER_TERMINAL_COMMIT');
    });

    await expect(fixture.controller.start(startInput())).rejects.toMatchObject({
      code: 'AFTER_TERMINAL_COMMIT',
    });
    expect(fixture.controls.controls.get('control-1')).toMatchObject({
      status: 'achieved',
      terminalOutcomeId: 'terminal-outcome-task-task-control',
    });
    expect(fixture.goals.goal.status).toBe('achieved');
  });

  it('returns committed authority even when enhancement and warning persistence both fail', async () => {
    const fixture = createFixture({ maxReplans: 1, autoConfirm: true });
    fixture.evaluator.decisions.push({ decision: 'achieved', summary: 'Committed.' });
    fixture.taskOutcomes.enhanceResultMemory.mockRejectedValueOnce(
      codedError('RESULT_MEMORY_WRITE_FAILED'),
    );
    vi.spyOn(fixture.terminalOutcomes, 'recordEnhancementWarning').mockRejectedValueOnce(
      codedError('WARNING_PERSISTENCE_FAILED'),
    );

    await expect(fixture.controller.start(startInput())).resolves.toMatchObject({
      status: 'achieved',
      terminalOutcomeId: 'terminal-outcome-task-task-control',
    });
    expect(fixture.reportWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'result_memory',
        code: 'WARNING_PERSISTENCE_FAILED',
        message: expect.stringContaining('Unable to persist enhancement warning'),
      }),
    );
    expect(fixture.reportWarning).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'result_memory', code: 'RESULT_MEMORY_WRITE_FAILED' }),
    );
  });
});

function startInput() {
  return {
    controlId: 'control-1',
    contextId: 'context-control',
    goalId: 'goal-control',
    goalVersion: 1,
    taskId: 'task-control',
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
  const taskOutcomes = {
    reportCapabilityGap: vi.fn(() => Promise.resolve()),
    prepareAchieved: vi.fn(() => Promise.resolve(processedResult())),
    enhanceResultMemory: vi.fn(() => Promise.resolve()),
    enhanceTaskQuality: vi.fn(() => Promise.resolve()),
    enhanceTemporarySkill: vi.fn<() => Promise<string | undefined>>(() =>
      Promise.resolve(undefined),
    ),
    enhanceSkillEvolution: vi.fn(() => Promise.resolve()),
    requestInput: vi.fn(() => Promise.resolve()),
    requestSkillConfirmation: vi.fn(() => Promise.resolve()),
    prepareSkillReplacement: vi.fn(() =>
      Promise.resolve({
        skillId: 'skill-replacement',
        skillVersion: 1,
        decisionSummary: 'Use the enabled alternative.',
      }),
    ),
    prepareCompositionRefresh: vi.fn(() =>
      Promise.resolve({
        skillId: 'skill-control',
        skillVersion: 1,
        decisionSummary: 'Refresh the immutable composition.',
      }),
    ),
    reportReplacementPlan: vi.fn(() => Promise.resolve()),
    reportInputContinuationPlan: vi.fn(() => Promise.resolve()),
    continueUserGoalPlan: vi.fn(() => Promise.resolve()),
  };
  const terminalOutcomes = new MemoryTerminalOutcomes(controls, goals);
  const experiences = { record: vi.fn(() => Promise.resolve(undefined as never)) };
  const memories = { recordEvolution: vi.fn(() => Promise.resolve(undefined as never)) };
  const reportWarning = vi.fn();
  const planner = {
    plan: vi.fn(async (request: { planId: string; workflowVersion: number }) => {
      const next = plan(request.planId, request.workflowVersion, 'awaiting_confirmation');
      await plans.savePlan(next);
      return next;
    }),
  };
  const execute = vi.fn(
    (request: { instanceId: string; planId: string; input: unknown; replanCount?: number }) =>
      Promise.resolve(
        instance(request.instanceId, request.planId, request.replanCount ?? 0, input.maxReplans),
      ),
  );
  const get = vi.fn<(instanceId: string) => Promise<WorkflowInstance | undefined>>(() =>
    Promise.resolve(undefined),
  );
  const execution = {
    execute,
    get,
    waitForPauseResolution: vi.fn((instanceId: string) =>
      Promise.resolve(instance(instanceId, 'plan-control-1', 0, input.maxReplans)),
    ),
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
    confirmation: {
      evaluate: async (skillIds) => ({
        autoConfirm:
          skillIds.length > 0 &&
          (await Promise.all(skillIds.map((skillId) => skills.findCurrentVersion(skillId)))).every(
            (skill) => skill?.status === 'enabled' && skill.runtimePolicy.autoConfirmPlan,
          ),
        skillVersions: [],
        blockingSkillIds: [],
      }),
    },
    planner,
    execution,
    evaluator,
    experiences,
    memories,
    taskOutcomes,
    terminalAuthority: new UserGoalPlanController({ terminal: terminalOutcomes }),
    reportWarning,
    clock: { now: () => `2026-07-12T00:00:${String(tick++).padStart(2, '0')}.000Z` },
    ids: {
      nextPlanId: (controlId, replanCount) => `plan-${controlId}-${String(replanCount)}`,
      nextInstanceId: (_controlId, roundIndex) => `instance-${String(roundIndex)}`,
    },
  });
  return {
    controller,
    controls,
    plans,
    goals,
    evaluator,
    execution,
    planner,
    taskOutcomes,
    terminalOutcomes,
    experiences,
    memories,
    reportWarning,
  };
}

function codedError(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(code), { code });
}

function processedResult(): ProcessedResultRecord {
  return {
    resultId: 'processed-result-terminal-task-control',
    taskId: 'task-control',
    skillId: 'skill-control',
    skillVersion: 1,
    normalized: {
      data: true,
      errors: [],
      originalSize: 4,
      contextValue: true,
      contextTruncated: false,
      summary: 'Successful result with 4 JSON characters.',
    },
    output: { text: 'Done.', structured: true },
    facts: [],
    valuable: true,
    valueSummary: 'Useful.',
    memoryCandidates: [],
    createdAt: '2026-07-12T00:00:03.000Z',
  };
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
    goalContract: {
      goalId: 'goal-control',
      version: 1,
      title: 'Control',
      description: 'Complete the control Goal.',
      constraints: [],
      successCriteria: ['Done'],
    },
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
  inputs: Parameters<GoalEvaluator['evaluate']>[0][] = [];
  evaluate(input: Parameters<GoalEvaluator['evaluate']>[0]) {
    this.inputs.push(input);
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

class MemoryTerminalOutcomes implements RuntimeTerminalOutcomeRepository {
  readonly #controls: MemoryControls;
  readonly #goals: MemoryGoals;
  readonly outcomes = new Map<string, RuntimeTerminalOutcomeRecord>();

  constructor(controls: MemoryControls, goals: MemoryGoals) {
    this.#controls = controls;
    this.#goals = goals;
  }

  commitAchieved(input: RuntimeAchievedOutcomeInput) {
    return this.#commit('achieved', 'achieved', input);
  }

  commitUnachievable(input: RuntimeUnachievableOutcomeInput) {
    return this.#commit('unachievable', input.controlStatus, input);
  }

  commitCanceled(input: RuntimeCanceledOutcomeInput) {
    return this.#commit('canceled', 'canceled', input);
  }

  recordEnhancementWarning(outcomeId: string, warning: RuntimeEnhancementWarning) {
    const existing = this.outcomes.get(outcomeId);
    if (existing === undefined)
      return Promise.reject(new Error('RUNTIME_TERMINAL_OUTCOME_NOT_FOUND'));
    this.outcomes.set(outcomeId, {
      ...existing,
      enhancementWarnings: [...existing.enhancementWarnings, warning],
    });
    return Promise.resolve();
  }

  find(outcomeId: string) {
    return Promise.resolve(this.outcomes.get(outcomeId));
  }

  findByControl(controlId: string) {
    return Promise.resolve(
      [...this.outcomes.values()].find((outcome) => outcome.controlId === controlId),
    );
  }

  async #commit(
    kind: RuntimeTerminalOutcomeKind,
    controlStatus: RuntimeTerminalControlStatus,
    input:
      RuntimeAchievedOutcomeInput | RuntimeUnachievableOutcomeInput | RuntimeCanceledOutcomeInput,
  ): Promise<RuntimeTerminalOutcomeRecord> {
    const existing = this.outcomes.get(input.outcomeId);
    if (existing !== undefined) return existing;
    const round = input.round;
    const resultId =
      kind === 'achieved'
        ? (input as RuntimeAchievedOutcomeInput).processedResult?.resultId
        : undefined;
    const record: RuntimeTerminalOutcomeRecord = {
      outcomeId: input.outcomeId,
      kind,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      controlId: input.controlId,
      controlStatus,
      ...(round === undefined ? {} : { roundIndex: round.roundIndex }),
      ...(round === undefined ? {} : { finalInstanceId: round.instanceId }),
      ...(resultId === undefined ? {} : { resultId }),
      summary: input.summary,
      enhancementWarnings: [],
      committedAt: input.committedAt,
    };
    this.outcomes.set(input.outcomeId, record);
    this.#goals.goal = {
      ...this.#goals.goal,
      status: kind === 'achieved' ? 'achieved' : kind === 'canceled' ? 'canceled' : 'unachievable',
      updatedAt: input.committedAt,
    };
    const control = this.#controls.controls.get(input.controlId);
    if (control === undefined) throw new Error('WORKFLOW_CONTROL_NOT_FOUND');
    if (round !== undefined)
      await this.#controls.saveRound({ ...round, terminalOutcomeId: input.outcomeId });
    await this.#controls.save({
      ...control,
      status: controlStatus,
      roundCount: round === undefined ? control.roundCount : round.roundIndex + 1,
      ...(round === undefined ? {} : { finalInstanceId: round.instanceId }),
      terminalOutcomeId: input.outcomeId,
      updatedAt: input.committedAt,
    });
    return record;
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
  savePlanAndSupersede(item: WorkflowPlanRecord, sourcePlanId: string) {
    const source = this.plans.get(sourcePlanId);
    if (source !== undefined)
      this.plans.set(sourcePlanId, { ...source, confirmationStatus: 'superseded' });
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
  findLatestByContextId(id: string) {
    return Promise.resolve(id === this.goal.contextId ? this.goal : undefined);
  }
  listByContextId(id: string) {
    return Promise.resolve(id === this.goal.contextId ? [this.goal] : []);
  }
  listTransitions() {
    return Promise.resolve([]);
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
