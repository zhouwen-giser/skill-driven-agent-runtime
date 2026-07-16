import { describe, expect, it, vi } from 'vitest';

import type {
  SkillCallWorkflowRecord,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { createSkillVersion } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  MAX_SKILL_CHILD_RESULT_CHARACTERS,
  MAX_SKILL_CALL_DEPTH,
  nextSkillCallAncestry,
  SkillCallWorkflowService,
} from '../src/skill-call-workflow.js';
import type { PlanWorkflowInput } from '../src/workflow-planner.js';

describe('SkillCallWorkflowService', () => {
  it('plans, validates, confirms and executes the current Skill as an independent child Workflow', async () => {
    const skill = childSkill();
    const definition = childDefinition(skill.skillId, skill.version);
    const plan = childPlan(definition);
    let savedRecord: Awaited<ReturnType<ReturnType<typeof memoryRecords>['find']>>;
    const saveRecord = vi.fn((record) => {
      savedRecord = record;
      return Promise.resolve();
    });
    const planner = {
      plan: vi.fn((input: PlanWorkflowInput) => {
        void input;
        return Promise.resolve(plan);
      }),
    };
    const validator = {
      validate: vi.fn(() => Promise.resolve({ valid: true, errors: [], definition })),
    };
    const confirm = vi.fn(() =>
      Promise.resolve({ ...plan, confirmationStatus: 'confirmed' as const }),
    );
    const signal = new AbortController().signal;
    const executionContext = {
      mode: 'historical-replay' as const,
      simulationId: 'replay-child-1',
    };
    const execute = vi.fn(() => Promise.resolve(childInstance({ status: 'online' })));
    const loadToolPlanningMetadata = vi.fn(() =>
      Promise.resolve([
        {
          policy: 'required' as const,
          reference: { serverId: 'mcp.devices', toolName: 'device_status' },
          inputSchema: {
            type: 'object',
            required: ['deviceId'],
            properties: { deviceId: { type: 'string' } },
          },
          contractAuthority: 'original_mcp_input_schema' as const,
        },
      ]),
    );
    const service = new SkillCallWorkflowService({
      skills: { findCurrentVersion: () => Promise.resolve(skill) } as never,
      planner,
      validator,
      execution: {
        confirm,
        execute,
        get: () => Promise.resolve(undefined),
        findActiveByPlanId: () => Promise.resolve(undefined),
        resumeHumanConfirmation: vi.fn(),
      },
      plans: { findPlan: () => Promise.resolve(plan) },
      confirmation: {
        evaluate: () =>
          Promise.resolve({ autoConfirm: true, skillVersions: [], blockingSkillIds: [] }),
      },
      records: {
        save: saveRecord,
        find: () => Promise.resolve(savedRecord),
        listByParent: () => Promise.resolve(savedRecord === undefined ? [] : [savedRecord]),
      },
      schemas: new AjvJsonSchemaValidator(),
      loadToolPlanningMetadata,
      clock: { now: () => '2026-07-12T00:00:01.000Z' },
      nextId: () => 'id-1',
    });

    await expect(
      service.execute({
        skillId: skill.skillId,
        value: { deviceId: 'device-1' },
        parentPlanId: 'plan-parent',
        parentInstanceId: 'instance-parent',
        parentNodeId: 'child',
        parentGoalId: 'goal-1',
        parentGoalVersion: 1,
        signal,
        executionContext,
      }),
    ).resolves.toEqual({ status: 'completed', output: { status: 'online' } });

    expect(loadToolPlanningMetadata).toHaveBeenCalledWith(skill);
    const planningCall = planner.plan.mock.calls[0]?.[0];
    if (planningCall === undefined) throw new Error('CHILD_PLANNING_CALL_MISSING');
    expect(JSON.parse(planningCall.planningInstruction)).toMatchObject({
      operation: 'skill_call_child_plan',
      selectedSkill: {
        skillId: skill.skillId,
        version: skill.version,
        description: skill.description,
        workflowGuidance: skill.workflowGuidance,
        inputSchema: skill.inputSchema,
        outputSchema: skill.outputSchema,
        toolPolicy: skill.toolPolicy,
        runtimePolicy: skill.runtimePolicy,
      },
      resolvedInput: { deviceId: 'device-1' },
      toolPlanningMetadata: [
        expect.objectContaining({
          reference: { serverId: 'mcp.devices', toolName: 'device_status' },
        }),
      ],
    });
    expect(validator.validate).toHaveBeenCalledWith(definition);
    expect(confirm).toHaveBeenCalledWith(plan.planId);
    expect(execute).toHaveBeenCalledWith({
      instanceId: 'instance-skill-call-id-1',
      planId: 'plan-skill-call-id-1',
      input: { deviceId: 'device-1' },
      skillIds: [skill.skillId],
      signal,
      executionContext,
    });
    expect(saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'id-1',
        parentPlanId: 'plan-parent',
        parentInstanceId: 'instance-parent',
        childInstanceId: 'instance-skill-call-id-1',
        skillVersion: 3,
        status: 'succeeded',
        evaluationSummary: expect.stringContaining('after executing'),
      }),
    );
  });

  it('rejects invalid resolved input before planning or persistence', async () => {
    const harness = serviceHarness();

    await expect(
      harness.service.execute({
        skillId: harness.skill.skillId,
        value: { deviceId: 42 },
        parentPlanId: 'plan-parent',
        parentInstanceId: 'instance-parent',
        parentNodeId: 'child',
        parentGoalId: 'goal-1',
        parentGoalVersion: 1,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_SKILL_INPUT_INVALID' });
    expect(harness.plan).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.saveRecord).not.toHaveBeenCalled();
  });

  it('rejects invalid child output and records the failed Skill evaluation', async () => {
    const harness = serviceHarness({ child: childInstance({ status: 'offline' }) });

    await expect(
      harness.service.execute(executionInput(harness.skill.skillId)),
    ).rejects.toMatchObject({ code: 'WORKFLOW_SKILL_OUTPUT_INVALID' });
    expect(harness.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        evaluationSummary: expect.stringContaining('schema validation'),
      }),
    );
  });

  it('rejects an oversized child result before injecting it into the parent state', async () => {
    const harness = serviceHarness({
      child: childInstance({
        status: 'online',
        payload: 'x'.repeat(MAX_SKILL_CHILD_RESULT_CHARACTERS),
      }),
    });

    await expect(
      harness.service.execute(executionInput(harness.skill.skillId)),
    ).rejects.toMatchObject({ code: 'WORKFLOW_SKILL_OUTPUT_TOO_LARGE' });
    expect(harness.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'id-1',
        status: 'failed',
        evaluationSummary: expect.stringContaining('exceeding'),
      }),
    );
  });

  it('rejects a cyclic non-JSON child result before output-schema validation', async () => {
    const cyclic: { status: string; self?: unknown } = { status: 'online' };
    cyclic.self = cyclic;
    const harness = serviceHarness({ child: childInstance(cyclic) });

    await expect(
      harness.service.execute(executionInput(harness.skill.skillId)),
    ).rejects.toMatchObject({ code: 'WORKFLOW_SKILL_OUTPUT_INVALID' });
  });

  it.each([
    ['failed', 'WORKFLOW_SKILL_CHILD_FAILED'],
    ['canceled', 'WORKFLOW_SKILL_CHILD_CANCELED'],
  ] as const)('propagates a %s child outcome without fabricating success', async (status, code) => {
    const harness = serviceHarness({ child: childInstance(undefined, status) });

    await expect(
      harness.service.execute(executionInput(harness.skill.skillId)),
    ).rejects.toMatchObject({
      code,
    });
    expect(harness.saveRecord).toHaveBeenCalledWith(expect.objectContaining({ status }));
  });

  it('does not confirm or execute when child plan persistence fails', async () => {
    const harness = serviceHarness();
    harness.plan.mockRejectedValueOnce(new Error('DB_WRITE_FAILED'));

    await expect(harness.service.execute(executionInput(harness.skill.skillId))).rejects.toThrow(
      'DB_WRITE_FAILED',
    );
    expect(harness.confirm).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
  });

  it('persists an independently confirmable child plan when transitive policy opts out', async () => {
    const harness = serviceHarness({ autoConfirm: false });

    await expect(harness.service.execute(executionInput(harness.skill.skillId))).resolves.toEqual({
      status: 'awaiting_confirmation',
      callId: 'id-1',
      parentPlanId: 'plan-parent',
      parentInstanceId: 'instance-parent',
      parentNodeId: 'child',
      childPlanId: 'plan-skill-call-id-1',
      childSkillId: 'skill.child',
      childSkillVersion: 3,
    });
    expect(harness.confirm).not.toHaveBeenCalled();
    expect(harness.execute).not.toHaveBeenCalled();
    expect(harness.saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPlanId: 'plan-parent',
        confirmationStatus: 'awaiting_confirmation',
        status: 'awaiting_confirmation',
      }),
    );
  });

  it('confirms, resumes, and rejects only the child plan bound to the paused parent checkpoint', async () => {
    const parent = pausedParentInstance();
    const confirmed = serviceHarness({ autoConfirm: false, parent });
    await confirmed.service.execute(executionInput(confirmed.skill.skillId));

    await expect(
      confirmed.service.confirmPendingForParentPlan('plan-parent', 'task-parent'),
    ).resolves.toBe(true);
    expect(confirmed.confirm).toHaveBeenCalledWith('plan-skill-call-id-1', 'task-parent');
    expect(confirmed.records.current()).toMatchObject({
      confirmationStatus: 'confirmed',
      status: 'running',
    });
    await expect(confirmed.service.resumeConfirmedForParentPlan('plan-parent')).resolves.toBe(true);
    expect(confirmed.resumeHumanConfirmation).toHaveBeenCalledWith({
      instanceId: 'instance-parent',
      confirmed: true,
    });

    const rejected = serviceHarness({ autoConfirm: false, parent });
    await rejected.service.execute(executionInput(rejected.skill.skillId));
    await expect(rejected.service.rejectPendingForParentPlan('plan-parent')).resolves.toBe(true);
    expect(rejected.records.current()).toMatchObject({
      confirmationStatus: 'rejected',
      status: 'rejected',
    });
    expect(rejected.resumeHumanConfirmation).toHaveBeenCalledWith({
      instanceId: 'instance-parent',
      confirmed: false,
    });
  });

  it('treats an exact duplicate child confirmation as idempotent', async () => {
    const harness = serviceHarness({ autoConfirm: false, parent: pausedParentInstance() });
    await harness.service.execute(executionInput(harness.skill.skillId));

    await expect(harness.service.confirmPendingForParentPlan('plan-parent')).resolves.toBe(true);
    await expect(harness.service.confirmPendingForParentPlan('plan-parent')).resolves.toBe(true);

    expect(harness.confirm).toHaveBeenCalledTimes(1);
    expect(harness.records.current()).toMatchObject({ confirmationStatus: 'confirmed' });
  });

  it('rejects a stale decision whose checkpoint metadata no longer matches the child linkage', async () => {
    const harness = serviceHarness({ autoConfirm: false, parent: pausedParentInstance() });
    await harness.service.execute(executionInput(harness.skill.skillId));
    harness.setParent({
      ...pausedParentInstance(),
      pendingConfirmation: {
        ...pausedParentInstance().pendingConfirmation,
        kind: 'skill_confirmation',
        nodeId: 'child',
        prompt: 'Confirm a replaced child.',
        childPlanId: 'plan-replaced-child',
      },
    });

    await expect(harness.service.confirmPendingForParentPlan('plan-parent')).rejects.toMatchObject({
      code: 'WORKFLOW_SKILL_CONFIRMATION_STALE',
    });
    expect(harness.confirm).not.toHaveBeenCalled();
  });

  it('invalidates a confirmed child plan that was superseded before parent resume', async () => {
    const harness = serviceHarness({ autoConfirm: false, parent: pausedParentInstance() });
    await harness.service.execute(executionInput(harness.skill.skillId));
    await harness.service.confirmPendingForParentPlan('plan-parent');
    harness.setPlan({
      ...childPlan(childDefinition(harness.skill.skillId, 3)),
      confirmationStatus: 'superseded',
    });

    await expect(harness.service.resumeConfirmedForParentPlan('plan-parent')).resolves.toBe(true);
    expect(harness.records.current()).toMatchObject({
      confirmationStatus: 'invalidated',
      status: 'invalidated',
      evaluationSummary: expect.stringContaining('immutable plan changed'),
    });
    expect(harness.resumeHumanConfirmation).toHaveBeenCalledWith({
      instanceId: 'instance-parent',
      confirmed: true,
    });
  });

  it('invalidates a waiting child when its current version changes and prepares a fresh plan', async () => {
    const parent = pausedParentInstance();
    const harness = serviceHarness({ autoConfirm: false, parent });
    await harness.service.execute(executionInput(harness.skill.skillId));
    harness.setSkill({ ...harness.skill, version: 4, previousVersion: 3 });

    await expect(harness.service.confirmPendingForParentPlan('plan-parent')).resolves.toBe(true);
    expect(harness.confirm).not.toHaveBeenCalled();
    expect(harness.records.current()).toMatchObject({
      skillVersion: 3,
      confirmationStatus: 'invalidated',
      status: 'invalidated',
    });
    await harness.service.resumeConfirmedForParentPlan('plan-parent');
    await expect(
      harness.service.execute(executionInput(harness.skill.skillId)),
    ).resolves.toMatchObject({
      status: 'awaiting_confirmation',
      callId: 'id-2',
      childPlanId: 'plan-skill-call-id-2',
      childSkillVersion: 4,
    });
  });

  it('rejects recursive Skills and bounds multi-level composition depth', () => {
    expect(() => nextSkillCallAncestry(['skill.parent'], 'skill.parent')).toThrow(
      expect.objectContaining({ code: 'WORKFLOW_SKILL_RECURSION_INVALID' }),
    );
    expect(() =>
      nextSkillCallAncestry(
        Array.from({ length: MAX_SKILL_CALL_DEPTH }, (_, index) => `skill.${String(index)}`),
        'skill.next',
      ),
    ).toThrow(expect.objectContaining({ code: 'WORKFLOW_SKILL_DEPTH_EXCEEDED' }));
    expect(nextSkillCallAncestry(['skill.parent'], 'skill.child')).toEqual([
      'skill.parent',
      'skill.child',
    ]);
  });
});

