import { createHash } from 'node:crypto';

import {
  type GoalService,
  GoalServiceError,
  type ResolveTopLevelSkillInput,
  type SkillInputResolutionService,
  type SkillRepository,
  type UserGoalPlanCandidateAuthority,
  type UserGoalPlanCandidateAuthorityResolver,
  type UserGoalPlanCandidateGuard,
  type UserGoalPlanningRepository,
  type UserGoalPlanningService,
  userGoalCompletionContractFor,
} from '../../../packages/application/src/index.js';
import {
  createTaskCapabilityBinding,
  createUserGoalPlan,
  hashCanonicalEvidenceJson,
  validateUserGoalPlan,
  type AgentTask,
  type Goal,
  type SelectedTaskOperation,
  type SkillInputResolutionRecord,
  type SkillVersion,
  type TaskCapabilityBinding,
  type UserGoalCompletionContract,
  type UserGoalPlan,
} from '../../../packages/domain/src/index.js';

import { adaptUgvMoveInput, UGV_MOVE_RESOURCE_ID } from './ugv-move-input-adapter.js';

const CAPABILITY_ID = 'embodied.move';
const SKILL_ID = 'embodied.move_to';
const SKILL_VERSION = 1;
const EFFECT_REF = 'effect.final_position';
const OUTCOME_EVIDENCE_REF = 'evidence.final_position';
const WORKFLOW_EVIDENCE_TYPE = 'position.observation';
const UGV_NAVIGATE_REPLAY_CONSTRAINT = 'profile.ugv-agent-profile.side_effect_replay=forbidden';

const GOAL_TITLE = 'Move the simulation UGV to its capability-authorized point';
const GOAL_SUCCESS_CRITERION =
  'A fresh same-resource final-position observation proves the authorized target is within tolerance.';

type ExactSkillInputResolver = Pick<SkillInputResolutionService, 'resolveExact'>;

export interface UgvAgentProfileInitialAdmissionResult {
  readonly goal: Goal;
  readonly userGoalPlanId: string;
  readonly summary: string;
}

/**
 * Profile-only, model-free admission into the formal v1.2.2 Goal/Skill path.
 * It creates no execution authority: the existing Skill scheduler, selector and
 * Workflow Planner remain mandatory after this handoff.
 */
