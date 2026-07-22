import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createBusinessEventInboxRecord,
  createEventImpactAssessment,
  createRemoteTaskBinding,
  createUserGoalPlan,
  type BusinessEventRelationProjection,
  type EventImpactAssessment,
  type EventIncident,
  type UserGoalPlan,
} from '../../domain/src/index.js';
import {
  EmergencySkillIsolationService,
  EventImpactRecoveryService,
  TaskImpactAssessmentService,
  type BusinessEventImpactRepository,
  type BusinessEventPlanRepository,
  type EventRecoveryControlPort,
} from '../src/index.js';

describe('Business Event impact and recovery', () => {
  it('maps a Task Event through Binding → Attempt → Skill Goal → User Criterion', async () => {
    const events = new ImpactRepository();
    const recovery = { apply: vi.fn(() => Promise.resolve()) };
    const service = new TaskImpactAssessmentService({
      events,
      bindings: { findByRemoteIdentity: () => Promise.resolve(binding()) },
      plans: new PlanRepository(plan('executing')),
      relations: { resolve: () => Promise.resolve(completeRelation(['remote-1'])) },
      recovery,
      clock,
      nextAssessmentId: () => 'assessment-1',
    });
    await service.process(taskInbox('vehicle.connectivity.lost'));
    expect(events.assessments[0]).toMatchObject({
      classification: 'current_task_goal',
      confidence: 'high',
      goalId: 'goal-1',
      goalVersion: 1,
      planId: 'user-goal-plan-1',
      skillGoalId: 'skill-goal-1',
      criterionIds: ['criterion-1'],
      relatedBindingIds: ['binding-1'],
      action: 'reconcile_remote_task',
    });
    expect(recovery.apply).toHaveBeenCalledOnce();
  });

  it('never authorizes no impact from an incomplete Provider relation', async () => {
    const events = new ImpactRepository();
    const service = new TaskImpactAssessmentService({
      events,
      bindings: { findByRemoteIdentity: () => Promise.resolve(undefined) },
      plans: new PlanRepository(plan('pending')),
      relations: {
        resolve: () => Promise.resolve({ ...completeRelation([]), status: 'incomplete', total: 4 }),
      },
      semantic: {
        assess: () =>
          Promise.resolve({ classification: 'none', confidence: 'low', ruleId: 'model-none' }),
      },
      recovery: { apply: () => Promise.resolve() },
      clock,
      nextAssessmentId: () => 'assessment-2',
    });
    await service.process(resourceInbox());
    expect(events.assessments[0]).toMatchObject({
      classification: 'continuity_unknown',
      confidence: 'low',
      action: 'request_confirmation',
      ruleIds: ['relation_incomplete_fail_closed'],
    });
  });

  it('inserts a bounded EventHandlingSkillGoal in a confirmation-pending plan revision', async () => {
    const source = plan('pending');
    const plans = new PlanRepository(source);
    const events = new ImpactRepository();
    const controls = controlsSpy();
    const recovery = recoveryService(plans, events, controls);
    const assessment = impact({
      classification: 'future_dependency',
      action: 'insert_event_handling_skill_goal',
    });
    await recovery.apply(assessment, {
      event: resourceEvent(),
      subscription: events.subscription,
      bindings: [binding()],
    });
    expect(plans.replacement).toMatchObject({
      revision: 2,
      revisionKind: 'event_impact',
      status: 'revision_pending',
      sourcePlanId: source.planId,
    });
    expect(plans.replacement?.skillGoals[0]).toMatchObject({
      capabilityNeeds: ['business-event.handling'],
      status: 'pending',
    });
    expect(plans.replacement?.dependencies).toEqual([
      expect.objectContaining({
        predecessorSkillGoalId: 'event-goal-1',
        successorSkillGoalId: 'skill-goal-1',
      }),
    ]);
  });

  it('creates a deduplicated cross-Goal Incident AgentTask authority', async () => {
    const plans = new PlanRepository(plan('executing'));
    const events = new ImpactRepository();
    const controls = controlsSpy();
    const recovery = recoveryService(plans, events, controls);
    const assessment = impact({
      classification: 'cross_goal_incident',
      action: 'create_incident_task',
    });
    const context = {
      event: resourceEvent(),
      subscription: events.subscription,
      bindings: [binding(), binding({ bindingId: 'binding-2', goalId: 'goal-2' })],
    };
    await recovery.apply(assessment, context);
    await recovery.apply(assessment, context);
    expect(controls.createIncidentTask).toHaveBeenCalledOnce();
    expect(events.incidents).toHaveLength(1);
    expect(events.incidents[0]?.relatedGoalIds).toEqual(['goal-1', 'goal-2']);
  });

  it('repairs an Incident reservation whose AgentTask attachment was interrupted', async () => {
    const plans = new PlanRepository(plan('executing'));
    const events = new ImpactRepository();
    const controls = controlsSpy();
    const recovery = recoveryService(plans, events, controls);
    const assessment = impact({
      classification: 'cross_goal_incident',
      action: 'create_incident_task',
    });
    const context = {
      event: resourceEvent(),
      subscription: events.subscription,
      bindings: [binding(), binding({ bindingId: 'binding-2', goalId: 'goal-2' })],
    };
    events.failNextAttachment = true;
    await expect(recovery.apply(assessment, context)).rejects.toThrow(
      'injected attachment failure',
    );
    await expect(recovery.apply(assessment, context)).resolves.toBeUndefined();
    expect(controls.createIncidentTask).toHaveBeenCalledTimes(2);
    expect(events.incidents[0]?.agentTaskId).toBe('incident-task-1');
  });

  it('keeps Emergency Skills isolated candidates requiring confirmation', () => {
    const decision = new EmergencySkillIsolationService().select([
      {
        skillId: 'skill-emergency',
        version: 1,
        name: 'Emergency isolation',
        summary: 'Isolate only.',
        description: 'Isolate an affected resource.',
        capabilities: ['event.emergency.isolation'],
        workflowGuidance: 'Prepare an isolation plan.',
        outputInstruction: 'Report isolation evidence.',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
        sourceKind: 'manual_correction',
        validationPassed: true,
        createdAt: clock.now(),
        outcomeSpecification: {
          schemaVersion: '1.0',
          skillId: 'skill-emergency',
          skillVersion: 1,
          effects: ['resource.isolated'],
          evidence: ['isolation-evidence'],
          artifacts: [],
          taskGoalPolicy: {},
          confidencePolicy: {},
          sideEffectPolicy: {},
          specificationHash: `sha256:${'e'.repeat(64)}`,
        },
      },
    ]);
    expect(decision).toEqual({
      skillId: 'skill-emergency',
      version: 1,
      disposition: 'isolated_candidate',
      requiresConfirmation: true,
    });
  });
});

