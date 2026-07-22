import { describe, expect, it } from 'vitest';

import { createSkillVersion, type SkillAttempt, type SkillGoal } from '../../domain/src/index.js';
import { isSkillGoalCompatible, SkillGoalScheduler } from '../src/index.js';

const timestamp = '2026-07-22T02:00:00.000Z';

describe('SkillGoalScheduler', () => {
  it('dispatches only ready Goals and performs candidate work after dispatch-intent commit', async () => {
    const repository = new MemoryDispatchRepository([skillGoal('goal.a', 'effect.a')]);
    const scheduler = createScheduler(repository, (goal) => {
      expect(repository.lockHeld).toBe(false);
      return Promise.resolve([skill(goal.skillGoalId, 'effect.a')]);
    });
    const dispatched = await scheduler.dispatchReady('plan.1');
    expect(dispatched).toHaveLength(1);
    expect(repository.calls).toEqual(['list-ready', 'claim:goal.a', 'save:goal.a']);
    expect(dispatched[0]).toMatchObject({
      kind: 'selected',
      attempt: { status: 'selecting', skillGoalId: 'goal.a' },
      skill: { skillId: 'skill.goal.a', version: 1 },
    });
    const selected = dispatched[0];
    if (selected?.kind !== 'selected') throw new Error('TEST_SELECTED_DISPATCH_REQUIRED');
    const execution = await scheduler.createExecutionContract({
      attempt: selected.attempt,
      skill: selected.skill,
      resolvedInput: { value: 'resolved' },
    });
    expect(execution).toMatchObject({
      attempt: { status: 'planning_workflow' },
      contract: { resolvedInput: { value: 'resolved' } },
    });
  });

  it('dispatches at most four disjoint-effect Goals in parallel and serializes conflicts', async () => {
    const disjoint = new MemoryDispatchRepository(
      ['a', 'b', 'c', 'd', 'e'].map((id) => skillGoal(`goal.${id}`, `effect.${id}`)),
    );
    await createScheduler(disjoint, (goal) =>
      Promise.resolve([skill(goal.skillGoalId, goal.requiredEffectRefs[0] ?? 'effect.unknown')]),
    ).dispatchReady('plan.parallel');
    expect(disjoint.claimed).toEqual(['goal.a', 'goal.b', 'goal.c', 'goal.d']);

    const conflict = new MemoryDispatchRepository([
      skillGoal('goal.first', 'effect.shared'),
      skillGoal('goal.second', 'effect.shared'),
    ]);
    await createScheduler(conflict, (goal) =>
      Promise.resolve([skill(goal.skillGoalId, 'effect.shared')]),
    ).dispatchReady('plan.serial');
    expect(conflict.claimed).toEqual(['goal.first']);
  });

  it('rejects a Skill that misses capability, effect, evidence or artifact requirements', () => {
    const goal = {
      ...skillGoal('goal.compatibility', 'effect.required'),
      capabilityNeeds: ['capability.required'],
      evidenceRequirements: ['evidence.required'],
      artifactRequirements: ['artifact.required'],
    };
    const candidate = skill('goal.compatibility', 'effect.required');
    const outcome = candidate.outcomeSpecification;
    if (outcome === undefined) throw new Error('TEST_OUTCOME_SPECIFICATION_MISSING');
    expect(isSkillGoalCompatible(goal, candidate)).toBe(false);
    expect(
      isSkillGoalCompatible(goal, {
        ...candidate,
        capabilities: ['capability.required'],
        outcomeSpecification: {
          ...outcome,
          evidence: ['evidence.required'],
          artifacts: ['artifact.required'],
        },
      }),
    ).toBe(true);
  });

  it('rejects incompatible and unknown policy requirements before selection', () => {
    const candidate = skill('goal.policy', 'effect.policy');
    expect(
      isSkillGoalCompatible(
        {
          ...skillGoal('goal.policy', 'effect.policy'),
          constraints: ['policy.confirmation=required', 'policy.replay=forbidden'],
        },
        candidate,
      ),
    ).toBe(true);
    expect(
      isSkillGoalCompatible(
        {
          ...skillGoal('goal.policy', 'effect.policy'),
          constraints: ['policy.side_effect=read_only'],
        },
        candidate,
      ),
    ).toBe(false);
    expect(
      isSkillGoalCompatible(
        { ...skillGoal('goal.policy', 'effect.policy'), constraints: ['policy.unknown=value'] },
        candidate,
      ),
    ).toBe(false);
  });

  it('lets one duplicate-dispatch contender win through repository CAS', async () => {
    const repository = new MemoryDispatchRepository([skillGoal('goal.race', 'effect.race')]);
    repository.onlyFirstClaim = true;
    const scheduler = createScheduler(repository, (goal) =>
      Promise.resolve([skill(goal.skillGoalId, 'effect.race')]),
    );
    const [left, right] = await Promise.all([
      scheduler.dispatchReady('plan.race'),
      scheduler.dispatchReady('plan.race'),
    ]);
    expect(left.length + right.length).toBe(1);
  });
});

