import {
  createSkillExecutionEvent,
  createSkillExecutionRecord,
  createSkillExecutionReference,
  type SkillExecutionEvent,
  type SkillExecutionEventType,
  type SkillExecutionReference,
  type SkillExecutionReferenceKind,
  type SkillExecutionStatus,
  type SkillExecutionView,
  type SkillUsagePlanPolicy,
} from '../../domain/src/index.js';
import type { Clock, SkillExecutionRepository } from './ports.js';

export interface SkillExecutionPlanningEvidence {
  readonly executionId: string;
  readonly parentExecutionId?: string;
  readonly taskId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly selectionRef: string;
  readonly applicabilityStatus: 'satisfied' | 'partial' | 'unsatisfied' | 'unknown';
  readonly policy: SkillUsagePlanPolicy;
  readonly workflowPlanId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: number;
  readonly procedureCompiled: boolean;
  readonly planCompliancePassed: boolean;
}

export class SkillExecutionRecordingService {
  readonly #repository: SkillExecutionRepository;
  readonly #clock: Clock;
  readonly #nextId: (kind: 'event' | 'reference') => string;

  constructor(
    input: Readonly<{
      repository: SkillExecutionRepository;
      clock: Clock;
      nextId: (kind: 'event' | 'reference') => string;
    }>,
  ) {
    this.#repository = input.repository;
    this.#clock = input.clock;
    this.#nextId = input.nextId;
  }