export class UgvAgentProfileInitialAdmission {
  readonly #bindings: Readonly<{
    findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
  }>;
  readonly #authority: UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver;
  readonly #goals: Pick<GoalService, 'create' | 'get' | 'findActiveByContextId'>;
  readonly #planning: Pick<UserGoalPlanningService, 'commitCandidate'>;
  readonly #plans: Pick<UserGoalPlanningRepository, 'findPlan'>;
  readonly #guard: UgvAgentProfileUserGoalPlanCandidateGuard;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(
    dependencies: Readonly<{
      bindings: Readonly<{
        findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
      }>;
      authority: UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver;
      goals: Pick<GoalService, 'create' | 'get' | 'findActiveByContextId'>;
      planning: Pick<UserGoalPlanningService, 'commitCandidate'>;
      plans: Pick<UserGoalPlanningRepository, 'findPlan'>;
      guard: UgvAgentProfileUserGoalPlanCandidateGuard;
      clock: Readonly<{ now(): string }>;
    }>,
  ) {
    this.#bindings = dependencies.bindings;
    this.#authority = dependencies.authority;
    this.#goals = dependencies.goals;
    this.#planning = dependencies.planning;
    this.#plans = dependencies.plans;
    this.#guard = dependencies.guard;
    this.#clock = dependencies.clock;
  }

  async admit(task: AgentTask): Promise<UgvAgentProfileInitialAdmissionResult> {
    const binding = await requireBinding(this.#bindings, task.taskId);
    const authority = await this.#authority.resolve(task.taskId);
    if (authority === undefined) {
      fail(
        'UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED',
        'UGV profile admission requires exact Task Capability User Goal Plan authority.',
      );
    }
    const inputAuthority = snapshotInputAuthority(binding);
    const goalId = stableId('goal-ugv-agent-profile', task.taskId);
    const userGoalPlanId = stableId('user-goal-plan-ugv-agent-profile', task.taskId);
    assertExistingTaskIdentity(task, goalId, userGoalPlanId);

    const active = await this.#goals.findActiveByContextId(task.contextId);
    if (active !== undefined && active.goalId !== goalId) {
      fail(
        'UGV_AGENT_PROFILE_ACTIVE_GOAL_CONFLICT',
        'UGV profile admission cannot reuse, supersede, or reinterpret another active Goal in the same context.',
      );
    }

    const expectedGoal = goalContractFields(task, binding, inputAuthority.inputHash);
    let goal = await findGoal(this.#goals, goalId);
    if (goal === undefined) {
      goal = await this.#goals.create({ goalId, contextId: task.contextId, ...expectedGoal });
    } else {
      assertExactGoal(goal, task.contextId, expectedGoal);
    }

    const contract = userGoalCompletionContractFor(goal);
    const existingPlan = await this.#plans.findPlan(userGoalPlanId);
    if (existingPlan === undefined) {
      const plan = createExactPlan({
        planId: userGoalPlanId,
        contract,
        binding,
        authority,
        inputHash: inputAuthority.inputHash,
        createdAt: this.#clock.now(),
      });
      this.#guard.assert(plan, contract);
      await this.#planning.commitCandidate({ contract, plan });
    } else {
      assertExactPersistedPlan(
        existingPlan,
        contract,
        binding,
        authority,
        inputAuthority.inputHash,
      );
      this.#guard.assert(existingPlan, contract);
    }

    return Object.freeze({
      goal,
      userGoalPlanId,
      summary: `Admitted exact ${CAPABILITY_ID} authority from Task Capability Binding ${binding.bindingId}.`,
    });
  }
}

/**
 * Profile bridge from Task Capability admission evidence to the formal User
 * Goal Plan authority vocabulary. Workflow evidence types remain distinct
 * from the Skill outcome evidence references owned by the exact Skill version.
 */
export class UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver implements UserGoalPlanCandidateAuthorityResolver {
  readonly #bindings: Readonly<{
    findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
  }>;
  readonly #skills: Pick<SkillRepository, 'findVersion'>;

  constructor(
    dependencies: Readonly<{
      bindings: Readonly<{
        findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
      }>;
      skills: Pick<SkillRepository, 'findVersion'>;
    }>,
  ) {
    this.#bindings = dependencies.bindings;
    this.#skills = dependencies.skills;
  }

  async resolve(taskId: string): Promise<UserGoalPlanCandidateAuthority | undefined> {
    if ((await this.#bindings.findBinding(taskId)) === undefined) return undefined;
    const binding = await requireBinding(this.#bindings, taskId);
    const skill = await requireExactSkill(this.#skills, binding);
    return exactUserGoalPlanAuthority(binding, skill);
  }
}

/** Stateless formal-candidate guard; task-specific hashes are additionally checked by admission. */
export class UgvAgentProfileUserGoalPlanCandidateGuard implements UserGoalPlanCandidateGuard {
  assert(plan: UserGoalPlan, contract: UserGoalCompletionContract): void {
    const skillGoal = plan.skillGoals[0];
    if (
      plan.skillGoals.length !== 1 ||
      skillGoal === undefined ||
      plan.dependencies.length !== 0 ||
      !sameStrings(skillGoal.capabilityNeeds, [CAPABILITY_ID]) ||
      !sameStrings(skillGoal.requiredEffectRefs, [EFFECT_REF]) ||
      !sameStrings(skillGoal.evidenceRequirements, [OUTCOME_EVIDENCE_REF]) ||
      skillGoal.artifactRequirements.length !== 0 ||
      !sameStrings(
        skillGoal.coveredCriterionIds,
        contract.criteria
          .filter((criterion) => criterion.required)
          .map((criterion) => criterion.criterionId),
      ) ||
      skillGoal.constraints.length !== 4 ||
      !hasSingleExactConstraint(skillGoal.constraints, 'policy.confirmation=required') ||
      !hasSingleExactConstraint(skillGoal.constraints, UGV_NAVIGATE_REPLAY_CONSTRAINT) ||
      !hasSingleHashConstraint(skillGoal.constraints, 'authority.task-capability-binding-hash=') ||
      !hasSingleHashConstraint(skillGoal.constraints, 'authority.skill-input-hash=')
    ) {
      fail(
        'UGV_AGENT_PROFILE_USER_GOAL_PLAN_INVALID',
        'UGV User Goal Plan must be one exact capability/effect/evidence Skill Goal without execution authority.',
      );
    }
    validateUserGoalPlan(contract, plan);
  }
}

/**
 * Resolves the exact formal Skill input only from the immutable Task Capability
 * input snapshot. Request metadata, request prose and Memory are never consulted.
 */
export class UgvAgentProfileExactSkillInputResolver {
  readonly #bindings: Readonly<{
    findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
  }>;
  readonly #delegate: ExactSkillInputResolver;

  constructor(
    dependencies: Readonly<{
      bindings: Readonly<{
        findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined>;
      }>;
      delegate: ExactSkillInputResolver;
    }>,
  ) {
    this.#bindings = dependencies.bindings;
    this.#delegate = dependencies.delegate;
  }

  async resolve(input: ResolveTopLevelSkillInput): Promise<SkillInputResolutionRecord> {
    const binding = await requireBinding(this.#bindings, input.task.taskId);
    assertExactTaskAndSkillIdentity(input, binding);
    snapshotInputAuthority(binding);
    const sourceRef = bindingInputSourceRef(binding);
    const resolution = await this.#delegate.resolveExact({
      ...input,
      structuredInput: binding.inputSnapshot,
      sourceRef,
    });
    assertUgvAgentProfileMoveInputAuthority({ binding, resolution });
    return resolution;
  }
}

/**
 * Pre-Planner equality gate. The same Capability input must own the formal
 * Skill input and the selected Provider arguments; a later terminal check is
 * intentionally insufficient because the wrong target must never dispatch.
 */
export function assertUgvAgentProfileMoveInputAuthority(
  input: Readonly<{
    binding: TaskCapabilityBinding;
    resolution: SkillInputResolutionRecord;
    selectedTaskOperation?: SelectedTaskOperation;
  }>,
): void {
  const binding = createTaskCapabilityBinding(input.binding);
  const expected = snapshotInputAuthority(binding);
  if (
    input.resolution.taskId !== binding.taskId ||
    input.resolution.skillId !== SKILL_ID ||
    input.resolution.skillVersion !== SKILL_VERSION ||
    input.resolution.status !== 'resolved' ||
    input.resolution.structuredInput === undefined ||
    hashCanonicalEvidenceJson(input.resolution.structuredInput) !== expected.inputHash ||
    !sameStrings(input.resolution.sourceRefs, [bindingInputSourceRef(binding)])
  ) {
    fail(
      'UGV_AGENT_PROFILE_SKILL_INPUT_AUTHORITY_MISMATCH',
      'Formal Skill input does not equal the immutable Task Capability input snapshot.',
    );
  }

  const selected = input.selectedTaskOperation;
  if (selected === undefined) return;
  if (
    selected.skill.skillId !== SKILL_ID ||
    selected.skill.version !== SKILL_VERSION ||
    selected.resource.resourceId !== UGV_MOVE_RESOURCE_ID ||
    selected.argumentsHash !== expected.adapted.argumentsHash ||
    hashCanonicalEvidenceJson(selected.resolvedArguments) !==
      hashCanonicalEvidenceJson(expected.adapted.providerArguments)
  ) {
    fail(
      'UGV_AGENT_PROFILE_SELECTED_TARGET_AUTHORITY_MISMATCH',
      'Selected UGV navigation arguments do not equal the capability-authorized Skill input.',
    );
  }
}

export type UgvAgentProfileAdmissionErrorCode =
  | 'UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED'
  | 'UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_INVALID'
  | 'UGV_AGENT_PROFILE_ACTIVE_GOAL_CONFLICT'
  | 'UGV_AGENT_PROFILE_TASK_IDENTITY_STALE'
  | 'UGV_AGENT_PROFILE_GOAL_AUTHORITY_MISMATCH'
  | 'UGV_AGENT_PROFILE_USER_GOAL_PLAN_INVALID'
  | 'UGV_AGENT_PROFILE_SKILL_INPUT_AUTHORITY_MISMATCH'
  | 'UGV_AGENT_PROFILE_SELECTED_TARGET_AUTHORITY_MISMATCH';

export class UgvAgentProfileAdmissionError extends Error {
  constructor(
    readonly code: UgvAgentProfileAdmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UgvAgentProfileAdmissionError';
  }
}

async function requireBinding(
  bindings: Readonly<{ findBinding(taskId: string): Promise<TaskCapabilityBinding | undefined> }>,
  taskId: string,
): Promise<TaskCapabilityBinding> {
  const binding = await bindings.findBinding(taskId);
  if (binding === undefined) {
    fail(
      'UGV_AGENT_PROFILE_TASK_CAPABILITY_BINDING_REQUIRED',
      'UGV profile admission requires one formal Task Capability Binding.',
    );
  }
  const exact = createTaskCapabilityBinding(binding);
  if (
    exact.taskId !== taskId ||
    exact.requestedCapabilityId !== CAPABILITY_ID ||
    exact.capabilityVersion !== 1 ||
    !sameStrings(exact.initialImplementationRefs, [`skill:${SKILL_ID}:${String(SKILL_VERSION)}`]) ||
    !hasExactConstraint(exact, 'exact_skill_version', {
      skillId: SKILL_ID,
      skillVersion: SKILL_VERSION,
      taskType: CAPABILITY_ID,
    }) ||
    !hasExactConstraint(exact, 'confirmation_policy', {
      required: true,
      stage: 'before_execution',
    }) ||
    !hasExactConstraint(exact, 'runtime_execution_mode_policy', { mode: 'simulation' }) ||
    !hasSimulationIdentity(exact) ||
    !exact.evidenceRequirementSnapshot.some(
      (requirement) =>
        requirement['evidenceType'] === WORKFLOW_EVIDENCE_TYPE &&
        requirement['required'] === true &&
        requirement['hardGate'] === true,
    )
  ) {
    fail(
      'UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_INVALID',
      'Task Capability Binding does not freeze the exact UGV Skill, task type and hard evidence gate.',
    );
  }
  return exact;
}

async function requireExactSkill(
  skills: Pick<SkillRepository, 'findVersion'>,
  binding: TaskCapabilityBinding,
): Promise<SkillVersion> {
  const skill = await skills.findVersion(SKILL_ID, SKILL_VERSION);
  const outcome = skill?.outcomeSpecification;
  if (
    skill?.status !== 'enabled' ||
    !skill.validationPassed ||
    !skill.capabilities.includes(binding.requestedCapabilityId) ||
    outcome === undefined ||
    !sameStrings(outcome.effects, [EFFECT_REF]) ||
    !sameStrings(outcome.evidence, [OUTCOME_EVIDENCE_REF]) ||
    outcome.artifacts.length !== 0 ||
    skill.runtimePolicy.autoConfirmPlan ||
    !skill.usageSpecification?.evidencePolicy.rejectSuccessWithoutRequiredEvidence ||
    !skill.usageSpecification.evidencePolicy.requirements.some(
      (requirement) =>
        requirement.evidenceType === WORKFLOW_EVIDENCE_TYPE &&
        requirement.required &&
        requirement.hardGate,
    )
  ) {
    fail(
      'UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_INVALID',
      'The exact enabled UGV Skill authority is unavailable or incomplete.',
    );
  }
  return skill;
}

function assertExactTaskAndSkillIdentity(
  input: ResolveTopLevelSkillInput,
  binding: TaskCapabilityBinding,
): void {
  if (
    input.task.taskId !== binding.taskId ||
    input.task.selectedSkillId !== SKILL_ID ||
    input.task.selectedSkillVersion !== SKILL_VERSION ||
    input.goal.goalId !== input.task.goalId ||
    input.goal.version !== input.task.goalVersion ||
    input.skill.skillId !== SKILL_ID ||
    input.skill.version !== SKILL_VERSION
  ) {
    fail(
      'UGV_AGENT_PROFILE_TASK_IDENTITY_STALE',
      'Task, Goal, Skill and Task Capability identities do not form one exact admission chain.',
    );
  }
}

function snapshotInputAuthority(binding: TaskCapabilityBinding) {
  const adapted = adaptUgvMoveInput(binding.inputSnapshot);
  return Object.freeze({
    adapted,
    inputHash: hashCanonicalEvidenceJson(binding.inputSnapshot),
  });
}

function goalContractFields(task: AgentTask, binding: TaskCapabilityBinding, inputHash: string) {
  const target = adaptUgvMoveInput(binding.inputSnapshot).target;
  return Object.freeze({
    title: GOAL_TITLE,
    description: `Move ${UGV_MOVE_RESOURCE_ID} to the capability-authorized ${target.frame} point (${String(target.longitude)}, ${String(target.latitude)}) and prove final position.`,
    constraints: Object.freeze([
      'policy.confirmation=required',
      UGV_NAVIGATE_REPLAY_CONSTRAINT,
      'execution.mode=simulation',
      `authority.task-id=${task.taskId}`,
      `authority.task-capability-binding=${binding.bindingId}`,
      `authority.task-capability-binding-hash=sha256:${binding.bindingHash}`,
      `authority.skill-input-hash=${inputHash}`,
    ]),
    successCriteria: Object.freeze([GOAL_SUCCESS_CRITERION]),
  });
}

function createExactPlan(
  input: Readonly<{
    planId: string;
    contract: UserGoalCompletionContract;
    binding: TaskCapabilityBinding;
    authority: UserGoalPlanCandidateAuthority;
    inputHash: string;
    createdAt: string;
  }>,
): UserGoalPlan {
  const authority = input.authority;
  const skillGoals = Object.freeze([
    Object.freeze({
      skillGoalId: `${input.planId}:skill-goal:1`,
      requiredResult:
        'Reach the capability-authorized point and produce a verified final-position outcome.',
      capabilityNeeds: authority.capabilityNeeds,
      coveredCriterionIds: Object.freeze(
        input.contract.criteria
          .filter((criterion) => criterion.required)
          .map((criterion) => criterion.criterionId),
      ),
      requiredEffectRefs: authority.requiredEffectRefs,
      evidenceRequirements: authority.evidenceRequirements,
      artifactRequirements: authority.artifactRequirements,
      assumptions: Object.freeze([]),
      constraints: Object.freeze([
        'policy.confirmation=required',
        UGV_NAVIGATE_REPLAY_CONSTRAINT,
        `authority.task-capability-binding-hash=sha256:${input.binding.bindingHash}`,
        `authority.skill-input-hash=${input.inputHash}`,
      ]),
      status: 'pending' as const,
    }),
  ]);
  const contractHash = hashCanonicalEvidenceJson(input.contract);
  const contentHash = hashCanonicalEvidenceJson({
    schemaVersion: '1.0',
    goalId: input.contract.goalId,
    goalVersion: input.contract.goalVersion,
    revision: 1,
    skillGoals: skillGoals.map((skillGoal) => {
      const { status, ...content } = skillGoal;
      void status;
      return content;
    }),
    dependencies: [],
  });
  return validateUserGoalPlan(
    input.contract,
    createUserGoalPlan({
      schemaVersion: '1.0',
      planId: input.planId,
      goalId: input.contract.goalId,
      goalVersion: input.contract.goalVersion,
      revision: 1,
      revisionKind: 'initial',
      status: 'validated',
      contractHash,
      contentHash,
      skillGoals,
      dependencies: Object.freeze([]),
      inheritedCompletedEffectIds: Object.freeze([]),
      forbiddenReplayFingerprints: Object.freeze([]),
      createdAt: input.createdAt,
    }),
  );
}

function exactUserGoalPlanAuthority(binding: TaskCapabilityBinding, skill: SkillVersion) {
  const outcome = skill.outcomeSpecification;
  if (
    binding.requestedCapabilityId !== CAPABILITY_ID ||
    outcome === undefined ||
    !sameStrings(outcome.effects, [EFFECT_REF]) ||
    !sameStrings(outcome.evidence, [OUTCOME_EVIDENCE_REF]) ||
    outcome.artifacts.length !== 0
  ) {
    fail(
      'UGV_AGENT_PROFILE_TASK_CAPABILITY_AUTHORITY_INVALID',
      'Task Capability User Goal Plan authority is not the exact UGV outcome contract.',
    );
  }
  return Object.freeze({
    capabilityNeeds: Object.freeze([CAPABILITY_ID]),
    requiredEffectRefs: Object.freeze([EFFECT_REF]),
    evidenceRequirements: Object.freeze([OUTCOME_EVIDENCE_REF]),
    artifactRequirements: Object.freeze([]),
  });
}

async function findGoal(
  goals: Pick<GoalService, 'get'>,
  goalId: string,
): Promise<Goal | undefined> {
  try {
    return await goals.get(goalId);
  } catch (error: unknown) {
    if (error instanceof GoalServiceError && error.code === 'GOAL_NOT_FOUND') return undefined;
    throw error;
  }
}

function assertExistingTaskIdentity(task: AgentTask, goalId: string, planId: string): void {
  if (
    (task.goalId !== undefined && task.goalId !== goalId) ||
    (task.goalVersion !== undefined && (task.goalId !== goalId || task.goalVersion !== 1)) ||
    (task.userGoalPlanId !== undefined && task.userGoalPlanId !== planId)
  ) {
    fail(
      'UGV_AGENT_PROFILE_TASK_IDENTITY_STALE',
      'Existing Task Goal or User Goal Plan identity does not match deterministic UGV admission.',
    );
  }
}

function assertExactGoal(
  goal: Goal,
  contextId: string,
  expected: ReturnType<typeof goalContractFields>,
): void {
  if (
    goal.contextId !== contextId ||
    goal.version !== 1 ||
    goal.status !== 'active' ||
    goal.title !== expected.title ||
    goal.description !== expected.description ||
    !sameStrings(goal.constraints, expected.constraints) ||
    !sameStrings(goal.successCriteria, expected.successCriteria)
  ) {
    fail(
      'UGV_AGENT_PROFILE_GOAL_AUTHORITY_MISMATCH',
      'Existing deterministic UGV Goal does not match the current Task Capability authority.',
    );
  }
}

function assertExactPersistedPlan(
  plan: UserGoalPlan,
  contract: UserGoalCompletionContract,
  binding: TaskCapabilityBinding,
  authority: UserGoalPlanCandidateAuthority,
  inputHash: string,
): void {
  validateUserGoalPlan(contract, plan);
  const expected = createExactPlan({
    planId: plan.planId,
    contract,
    binding,
    authority,
    inputHash,
    createdAt: plan.createdAt,
  });
  const actualSkillGoal = plan.skillGoals[0];
  const expectedSkillGoal = expected.skillGoals[0];
  if (
    plan.goalId !== expected.goalId ||
    plan.goalVersion !== expected.goalVersion ||
    plan.revision !== expected.revision ||
    plan.revisionKind !== expected.revisionKind ||
    plan.contractHash !== expected.contractHash ||
    plan.contentHash !== expected.contentHash ||
    plan.dependencies.length !== 0 ||
    plan.inheritedCompletedEffectIds.length !== 0 ||
    plan.forbiddenReplayFingerprints.length !== 0 ||
    actualSkillGoal === undefined ||
    expectedSkillGoal === undefined ||
    hashCanonicalEvidenceJson({ ...actualSkillGoal, status: 'pending' }) !==
      hashCanonicalEvidenceJson(expectedSkillGoal)
  ) {
    fail(
      'UGV_AGENT_PROFILE_USER_GOAL_PLAN_INVALID',
      'Existing UGV User Goal Plan does not match the current Task Capability authority.',
    );
  }
}

function hasExactConstraint(
  binding: TaskCapabilityBinding,
  type: string,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  const matches = binding.constraintSnapshot.filter((constraint) => constraint['type'] === type);
  return (
    matches.length === 1 &&
    Object.entries(expected).every(([key, value]) => matches[0]?.[key] === value)
  );
}

function hasSimulationIdentity(binding: TaskCapabilityBinding): boolean {
  const policy = binding.constraintSnapshot.find(
    (constraint) => constraint['type'] === 'runtime_execution_mode_policy',
  );
  return typeof policy?.['simulationId'] === 'string' && policy['simulationId'].trim() !== '';
}

function bindingInputSourceRef(binding: TaskCapabilityBinding): string {
  return `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:input-snapshot`;
}

function hasSingleHashConstraint(constraints: readonly string[], prefix: string): boolean {
  const matches = constraints.filter((constraint) => constraint.startsWith(prefix));
  return (
    matches.length === 1 && /^sha256:[0-9a-f]{64}$/u.test(matches[0]?.slice(prefix.length) ?? '')
  );
}

function hasSingleExactConstraint(constraints: readonly string[], expected: string): boolean {
  return constraints.filter((constraint) => constraint === expected).length === 1;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stableId(prefix: string, taskId: string): string {
  return `${prefix}-${createHash('sha256').update(taskId).digest('hex').slice(0, 32)}`;
}

function fail(code: UgvAgentProfileAdmissionErrorCode, message: string): never {
  throw new UgvAgentProfileAdmissionError(code, message);
}