function createScheduler(
  repository: MemoryDispatchRepository,
  list: (goal: SkillGoal) => Promise<readonly ReturnType<typeof skill>[]>,
) {
  let attempt = 0;
  let contract = 0;
  return new SkillGoalScheduler({
    repository,
    candidates: { list },
    now: () => timestamp,
    nextAttemptId: () => `attempt.${String(++attempt)}`,
    nextExecutionContractId: () => `execution-contract.${String(++contract)}`,
  });
}

function skillGoal(skillGoalId: string, effect: string): SkillGoal {
  return {
    skillGoalId,
    requiredResult: `Complete ${skillGoalId}.`,
    capabilityNeeds: [`capability.${skillGoalId}`],
    coveredCriterionIds: [`criterion.${skillGoalId}`],
    requiredEffectRefs: [effect],
    evidenceRequirements: [`evidence.${skillGoalId}`],
    artifactRequirements: [],
    assumptions: [],
    constraints: ['policy.parallel=safe'],
    status: 'ready',
  };
}

function skill(skillGoalId: string, effect: string) {
  return createSkillVersion({
    skillId: `skill.${skillGoalId}`,
    version: 1,
    name: skillGoalId,
    summary: `Skill for ${skillGoalId}.`,
    description: `Completes ${skillGoalId}.`,
    capabilities: [`capability.${skillGoalId}`],
    workflowGuidance: 'Execute once.',
    outputInstruction: 'Return evidence.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false, maxReplans: 1, maxLlmCalls: 2, maxMcpCalls: 2 },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: timestamp,
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId: `skill.${skillGoalId}`,
      skillVersion: 1,
      effects: [effect],
      evidence: [`evidence.${skillGoalId}`],
      artifacts: [],
      taskGoalPolicy: { requireAllEffects: true },
      confidencePolicy: { achievedMinimum: 'high' },
      sideEffectPolicy: { replay: 'forbidden', parallel: 'safe' },
      specificationHash: `sha256:${'a'.repeat(64)}`,
    },
  });
}

class MemoryDispatchRepository {
  readonly ready: readonly SkillGoal[];
  readonly calls: string[] = [];
  readonly claimed: string[] = [];
  readonly rejected: string[] = [];
  lockHeld = false;
  onlyFirstClaim = false;

  constructor(ready: readonly SkillGoal[]) {
    this.ready = ready;
  }

  listReadySkillGoals(): Promise<readonly SkillGoal[]> {
    this.calls.push('list-ready');
    return Promise.resolve(this.ready);
  }

  findPlan(): Promise<
    Readonly<{ revision: number; forbiddenReplayFingerprints: readonly string[] }>
  > {
    return Promise.resolve({ revision: 1, forbiddenReplayFingerprints: [] });
  }

  nextAttemptOrdinal(): Promise<number> {
    return Promise.resolve(1);
  }

  createDispatchIntent(attempt: SkillAttempt): Promise<boolean> {
    this.lockHeld = true;
    try {
      if (this.onlyFirstClaim && this.claimed.length > 0) return Promise.resolve(false);
      this.claimed.push(attempt.skillGoalId);
      this.calls.push(`claim:${attempt.skillGoalId}`);
      return Promise.resolve(true);
    } finally {
      this.lockHeld = false;
    }
  }

  saveExecutionContract(attempt: SkillAttempt): Promise<void> {
    this.calls.push(`save:${attempt.skillGoalId}`);
    return Promise.resolve();
  }

  saveSelectedAttempt(attempt: SkillAttempt): Promise<void> {
    this.calls.push(`save:${attempt.skillGoalId}`);
    return Promise.resolve();
  }

  rejectDispatchIntent(attempt: SkillAttempt): Promise<void> {
    this.rejected.push(attempt.skillGoalId);
    return Promise.resolve();
  }

  findAttempt(): Promise<SkillAttempt | undefined> {
    return Promise.resolve(undefined);
  }

  saveTaskGoalContract(): Promise<void> {
    return Promise.resolve();
  }
}