  async recordPlanning(input: SkillExecutionPlanningEvidence): Promise<SkillExecutionView> {
    const occurredAt = this.#clock.now();
    const event = (
      eventType: SkillExecutionEventType,
      summary: string,
      details: Readonly<Record<string, unknown>>,
      statusAfter?: SkillExecutionStatus,
    ): SkillExecutionEvent =>
      createSkillExecutionEvent({
        eventId: this.#nextId('event'),
        executionId: input.executionId,
        eventType,
        ...(statusAfter === undefined ? {} : { statusAfter }),
        summary,
        details,
        occurredAt,
      });
    const events: SkillExecutionEvent[] = [
      event('skill.discovered', 'Exact Skill version discovered for Task planning.', {
        skillId: input.policy.skill.skillId,
        skillVersion: input.policy.skill.skillVersion,
      }),
      event('skill.applicability_assessed', 'Skill applicability assessment recorded.', {
        status: input.applicabilityStatus,
        contextComplete: input.policy.context.complete,
        taskReadiness: input.policy.readiness.overall,
      }),
      event(
        'skill.selected',
        'Exact Skill version selected for the Workflow plan.',
        { selectionRef: input.selectionRef },
        'selected',
      ),
      event('skill.mode_selected', 'Skill execution mode selected.', {
        mode: input.policy.mode,
        confirmationRequired: input.policy.modeDecision.confirmationRequired,
        confirmationSatisfied: input.policy.modeDecision.confirmationSatisfied,
      }),
      event(
        input.policy.context.complete ? 'skill.context_resolved' : 'skill.context_missing',
        input.policy.context.complete
          ? 'Required Skill context was resolved.'
          : 'Required Skill context remains incomplete.',
        {
          requiredContextIds: input.policy.requiredContextIds,
          satisfied: input.policy.context.satisfied,
          total: input.policy.context.total,
          inputRequiredIds: input.policy.context.inputRequiredIds,
          unsatisfiedIds: input.policy.context.unsatisfiedIds,
          unknownIds: input.policy.context.unknownIds,
        },
      ),
      event('skill.composition_started', 'Bounded Skill composition snapshot recorded.', {
        maxDepth: input.policy.composition.maxDepth,
        consumedDepth: input.policy.composition.consumedDepth,
        consumedSkills: input.policy.composition.consumedSkills,
        consumedNodes: input.policy.composition.consumedNodes,
      }),
      ...input.policy.childPolicies.map((child) =>
        event('skill.child_selected', 'Exact child Skill version selected.', {
          edgeId: child.edgeId,
          skillId: child.child.skillId,
          skillVersion: child.child.skillVersion,
          failurePolicy: child.failurePolicy,
        }),
      ),
      event(
        'skill.plan_generated',
        'Workflow plan generated from the frozen Skill usage policy.',
        {
          workflowPlanId: input.workflowPlanId,
          workflowDefinitionId: input.workflowDefinitionId,
          workflowDefinitionVersion: input.workflowDefinitionVersion,
        },
        'planning',
      ),
      ...(input.procedureCompiled
        ? [
            event(
              'skill.procedure_compiled',
              'Declarative Skill procedure compiled to Workflow DSL.',
              {
                workflowDefinitionId: input.workflowDefinitionId,
                workflowDefinitionVersion: input.workflowDefinitionVersion,
              },
            ),
          ]
        : []),
      event(
        input.planCompliancePassed
          ? 'skill.plan_compliance_passed'
          : 'skill.plan_compliance_failed',
        input.planCompliancePassed
          ? 'Workflow plan passed deterministic Skill policy compliance.'
          : 'Workflow plan failed deterministic Skill policy compliance.',
        { compliant: input.planCompliancePassed },
      ),
      ...input.policy.evidenceRequirements
        .filter((requirement) => requirement.hardGate)
        .map((requirement) =>
          event('skill.hard_gate_triggered', 'Required evidence hard gate attached to execution.', {
            requirementId: requirement.requirementId,
            evidenceType: requirement.evidenceType,
          }),
        ),
      ...(input.policy.modeDecision.confirmationRequired &&
      !input.policy.modeDecision.confirmationSatisfied
        ? [
            event('skill.human_intervention', 'Human confirmation remains authoritative.', {
              requiredConfirmationIds: input.policy.requiredConfirmations,
            }),
          ]
        : []),
    ];
    const references = this.#planningReferences(input, occurredAt);
    return this.#repository.create(
      createSkillExecutionRecord({
        executionId: input.executionId,
        ...(input.parentExecutionId === undefined
          ? {}
          : { parentExecutionId: input.parentExecutionId }),
        taskId: input.taskId,
        goalId: input.goalId,
        goalVersion: input.goalVersion,
        skillId: input.policy.skill.skillId,
        skillVersion: input.policy.skill.skillVersion,
        selectionRef: input.selectionRef,
        applicabilityStatus: input.applicabilityStatus,
        usagePolicy: input.policy,
        workflowPlanId: input.workflowPlanId,
        workflowDefinitionId: input.workflowDefinitionId,
        workflowDefinitionVersion: input.workflowDefinitionVersion,
        createdAt: occurredAt,
      }),
      events,
      references,
    );
  }

  async recordStatus(
    input: Readonly<{
      workflowPlanId: string;
      eventType: SkillExecutionEventType;
      status: SkillExecutionStatus;
      summary: string;
      details?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<SkillExecutionView | undefined> {
    const execution = await this.#repository.findByPlan(input.workflowPlanId);
    if (execution === undefined) return undefined;
    if (execution.status === input.status) return execution;
    return this.#repository.appendEvent(
      createSkillExecutionEvent({
        eventId: this.#nextId('event'),
        executionId: execution.executionId,
        eventType: input.eventType,
        statusAfter: input.status,
        summary: input.summary,
        details: input.details ?? {},
        occurredAt: this.#clock.now(),
      }),
    );
  }

  async recordEvent(
    input: Readonly<{
      workflowPlanId: string;
      eventType: SkillExecutionEventType;
      summary: string;
      details?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<SkillExecutionView | undefined> {
    const execution = await this.#repository.findByPlan(input.workflowPlanId);
    if (execution === undefined) return undefined;
    return this.#repository.appendEvent(
      createSkillExecutionEvent({
        eventId: this.#nextId('event'),
        executionId: execution.executionId,
        eventType: input.eventType,
        summary: input.summary,
        details: input.details ?? {},
        occurredAt: this.#clock.now(),
      }),
    );
  }

  async recordReference(
    input: Readonly<{
      workflowPlanId: string;
      kind: SkillExecutionReferenceKind;
      referenceId: string;
      referenceType: string;
      sourceSystem: string;
      uri?: string;
      checksum?: string;
      producedAt?: string;
      producerRefs?: readonly string[];
      metadata?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<SkillExecutionView | undefined> {
    const execution = await this.#repository.findByPlan(input.workflowPlanId);
    if (execution === undefined) return undefined;
    if (
      execution.references.some(
        (reference) => reference.kind === input.kind && reference.referenceId === input.referenceId,
      )
    )
      return execution;
    return this.#repository.appendReference(
      createSkillExecutionReference({
        linkId: this.#nextId('reference'),
        executionId: execution.executionId,
        kind: input.kind,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        sourceSystem: input.sourceSystem,
        ...(input.uri === undefined ? {} : { uri: input.uri }),
        ...(input.checksum === undefined ? {} : { checksum: input.checksum }),
        ...(input.producedAt === undefined ? {} : { producedAt: input.producedAt }),
        producerRefs: input.producerRefs ?? [],
        metadata: input.metadata ?? {},
        createdAt: this.#clock.now(),
      }),
    );
  }

  #planningReferences(
    input: SkillExecutionPlanningEvidence,
    createdAt: string,
  ): readonly SkillExecutionReference[] {
    const reference = (
      kind: SkillExecutionReferenceKind,
      referenceId: string,
      referenceType: string,
      sourceSystem: string,
      metadata: Readonly<Record<string, unknown>>,
    ) =>
      createSkillExecutionReference({
        linkId: this.#nextId('reference'),
        executionId: input.executionId,
        kind,
        referenceId,
        referenceType,
        sourceSystem,
        producerRefs: [],
        metadata,
        createdAt,
      });
    const providers = new Map(
      input.policy.taskOperations.map((operation) => [operation.providerId, operation] as const),
    );
    return [
      ...[...providers.values()].map((operation) =>
        reference('provider', operation.providerId, 'task.provider', 'mcp_registry', {
          bindingId: operation.bindingId,
          taskType: operation.taskType,
          operationName: operation.operationName,
        }),
      ),
      ...input.policy.taskOperations.map((operation) =>
        reference(
          'resource',
          `${operation.providerId}/${operation.operationName}`,
          'mcp.task_operation',
          operation.providerId,
          { bindingId: operation.bindingId, taskType: operation.taskType },
        ),
      ),
      ...input.policy.context.requirements
        .filter(
          (requirement): requirement is typeof requirement & { readonly evidenceRef: string } =>
            requirement.evidenceRef !== undefined,
        )
        .map((requirement) =>
          reference('evidence', requirement.evidenceRef, 'skill.context', 'context_resolver', {
            requirementId: requirement.requirementId,
            status: requirement.status,
            source: requirement.source,
          }),
        ),
      ...input.policy.evidenceRequirements
        .filter((requirement) => requirement.hardGate)
        .map((requirement) =>
          reference(
            'hard_gate',
            requirement.requirementId,
            requirement.evidenceType,
            'skill_policy',
            {
              required: requirement.required,
              rejectSuccessWithoutRequiredEvidence:
                input.policy.rejectSuccessWithoutRequiredEvidence,
            },
          ),
        ),
      ...(input.policy.modeDecision.confirmationRequired
        ? input.policy.requiredConfirmations.map((confirmationId) =>
            reference(
              'human_intervention',
              confirmationId,
              'skill.confirmation',
              'workflow_confirmation',
              { satisfied: input.policy.modeDecision.confirmationSatisfied },
            ),
          )
        : []),
    ];
  }
}