class ImpactRepository implements BusinessEventImpactRepository {
  readonly assessments: EventImpactAssessment[] = [];
  readonly incidents: EventIncident[] = [];
  readonly subscription = {
    subscriptionId: 'subscription-1',
    providerId: 'server-1',
    streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
    generation: 1,
    status: 'current' as const,
    lastDurablyAdmittedSequence: '1',
    lastProcessedSequence: '0',
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };
  failNextAttachment = false;

  findBusinessEventSubscription() {
    return Promise.resolve(this.subscription);
  }
  saveEventImpactAssessment(assessment: EventImpactAssessment) {
    this.assessments.push(assessment);
    return Promise.resolve();
  }
  saveEventIncident(incident: EventIncident) {
    const created = !this.incidents.some((item) => item.dedupeKey === incident.dedupeKey);
    if (created) this.incidents.push(incident);
    return Promise.resolve({ created });
  }
  findEventIncidentByDedupeKey(dedupeKey: string) {
    return Promise.resolve(this.incidents.find((item) => item.dedupeKey === dedupeKey));
  }
  attachEventIncidentTask(dedupeKey: string, agentTaskId: string, incident: EventIncident) {
    if (this.failNextAttachment) {
      this.failNextAttachment = false;
      throw new Error('injected attachment failure');
    }
    const index = this.incidents.findIndex((item) => item.dedupeKey === dedupeKey);
    this.incidents[index] = { ...incident, agentTaskId };
    return Promise.resolve();
  }
}

class PlanRepository implements BusinessEventPlanRepository {
  current: UserGoalPlan;
  replacement: UserGoalPlan | undefined;
  constructor(current: UserGoalPlan) {
    this.current = current;
  }
  findCurrentPlan() {
    return Promise.resolve({ plan: this.current, lockVersion: 1 });
  }
  replacePlan(_source: unknown, replacement: UserGoalPlan) {
    this.replacement = replacement;
    this.current = replacement;
    return Promise.resolve(true);
  }
}

function recoveryService(
  plans: BusinessEventPlanRepository,
  events: BusinessEventImpactRepository,
  controls: ReturnType<typeof controlsSpy>,
) {
  return new EventImpactRecoveryService({
    plans,
    events,
    controls,
    clock,
    nextPlanId: () => 'event-plan-2',
    nextSkillGoalId: () => 'event-goal-1',
    nextDependencyId: () => 'event-dependency-1',
    nextIncidentId: () => 'incident-1',
    hash,
  });
}

function controlsSpy() {
  return {
    reconcileRemoteTasks: vi.fn(() => Promise.resolve()),
    pauseAttempts: vi.fn(() => Promise.resolve()),
    cancelAttempts: vi.fn(() => Promise.resolve()),
    createIncidentTask: vi.fn(() => Promise.resolve('incident-task-1')),
  } satisfies EventRecoveryControlPort;
}

