import { describe, expect, it } from 'vitest';

import {
  createCognitiveSourceRef,
  createInteractivePlanningSessionSnapshot,
  createInteractivePlanningTurn,
  createUserGoalPlanCandidateSnapshot,
  createUserGoalCompletionContract,
  createUserGoalPlan,
  type Goal,
  type InteractivePlanningSessionSnapshot,
  type InteractivePlanningTurn,
  type UserGoalPlan,
  type UserGoalPlanCandidateSnapshot,
} from '../../domain/src/index.js';
import {
  ConfirmedPlanHandoff,
  InteractivePlanPatchService,
  InteractivePlanningSessionService,
  UserGoalPlanCandidateValidator,
  type InteractivePlanningMutation,
  type InteractivePlanningMutationResult,
  type InteractivePlanningRepository,
} from '../src/cognitive/index.js';

describe('UserGoalPlanCandidateValidator', () => {
  it('rejects cycles and missing required criterion coverage through the frozen validator', () => {
    const validator = new UserGoalPlanCandidateValidator();
    const cycle = validator.validate(contract(), {
      ...plan(),
      dependencies: [
        dependency('dependency.a-b', 'skill-goal.a', 'skill-goal.b'),
        dependency('dependency.b-a', 'skill-goal.b', 'skill-goal.a'),
      ],
    });
    expect(cycle).toMatchObject({ valid: false, errorCodes: ['USER_GOAL_PLAN_CYCLE'] });

    const uncovered = validator.validate(contract(), {
      ...plan(),
      skillGoals: [requiredFirstGoal(plan())],
    });
    expect(uncovered).toMatchObject({
      valid: false,
      errorCodes: ['USER_GOAL_PLAN_CRITERION_COVERAGE_INCOMPLETE'],
    });
  });
});

describe('InteractivePlanPatchService', () => {
  it('compiles a strict natural-language patch into a new immutable validated candidate and diff', async () => {
    const original = plan();
    const service = new InteractivePlanPatchService({
      model: {
        generate: () =>
          Promise.resolve({
            invocationId: 'model-invocation.plan-patch.1',
            structuredResult: {
              operations: [
                {
                  op: 'update_skill_goal',
                  skillGoalId: 'skill-goal.a',
                  changes: { requiredResult: 'Inspect pump-17 and record evidence.' },
                },
                { op: 'set_priority', skillGoalId: 'skill-goal.a', priority: 10 },
                {
                  op: 'set_confirmation_policy',
                  confirmationPolicy: 'manual_all',
                },
              ],
            },
          }),
      },
      validator: new UserGoalPlanCandidateValidator(),
      clock: { now: () => '2026-07-23T05:00:00.000Z' },
      nextCandidateId: () => 'plan-candidate.2',
      nextPlanId: () => 'user-goal-plan.2',
    });

    const patched = await service.compile({
      taskId: 'task.interactive-plan',
      sessionId: 'planning-session.1',
      contract: contract(),
      current: {
        schemaVersion: '1.0',
        candidateId: 'plan-candidate.1',
        sessionId: 'planning-session.1',
        revision: 1,
        status: 'candidate',
        basePlanId: original.planId,
        plan: original,
        planHash: original.contentHash,
        validation: { valid: true, errorCodes: [], checks: [] },
        diff: { changedFields: [], addedSkillGoalIds: [], removedSkillGoalIds: [] },
        experienceHints: [],
        confirmationPolicy: 'manual_all',
        riskLevel: 'low',
        planningMetadata: { priorities: {}, parallelGroups: {} },
        sourceRefs: [],
        createdAt: '2026-07-23T04:59:00.000Z',
      },
      instruction: 'Make inspection evidence explicit and prioritize it.',
      sourceRefs: [],
    });

    expect(original.skillGoals[0]?.requiredResult).toBe('Inspect pump-17.');
    expect(patched.plan).toMatchObject({
      planId: 'user-goal-plan.2',
      revision: 1,
      revisionKind: 'initial',
    });
    expect(patched.plan).not.toHaveProperty('sourcePlanId');
    expect(patched.plan.skillGoals[0]?.requiredResult).toBe('Inspect pump-17 and record evidence.');
    expect(patched.diff.changedFields).toContain('skillGoals');
    expect(patched.planningMetadata.priorities).toEqual({ 'skill-goal.a': 10 });
    expect(patched.validation.valid).toBe(true);
    expect(patched.patchModelInvocationId).toBe('model-invocation.plan-patch.1');
  });
});