function serviceHarness(
  options: Readonly<{
    child?: WorkflowInstance;
    autoConfirm?: boolean;
    parent?: WorkflowInstance;
  }> = {},
) {
  const skill = childSkill(options.autoConfirm ?? true);
  let currentSkill = skill;
  const definition = childDefinition(skill.skillId, skill.version);
  const planRecord = childPlan(definition);
  let currentPlan = planRecord;
  let currentParent = options.parent;
  const plan = vi.fn((input: PlanWorkflowInput) => {
    void input;
    return Promise.resolve(planRecord);
  });
  const confirm = vi.fn(() =>
    Promise.resolve({ ...planRecord, confirmationStatus: 'confirmed' as const }),
  );
  const execute = vi.fn(() =>
    Promise.resolve(options.child ?? childInstance({ status: 'online' })),
  );
  const records = memoryRecords();
  const resumeHumanConfirmation = vi.fn(() => Promise.resolve(options.parent ?? childInstance({})));
  let idSequence = 0;
  return {
    skill,
    setSkill(value: ReturnType<typeof childSkill>) {
      currentSkill = value;
    },
    setPlan(value: WorkflowPlanRecord) {
      currentPlan = value;
    },
    setParent(value: WorkflowInstance) {
      currentParent = value;
    },
    plan,
    confirm,
    execute,
    saveRecord: records.save,
    records,
    resumeHumanConfirmation,
    service: new SkillCallWorkflowService({
      skills: { findCurrentVersion: () => Promise.resolve(currentSkill) } as never,
      planner: { plan },
      validator: {
        validate: () => Promise.resolve({ valid: true, errors: [], definition }),
      },
      execution: {
        confirm,
        execute,
        get: () => Promise.resolve(undefined),
        findActiveByPlanId: () => Promise.resolve(currentParent),
        resumeHumanConfirmation,
      },
      plans: { findPlan: () => Promise.resolve(currentPlan) },
      confirmation: {
        evaluate: () =>
          Promise.resolve({
            autoConfirm: options.autoConfirm ?? true,
            skillVersions: [],
            blockingSkillIds: options.autoConfirm === false ? [skill.skillId] : [],
          }),
      },
      records,
      schemas: new AjvJsonSchemaValidator(),
      loadToolPlanningMetadata: () => Promise.resolve([]),
      clock: { now: () => '2026-07-12T00:00:01.000Z' },
      nextId: () => `id-${String(++idSequence)}`,
    }),
  };
}