function plan(status: UserGoalPlan['skillGoals'][number]['status']) {
  return createUserGoalPlan({
    schemaVersion: '1.0',
    planId: 'user-goal-plan-1',
    goalId: 'goal-1',
    goalVersion: 1,
    revision: 1,
    revisionKind: 'initial',
    status: 'active',
    contractHash: `sha256:${'a'.repeat(64)}`,
    contentHash: `sha256:${'b'.repeat(64)}`,
    skillGoals: [
      {
        skillGoalId: 'skill-goal-1',
        requiredResult: 'Vehicle remains available.',
        capabilityNeeds: ['vehicle.operation'],
        coveredCriterionIds: ['criterion-1'],
        requiredEffectRefs: ['vehicle.available'],
        evidenceRequirements: ['vehicle-status'],
        artifactRequirements: [],
        assumptions: [],
        constraints: [],
        status,
      },
    ],
    dependencies: [],
    inheritedCompletedEffectIds: [],
    forbiddenReplayFingerprints: [],
    createdAt: clock.now(),
  });
}

function binding(overrides = {}) {
  return createRemoteTaskBinding({
    bindingId: 'binding-1',
    serverId: 'server-1',
    operationName: 'move',
    remoteTaskId: 'remote-1',
    agentTaskId: 'task-1',
    contextId: 'context-1',
    goalId: 'goal-1',
    goalVersion: 1,
    workflowPlanId: 'workflow-plan-1',
    skillGoalId: 'skill-goal-1',
    skillAttemptId: 'attempt-1',
    workflowDefinitionId: 'workflow-1',
    workflowDefinitionVersion: 1,
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'run-1',
    mcpInvocationId: 'invocation-1',
    protocolStatus: 'working',
    protocolRevision: '2026-07-28',
    tasksSchemaRevision: 'schema-1',
    protocolContract: {
      mode: 'frozen_v1',
      protocolVersion: '2026-07-28',
      baselineSha256: 'a'.repeat(64),
    },
    taskBehavior: 'server_directed',
    runtimeRevision: '1',
    lastProviderUpdatedAt: clock.now(),
    executionContext: { mode: 'live' },
    credentialRevision: 'credential-1',
    sessionRevision: 'session-1',
    pollIntervalMs: 200,
    createdAt: clock.now(),
    ...overrides,
  });
}

function taskInbox(eventType: string) {
  return createBusinessEventInboxRecord({
    inboxId: 'inbox-1',
    subscriptionId: 'subscription-1',
    eventId: 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o',
    sequence: '1',
    envelopeHash: `sha256:${'c'.repeat(64)}`,
    envelope: {
      streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
      eventId: 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o',
      sequence: '1',
      sourceId: 'adapter.vehicle',
      eventType,
      occurredAt: clock.now(),
      scope: 'task',
      description: 'Task condition changed.',
      taskId: 'remote-1',
    },
    status: 'admitted',
    admittedAt: clock.now(),
  });
}

function resourceInbox() {
  return createBusinessEventInboxRecord({
    ...taskInbox('vehicle.battery.changed'),
    inboxId: 'inbox-resource',
    envelope: resourceEvent(),
  });
}

function resourceEvent() {
  return {
    streamId: '018f0d4e-7b3a-7cc1-8d57-2f4d9e2a0001',
    eventId: 'nZ_hzhW-zrueWt69x9wP5gq-T_rLs_WgSgyTE7jER_o',
    sequence: '1',
    sourceId: 'adapter.vehicle',
    eventType: 'vehicle.battery.changed',
    occurredAt: clock.now(),
    scope: 'resource' as const,
    description: 'Battery changed.',
    resourceRef: 'vehicle:42',
    relatedTaskIds: [],
    relatedTaskCount: 4,
    relationTruncated: true,
  };
}

function completeRelation(taskIds: readonly string[]): BusinessEventRelationProjection {
  return {
    relationProjectionId: 'relation-1',
    inboxId: 'inbox-1',
    status: 'complete',
    relationHash: `sha256:${'d'.repeat(64)}`,
    taskIds,
    total: taskIds.length,
    createdAt: clock.now(),
  };
}

function impact(overrides: Partial<EventImpactAssessment>) {
  return createEventImpactAssessment({
    assessmentId: 'assessment-recovery',
    inboxId: 'inbox-1',
    classification: 'current_task_goal',
    confidence: 'high',
    goalId: 'goal-1',
    goalVersion: 1,
    planId: 'user-goal-plan-1',
    skillGoalId: 'skill-goal-1',
    criterionIds: ['criterion-1'],
    relatedBindingIds: ['binding-1'],
    ruleIds: ['test-rule'],
    action: 'reconcile_remote_task',
    createdAt: clock.now(),
    ...overrides,
  });
}

const clock = { now: () => '2026-07-22T03:00:00.000Z' };
function hash(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
