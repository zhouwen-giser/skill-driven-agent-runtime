import { beforeAll, describe, expect, it } from 'vitest';

import {
  GoalService,
  SkillInputResolutionService,
  UserGoalPlanningService,
  type UserGoalPlanningRepository,
  userGoalCompletionContractFor,
} from '../../../packages/application/src/index.js';
import {
  bindTaskGoal,
  bindTaskSkill,
  createAgentTask,
  createConversationContext,
  createSkillInputResolutionRecord,
  createTaskCapabilityBinding,
  createUserGoalPlan,
  hashCanonicalEvidenceJson,
  transitionTask,
  type AgentTask,
  type Goal,
  type SkillInputResolutionRecord,
  type SkillVersion,
  type TaskCapabilityBinding,
  type UserGoalCompletionContract,
  type UserGoalPlan,
} from '../../../packages/domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../../packages/json-schema-adapter/src/index.js';
import {
  assertUgvAgentProfileMoveInputAuthority,
  UgvAgentProfileExactSkillInputResolver,
  UgvAgentProfileInitialAdmission,
  UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver,
  UgvAgentProfileUserGoalPlanCandidateGuard,
} from '../src/ugv-agent-profile-admission.js';

import { loadExactUgvProfileSkill } from './ugv-agent-profile-test-fixture.js';
import { selectedUgvTaskOperation } from './ugv-move-workflow-test-fixture.js';

const NOW = '2026-08-21T12:00:02.000Z';
const CONTEXT_ID = 'context-uap-p2-b03-admission';
const TASK_ID = 'task-uap-p2-b03-admission';
const AUTHORIZED_INPUT = Object.freeze({
  resourceId: 'vehicle:ugv1',
  target: Object.freeze({ x: 112, y: 28, frame: 'EPSG:4326' }),
});

let exactSkill: SkillVersion;

beforeAll(async () => {
  exactSkill = await loadExactUgvProfileSkill();
});

