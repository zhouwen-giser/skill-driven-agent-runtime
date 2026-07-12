import { describe, expect, it } from 'vitest';

import type {
  Goal,
  GoalPatchRecord,
  SkillVersion,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';
import { GoalPatchService, type PlanWorkflowInput } from '../src/index.js';

const goal: Goal = {
  goalId: 'goal-1',
  contextId: 'context-1',
  version: 1,
  title: 'Inspect',
  description: 'Inspect device 1.',
  constraints: ['read-only'],
  successCriteria: ['status returned'],
  status: 'active',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};
const sourcePlan: WorkflowPlanRecord = {
  planId: 'plan-1',
  goalId: goal.goalId,
  goalVersion: 1,
  definition: {
    workflowDefinitionId: 'workflow-1',
    version: 1,
    goalId: goal.goalId,
    goalVersion: 1,
    entryNodeId: 'tool',
    exitNodeIds: ['result'],
    nodes: [
      {
        nodeId: 'tool',
        name: 'Read',
        type: 'mcp_tool',
        tool: { serverId: 'devices', toolName: 'read' },
        arguments: {},
      },
      {
        nodeId: 'skill',
        name: 'Calibrate',
        type: 'skill_call',
        skillId: 'skill.calibrate',
        input: {},
      },
      {
        nodeId: 'result',
        name: 'Result',
        type: 'result',
        value: { op: 'literal', value: true },
      },
    ],
    edges: [
      { sourceNodeId: 'tool', targetNodeId: 'skill' },
      { sourceNodeId: 'skill', targetNodeId: 'result' },
    ],
  },
  confirmationStatus: 'confirmed',
  attemptCount: 1,
  createdAt: '2026-07-12T00:00:00.000Z',
};

describe('GoalPatchService', () => {
  it('invalidates first, records compensation risk, and always replans awaiting confirmation', async () => {
    let persisted: GoalPatchRecord | undefined;
    const planning: PlanWorkflowInput[] = [];
    const service = new GoalPatchService({
      goals: {
        findById: () => Promise.resolve(goal),
        findActiveByContextId: () => Promise.resolve(goal),
        save: () => Promise.resolve(),
      },
      plans: {
        findPlan: () => Promise.resolve(sourcePlan),
        findConfirmedDefinition: () => Promise.resolve(undefined),
        confirmPlan: () => Promise.resolve(),
        saveAttempt: () => Promise.resolve(),
        savePlan: () => Promise.resolve(),
        savePlanAndSupersede: () => Promise.resolve(),
      },
      patches: {
        apply: (record) => {
          persisted = {
            ...record,
            invalidatedPlanIds: ['plan-1'],
            invalidatedInstanceIds: ['instance-1'],
          };
          return Promise.resolve(persisted);
        },
        find: () => Promise.resolve(persisted),
        listByGoal: () => Promise.resolve(persisted === undefined ? [] : [persisted]),
      },
      planner: {
        plan: (input) => {
          planning.push(input);
          return Promise.resolve({
            planId: input.planId,
            goalId: input.goalId,
            goalVersion: input.goalVersion,
            confirmationStatus: 'awaiting_confirmation',
            attemptCount: 1,
            createdAt: '2026-07-12T00:00:01.000Z',
          });
        },
      },
      skills: skillsWithCompensation(),
      model: {
        generateStructured: () =>
          Promise.resolve({
            changes: { constraints: ['read-only', 'include temperature'] },
            decisionSummary: 'Added the requested constraint.',
          }),
      },
      clock: { now: () => '2026-07-12T00:00:01.000Z' },
      ids: { nextPatchId: () => 'patch-1', nextPlanId: () => 'plan-2' },
    });

    await expect(
      service.apply({
        goalId: goal.goalId,
        sourcePlanId: sourcePlan.planId,
        instruction: 'Also include temperature.',
        taskId: 'task-1',
      }),
    ).resolves.toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      newPlanId: 'plan-2',
      compensationWarnings: [expect.stringContaining('no automatic compensation')],
    });
    expect(planning[0]).toMatchObject({
      planId: 'plan-2',
      goalVersion: 2,
      sourcePlanId: 'plan-1',
      revisionKind: 'replan',
    });
    expect(JSON.stringify(planning[0])).toContain('always_require_confirmation');
    expect(JSON.stringify(planning[0])).toContain('Restore the prior calibration value.');
  });
});

function skillsWithCompensation() {
  const version: SkillVersion = {
    skillId: 'skill.calibrate',
    version: 1,
    name: 'Calibrate',
    summary: 'Calibrate a device.',
    description: 'Calibrates a device.',
    capabilities: ['calibration'],
    workflowGuidance: 'Calibrate once.',
    outputInstruction: 'Return the calibration.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: {
      autoConfirmPlan: true,
      compensationGuidance: 'Restore the prior calibration value.',
    },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  return {
    find: () => Promise.resolve(undefined),
    findCurrentVersion: () => Promise.resolve(version),
    findVersion: () => Promise.resolve(version),
    listVersions: () => Promise.resolve([]),
    listEnabledVersions: () => Promise.resolve([]),
    listCurrentVersions: () => Promise.resolve([]),
    saveVersionAndSetCurrent: () => Promise.resolve(),
  };
}