describe('InteractivePlanningSessionService', () => {
  it('keeps the base plan outside v1.2.2 authority until an idempotent confirmed handoff', async () => {
    const repository = new MemoryInteractivePlanningRepository();
    const committed = new Set<string>();
    const service = planningSessions(repository, committed, 'manual_all');
    const started = await service.start(startInput(goal()));

    expect(started.session.state).toBe('plan_review');
    expect(committed.size).toBe(0);
    const accepted = await service.applyAction({
      sessionId: started.session.sessionId,
      expectedVersion: 1,
      idempotencyKey: 'planning-action.accept.1',
      actorId: 'user.1',
      action: 'accept',
      payload: {},
    });
    expect(accepted.session.state).toBe('confirmed');
    expect(committed).toEqual(new Set(['user-goal-plan.1']));

    await service.applyAction({
      sessionId: started.session.sessionId,
      expectedVersion: 1,
      idempotencyKey: 'planning-action.accept.1',
      actorId: 'user.1',
      action: 'accept',
      payload: {},
    });
    expect(committed).toEqual(new Set(['user-goal-plan.1']));
  });

  it('recovers a confirmed candidate after restart and replays only the idempotent handoff', async () => {
    const repository = new MemoryInteractivePlanningRepository();
    const committed = new Set<string>();
    const first = planningSessions(repository, committed, 'manual_all');
    const started = await first.start(startInput(goal()));
    await first.applyAction({
      sessionId: started.session.sessionId,
      expectedVersion: 1,
      idempotencyKey: 'planning-action.accept.restart',
      actorId: 'user.1',
      action: 'accept',
      payload: {},
    });

    const restarted = planningSessions(repository, committed, 'manual_all');
    await expect(restarted.getByTask('task.interactive-plan')).resolves.toMatchObject({
      session: { state: 'confirmed' },
      candidate: { status: 'confirmed' },
    });
    expect(committed).toEqual(new Set(['user-goal-plan.1']));
  });

  it('forces high-risk auto_validated candidates through manual review', async () => {
    const repository = new MemoryInteractivePlanningRepository();
    const committed = new Set<string>();
    const riskyGoal = goal();
    const service = planningSessions(repository, committed, 'auto_validated', () =>
      createUserGoalPlan({
        ...plan(),
        skillGoals: plan().skillGoals.map((item, index) =>
          index === 0 ? { ...item, capabilityNeeds: ['device.control'] } : item,
        ),
      }),
    );
    const started = await service.start(startInput(riskyGoal));
    expect(started.candidate).toMatchObject({ riskLevel: 'high', validation: { valid: true } });
    expect(started.session.state).toBe('plan_review');
    expect(committed.size).toBe(0);
  });
});

describe('ConfirmedPlanHandoff', () => {
  it('locks on the candidate Goal version before committing to the frozen planner', async () => {
    const calls: string[] = [];
    const candidate = createUserGoalPlanCandidateSnapshot({
      schemaVersion: '1.0',
      candidateId: 'plan-candidate.confirmed',
      sessionId: 'planning-session.confirmed',
      revision: 1,
      status: 'confirmed',
      plan: plan(),
      planHash: plan().contentHash,
      validation: new UserGoalPlanCandidateValidator().validate(contract(), plan()),
      diff: { changedFields: [], addedSkillGoalIds: [], removedSkillGoalIds: [] },
      experienceHints: [],
      confirmationPolicy: 'manual_all',
      riskLevel: 'low',
      planningMetadata: { priorities: {}, parallelGroups: {} },
      sourceRefs: [],
      createdAt: '2026-07-23T05:00:00.000Z',
    });
    await new ConfirmedPlanHandoff({
      lock: {
        withLock: async (goalId, goalVersion, operation) => {
          calls.push(`lock:${goalId}:${String(goalVersion)}`);
          return operation();
        },
      },
      planner: {
        commitCandidate: () => {
          calls.push('commit');
          return Promise.resolve();
        },
      },
    }).commit(candidate, contract());
    expect(calls).toEqual(['lock:goal.interactive-plan:1', 'commit']);
  });
});

