import { DomainError } from './errors.js';

export const USER_GOAL_RUNTIME_LIMITS = Object.freeze({
  maxSkillGoals: 16,
  maxDagDepth: 8,
  maxParallelReadyGoals: 4,
  maxPlanRevisions: 4,
  maxPlanningModelAttempts: 2,
});

export type UserGoalPlanStatus =
  | 'planning'
  | 'validated'
  | 'active'
  | 'revision_pending'
  | 'superseded'
  | 'completed'
  | 'failed'
  | 'canceled';
export type UserGoalPlanRevisionKind =
  'initial' | 'goal_patch' | 'user_revision' | 'recovery' | 'event_impact';
export type SkillGoalStatus =
  | 'pending'
  | 'ready'
  | 'dispatch_intent'
  | 'selecting'
  | 'executing'
  | 'judging'
  | 'achieved'
  | 'partially_achieved'
  | 'failed'
  | 'blocked'
  | 'superseded'
  | 'canceled';
export type SkillAttemptStatus =
  | 'dispatch_intent'
  | 'selecting'
  | 'planning_workflow'
  | 'awaiting_confirmation'
  | 'running'
  | 'waiting_external'
  | 'judging'
  | 'achieved'
  | 'partially_achieved'
  | 'failed'
  | 'canceled'
  | 'superseded';
export type OutcomeLevel = 'task_goal' | 'skill_goal' | 'user_goal';
export type OutcomeStatus = 'achieved' | 'partially_achieved' | 'not_achieved' | 'unknown';
export type OutcomeConfidence = 'high' | 'medium' | 'low';
export type ProgressClass = 'progressing' | 'stalled' | 'regressing' | 'complete';
export type BusinessEventSubscriptionStatus =
  'current' | 'draining_closed' | 'reset_required' | 'retired';
export type BusinessEventInboxStatus =
  'admitted' | 'processing' | 'processed' | 'retryable_failed' | 'terminal_failed';

export interface UserGoalCriterion {
  readonly criterionId: string;
  readonly description: string;
  readonly required: boolean;
  readonly expectedEffectRefs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly artifactRequirements: readonly string[];
}

export interface UserGoalCompletionContract {
  readonly schemaVersion: '1.0';
  readonly goalId: string;
  readonly goalVersion: number;
  readonly title: string;
  readonly description: string;
  readonly constraints: readonly string[];
  readonly criteria: readonly UserGoalCriterion[];
  readonly assumptions: readonly string[];
  readonly policy: Readonly<typeof USER_GOAL_RUNTIME_LIMITS>;
}

export interface SkillGoal {
  readonly skillGoalId: string;
  readonly requiredResult: string;
  readonly capabilityNeeds: readonly string[];
  readonly coveredCriterionIds: readonly string[];
  readonly requiredEffectRefs: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly artifactRequirements: readonly string[];
  readonly assumptions: readonly string[];
  readonly constraints: readonly string[];
  readonly status: SkillGoalStatus;
}

export interface SkillGoalDependency {
  readonly dependencyId: string;
  readonly predecessorSkillGoalId: string;
  readonly successorSkillGoalId: string;
  readonly predicate: 'required' | 'optional';
}

export interface UserGoalPlan {
  readonly schemaVersion: '1.0';
  readonly planId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly revision: number;
  readonly revisionKind: UserGoalPlanRevisionKind;
  readonly status: UserGoalPlanStatus;
  readonly contractHash: string;
  readonly contentHash: string;
  readonly skillGoals: readonly SkillGoal[];
  readonly dependencies: readonly SkillGoalDependency[];
  readonly inheritedCompletedEffectIds: readonly string[];
  readonly forbiddenReplayFingerprints: readonly string[];
  readonly createdAt: string;
}

export interface SkillOutcomeSpecification {
  readonly schemaVersion: '1.0';
  readonly skillId: string;
  readonly skillVersion: number;
  readonly effects: readonly string[];
  readonly evidence: readonly string[];
  readonly artifacts: readonly string[];
  readonly taskGoalPolicy: Readonly<Record<string, unknown>>;
  readonly confidencePolicy: Readonly<Record<string, unknown>>;
  readonly sideEffectPolicy: Readonly<Record<string, unknown>>;
  readonly specificationHash: string;
}

