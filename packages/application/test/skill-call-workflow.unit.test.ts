import { describe, expect, it, vi } from 'vitest';

import { createSkillVersion } from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import { SkillCallWorkflowService } from '../src/skill-call-workflow.js';

describe('SkillCallWorkflowService', () => {
  it('resolves the current Skill version and persists an independently evaluated child instance', async () => {
    const skill = createSkillVersion({
      skillId: 'skill.child',
      version: 3,
      previousVersion: 2,
      name: 'Child',
      summary: 'Child Skill.',
      description: 'Child Skill execution.',
      capabilities: ['child'],
      workflowGuidance: 'Return status.',
      outputInstruction: 'Return status.',
      inputSchema: {
        type: 'object',
        required: ['deviceId'],
        properties: { deviceId: { type: 'string' } },
        additionalProperties: false,
      },
      outputSchema: { type: 'object', required: ['status'] },
      toolPolicy: { required: [], optional: [], forbidden: [] },
      runtimePolicy: { autoConfirmPlan: false },
      status: 'enabled',
      sourceKind: 'admin',
      validationPassed: true,
      createdAt: '2026-07-12T00:00:00.000Z',
    });
    const savePlan = vi.fn(() => Promise.resolve());
    const saveRecord = vi.fn(() => Promise.resolve());
    const execute = vi.fn(() =>
      Promise.resolve({
        instanceId: 'instance-skill-call-id-1',
        planId: 'plan-skill-call-id-1',
        workflowDefinitionId: 'workflow-skill-skill.child-3',
        workflowVersion: 3,
        goalId: 'goal-1',
        goalVersion: 1,
        skillVersions: [{ skillId: skill.skillId, version: skill.version }],
        budgetLimits: {
          maxReplans: 1,
          maxDurationSeconds: 60,
          maxLlmCalls: 2,
          maxMcpCalls: 0,
          maxCost: 10,
        },
        budgetUsage: { replanCount: 0, durationMs: 5, llmCalls: 1, mcpCalls: 0, cost: 1 },
        status: 'succeeded' as const,
        input: {},
        result: { status: 'online' },
        errors: {},
        startedAt: '2026-07-12T00:00:01.000Z',
        completedAt: '2026-07-12T00:00:02.000Z',
      }),
    );
    const service = new SkillCallWorkflowService({
      skills: { findCurrentVersion: () => Promise.resolve(skill) } as never,
      plans: { savePlan } as never,
      execution: { execute },
      records: { save: saveRecord } as never,
      schemas: new AjvJsonSchemaValidator(),
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
      }),
    ).resolves.toEqual({ status: 'online' });
    expect(savePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationStatus: 'confirmed',
        definition: expect.objectContaining({ version: 3 }),
      }),
    );
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ skillIds: [skill.skillId] }));
    expect(saveRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        parentInstanceId: 'instance-parent',
        childInstanceId: 'instance-skill-call-id-1',
        skillVersion: 3,
        status: 'succeeded',
      }),
    );

    savePlan.mockClear();
    execute.mockClear();
    saveRecord.mockClear();
    await expect(
      service.execute({
        skillId: skill.skillId,
        value: { deviceId: 42 },
        parentInstanceId: 'instance-parent',
        parentNodeId: 'child',
        parentGoalId: 'goal-1',
        parentGoalVersion: 1,
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_SKILL_INPUT_INVALID',
      message: expect.stringContaining('skill.child@3'),
    });
    expect(savePlan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
  });
});