function contract() {
  return createUserGoalCompletionContract({
    schemaVersion: '1.0',
    goalId: 'goal.interactive-plan',
    goalVersion: 1,
    title: 'Inspect pump',
    description: 'Inspect pump-17.',
    constraints: ['Read only.'],
    criteria: [
      {
        criterionId: 'criterion-1',
        description: 'Inspection completed.',
        required: true,
        expectedEffectRefs: ['effect-1'],
        evidenceRequirements: ['evidence-1'],
        artifactRequirements: [],
      },
      {
        criterionId: 'criterion-2',
        description: 'Evidence recorded.',
        required: true,
        expectedEffectRefs: ['effect-2'],
        evidenceRequirements: ['evidence-2'],
        artifactRequirements: [],
      },
    ],
    assumptions: [],
    policy: {
      maxSkillGoals: 16,
      maxDagDepth: 8,
      maxParallelReadyGoals: 4,
      maxPlanRevisions: 4,
      maxPlanningModelAttempts: 2,
    },
  });
}

function goal(): Goal {
  return {
    goalId: 'goal.interactive-plan',
    contextId: 'context.interactive-plan',
    version: 1,
    title: 'Inspect pump',
    description: 'Inspect pump-17.',
    constraints: ['Read only.'],
    successCriteria: ['Inspection completed.', 'Evidence recorded.'],
    status: 'active',
    createdAt: '2026-07-23T04:58:00.000Z',
    updatedAt: '2026-07-23T04:58:00.000Z',
  };
}

function startInput(value: Goal) {
  return {
    taskId: 'task.interactive-plan',
    userId: 'user.interactive-plan',
    goalSessionId: 'goal-session.interactive-plan',
    confirmedContractCandidateId: 'goal-contract-candidate.confirmed',
    goal: value,
    sourceRefs: [
      createCognitiveSourceRef({
        schemaVersion: '1.0',
        sourceRefId: 'source.goal-contract.confirmed',
        sourceKind: 'goal_contract',
        sourceId: 'goal-contract-candidate.confirmed',
        sourceRevision: 1,
        authority: 'user_confirmation',
        dataClassification: 'user_scoped',
        capturedAt: '2026-07-23T04:58:00.000Z',
      }),
    ],
  };
}

function planningSessions(
  repository: MemoryInteractivePlanningRepository,
  committed: Set<string>,
  policy: 'manual_all' | 'auto_validated',
  nextPlan: () => UserGoalPlan = plan,
) {
  let sessionSequence = 0;
  let turnSequence = 0;
  let candidateSequence = 0;
  return new InteractivePlanningSessionService({
    repository,
    planner: {
      generateCandidate: () => Promise.resolve({ contract: contract(), plan: nextPlan() }),
    },
    patches: {
      compile: () => Promise.reject(new Error('PATCH_NOT_EXPECTED')),
    },
    validator: new UserGoalPlanCandidateValidator(),
    handoff: {
      commit: (candidate) => {
        committed.add(candidate.plan.planId);
        return Promise.resolve();
      },
    },
    goals: { get: () => Promise.resolve(goal()) },
    clock: { now: () => '2026-07-23T05:00:00.000Z' },
    ids: {
      nextSessionId: () => `planning-session.${String(++sessionSequence)}`,
      nextTurnId: () => `planning-turn.${String(++turnSequence)}`,
      nextCandidateId: () => `plan-candidate.${String(++candidateSequence)}`,
    },
    maxRevisions: 4,
    maxElapsedMs: 900_000,
    defaultConfirmationPolicy: policy,
  });
}

