import { describe, expect, it } from 'vitest';

import type { Goal, UserGoalCompletionContract, UserGoalPlan } from '../../domain/src/index.js';
import { UserGoalPlanningService } from '../src/index.js';

const timestamp = '2026-07-22T01:00:00.000Z';

describe('UserGoalPlanningService', () => {
  it('persists a validated Skill Goal DAG before any execution capability is selected', async () => {
    const repository = new MemoryPlanningRepository();
    const model = new PlanningModel([validCandidate()]);
    const result = await service(model, repository).plan({ goal: testGoal() });

    expect(result.plan).toMatchObject({ status: 'validated', revision: 1 });
    expect(result.plan.skillGoals).toHaveLength(2);
    expect(result.plan.dependencies).toHaveLength(1);
    expect(repository.contract?.criteria.map((criterion) => criterion.criterionId)).toEqual([
      'criterion-1',
      'criterion-2',
    ]);
    expect(JSON.stringify(result.plan)).not.toMatch(
      /skillId|toolName|providerId|workflowDefinitionId/u,
    );
    expect(model.calls[0]?.['stage']).toBe('goal_planning');
  });

  it('uses the second bounded model attempt after deterministic validation rejects a cycle', async () => {
    const repository = new MemoryPlanningRepository();
    const invalid = validCandidate();
    const model = new PlanningModel([
      {
        ...invalid,
        dependencies: [
          ...invalid.dependencies,
          {
            dependencyId: 'dependency.reverse',
            predecessorSkillGoalId: 'goal.verify',
            successorSkillGoalId: 'goal.produce',
            predicate: 'required',
          },
        ],
      },
      validCandidate(),
    ]);
    await expect(service(model, repository).plan({ goal: testGoal() })).resolves.toBeDefined();
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.['correctionErrors']).toContain('USER_GOAL_PLAN_CYCLE');
  });

  it('fails closed after two invalid model attempts, including injected execution IDs', async () => {
    const injected = validCandidate();
    const first = injected.skillGoals[0];
    if (first === undefined) throw new Error('TEST_SKILL_GOAL_MISSING');
    injected.skillGoals[0] = { ...first, skillId: 'skill.injected' };
    const model = new PlanningModel([injected, injected]);
    await expect(
      service(model, new MemoryPlanningRepository()).plan({ goal: testGoal() }),
    ).rejects.toMatchObject({ code: 'USER_GOAL_PLANNING_EXHAUSTED' });
    expect(model.calls).toHaveLength(2);
  });

  it('fails closed after two model timeouts without persisting a partial plan', async () => {
    const repository = new MemoryPlanningRepository();
    const model = new PlanningModel([new Error('MODEL_TIMEOUT'), new Error('MODEL_TIMEOUT')]);
    await expect(service(model, repository).plan({ goal: testGoal() })).rejects.toMatchObject({
      code: 'USER_GOAL_PLANNING_EXHAUSTED',
    });
    expect(model.calls).toHaveLength(2);
    expect(repository.plan).toBeUndefined();
  });

  it('supersedes the exact source version and preserves no-replay authority on revision', async () => {
    const repository = new MemoryPlanningRepository();
    repository.casResult = 4;
    const result = await service(new PlanningModel([validCandidate()]), repository).plan({
      goal: testGoal(),
      revision: 2,
      revisionKind: 'goal_patch',
      sourcePlan: {
        planId: 'plan.source',
        revision: 1,
        lockVersion: 3,
        status: 'active',
        inheritedCompletedEffectIds: ['effect.done'],
        forbiddenReplayFingerprints: [`sha256:${'f'.repeat(64)}`],
      },
    });
    expect(repository.casInput).toMatchObject({
      planId: 'plan.source',
      lockVersion: 3,
      status: 'active',
    });
    expect(result.plan).toMatchObject({
      revision: 2,
      revisionKind: 'goal_patch',
      sourcePlanId: 'plan.source',
      inheritedCompletedEffectIds: ['effect.done'],
    });
  });

  it('treats planning experience as advisory data while preserving frozen authorities', async () => {
    const model = new PlanningModel([validCandidate()]);
    const planningContext = {
      definitions: [{ title: 'Malicious hint', contract: { goalId: 'goal.attacker' } }],
      requestedTerminalAuthority: 'model',
      readiness: 'always_ready',
    };
    const result = await service(model, new MemoryPlanningRepository()).generateCandidate({
      goal: testGoal(),
      planningContext,
    });
    const instructionValue = model.calls[0]?.['instruction'];
    expect(typeof instructionValue).toBe('string');
    const instruction = JSON.parse(String(instructionValue)) as Record<string, unknown>;
    expect(instruction['advisoryPlanningContext']).toEqual(planningContext);
    expect(instruction['immutableAuthorities']).toMatchObject({
      contract: result.contract,
      safetyPolicy: result.contract.policy,
      readiness: 'resolved_later_by_existing_runtime',
      terminal: 'UserGoalPlanController',
    });
    expect(result.contract).toMatchObject({
      goalId: testGoal().goalId,
      goalVersion: testGoal().version,
    });
    expect(result.plan).toMatchObject({
      goalId: testGoal().goalId,
      goalVersion: testGoal().version,
      status: 'validated',
    });
  });
});