export interface SkillExecutionContract {
  readonly schemaVersion: '1.0';
  readonly executionContractId: string;
  readonly planId: string;
  readonly skillGoalId: string;
  readonly attemptId: string;
  readonly skillId: string;
  readonly skillVersion: number;
  readonly resolvedInput: unknown;
  readonly outcomeSpecificationHash: string;
  readonly allowedAuthorities: readonly string[];
  readonly budget: Readonly<Record<string, number>>;
  readonly confirmationRequired: boolean;
  readonly forbiddenReplayFingerprints: readonly string[];
  readonly contractHash: string;
}

export interface SkillAttempt {
  readonly attemptId: string;
  readonly planId: string;
  readonly skillGoalId: string;
  readonly ordinal: number;
  readonly status: SkillAttemptStatus;
  readonly strategyFingerprint: string;
  readonly budget: Readonly<{ maxAttempts: number; consumedAttempts: number }>;
  readonly executionContractId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutcomeDecision {
  readonly outcomeDecisionId: string;
  readonly level: OutcomeLevel;
  readonly subjectId: string;
  readonly status: OutcomeStatus;
  readonly confidence: OutcomeConfidence;
  readonly ruleIds: readonly string[];
  readonly criterionRefs: readonly string[];
  readonly effectRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly summary: string;
  readonly createdAt: string;
}

export interface ProgressObservation {
  readonly progressObservationId: string;
  readonly planId: string;
  readonly classification: ProgressClass;
  readonly vector: Readonly<Record<string, unknown>>;
  readonly observedAt: string;
}

export interface CompletedEffect {
  readonly completedEffectId: string;
  readonly goalId: string;
  readonly planId: string;
  readonly skillGoalId?: string;
  readonly status: 'observed' | 'verified' | 'invalidated';
  readonly effectFingerprint: string;
  readonly evidenceRefs: readonly string[];
  readonly predecessorEffectId?: string;
  readonly createdAt: string;
}

export interface RecoveryDecision {
  readonly recoveryDecisionId: string;
  readonly planId: string;
  readonly skillGoalId?: string;
  readonly attemptId?: string;
  readonly action:
    | 'no_action'
    | 'reconcile_remote_task'
    | 'replacement_attempt'
    | 'revise_plan'
    | 'request_input'
    | 'fail_goal';
  readonly reasonCode: string;
  readonly strategyFingerprint: string;
  readonly createdAt: string;
}

export interface BusinessEventSubscription {
  readonly subscriptionId: string;
  readonly providerId: string;
  readonly streamId: string;
  readonly generation: number;
  readonly status: BusinessEventSubscriptionStatus;
  readonly lastDurablyAdmittedSequence: string;
  readonly lastProcessedSequence: string;
  readonly lastReplayableSequence?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BusinessEventInboxRecord {
  readonly inboxId: string;
  readonly subscriptionId: string;
  readonly eventId: string;
  readonly sequence: string;
  readonly envelopeHash: string;
  readonly envelope: unknown;
  readonly status: BusinessEventInboxStatus;
  readonly admittedAt: string;
}

export interface EventImpactAssessment {
  readonly assessmentId: string;
  readonly inboxId: string;
  readonly classification:
    | 'none'
    | 'current_task_goal'
    | 'current_skill_goal'
    | 'future_dependency'
    | 'user_criterion'
    | 'evidence_invalidated'
    | 'plan_assumption_invalidated'
    | 'continuity_unknown'
    | 'cross_goal_incident';
  readonly confidence: OutcomeConfidence;
  readonly goalId?: string;
  readonly planId?: string;
  readonly skillGoalId?: string;
  readonly ruleIds: readonly string[];
  readonly action:
    | 'record_only'
    | 'reconcile_remote_task'
    | 'pause_attempt'
    | 'cancel_attempt'
    | 'insert_event_handling_skill_goal'
    | 'revise_user_goal_plan'
    | 'create_incident_task'
    | 'request_confirmation'
    | 'request_input';
  readonly createdAt: string;
}

export function createUserGoalCompletionContract(
  input: UserGoalCompletionContract,
): UserGoalCompletionContract {
  assertId(input.goalId, 'USER_GOAL_CONTRACT_INVALID');
  if (input.goalVersion < 1 || input.title.trim() === '' || input.description.trim() === '')
    invalid(
      'USER_GOAL_CONTRACT_INVALID',
      'User Goal contract identity and description are required.',
    );
  if (input.criteria.length === 0 || input.criteria.length > 128)
    invalid('USER_GOAL_CONTRACT_INVALID', 'User Goal criteria must be bounded and non-empty.');
  assertUnique(
    input.criteria.map((item) => item.criterionId),
    'USER_GOAL_CONTRACT_INVALID',
  );
  for (const criterion of input.criteria) {
    assertId(criterion.criterionId, 'USER_GOAL_CONTRACT_INVALID');
    if (criterion.description.trim() === '')
      invalid('USER_GOAL_CONTRACT_INVALID', 'Criterion description is required.');
  }
  if (!sameLimits(input.policy))
    invalid('USER_GOAL_CONTRACT_INVALID', 'User Goal policy must use the frozen limits.');
  assertBoundedJson(input, 'USER_GOAL_CONTRACT_INVALID');
  return Object.freeze(input);
}

export function createUserGoalPlan(input: UserGoalPlan): UserGoalPlan {
  assertId(input.planId, 'USER_GOAL_PLAN_INVALID');
  assertId(input.goalId, 'USER_GOAL_PLAN_INVALID');
  if (input.goalVersion < 1 || input.revision < 1 || input.revision > 4)
    invalid('USER_GOAL_PLAN_INVALID', 'Goal version and plan revision must be in range.');
  assertHash(input.contractHash, 'USER_GOAL_PLAN_INVALID');
  assertHash(input.contentHash, 'USER_GOAL_PLAN_INVALID');
  assertBoundedJson(input, 'USER_GOAL_PLAN_INVALID');
  return Object.freeze(input);
}

export function validateUserGoalPlan(
  contract: UserGoalCompletionContract,
  candidate: unknown,
): UserGoalPlan {
  if (
    !isRecord(candidate) ||
    !Array.isArray(candidate['skillGoals']) ||
    !Array.isArray(candidate['dependencies'])
  )
    invalid('USER_GOAL_PLAN_INVALID', 'User Goal plan shape is invalid.');
  const plan = createUserGoalPlan(candidate as unknown as UserGoalPlan);
  if (plan.goalId !== contract.goalId || plan.goalVersion !== contract.goalVersion)
    invalid('USER_GOAL_PLAN_INVALID', 'User Goal plan does not belong to the contract.');
  if (plan.skillGoals.length === 0 || plan.skillGoals.length > contract.policy.maxSkillGoals)
    invalid('USER_GOAL_PLAN_BOUND_EXCEEDED', 'Skill Goal count exceeds the frozen bound.');
  assertUnique(
    plan.skillGoals.map((goal) => goal.skillGoalId),
    'USER_GOAL_PLAN_INVALID',
  );
  assertUnique(
    plan.dependencies.map((dependency) => dependency.dependencyId),
    'USER_GOAL_PLAN_INVALID',
  );
  for (const skillGoal of plan.skillGoals) {
    assertId(skillGoal.skillGoalId, 'USER_GOAL_PLAN_INVALID');
    assertNoExecutionAuthority(skillGoal);
  }
  const ids = new Set(plan.skillGoals.map((goal) => goal.skillGoalId));
  for (const dependency of plan.dependencies) {
    if (
      !ids.has(dependency.predecessorSkillGoalId) ||
      !ids.has(dependency.successorSkillGoalId) ||
      dependency.predecessorSkillGoalId === dependency.successorSkillGoalId
    )
      invalid('USER_GOAL_PLAN_INVALID', 'Skill Goal dependency identity is invalid.');
  }
  const depth = dagDepth(plan.skillGoals, plan.dependencies);
  if (depth === undefined) invalid('USER_GOAL_PLAN_CYCLE', 'Skill Goal DAG contains a cycle.');
  if (depth > contract.policy.maxDagDepth)
    invalid('USER_GOAL_PLAN_BOUND_EXCEEDED', 'Skill Goal DAG exceeds the frozen depth.');
  const covered = new Set(plan.skillGoals.flatMap((goal) => [...goal.coveredCriterionIds]));
  const required = contract.criteria.filter((criterion) => criterion.required);
  if (required.some((criterion) => !covered.has(criterion.criterionId)))
    invalid(
      'USER_GOAL_PLAN_CRITERION_COVERAGE_INCOMPLETE',
      'Every required criterion must be covered exactly before plan acceptance.',
    );
  const knownCriteria = new Set(contract.criteria.map((criterion) => criterion.criterionId));
  if ([...covered].some((criterionId) => !knownCriteria.has(criterionId)))
    invalid('USER_GOAL_PLAN_INVALID', 'Skill Goal references an unknown criterion.');
  return plan;
}

export function createSkillAttempt(
  input: Omit<SkillAttempt, 'updatedAt'> & { readonly updatedAt?: string },
): SkillAttempt {
  assertId(input.attemptId, 'SKILL_ATTEMPT_INVALID');
  assertId(input.planId, 'SKILL_ATTEMPT_INVALID');
  assertId(input.skillGoalId, 'SKILL_ATTEMPT_INVALID');
  assertHash(input.strategyFingerprint, 'SKILL_ATTEMPT_INVALID');
  if (
    input.ordinal < 1 ||
    input.budget.maxAttempts < 1 ||
    input.budget.consumedAttempts < 0 ||
    input.budget.consumedAttempts > input.budget.maxAttempts
  )
    invalid('SKILL_ATTEMPT_INVALID', 'Skill Attempt ordinal or budget is invalid.');
  return Object.freeze({ ...input, updatedAt: input.updatedAt ?? input.createdAt });
}

const ATTEMPT_TRANSITIONS: Readonly<Record<SkillAttemptStatus, readonly SkillAttemptStatus[]>> = {
  dispatch_intent: ['selecting', 'canceled', 'superseded', 'failed'],
  selecting: ['planning_workflow', 'failed', 'canceled', 'superseded'],
  planning_workflow: ['awaiting_confirmation', 'running', 'failed', 'canceled', 'superseded'],
  awaiting_confirmation: ['running', 'failed', 'canceled', 'superseded'],
  running: ['waiting_external', 'judging', 'failed', 'canceled', 'superseded'],
  waiting_external: ['running', 'judging', 'failed', 'canceled', 'superseded'],
  judging: ['achieved', 'partially_achieved', 'failed', 'canceled', 'superseded'],
  achieved: [],
  partially_achieved: [],
  failed: [],
  canceled: [],
  superseded: [],
};

export function transitionSkillAttempt(
  attempt: SkillAttempt,
  status: SkillAttemptStatus,
  updatedAt: string,
): SkillAttempt {
  if (!ATTEMPT_TRANSITIONS[attempt.status].includes(status))
    invalid(
      'SKILL_ATTEMPT_TRANSITION_INVALID',
      `Skill Attempt cannot transition from ${attempt.status} to ${status}.`,
    );
  return Object.freeze({ ...attempt, status, updatedAt });
}

export function createOutcomeDecision(input: OutcomeDecision): OutcomeDecision {
  assertId(input.outcomeDecisionId, 'OUTCOME_DECISION_INVALID');
  assertId(input.subjectId, 'OUTCOME_DECISION_INVALID');
  if (input.confidence === 'low' && input.status === 'achieved')
    invalid('OUTCOME_DECISION_INVALID', 'Low confidence cannot produce achieved.');
  if (input.summary.trim() === '')
    invalid('OUTCOME_DECISION_INVALID', 'Outcome decision summary is required.');
  assertBoundedJson(input, 'OUTCOME_DECISION_INVALID');
  return Object.freeze(input);
}

export function createBusinessEventInboxRecord(
  input: BusinessEventInboxRecord,
): BusinessEventInboxRecord {
  for (const id of [input.inboxId, input.subscriptionId, input.eventId])
    assertId(id, 'BUSINESS_EVENT_RECORD_INVALID');
  assertDecimalSequence(input.sequence);
  assertHash(input.envelopeHash, 'BUSINESS_EVENT_RECORD_INVALID');
  assertBoundedJson(input.envelope, 'BUSINESS_EVENT_RECORD_INVALID');
  return Object.freeze(input);
}

function assertNoExecutionAuthority(value: unknown): void {
  const forbidden = new Set([
    'skillId',
    'skillVersion',
    'toolId',
    'toolName',
    'providerId',
    'serverId',
    'mcpOperation',
    'workflowId',
    'workflowDefinitionId',
    'modelProviderId',
  ]);
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    if (!isRecord(current)) return;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.has(key))
        invalid(
          'SKILL_GOAL_EXECUTION_AUTHORITY_FORBIDDEN',
          `Skill Goal contains forbidden execution authority ${key}.`,
        );
      visit(child);
    }
  };
  visit(value);
}

