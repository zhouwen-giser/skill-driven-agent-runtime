import type {
  BusinessEventContinuityRecord,
  BusinessEventEnvelope,
  BusinessEventInboxRecord,
  BusinessEventRelationProjection,
  BusinessEventSubscription,
  EventImpactAssessment,
  EventIncident,
  RemoteTaskBinding,
  SkillVersion,
  UserGoalPlan,
} from '../../domain/src/index.js';
import {
  USER_GOAL_RUNTIME_LIMITS,
  createBusinessEventEnvelope,
  createEventImpactAssessment,
  createEventIncident,
  createUserGoalPlan,
} from '../../domain/src/index.js';

import type { BusinessEventProcessor } from './business-events.js';
import type { Clock } from './ports.js';

export interface BusinessEventImpactRepository {
  findBusinessEventSubscription(
    subscriptionId: string,
  ): Promise<BusinessEventSubscription | undefined>;
  saveEventImpactAssessment(assessment: EventImpactAssessment): Promise<void>;
  saveEventIncident(incident: EventIncident): Promise<Readonly<{ created: boolean }>>;
  findEventIncidentByDedupeKey(dedupeKey: string): Promise<EventIncident | undefined>;
  attachEventIncidentTask(
    dedupeKey: string,
    agentTaskId: string,
    incident: EventIncident,
  ): Promise<void>;
}

export interface BusinessEventRemoteBindingRepository {
  findByRemoteIdentity(
    serverId: string,
    remoteTaskId: string,
  ): Promise<RemoteTaskBinding | undefined>;
}

export interface BusinessEventPlanRepository {
  findCurrentPlan(
    goalId: string,
    goalVersion: number,
  ): Promise<Readonly<{ plan: UserGoalPlan; lockVersion: number }> | undefined>;
  replacePlan(
    source: Readonly<{
      planId: string;
      lockVersion: number;
      status: UserGoalPlan['status'];
    }>,
    plan: UserGoalPlan,
    updatedAt: string,
  ): Promise<boolean>;
}

export interface BusinessEventRelationAuthority {
  resolve(
    record: BusinessEventInboxRecord,
    event: Extract<BusinessEventEnvelope, Readonly<{ scope: 'resource' }>>,
    subscription: BusinessEventSubscription,
  ): Promise<BusinessEventRelationProjection>;
}

export interface BusinessEventSemanticImpactAssessor {
  assess(
    input: Readonly<{
      event: BusinessEventEnvelope;
      bindings: readonly RemoteTaskBinding[];
      candidateCriterionIds: readonly string[];
    }>,
  ): Promise<
    Readonly<{
      classification: EventImpactAssessment['classification'];
      confidence: EventImpactAssessment['confidence'];
      ruleId: string;
    }>
  >;
}

export interface BusinessEventRecoveryPort {
  apply(
    assessment: EventImpactAssessment,
    context: Readonly<{
      event: BusinessEventEnvelope;
      subscription: BusinessEventSubscription;
      bindings: readonly RemoteTaskBinding[];
    }>,
  ): Promise<void>;
}

export class TaskImpactAssessmentService implements BusinessEventProcessor {
  readonly #events: BusinessEventImpactRepository;
  readonly #bindings: BusinessEventRemoteBindingRepository;
  readonly #plans: Pick<BusinessEventPlanRepository, 'findCurrentPlan'>;
  readonly #relations: BusinessEventRelationAuthority;
  readonly #semantic: BusinessEventSemanticImpactAssessor | undefined;
  readonly #recovery: BusinessEventRecoveryPort;
  readonly #clock: Clock;
  readonly #nextAssessmentId: () => string;

  constructor(
    input: Readonly<{
      events: BusinessEventImpactRepository;
      bindings: BusinessEventRemoteBindingRepository;
      plans: Pick<BusinessEventPlanRepository, 'findCurrentPlan'>;
      relations: BusinessEventRelationAuthority;
      semantic?: BusinessEventSemanticImpactAssessor;
      recovery: BusinessEventRecoveryPort;
      clock: Clock;
      nextAssessmentId(): string;
    }>,
  ) {
    this.#events = input.events;
    this.#bindings = input.bindings;
    this.#plans = input.plans;
    this.#relations = input.relations;
    this.#semantic = input.semantic;
    this.#recovery = input.recovery;
    this.#clock = input.clock;
    this.#nextAssessmentId = input.nextAssessmentId;
  }