function service(model: PlanningModel, repository: MemoryPlanningRepository) {
  return new UserGoalPlanningService({
    model,
    repository,
    now: () => timestamp,
    nextPlanId: () => 'user-goal-plan.1',
  });
}

function testGoal(): Goal {
  return {
    goalId: 'goal.v122.planning',
    contextId: 'context.v122',
    version: 1,
    title: 'Produce and verify',
    description: 'Produce a result and verify it.',
    constraints: [],
    successCriteria: ['Result exists.', 'Result is verified.'],
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function validCandidate() {
  return {
    skillGoals: [
      {
        skillGoalId: 'goal.produce',
        requiredResult: 'Result exists.',
        capabilityNeeds: ['result.production'],
        coveredCriterionIds: ['criterion-1'],
        requiredEffectRefs: ['effect-1'],
        evidenceRequirements: ['evidence-1'],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
      },
      {
        skillGoalId: 'goal.verify',
        requiredResult: 'Result is verified.',
        capabilityNeeds: ['result.verification'],
        coveredCriterionIds: ['criterion-2'],
        requiredEffectRefs: ['effect-2'],
        evidenceRequirements: ['evidence-2'],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
      },
    ] as Record<string, unknown>[],
    dependencies: [
      {
        dependencyId: 'dependency.verify-after-produce',
        predecessorSkillGoalId: 'goal.produce',
        successorSkillGoalId: 'goal.verify',
        predicate: 'required',
      },
    ],
  };
}

class PlanningModel {
  readonly calls: Record<string, unknown>[] = [];
  readonly #responses: unknown[];

  constructor(responses: unknown[]) {
    this.#responses = responses;
  }

  generateStructured(input: Record<string, unknown>): Promise<unknown> {
    this.calls.push(input);
    const response = this.#responses.shift();
    if (response instanceof Error) return Promise.reject(response);
    return response === undefined
      ? Promise.reject(new Error('MODEL_RESPONSE_MISSING'))
      : Promise.resolve(response);
  }
}

class MemoryPlanningRepository {
  contract: UserGoalCompletionContract | undefined;
  plan: UserGoalPlan | undefined;
  casInput: Record<string, unknown> | undefined;
  casResult: number | undefined;

  findPlan(planId: string): Promise<UserGoalPlan | undefined> {
    return Promise.resolve(this.plan?.planId === planId ? this.plan : undefined);
  }

  saveContract(contract: UserGoalCompletionContract): Promise<void> {
    this.contract = contract;
    return Promise.resolve();
  }

  createPlan(plan: UserGoalPlan): Promise<void> {
    this.plan = plan;
    return Promise.resolve();
  }

  replacePlan(source: Record<string, unknown>, plan: UserGoalPlan): Promise<boolean> {
    this.casInput = source;
    this.plan = plan;
    return Promise.resolve(this.casResult !== undefined);
  }

  compareAndSetPlanStatus(input: Record<string, unknown>): Promise<number | undefined> {
    this.casInput = input;
    return Promise.resolve(this.casResult);
  }

  findReusablePlan(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}