describe('UGV Agent Profile deterministic admission', () => {
  it('creates and then idempotently revalidates one formal Goal and exact User Goal Plan without a model', async () => {
    const harness = createAdmissionHarness(capabilityBinding(), exactSkill);
    const task = contextLoadingTask();

    const admitted = await harness.admission.admit(task);
    const persistedPlan = harness.plans.plan;
    if (persistedPlan === undefined) throw new Error('TEST_USER_GOAL_PLAN_REQUIRED');
    const retryTask = bindSelectedSkill(task, admitted.goal, persistedPlan);
    const retried = await harness.admission.admit(retryTask);

    expect(retried).toEqual(admitted);
    expect(harness.goalSaves).toBe(1);
    expect(harness.plans.createCalls).toBe(1);
    expect(harness.modelCalls).toBe(0);
    expect(persistedPlan).toMatchObject({
      goalId: admitted.goal.goalId,
      goalVersion: 1,
      revision: 1,
      status: 'validated',
      dependencies: [],
      skillGoals: [
        {
          capabilityNeeds: ['embodied.move'],
          requiredEffectRefs: ['effect.final_position'],
          evidenceRequirements: ['evidence.final_position'],
          artifactRequirements: [],
          status: 'pending',
        },
      ],
    });
    expect(JSON.stringify(persistedPlan)).not.toMatch(
      /selectedSkillId|toolName|providerId|workflowDefinitionId/u,
    );
  });

  it('admits an append-only live Capability successor without rewriting the exact Skill version', async () => {
    const binding = capabilityBinding(AUTHORIZED_INPUT, 'before_execution', {
      capabilityVersion: 4,
      executionMode: 'live',
    });
    const harness = createAdmissionHarness(binding, exactSkill);

    const admitted = await harness.admission.admit(contextLoadingTask());

    expect(admitted.goal.constraints).toContain('execution.mode=live');
    expect(admitted.goal.constraints).not.toContain('execution.mode=simulation');
    expect(admitted.goal.description).toContain('frozen live execution contract');
    expect(harness.plans.plan?.skillGoals[0]?.capabilityNeeds).toEqual(['embodied.move']);
    expect(binding.initialImplementationRefs).toEqual(['skill:embodied.move_to:1']);
    expect(harness.modelCalls).toBe(0);
  });

  it('rejects a live successor that carries a simulation identity', async () => {
    const binding = capabilityBinding(AUTHORIZED_INPUT, 'before_execution', {
      capabilityVersion: 4,
      executionMode: 'live',
      simulationId: 'must-not-be-present',
    });
    const harness = createAdmissionHarness(binding, exactSkill);

    await expect(harness.admission.admit(contextLoadingTask())).rejects.toMatchObject({
      code: 'UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_INVALID',
    });
    expect(harness.plans.plan).toBeUndefined();
  });

  it.each([
    [
      'missing',
      (constraints: readonly string[]) =>
        constraints.filter(
          (constraint) => constraint !== 'profile.ugv-agent-profile.side_effect_replay=forbidden',
        ),
    ],
    [
      'falsified',
      (constraints: readonly string[]) =>
        constraints.map((constraint) =>
          constraint === 'profile.ugv-agent-profile.side_effect_replay=forbidden'
            ? 'profile.ugv-agent-profile.side_effect_replay=allowed'
            : constraint,
        ),
    ],
    [
      'duplicated',
      (constraints: readonly string[]) => [
        ...constraints,
        'profile.ugv-agent-profile.side_effect_replay=forbidden',
      ],
    ],
    [
      'supplemented with generic policy.replay',
      (constraints: readonly string[]) => [...constraints, 'policy.replay=forbidden'],
    ],
  ] as const)(
    'rejects a %s Profile-owned navigate replay constraint',
    async (_case, mutateConstraints) => {
      const harness = createAdmissionHarness(capabilityBinding(), exactSkill);
      const admitted = await harness.admission.admit(contextLoadingTask());
      const persistedPlan = harness.plans.plan;
      if (persistedPlan === undefined) throw new Error('TEST_USER_GOAL_PLAN_REQUIRED');
      const skillGoal = persistedPlan.skillGoals[0];
      if (skillGoal === undefined) throw new Error('TEST_SKILL_GOAL_REQUIRED');
      const candidate = rebindSkillGoalConstraints(
        persistedPlan,
        mutateConstraints(skillGoal.constraints),
      );

      expect(() => {
        new UgvAgentProfileUserGoalPlanCandidateGuard().assert(
          candidate,
          userGoalCompletionContractFor(admitted.goal),
        );
      }).toThrow(expect.objectContaining({ code: 'UGV_AGENT_PROFILE_USER_GOAL_PLAN_INVALID' }));
    },
  );

  it('fails closed instead of reusing or superseding another active Goal in the same context', async () => {
    const harness = createAdmissionHarness(capabilityBinding(), exactSkill);
    await harness.goals.create({
      goalId: 'goal-other-active-target',
      contextId: CONTEXT_ID,
      title: 'Move somewhere else',
      description: 'An unrelated active Goal owns a different target.',
      constraints: ['authority.target=stale'],
      successCriteria: ['Other target reached'],
    });

    await expect(harness.admission.admit(contextLoadingTask())).rejects.toMatchObject({
      code: 'UGV_AGENT_PROFILE_ACTIVE_GOAL_CONFLICT',
    });
    expect(harness.plans.plan).toBeUndefined();
    expect(harness.modelCalls).toBe(0);
  });

  it('rejects a Task Capability that moves confirmation away from before_execution', async () => {
    const harness = createAdmissionHarness(
      capabilityBinding(AUTHORIZED_INPUT, 'after_execution'),
      exactSkill,
    );

    await expect(harness.admission.admit(contextLoadingTask())).rejects.toMatchObject({
      code: 'UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_INVALID',
    });
    expect(harness.plans.plan).toBeUndefined();
    expect(harness.modelCalls).toBe(0);
  });

  it('neutralizes a metadata structured_input spoof by resolving only the Capability input snapshot', async () => {
    const binding = capabilityBinding();
    const harness = createAdmissionHarness(binding, exactSkill);
    const admitted = await harness.admission.admit(contextLoadingTask());
    const plan = harness.plans.plan;
    if (plan === undefined) throw new Error('TEST_USER_GOAL_PLAN_REQUIRED');
    const metadataSpoof = Object.freeze({
      resourceId: 'vehicle:ugv1',
      target: Object.freeze({ x: -77, y: 9, frame: 'EPSG:4326' }),
    });
    const task = bindSelectedSkill(
      contextLoadingTask({ structured_input: metadataSpoof }),
      admitted.goal,
      plan,
    );
    const records = new MemorySkillInputRecords();
    let modelCalls = 0;
    const exact = new UgvAgentProfileExactSkillInputResolver({
      bindings: { findBinding: () => Promise.resolve(binding) },
      delegate: new SkillInputResolutionService({
        model: {
          generateStructured: () => {
            modelCalls += 1;
            return Promise.reject(new Error('MODEL_MUST_NOT_RUN'));
          },
        },
        schemas: new AjvJsonSchemaValidator(),
        records,
        clock: { now: () => NOW },
        nextId: () => 'skill-input-resolution-exact-1',
      }),
    });

    const resolution = await exact.resolve({
      task,
      goal: admitted.goal,
      skill: exactSkill,
      supplementaryInputs: [],
    });

    expect(modelCalls).toBe(0);
    expect(resolution.structuredInput).toEqual(binding.inputSnapshot);
    expect(resolution.structuredInput).not.toEqual(metadataSpoof);
    expect(resolution.sourceRefs).toEqual([
      `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:input-snapshot`,
    ]);
    expect(() => {
      assertUgvAgentProfileMoveInputAuthority({
        binding,
        resolution,
        selectedTaskOperation: selectedUgvTaskOperation(),
      });
    }).not.toThrow();
  });

  it('rejects a persisted Skill input that diverges from the Capability snapshot', async () => {
    const binding = capabilityBinding();
    const harness = createAdmissionHarness(binding, exactSkill);
    const admitted = await harness.admission.admit(contextLoadingTask());
    const plan = harness.plans.plan;
    if (plan === undefined) throw new Error('TEST_USER_GOAL_PLAN_REQUIRED');
    const task = bindSelectedSkill(contextLoadingTask(), admitted.goal, plan);
    const resolver = new UgvAgentProfileExactSkillInputResolver({
      bindings: { findBinding: () => Promise.resolve(binding) },
      delegate: {
        resolveExact: (input) =>
          Promise.resolve(
            resolutionRecord(input.task, input.goal, {
              resourceId: 'vehicle:ugv1',
              target: { x: -77, y: 9, frame: 'EPSG:4326' },
            }),
          ),
      },
    });

    await expect(
      resolver.resolve({ task, goal: admitted.goal, skill: exactSkill, supplementaryInputs: [] }),
    ).rejects.toMatchObject({ code: 'UGV_AGENT_PROFILE_SKILL_INPUT_AUTHORITY_MISMATCH' });
  });

  it('rejects a reloaded persisted Skill input with a forged source reference before Planner', async () => {
    const binding = capabilityBinding();
    const resolution = resolutionRecord(
      contextLoadingTask(),
      goalFixture(),
      binding.inputSnapshot,
      ['a2a-metadata:structured_input'],
    );
    let plannerCalls = 0;
    const plan = () =>
      Promise.resolve().then(() => {
        assertUgvAgentProfileMoveInputAuthority({
          binding,
          resolution,
          selectedTaskOperation: selectedUgvTaskOperation(),
        });
        plannerCalls += 1;
        return 'planned';
      });

    await expect(plan()).rejects.toMatchObject({
      code: 'UGV_AGENT_PROFILE_SKILL_INPUT_AUTHORITY_MISMATCH',
    });
    expect(plannerCalls).toBe(0);
  });

  it('blocks a mismatched Selected navigation target before Planner is invoked', async () => {
    const binding = capabilityBinding({
      resourceId: 'vehicle:ugv1',
      target: { x: 113, y: 29, frame: 'EPSG:4326' },
    });
    const task = contextLoadingTask();
    const resolution = resolutionRecord(task, goalFixture(), binding.inputSnapshot, [
      exactSourceRef(binding),
    ]);
    let plannerCalls = 0;
    const plan = () =>
      Promise.resolve().then(() => {
        assertUgvAgentProfileMoveInputAuthority({
          binding,
          resolution,
          selectedTaskOperation: selectedUgvTaskOperation(),
        });
        plannerCalls += 1;
        return 'planned';
      });

    await expect(plan()).rejects.toMatchObject({
      code: 'UGV_AGENT_PROFILE_SELECTED_TARGET_AUTHORITY_MISMATCH',
    });
    expect(plannerCalls).toBe(0);
  });
});