  async process(record: BusinessEventInboxRecord): Promise<void> {
    const event = createBusinessEventEnvelope(record.envelope as BusinessEventEnvelope);
    const subscription = await this.#events.findBusinessEventSubscription(record.subscriptionId);
    if (subscription === undefined)
      throw impactError(
        'BUSINESS_EVENT_SUBSCRIPTION_NOT_FOUND',
        'Impact assessment requires its durable subscription authority.',
      );
    const relation =
      event.scope === 'resource'
        ? await this.#relations.resolve(record, event, subscription)
        : undefined;
    const taskIds =
      event.scope === 'task'
        ? [event.taskId]
        : relation?.status === 'complete'
          ? relation.taskIds
          : event.relatedTaskIds;
    const bindings = Object.freeze(
      (
        await Promise.all(
          [...new Set(taskIds)].map((taskId) =>
            this.#bindings.findByRemoteIdentity(subscription.providerId, taskId),
          ),
        )
      ).filter((binding): binding is RemoteTaskBinding => binding !== undefined),
    );
    const assessment = await this.#assess(record, event, bindings, relation);
    await this.#events.saveEventImpactAssessment(assessment);
    await this.#recovery.apply(assessment, { event, subscription, bindings });
  }

  async #assess(
    record: BusinessEventInboxRecord,
    event: BusinessEventEnvelope,
    bindings: readonly RemoteTaskBinding[],
    relation: BusinessEventRelationProjection | undefined,
  ): Promise<EventImpactAssessment> {
    const goalIds = [...new Set(bindings.map((binding) => binding.goalId))];
    const primary = bindings[0];
    const current =
      primary === undefined
        ? undefined
        : await this.#plans.findCurrentPlan(primary.goalId, primary.goalVersion);
    const skillGoal = current?.plan.skillGoals.find(
      (goal) => goal.skillGoalId === primary?.skillGoalId,
    );
    const criterionIds = skillGoal?.coveredCriterionIds ?? [];
    const rule = deterministicImpact(event, bindings, relation, skillGoal?.status);
    const semantic =
      rule === undefined && this.#semantic !== undefined
        ? await this.#semantic.assess({
            event,
            bindings,
            candidateCriterionIds: criterionIds,
          })
        : undefined;
    const classification =
      rule?.classification ??
      semantic?.classification ??
      (bindings.length === 0 && relation?.status === 'complete' ? 'none' : 'continuity_unknown');
    const confidence =
      rule?.confidence ?? semantic?.confidence ?? (classification === 'none' ? 'high' : 'low');
    const safeClassification =
      confidence === 'low' && classification === 'none' ? 'continuity_unknown' : classification;
    const action = actionFor(safeClassification, confidence, goalIds.length);
    return createEventImpactAssessment({
      assessmentId: this.#nextAssessmentId(),
      inboxId: record.inboxId,
      classification: safeClassification,
      confidence,
      ...(primary === undefined ? {} : { goalId: primary.goalId }),
      ...(primary === undefined ? {} : { goalVersion: primary.goalVersion }),
      ...(current === undefined ? {} : { planId: current.plan.planId }),
      ...(primary?.skillGoalId === undefined ? {} : { skillGoalId: primary.skillGoalId }),
      criterionIds,
      relatedBindingIds: bindings.map((binding) => binding.bindingId).sort(),
      ruleIds: [rule?.ruleId ?? semantic?.ruleId ?? 'conservative_unknown'],
      action,
      createdAt: this.#clock.now(),
    });
  }
}