function plan(): UserGoalPlan {
  return createUserGoalPlan({
    schemaVersion: '1.0',
    planId: 'user-goal-plan.1',
    goalId: 'goal.interactive-plan',
    goalVersion: 1,
    revision: 1,
    revisionKind: 'initial',
    status: 'validated',
    contractHash: `sha256:${'a'.repeat(64)}`,
    contentHash: `sha256:${'b'.repeat(64)}`,
    skillGoals: [
      {
        skillGoalId: 'skill-goal.a',
        requiredResult: 'Inspect pump-17.',
        capabilityNeeds: ['inspection'],
        coveredCriterionIds: ['criterion-1'],
        requiredEffectRefs: ['effect-1'],
        evidenceRequirements: ['evidence-1'],
        artifactRequirements: [],
        assumptions: [],
        constraints: ['Read only.'],
        status: 'pending',
      },
      {
        skillGoalId: 'skill-goal.b',
        requiredResult: 'Record evidence.',
        capabilityNeeds: ['evidence'],
        coveredCriterionIds: ['criterion-2'],
        requiredEffectRefs: ['effect-2'],
        evidenceRequirements: ['evidence-2'],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
        status: 'pending',
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: '2026-07-23T04:59:00.000Z',
  });
}

function dependency(id: string, predecessor: string, successor: string) {
  return {
    dependencyId: id,
    predecessorSkillGoalId: predecessor,
    successorSkillGoalId: successor,
    predicate: 'required' as const,
  };
}

function requiredFirstGoal(value: UserGoalPlan) {
  const goal = value.skillGoals[0];
  if (goal === undefined) throw new Error('TEST_SKILL_GOAL_REQUIRED');
  return goal;
}

class MemoryInteractivePlanningRepository implements InteractivePlanningRepository {
  session: InteractivePlanningSessionSnapshot | undefined;
  readonly turns: InteractivePlanningTurn[] = [];
  readonly candidates = new Map<string, UserGoalPlanCandidateSnapshot<UserGoalPlan>>();

  findByTask(taskId: string): Promise<InteractivePlanningSessionSnapshot | undefined> {
    return Promise.resolve(this.session?.taskId === taskId ? this.session : undefined);
  }

  find(sessionId: string): Promise<InteractivePlanningSessionSnapshot | undefined> {
    return Promise.resolve(this.session?.sessionId === sessionId ? this.session : undefined);
  }

  listTurns(): Promise<readonly InteractivePlanningTurn[]> {
    return Promise.resolve(this.turns);
  }

  listCandidates(): Promise<readonly UserGoalPlanCandidateSnapshot<UserGoalPlan>[]> {
    return Promise.resolve([...this.candidates.values()]);
  }

  findTurnByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<InteractivePlanningTurn | undefined> {
    return Promise.resolve(
      this.turns.find(
        (turn) => turn.sessionId === sessionId && turn.idempotencyKey === idempotencyKey,
      ),
    );
  }

  start(
    session: InteractivePlanningSessionSnapshot,
    candidate: UserGoalPlanCandidateSnapshot<UserGoalPlan>,
  ): Promise<InteractivePlanningSessionSnapshot> {
    if (this.session !== undefined) return Promise.resolve(this.session);
    this.session = createInteractivePlanningSessionSnapshot(session);
    this.candidates.set(candidate.candidateId, createUserGoalPlanCandidateSnapshot(candidate));
    return Promise.resolve(this.session);
  }

  apply(mutation: InteractivePlanningMutation): Promise<InteractivePlanningMutationResult> {
    const duplicate = this.turns.find(
      (turn) =>
        turn.sessionId === mutation.nextSession.sessionId &&
        turn.idempotencyKey === mutation.idempotencyKey,
    );
    if (duplicate !== undefined && this.session !== undefined)
      return Promise.resolve({ outcome: 'duplicate', session: this.session });
    if (this.session?.version !== mutation.expectedVersion) {
      if (this.session === undefined) throw new Error('TEST_SESSION_MISSING');
      return Promise.resolve({ outcome: 'conflict', session: this.session });
    }
    this.turns.push(createInteractivePlanningTurn(mutation.turn));
    if (mutation.candidate !== undefined)
      this.candidates.set(
        mutation.candidate.candidateId,
        createUserGoalPlanCandidateSnapshot(mutation.candidate),
      );
    this.session = createInteractivePlanningSessionSnapshot(mutation.nextSession);
    return Promise.resolve({
      outcome: 'applied',
      session: this.session,
      ...(mutation.candidate === undefined ? {} : { candidate: mutation.candidate }),
    });
  }
}