function rebindSkillGoalConstraints(
  plan: UserGoalPlan,
  constraints: readonly string[],
): UserGoalPlan {
  const original = plan.skillGoals[0];
  if (original === undefined) throw new Error('TEST_SKILL_GOAL_REQUIRED');
  const skillGoals = Object.freeze([
    Object.freeze({ ...original, constraints: Object.freeze([...constraints]) }),
  ]);
  const contentHash = hashCanonicalEvidenceJson({
    schemaVersion: plan.schemaVersion,
    goalId: plan.goalId,
    goalVersion: plan.goalVersion,
    revision: plan.revision,
    skillGoals: skillGoals.map((skillGoal) => {
      const { status, ...content } = skillGoal;
      void status;
      return content;
    }),
    dependencies: plan.dependencies,
  });
  return createUserGoalPlan({ ...plan, skillGoals, contentHash });
}

function createAdmissionHarness(binding: TaskCapabilityBinding, skill: SkillVersion) {
  const context = createConversationContext({
    contextId: CONTEXT_ID,
    userId: 'anonymous',
    timestamp: NOW,
  });
  const persistedGoals = new Map<string, Goal>();
  let goalSaves = 0;
  const goals = new GoalService({
    contexts: {
      findById: (contextId) => Promise.resolve(contextId === CONTEXT_ID ? context : undefined),
      save: () => Promise.resolve(),
    },
    goals: {
      findById: (goalId) => Promise.resolve(persistedGoals.get(goalId)),
      findActiveByContextId: (contextId) =>
        Promise.resolve(
          [...persistedGoals.values()].find(
            (goal) => goal.contextId === contextId && goal.status === 'active',
          ),
        ),
      findLatestByContextId: (contextId) =>
        Promise.resolve([...persistedGoals.values()].find((goal) => goal.contextId === contextId)),
      listByContextId: (contextId) =>
        Promise.resolve(
          [...persistedGoals.values()].filter((goal) => goal.contextId === contextId),
        ),
      listTransitions: () => Promise.resolve([]),
      save: (goal: Goal) => {
        persistedGoals.set(goal.goalId, goal);
        goalSaves += 1;
        return Promise.resolve();
      },
    },
    clock: { now: () => NOW },
  });
  const plans = new MemoryPlanningRepository();
  let modelCalls = 0;
  const guard = new UgvAgentProfileUserGoalPlanCandidateGuard();
  const planning = new UserGoalPlanningService({
    model: {
      generateStructured: () => {
        modelCalls += 1;
        return Promise.reject(new Error('MODEL_MUST_NOT_RUN'));
      },
    },
    repository: plans,
    now: () => NOW,
    nextPlanId: () => 'model-plan-must-not-be-created',
    candidateGuard: guard,
  });
  const bindings = { findBinding: () => Promise.resolve(binding) };
  const authority = new UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver({
    bindings,
    skills: {
      findVersion: (skillId, version) =>
        Promise.resolve(skill.skillId === skillId && skill.version === version ? skill : undefined),
    },
  });
  const admission = new UgvAgentProfileInitialAdmission({
    bindings,
    authority,
    goals,
    planning,
    plans,
    guard,
    clock: { now: () => NOW },
  });
  return {
    admission,
    goals,
    plans,
    get goalSaves() {
      return goalSaves;
    },
    get modelCalls() {
      return modelCalls;
    },
  };
}