function deterministicImpact(
  event: BusinessEventEnvelope,
  bindings: readonly RemoteTaskBinding[],
  relation: BusinessEventRelationProjection | undefined,
  skillGoalStatus: UserGoalPlan['skillGoals'][number]['status'] | undefined,
):
  | Readonly<{
      classification: EventImpactAssessment['classification'];
      confidence: EventImpactAssessment['confidence'];
      ruleId: string;
    }>
  | undefined {
  if (event.scope === 'resource' && relation?.status !== 'complete')
    return {
      classification: 'continuity_unknown',
      confidence: 'low',
      ruleId: 'relation_incomplete_fail_closed',
    };
  if (bindings.length === 0)
    return { classification: 'none', confidence: 'high', ruleId: 'complete_relation_empty' };
  if (new Set(bindings.map((binding) => binding.goalId)).size > 1)
    return {
      classification: 'cross_goal_incident',
      confidence: 'high',
      ruleId: 'multiple_goal_bindings',
    };
  const normalized = `${event.eventType} ${event.reasonCode ?? ''}`.toLowerCase();
  if (normalized.includes('evidence') && /invalid|revok|stale/u.test(normalized))
    return {
      classification: 'evidence_invalidated',
      confidence: 'high',
      ruleId: 'explicit_evidence_invalidation',
    };
  if (normalized.includes('assumption') && /invalid|changed/u.test(normalized))
    return {
      classification: 'plan_assumption_invalidated',
      confidence: 'high',
      ruleId: 'explicit_plan_assumption_invalidation',
    };
  if (skillGoalStatus === 'pending' || skillGoalStatus === 'ready')
    return {
      classification: 'future_dependency',
      confidence: 'high',
      ruleId: 'binding_targets_future_skill_goal',
    };
  if (/lost|offline|failed|critical|unavailable/u.test(normalized))
    return {
      classification: 'current_task_goal',
      confidence: 'high',
      ruleId: 'active_task_disruption',
    };
  return undefined;
}

function actionFor(
  classification: EventImpactAssessment['classification'],
  confidence: EventImpactAssessment['confidence'],
  goalCount: number,
): EventImpactAssessment['action'] {
  if (confidence === 'low') return 'request_confirmation';
  if (goalCount > 1 || classification === 'cross_goal_incident') return 'create_incident_task';
  switch (classification) {
    case 'none':
      return 'record_only';
    case 'current_task_goal':
      return 'reconcile_remote_task';
    case 'current_skill_goal':
      return 'pause_attempt';
    case 'future_dependency':
      return 'insert_event_handling_skill_goal';
    case 'user_criterion':
    case 'evidence_invalidated':
    case 'plan_assumption_invalidated':
      return 'revise_user_goal_plan';
    case 'continuity_unknown':
      return 'request_confirmation';
  }
}

export interface EventRecoveryControlPort {
  reconcileRemoteTasks(bindingIds: readonly string[]): Promise<void>;
  pauseAttempts(bindings: readonly RemoteTaskBinding[], reasonCode: string): Promise<void>;
  cancelAttempts(bindings: readonly RemoteTaskBinding[], reasonCode: string): Promise<void>;
  createIncidentTask(
    input: Readonly<{
      dedupeKey: string;
      summary: string;
      relatedGoalIds: readonly string[];
      contextId: string;
    }>,
  ): Promise<string>;
}

export class EventImpactRecoveryService implements BusinessEventRecoveryPort {
  readonly #plans: BusinessEventPlanRepository;
  readonly #events: BusinessEventImpactRepository;
  readonly #controls: EventRecoveryControlPort;
  readonly #clock: Clock;
  readonly #nextPlanId: () => string;
  readonly #nextSkillGoalId: () => string;
  readonly #nextDependencyId: () => string;
  readonly #nextIncidentId: () => string;
  readonly #hash: (value: unknown) => string;

  constructor(
    input: Readonly<{
      plans: BusinessEventPlanRepository;
      events: BusinessEventImpactRepository;
      controls: EventRecoveryControlPort;
      clock: Clock;
      nextPlanId(): string;
      nextSkillGoalId(): string;
      nextDependencyId(): string;
      nextIncidentId(): string;
      hash(value: unknown): string;
    }>,
  ) {
    this.#plans = input.plans;
    this.#events = input.events;
    this.#controls = input.controls;
    this.#clock = input.clock;
    this.#nextPlanId = input.nextPlanId;
    this.#nextSkillGoalId = input.nextSkillGoalId;
    this.#nextDependencyId = input.nextDependencyId;
    this.#nextIncidentId = input.nextIncidentId;
    this.#hash = input.hash;
  }