function childSkill(autoConfirmPlan = true) {
  return createSkillVersion({
    skillId: 'skill.child',
    version: 3,
    previousVersion: 2,
    name: 'Child',
    summary: 'Child Skill.',
    description: 'Child Skill execution.',
    capabilities: ['child'],
    workflowGuidance: 'Read the registered device Tool and return status.',
    outputInstruction: 'Return status.',
    inputSchema: {
      type: 'object',
      required: ['deviceId'],
      properties: { deviceId: { type: 'string' } },
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['online'] } },
      additionalProperties: false,
    },
    toolPolicy: {
      required: [{ serverId: 'mcp.devices', toolName: 'device_status' }],
      optional: [],
      forbidden: [],
    },
    runtimePolicy: { autoConfirmPlan },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  });
}

function childDefinition(skillId: string, version: number): WorkflowDefinition {
  return {
    workflowDefinitionId: `workflow-skill-${skillId}-${String(version)}-id-1`,
    version,
    goalId: 'goal-1',
    goalVersion: 1,
    entryNodeId: 'tool',
    exitNodeIds: ['result'],
    nodes: [
      {
        nodeId: 'tool',
        name: 'Read device',
        type: 'mcp_tool',
        tool: { serverId: 'mcp.devices', toolName: 'device_status' },
        arguments: { deviceId: { op: 'ref', path: ['input', 'deviceId'] } },
      },
      {
        nodeId: 'result',
        name: 'Return result',
        type: 'result',
        value: { op: 'literal', value: true },
      },
    ],
    edges: [{ sourceNodeId: 'tool', targetNodeId: 'result' }],
  };
}

