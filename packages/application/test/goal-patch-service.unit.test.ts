import { describe, expect, it } from 'vitest';

import {
  createGoalExecutionContract,
  type Goal,
  type GoalPatchRecord,
  type SkillVersion,
  type WorkflowPlanRecord,
  type UserGoalPlan,
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
  goalContract: createGoalExecutionContract(goal),
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
    const reparsedGoalVersions: number[] = [];
    let applyCount = 0;
    let modelCallCount = 0;
    let inputRequired = false;
    let loadedSourcePlan = sourcePlan;
    const userGoalPlanningInputs: unknown[] = [];
    const currentUserGoalPlan: UserGoalPlan = {
      schemaVersion: '1.0',
      planId: 'user-goal-plan-1',
      goalId: goal.goalId,
      goalVersion: goal.version,
      revision: 1,
      revisionKind: 'initial',
      status: 'active',
      contractHash: `sha256:${'a'.repeat(64)}`,
      contentHash: `sha256:${'b'.repeat(64)}`,
      skillGoals: [],
      dependencies: [],
      inheritedCompletedEffectIds: ['effect.already-complete'],
      forbiddenReplayFingerprints: [`sha256:${'c'.repeat(64)}`],
      createdAt: '2026-07-12T00:00:00.000Z',
    };
    const service = new GoalPatchService({
      goals: {
        findById: () => Promise.resolve(goal),
        findActiveByContextId: () => Promise.resolve(goal),
        findLatestByContextId: () => Promise.resolve(goal),
        listByContextId: () => Promise.resolve([goal]),
        listTransitions: () => Promise.resolve([]),
        save: () => Promise.resolve(),
      },
      plans: {
        findPlan: () => Promise.resolve(loadedSourcePlan),
        findConfirmedDefinition: () => Promise.resolve(undefined),
        confirmPlan: () => Promise.resolve(),
        saveAttempt: () => Promise.resolve(),
        savePlan: () => Promise.resolve(),
        savePlanAndSupersede: () => Promise.resolve(),
      },
      patches: {
        apply: (record, triggeringTaskId) => {
          applyCount += 1;
          persisted = {
            ...record,
            ...(triggeringTaskId === undefined ? {} : { triggeringTaskId }),
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
            goalContract: input.goalContract,
            confirmationStatus: 'awaiting_confirmation',
            attemptCount: 1,
            createdAt: '2026-07-12T00:00:01.000Z',
          });
        },
      },
      skills: skillsWithCompensation(),
      model: {
        generateStructured: () => {
          modelCallCount += 1;
          return Promise.resolve({
            changes: { constraints: ['read-only', 'include temperature'] },
            decisionSummary: 'Added the requested constraint.',
          });
        },
      },
      clock: { now: () => '2026-07-12T00:00:01.000Z' },
      ids: { nextPatchId: () => 'patch-1', nextPlanId: () => 'plan-2' },
      userGoalPlans: {
        findCurrentPlan: () => Promise.resolve({ plan: currentUserGoalPlan, lockVersion: 3 }),
        listValidCompletedEffects: () =>
          Promise.resolve([
            {
              completedEffectId: 'completed-effect.persisted',
              goalId: 'goal-1',
              planId: 'user-goal-plan-1',
              skillGoalId: 'skill-goal-1',
              status: 'verified' as const,
              effectFingerprint: `sha256:${'d'.repeat(64)}`,
              evidenceRefs: ['evidence.persisted'],
              createdAt: '2026-07-12T00:00:00.000Z',
            },
          ]),
      },
      userGoalPlanning: {
        plan: (input) => {
          userGoalPlanningInputs.push(input);
          return Promise.resolve({ contract: {} as never, plan: currentUserGoalPlan });
        },
      },
      beforeReplan: {
        prepare: ({ goal: patchedGoal }) => {
          reparsedGoalVersions.push(patchedGoal.version);
          if (inputRequired) return Promise.resolve({ status: 'input_required' as const });
          return Promise.resolve({
            status: 'ready' as const,
            planningContext: {
              resolutionId: 'skill-input-resolution-patch-1',
              structuredInput: { deviceId: 'device-1' },
            },
          });
        },
      },
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
      triggeringTaskId: 'task-1',
      compensationWarnings: [expect.stringContaining('no automatic compensation')],
    });
    expect(planning[0]).toMatchObject({
      planId: 'plan-2',
      taskId: 'task-1',
      goalVersion: 2,
      goalContract: {
        goalId: 'goal-1',
        version: 2,
        constraints: ['read-only', 'include temperature'],
      },
      sourcePlanId: 'plan-1',
      revisionKind: 'replan',
    });
    expect(JSON.stringify(planning[0])).toContain('always_require_confirmation');
    expect(JSON.stringify(planning[0])).toContain('skill-input-resolution-patch-1');
    expect(userGoalPlanningInputs[0]).toMatchObject({ taskId: 'task-1' });
    expect(JSON.stringify(planning[0])).toContain('Restore the prior calibration value.');
    expect(userGoalPlanningInputs).toEqual([
      expect.objectContaining({
        goal: expect.objectContaining({ version: 2 }),
        revision: 2,
        revisionKind: 'goal_patch',
        sourcePlan: expect.objectContaining({
          planId: 'user-goal-plan-1',
          lockVersion: 3,
          inheritedCompletedEffectIds: ['effect.already-complete', 'completed-effect.persisted'],
          forbiddenReplayFingerprints: [`sha256:${'c'.repeat(64)}`, `sha256:${'d'.repeat(64)}`],
        }),
      }),
    ]);
    expect(reparsedGoalVersions).toEqual([2]);
    inputRequired = true;
    await expect(
      service.apply({
        goalId: goal.goalId,
        sourcePlanId: sourcePlan.planId,
        instruction: 'Also include humidity.',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'GOAL_PATCH_SKILL_INPUT_REQUIRED' });
    expect(applyCount).toBe(1);
    expect(planning).toHaveLength(1);

    loadedSourcePlan = {
      ...sourcePlan,
      goalContract: { ...sourcePlan.goalContract, constraints: ['write allowed'] },
    };
    const modelCallsBeforeStalePatch = modelCallCount;
    await expect(
      service.apply({
        goalId: goal.goalId,
        sourcePlanId: sourcePlan.planId,
        instruction: 'Use the stale plan.',
        taskId: 'task-1',
      }),
    ).rejects.toMatchObject({ code: 'GOAL_PATCH_SOURCE_PLAN_INVALID' });
    expect(modelCallCount).toBe(modelCallsBeforeStalePatch);
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