  async apply(
    assessment: EventImpactAssessment,
    context: Readonly<{
      event: BusinessEventEnvelope;
      subscription: BusinessEventSubscription;
      bindings: readonly RemoteTaskBinding[];
    }>,
  ): Promise<void> {
    const bindingIds = context.bindings.map((binding) => binding.bindingId);
    switch (assessment.action) {
      case 'record_only':
      case 'request_confirmation':
      case 'request_input':
        return;
      case 'reconcile_remote_task':
        await this.#controls.reconcileRemoteTasks(bindingIds);
        return;
      case 'pause_attempt':
        await this.#controls.pauseAttempts(context.bindings, assessment.classification);
        return;
      case 'cancel_attempt':
        await this.#controls.cancelAttempts(context.bindings, assessment.classification);
        return;
      case 'insert_event_handling_skill_goal':
      case 'revise_user_goal_plan':
        await this.#revisePlan(
          assessment,
          assessment.action === 'insert_event_handling_skill_goal',
        );
        return;
      case 'create_incident_task':
        await this.#createIncident(assessment, context);
        return;
    }
  }

  async #revisePlan(assessment: EventImpactAssessment, insertHandlingGoal: boolean): Promise<void> {
    if (assessment.goalId === undefined)
      throw impactError(
        'BUSINESS_EVENT_PLAN_AUTHORITY_MISSING',
        'Event recovery cannot revise a plan without Goal authority.',
      );
    const current = await this.#plans.findCurrentPlan(
      assessment.goalId,
      assessment.goalVersion ?? 1,
    );
    if (current === undefined)
      throw impactError(
        'BUSINESS_EVENT_PLAN_AUTHORITY_MISSING',
        'Event recovery cannot find the current User Goal Plan.',
      );
    if (current.plan.revision >= USER_GOAL_RUNTIME_LIMITS.maxPlanRevisions)
      throw impactError(
        'BUSINESS_EVENT_PLAN_REVISION_BUDGET_EXHAUSTED',
        'Event recovery exhausted the User Goal Plan revision budget.',
      );
    const remaining = current.plan.skillGoals.filter(
      (goal) =>
        goal.status !== 'achieved' && goal.status !== 'superseded' && goal.status !== 'canceled',
    );
    const handlingGoalId = insertHandlingGoal ? this.#nextSkillGoalId() : undefined;
    const skillGoals = [
      ...(handlingGoalId === undefined
        ? []
        : [
            {
              skillGoalId: handlingGoalId,
              requiredResult: 'Assess and safely handle the admitted Business Event.',
              capabilityNeeds: ['business-event.handling'],
              coveredCriterionIds: assessment.criterionIds,
              requiredEffectRefs: [],
              evidenceRequirements: ['business-event-impact-assessment'],
              artifactRequirements: [],
              assumptions: [],
              constraints: [
                'No external effect may execute before the resulting Workflow Plan is confirmed.',
                'Emergency Skills may isolate only and cannot become autonomous recovery authority.',
              ],
              status: 'pending' as const,
            },
          ]),
      ...remaining.map((goal) => ({
        ...goal,
        status: goal.status === 'achieved' ? ('achieved' as const) : ('pending' as const),
      })),
    ];
    const ids = new Set(skillGoals.map((goal) => goal.skillGoalId));
    const dependencies = [
      ...current.plan.dependencies.filter(
        (dependency) =>
          ids.has(dependency.predecessorSkillGoalId) && ids.has(dependency.successorSkillGoalId),
      ),
      ...(handlingGoalId === undefined ||
      assessment.skillGoalId === undefined ||
      !ids.has(assessment.skillGoalId)
        ? []
        : [
            {
              dependencyId: this.#nextDependencyId(),
              predecessorSkillGoalId: handlingGoalId,
              successorSkillGoalId: assessment.skillGoalId,
              predicate: 'required' as const,
            },
          ]),
    ];
    const createdAt = this.#clock.now();
    const revisionContent = {
      sourcePlanId: current.plan.planId,
      assessmentId: assessment.assessmentId,
      skillGoals,
      dependencies,
    };
    const revised = createUserGoalPlan({
      ...current.plan,
      planId: this.#nextPlanId(),
      revision: current.plan.revision + 1,
      revisionKind: 'event_impact',
      sourcePlanId: current.plan.planId,
      status: 'revision_pending',
      contentHash: this.#hash(revisionContent),
      skillGoals,
      dependencies,
      createdAt,
    });
    const changed = await this.#plans.replacePlan(
      {
        planId: current.plan.planId,
        lockVersion: current.lockVersion,
        status: current.plan.status,
      },
      revised,
      createdAt,
    );
    if (!changed)
      throw impactError(
        'BUSINESS_EVENT_PLAN_REVISION_CONFLICT',
        'Another authority changed the User Goal Plan before Event recovery committed.',
      );
  }

  async #createIncident(
    assessment: EventImpactAssessment,
    context: Readonly<{
      event: BusinessEventEnvelope;
      subscription: BusinessEventSubscription;
      bindings: readonly RemoteTaskBinding[];
    }>,
  ): Promise<void> {
    const goalIds = [...new Set(context.bindings.map((binding) => binding.goalId))].sort();
    const dedupeKey = this.#hash({
      providerId: context.subscription.providerId,
      streamId: context.event.streamId,
      eventId: context.event.eventId,
      goalIds,
    });
    const incident = createEventIncident({
      incidentId: this.#nextIncidentId(),
      providerId: context.subscription.providerId,
      streamId: context.event.streamId,
      dedupeKey,
      incidentKind: 'cross_goal',
      summary: `Cross-Goal incident for assessment ${assessment.assessmentId}.`,
      relatedGoalIds: goalIds,
      createdAt: this.#clock.now(),
    });
    const reservation = await this.#events.saveEventIncident(incident);
    const reservedIncident = reservation.created
      ? incident
      : await this.#events.findEventIncidentByDedupeKey(dedupeKey);
    if (reservedIncident === undefined)
      throw impactError(
        'BUSINESS_EVENT_INCIDENT_RESERVATION_MISSING',
        'The Incident reservation disappeared before AgentTask attachment.',
      );
    if (reservedIncident.agentTaskId !== undefined) return;
    const taskId = await this.#controls.createIncidentTask({
      dedupeKey,
      summary: `Business Event ${context.event.eventType} affects multiple User Goals.`,
      relatedGoalIds: goalIds,
      contextId: context.bindings[0]?.contextId ?? `incident-${dedupeKey.slice(7, 23)}`,
    });
    const attached = createEventIncident({ ...reservedIncident, agentTaskId: taskId });
    await this.#events.attachEventIncidentTask(dedupeKey, taskId, attached);
  }
}