function capabilityBinding(
  input: unknown = AUTHORIZED_INPUT,
  confirmationStage = 'before_execution',
  authority: Readonly<{
    capabilityVersion: number;
    executionMode: 'simulation' | 'live';
    simulationId?: string;
  }> = Object.freeze({ capabilityVersion: 2, executionMode: 'simulation' }),
): TaskCapabilityBinding {
  const runtimeExecutionModePolicy = Object.freeze({
    type: 'runtime_execution_mode_policy',
    mode: authority.executionMode,
    ...(authority.executionMode === 'simulation'
      ? { simulationId: authority.simulationId ?? 'uap-p2-b03-simulation' }
      : authority.simulationId === undefined
        ? {}
        : { simulationId: authority.simulationId }),
  });
  return createTaskCapabilityBinding({
    bindingId: 'capability-binding-uap-p2-b03',
    taskId: TASK_ID,
    requestedCapabilityId: 'embodied.move',
    capabilityVersion: authority.capabilityVersion,
    inputSnapshot: input,
    successCriteriaSnapshot: Object.freeze([
      Object.freeze({ type: 'required_evidence_complete', required: true }),
    ]),
    evidenceRequirementSnapshot: Object.freeze([
      Object.freeze({
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      }),
    ]),
    constraintSnapshot: Object.freeze([
      Object.freeze({
        type: 'exact_skill_version',
        skillId: 'embodied.move_to',
        skillVersion: 1,
        taskType: 'embodied.move',
      }),
      Object.freeze({
        type: 'confirmation_policy',
        required: true,
        stage: confirmationStage,
      }),
      runtimeExecutionModePolicy,
    ]),
    initialImplementationRefs: Object.freeze(['skill:embodied.move_to:1']),
    boundAt: NOW,
  });
}

