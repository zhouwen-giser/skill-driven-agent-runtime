import type { WorkflowDefinition, WorkflowPlanRecord } from '../../domain/src/index.js';
import type { Clock, WorkflowPlanRepository } from './ports.js';
import type { WorkflowPlannerService } from './workflow-planner.js';
import type { WorkflowValidator } from './workflow-validator.js';

export class WorkflowRevisionService {
  readonly #plans: WorkflowPlanRepository;
  readonly #planner: Pick<WorkflowPlannerService, 'plan'>;
  readonly #validator: WorkflowValidator;
  readonly #clock: Clock;
  constructor(
    dependencies: Readonly<{
      plans: WorkflowPlanRepository;
      planner: Pick<WorkflowPlannerService, 'plan'>;
      validator: WorkflowValidator;
      clock: Clock;
    }>,
  ) {
    this.#plans = dependencies.plans;
    this.#planner = dependencies.planner;
    this.#validator = dependencies.validator;
    this.#clock = dependencies.clock;
  }

  async reviseNaturalLanguage(
    input: Readonly<{
      sourcePlanId: string;
      newPlanId: string;
      instruction: string;
    }>,
  ): Promise<WorkflowPlanRecord> {
    const source = await this.#requireActiveSource(input.sourcePlanId);
    const definition = source.definition;
    if (definition === undefined) throw new Error('WORKFLOW_REVISION_DEFINITION_MISSING');
    return this.#planner.plan({
      planId: input.newPlanId,
      workflowDefinitionId: definition.workflowDefinitionId,
      workflowVersion: definition.version + 1,
      goalId: source.goalId,
      goalVersion: source.goalVersion,
      goalContract: source.goalContract,
      planningInstruction: JSON.stringify({
        operation: 'natural_language_plan_revision',
        instruction: input.instruction,
        sourceDefinition: definition,
      }),
      sourcePlanId: source.planId,
      revisionKind: 'natural_language',
      supersedeSourcePlan: true,
    });
  }

  async reviseAdmin(
    input: Readonly<{
      sourcePlanId: string;
      newPlanId: string;
      format: 'dsl' | 'dag';
      definition: unknown;
    }>,
  ): Promise<WorkflowPlanRecord> {
    const source = await this.#requireActiveSource(input.sourcePlanId);
    const sourceDefinition = source.definition;
    if (sourceDefinition === undefined) throw new Error('WORKFLOW_REVISION_DEFINITION_MISSING');
    const validation = await this.#validator.validate(input.definition);
    if (!validation.valid || validation.definition === undefined)
      throw new WorkflowRevisionError(
        'WORKFLOW_REVISION_INVALID',
        'Edited Workflow failed validation.',
        validation.errors,
      );
    assertRevisionIdentity(sourceDefinition, validation.definition);
    const timestamp = this.#clock.now();
    const plan: WorkflowPlanRecord = {
      planId: input.newPlanId,
      goalId: source.goalId,
      goalVersion: source.goalVersion,
      goalContract: source.goalContract,
      definition: validation.definition,
      sourcePlanId: source.planId,
      revisionKind: input.format === 'dsl' ? 'admin_dsl' : 'admin_dag',
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 1,
      createdAt: timestamp,
    };
    await this.#plans.saveAttempt({
      planId: plan.planId,
      goalContract: source.goalContract,
      attempt: 1,
      candidate: input.definition,
      validationErrors: [],
      valid: true,
      createdAt: timestamp,
    });
    await this.#plans.savePlanAndSupersede(plan, source.planId);
    return plan;
  }

  async get(planId: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#plans.findPlan(planId);
    if (plan === undefined)
      throw new WorkflowRevisionError('WORKFLOW_PLAN_NOT_FOUND', 'Workflow plan was not found.');
    return plan;
  }

  async #requireActiveSource(planId: string): Promise<WorkflowPlanRecord> {
    const plan = await this.#plans.findPlan(planId);
    if (plan === undefined)
      throw new WorkflowRevisionError('WORKFLOW_PLAN_NOT_FOUND', 'Workflow plan was not found.');
    if (
      plan.definition === undefined ||
      (plan.confirmationStatus !== 'awaiting_confirmation' &&
        plan.confirmationStatus !== 'confirmed')
    )
      throw new WorkflowRevisionError(
        'WORKFLOW_REVISION_SOURCE_INACTIVE',
        'Only an active validated plan can be revised.',
      );
    return plan;
  }
}

function assertRevisionIdentity(source: WorkflowDefinition, revision: WorkflowDefinition): void {
  if (
    revision.workflowDefinitionId !== source.workflowDefinitionId ||
    revision.version !== source.version + 1 ||
    revision.goalId !== source.goalId ||
    revision.goalVersion !== source.goalVersion
  )
    throw new WorkflowRevisionError(
      'WORKFLOW_REVISION_IDENTITY_INVALID',
      'Revision must preserve Workflow/Goal identity and increment the version exactly once.',
    );
}

export type WorkflowRevisionErrorCode =
  | 'WORKFLOW_PLAN_NOT_FOUND'
  | 'WORKFLOW_REVISION_IDENTITY_INVALID'
  | 'WORKFLOW_REVISION_INVALID'
  | 'WORKFLOW_REVISION_SOURCE_INACTIVE';
export class WorkflowRevisionError extends Error {
  readonly code: WorkflowRevisionErrorCode;
  readonly details: readonly unknown[];
  constructor(code: WorkflowRevisionErrorCode, message: string, details: readonly unknown[] = []) {
    super(message);
    this.name = 'WorkflowRevisionError';
    this.code = code;
    this.details = details;
  }
}