export class ContinuityImpactService {
  readonly #events: Pick<BusinessEventImpactRepository, 'saveEventIncident'>;
  readonly #clock: Clock;
  readonly #nextIncidentId: () => string;
  readonly #hash: (value: unknown) => string;

  constructor(
    input: Readonly<{
      events: Pick<BusinessEventImpactRepository, 'saveEventIncident'>;
      clock: Clock;
      nextIncidentId(): string;
      hash(value: unknown): string;
    }>,
  ) {
    this.#events = input.events;
    this.#clock = input.clock;
    this.#nextIncidentId = input.nextIncidentId;
    this.#hash = input.hash;
  }

  async handle(
    record: BusinessEventContinuityRecord,
    providerId: string,
  ): Promise<Readonly<{ created: boolean }>> {
    return this.#events.saveEventIncident(
      createEventIncident({
        incidentId: this.#nextIncidentId(),
        providerId,
        streamId: record.previousStreamId,
        dedupeKey: this.#hash({
          providerId,
          previousStreamId: record.previousStreamId,
          newStreamId: record.newStreamId,
          reasonCode: record.reasonCode,
        }),
        incidentKind: 'continuity_loss',
        summary: `Business Event continuity became uncertain: ${record.reasonCode}.`,
        relatedGoalIds: [],
        createdAt: this.#clock.now(),
      }),
    );
  }
}

export interface EmergencySkillDecision {
  readonly skillId: string;
  readonly version: number;
  readonly disposition: 'isolated_candidate';
  readonly requiresConfirmation: true;
}

export class EmergencySkillIsolationService {
  select(candidates: readonly SkillVersion[]): EmergencySkillDecision | undefined {
    const candidate = candidates
      .filter(
        (skill) =>
          skill.status === 'enabled' &&
          skill.capabilities.includes('event.emergency.isolation') &&
          !skill.capabilities.some((capability) => capability.includes('autonomous-recovery')),
      )
      .sort(
        (left, right) => left.skillId.localeCompare(right.skillId) || right.version - left.version,
      )[0];
    return candidate === undefined
      ? undefined
      : {
          skillId: candidate.skillId,
          version: candidate.version,
          disposition: 'isolated_candidate',
          requiresConfirmation: true,
        };
  }
}

export class BusinessEventImpactError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BusinessEventImpactError';
    this.code = code;
  }
}

function impactError(code: string, message: string): BusinessEventImpactError {
  return new BusinessEventImpactError(code, message);
}
