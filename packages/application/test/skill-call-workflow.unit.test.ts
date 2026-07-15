import { describe, expect, it, vi } from 'vitest';

import type {
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { createSkillVersion } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
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
    const saveRecord = vi.fn(() => Promise.resolve());
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
      execution: { confirm, execute },
      records: { save: saveRecord } as never,
      schemas: new AjvJsonSchemaValidator(),
      loadToolPlanningMetadata,
      clock: { now: () => '2026-07-12T00:00:01.000Z' },
      nextId: () => 'id-1',
    });

    await expect(
      service.execute({
        skillId: skill.skillId,
        value: { deviceId: 'device-1' },
        parentInstanceId: 'instance-parent',
        parentNodeId: 'child',
        parentGoalId: 'goal-1',
        parentGoalVersion: 1,
        signal,
      }),
    ).resolves.toEqual({ status: 'online' });

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
    });
    expect(saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
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

function serviceHarness(options: Readonly<{ child?: WorkflowInstance }> = {}) {
  const skill = childSkill();
  const definition = childDefinition(skill.skillId, skill.version);
  const planRecord = childPlan(definition);
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
  const saveRecord = vi.fn(() => Promise.resolve());
  return {
    skill,
    plan,
    confirm,
    execute,
    saveRecord,
    service: new SkillCallWorkflowService({
      skills: { findCurrentVersion: () => Promise.resolve(skill) } as never,
      planner: { plan },
      validator: {
        validate: () => Promise.resolve({ valid: true, errors: [], definition }),
      },
      execution: { confirm, execute },
      records: { save: saveRecord } as never,
      schemas: new AjvJsonSchemaValidator(),
      loadToolPlanningMetadata: () => Promise.resolve([]),
      clock: { now: () => '2026-07-12T00:00:01.000Z' },
      nextId: () => 'id-1',
    }),
  };
}

function childSkill() {
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
    runtimePolicy: { autoConfirmPlan: false },
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
    parentInstanceId: 'instance-parent',
    parentNodeId: 'child',
    parentGoalId: 'goal-1',
    parentGoalVersion: 1,
  };
}