function dagDepth(
  goals: readonly SkillGoal[],
  dependencies: readonly SkillGoalDependency[],
): number | undefined {
  const incoming = new Map(goals.map((goal) => [goal.skillGoalId, 0]));
  const outgoing = new Map(goals.map((goal) => [goal.skillGoalId, [] as string[]]));
  for (const dependency of dependencies) {
    incoming.set(
      dependency.successorSkillGoalId,
      (incoming.get(dependency.successorSkillGoalId) ?? 0) + 1,
    );
    outgoing.get(dependency.predecessorSkillGoalId)?.push(dependency.successorSkillGoalId);
  }
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => ({ id, depth: 1 }));
  let visited = 0;
  let maximum = 0;
  for (const item of queue) {
    visited += 1;
    maximum = Math.max(maximum, item.depth);
    for (const successor of outgoing.get(item.id) ?? []) {
      const remaining = (incoming.get(successor) ?? 0) - 1;
      incoming.set(successor, remaining);
      if (remaining === 0) queue.push({ id: successor, depth: item.depth + 1 });
    }
  }
  return visited === goals.length ? maximum : undefined;
}

function sameLimits(policy: Readonly<typeof USER_GOAL_RUNTIME_LIMITS>): boolean {
  return Object.entries(USER_GOAL_RUNTIME_LIMITS).every(
    ([key, value]) => policy[key as keyof typeof policy] === value,
  );
}