function contextLoadingTask(requestMetadata: Readonly<Record<string, unknown>> = {}): AgentTask {
  return transitionTask(
    createAgentTask({
      taskId: TASK_ID,
      contextId: CONTEXT_ID,
      userId: 'anonymous',
      requestText: 'Move the simulation UGV to the authorized point.',
      requestMetadata,
      timestamp: NOW,
    }),
    'context_loading',
    'Context loaded.',
    NOW,
  );
}

function bindSelectedSkill(task: AgentTask, goal: Goal, plan: UserGoalPlan): AgentTask {
  const skillGoal = plan.skillGoals[0];
  if (skillGoal === undefined) throw new Error('TEST_SKILL_GOAL_REQUIRED');
  const deliberating = transitionTask(task, 'goal_deliberation', 'Goal admitted.', NOW);
  const goalBound = bindTaskGoal(deliberating, {
    goalId: goal.goalId,
    goalVersion: goal.version,
    timestamp: NOW,
  });
  const resolving = transitionTask(goalBound, 'skill_resolution', 'Skill selected.', NOW);
  return bindTaskSkill(resolving, {
    skillId: 'embodied.move_to',
    skillVersion: 1,
    selectionId: 'skill-selection-uap-p2-b03',
    userGoalPlanId: plan.planId,
    skillGoalId: skillGoal.skillGoalId,
    skillAttemptId: 'skill-attempt-uap-p2-b03',
    timestamp: NOW,
  });
}

function resolutionRecord(
  task: AgentTask,
  goal: Pick<Goal, 'goalId' | 'version'>,
  structuredInput: unknown,
  sourceRefs: readonly string[] = ['task-capability-binding:test:input-snapshot'],
): SkillInputResolutionRecord {
  return createSkillInputResolutionRecord({
    resolutionId: 'skill-input-resolution-uap-p2-b03',
    taskId: task.taskId,
    goalId: goal.goalId,
    goalVersion: goal.version,
    skillId: 'embodied.move_to',
    skillVersion: 1,
    structuredInput,
    unresolvedFields: [],
    sourceRefs,
    decisionSummary: 'Test exact input.',
    status: 'resolved',
    createdAt: NOW,
  });
}

function exactSourceRef(binding: TaskCapabilityBinding): string {
  return `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:input-snapshot`;
}

function goalFixture(): Goal {
  return Object.freeze({
    goalId: 'goal-uap-p2-b03-fixture',
    contextId: CONTEXT_ID,
    version: 1,
    title: 'Move the UGV',
    description: 'Move to an exact target.',
    constraints: Object.freeze([]),
    successCriteria: Object.freeze(['Final position verified']),
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  });
}

class MemoryPlanningRepository implements UserGoalPlanningRepository {
  contract: UserGoalCompletionContract | undefined;
  plan: UserGoalPlan | undefined;
  createCalls = 0;

  findPlan(planId: string): Promise<UserGoalPlan | undefined> {
    return Promise.resolve(this.plan?.planId === planId ? this.plan : undefined);
  }

  saveContract(contract: UserGoalCompletionContract): Promise<void> {
    this.contract = contract;
    return Promise.resolve();
  }

  createPlan(plan: UserGoalPlan): Promise<void> {
    this.plan = plan;
    this.createCalls += 1;
    return Promise.resolve();
  }

  replacePlan(): Promise<boolean> {
    return Promise.resolve(false);
  }

  compareAndSetPlanStatus(): Promise<number | undefined> {
    return Promise.resolve(undefined);
  }

  findReusablePlan(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

class MemorySkillInputRecords {
  readonly values: SkillInputResolutionRecord[] = [];

  save(record: SkillInputResolutionRecord): Promise<void> {
    this.values.push(record);
    return Promise.resolve();
  }

  find(resolutionId: string): Promise<SkillInputResolutionRecord | undefined> {
    return Promise.resolve(this.values.find((record) => record.resolutionId === resolutionId));
  }

  findLatest(): Promise<SkillInputResolutionRecord | undefined> {
    return Promise.resolve(this.values.at(-1));
  }

  listByTask(taskId: string): Promise<readonly SkillInputResolutionRecord[]> {
    return Promise.resolve(this.values.filter((record) => record.taskId === taskId));
  }

  listProcessedDataByContext(): Promise<readonly []> {
    return Promise.resolve([]);
  }
}