function childPlan(definition: WorkflowDefinition): WorkflowPlanRecord {
  return {
    planId: 'plan-skill-call-id-1',
    goalId: definition.goalId,
    goalVersion: definition.goalVersion,
    definition,
    confirmationStatus: 'awaiting_confirmation',
    attemptCount: 1,
    createdAt: '2026-07-12T00:00:01.000Z',
  };
}

function childInstance(
  result: unknown,
  status: WorkflowInstance['status'] = 'succeeded',
): WorkflowInstance {
  return {
    instanceId: 'instance-skill-call-id-1',
    planId: 'plan-skill-call-id-1',
    workflowDefinitionId: 'workflow-skill-skill.child-3-id-1',
    workflowVersion: 3,
    goalId: 'goal-1',
    goalVersion: 1,
    skillVersions: [{ skillId: 'skill.child', version: 3 }],
    budgetLimits: {
      maxReplans: 1,
      maxDurationSeconds: 60,
      maxLlmCalls: 2,
      maxMcpCalls: 1,
      maxCost: 10,
    },
    budgetUsage: { replanCount: 0, durationMs: 5, llmCalls: 0, mcpCalls: 1, cost: 1 },
    status,
    input: { deviceId: 'device-1' },
    ...(result === undefined ? {} : { result }),
    errors: status === 'failed' ? { child: { code: 'MCP_FAILED', message: 'failed' } } : {},
    startedAt: '2026-07-12T00:00:01.000Z',
    completedAt: '2026-07-12T00:00:02.000Z',
  };
}

function executionInput(skillId: string) {
  return {
    skillId,
    value: { deviceId: 'device-1' },
    parentPlanId: 'plan-parent',
    parentInstanceId: 'instance-parent',
    parentNodeId: 'child',
    parentGoalId: 'goal-1',
    parentGoalVersion: 1,
  };
}

function pausedParentInstance(): WorkflowInstance {
  const terminal = childInstance(undefined);
  return {
    ...terminal,
    instanceId: 'instance-parent',
    planId: 'plan-parent',
    status: 'paused',
    pendingConfirmation: {
      nodeId: 'child',
      prompt: 'Confirm child.',
      kind: 'skill_confirmation',
      parentPlanId: 'plan-parent',
      childPlanId: 'plan-skill-call-id-1',
      childSkillId: 'skill.child',
      childSkillVersion: 3,
    },
  };
}

function memoryRecords() {
  let record: SkillCallWorkflowRecord | undefined;
  return {
    save: vi.fn((value: SkillCallWorkflowRecord) => {
      record = value;
      return Promise.resolve();
    }),
    find: vi.fn(() => Promise.resolve(record)),
    listByParent: vi.fn(() => Promise.resolve(record === undefined ? [] : [record])),
    current: () => record,
  };
}