function assertId(value: string, code: Parameters<typeof invalid>[0]): void {
  if (!/^[\x21-\x7E]{1,128}$/u.test(value))
    invalid(code, 'Identifier must be 1-128 ASCII characters.');
}

function assertHash(value: string, code: Parameters<typeof invalid>[0]): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value))
    invalid(code, 'Hash must use sha256:<64 lowercase hex>.');
}

function assertDecimalSequence(value: string): void {
  if (!/^(0|[1-9][0-9]*)$/u.test(value))
    invalid('BUSINESS_EVENT_RECORD_INVALID', 'Business Event sequence must be a decimal string.');
}

function assertUnique(values: readonly string[], code: Parameters<typeof invalid>[0]): void {
  if (new Set(values).size !== values.length) invalid(code, 'Identifiers must be unique.');
}

function assertBoundedJson(value: unknown, code: Parameters<typeof invalid>[0]): void {
  let nodes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 4096 || depth > 16) invalid(code, 'JSON exceeds structural bounds.');
    if (typeof current === 'string' && Buffer.byteLength(current, 'utf8') > 65_536)
      invalid(code, 'JSON string exceeds byte bound.');
    if (Array.isArray(current)) for (const item of current) visit(item, depth + 1);
    else if (isRecord(current)) for (const child of Object.values(current)) visit(child, depth + 1);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 262_144)
    invalid(code, 'JSON exceeds total byte bound.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(code: ConstructorParameters<typeof DomainError>[0], message: string): never {
  throw new DomainError(code, message);
}
