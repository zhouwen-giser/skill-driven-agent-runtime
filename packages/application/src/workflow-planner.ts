import type { WorkflowPlanAttempt, WorkflowPlanRecord } from '../../domain/src/index.js';
import type { Clock, StructuredModelProvider, WorkflowPlanRepository } from './ports.js';
import type { WorkflowValidationResult, WorkflowValidator } from './workflow-validator.js';
import type { WorkflowTemplateService } from './workflow-template.js';

export interface PlanWorkflowInput {
  readonly planId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly planningInstruction: string;
  readonly sourceConfirmedPlanId?: string;
  readonly sourcePlanId?: string;
  readonly revisionKind?: NonNullable<WorkflowPlanRecord['revisionKind']>;
  readonly supersedeSourcePlan?: boolean;
  readonly templateQuery?: string;
}

export class WorkflowPlannerService {
  readonly #model: StructuredModelProvider;
  readonly #validator: WorkflowValidator;
  readonly #repository: WorkflowPlanRepository;
  readonly #schema: unknown;
  readonly #clock: Clock;
  readonly #maxAttempts: number;
  readonly #templates: Pick<WorkflowTemplateService, 'findPreferred' | 'recordUse'> | undefined;

  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      validator: WorkflowValidator;
      repository: WorkflowPlanRepository;
      workflowSchema: unknown;
      clock: Clock;
      maxAttempts: number;
      templates?: Pick<WorkflowTemplateService, 'findPreferred' | 'recordUse'>;
    }>,
  ) {
    if (!Number.isInteger(dependencies.maxAttempts) || dependencies.maxAttempts < 1)
      throw new WorkflowPlannerError(
        'WORKFLOW_PLANNER_ATTEMPTS_INVALID',
        'maxAttempts must be positive.',
      );
    this.#model = dependencies.model;
    this.#validator = dependencies.validator;
    this.#repository = dependencies.repository;
    this.#schema = dependencies.workflowSchema;
    this.#clock = dependencies.clock;
    this.#maxAttempts = dependencies.maxAttempts;
    this.#templates = dependencies.templates;
  }

  async plan(input: PlanWorkflowInput): Promise<WorkflowPlanRecord> {
    const source =
      input.sourceConfirmedPlanId === undefined
        ? undefined
        : await this.#repository.findPlan(input.sourceConfirmedPlanId);
    if (input.sourceConfirmedPlanId !== undefined && source?.confirmationStatus !== 'confirmed') {
      throw new WorkflowPlannerError(
        'WORKFLOW_REPAIR_SOURCE_NOT_CONFIRMED',
        'Repair source plan is not confirmed.',
      );
    }
    const preferredTemplate =
      input.templateQuery === undefined
        ? undefined
        : await this.#templates?.findPreferred(input.templateQuery);
    const planningInstruction =
      preferredTemplate === undefined
        ? input.planningInstruction
        : addPreferredTemplate(input.planningInstruction, preferredTemplate);
    let correctionErrors: readonly string[] = [];
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const candidate = await this.#model.generateStructured({
        stage: 'workflow_planning',
        instruction: planningInstruction,
        responseSchema: this.#schema,
        correctionErrors,
      });
      const validation = await this.#validateExpected(candidate, input);
      await this.#repository.saveAttempt(
        toAttempt(input.planId, attempt, candidate, validation, this.#clock.now()),
      );
      if (validation.valid && validation.definition !== undefined) {
        const plan: WorkflowPlanRecord = {
          planId: input.planId,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          definition: validation.definition,
          ...(input.sourceConfirmedPlanId === undefined
            ? {}
            : { sourceConfirmedPlanId: input.sourceConfirmedPlanId }),
          ...(input.sourcePlanId === undefined ? {} : { sourcePlanId: input.sourcePlanId }),
          ...(input.revisionKind === undefined ? {} : { revisionKind: input.revisionKind }),
          confirmationStatus:
            source?.confirmationStatus === 'confirmed' ? 'confirmed' : 'awaiting_confirmation',
          attemptCount: attempt,
          createdAt: this.#clock.now(),
        };
        if (input.supersedeSourcePlan === true) {
          if (input.sourcePlanId === undefined)
            throw new WorkflowPlannerError(
              'WORKFLOW_REVISION_SOURCE_REQUIRED',
              'Superseding revision requires a source plan.',
            );
          await this.#repository.savePlanAndSupersede(plan, input.sourcePlanId);
        } else await this.#repository.savePlan(plan);
        if (preferredTemplate !== undefined)
          await this.#templates?.recordUse(preferredTemplate, plan.planId, validation.definition);
        return plan;
      }
      correctionErrors = validation.errors.map(
        (error) => `${error.code} at ${error.path}: ${error.message}`,
      );
    }
    await this.#repository.savePlan({
      planId: input.planId,
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      ...(input.sourceConfirmedPlanId === undefined
        ? {}
        : { sourceConfirmedPlanId: input.sourceConfirmedPlanId }),
      confirmationStatus: 'failed',
      attemptCount: this.#maxAttempts,
      createdAt: this.#clock.now(),
    });
    throw new WorkflowPlannerError(
      'WORKFLOW_PLANNING_FAILED',
      'Workflow remained invalid after configured correction attempts.',
    );
  }

  async #validateExpected(
    candidate: unknown,
    input: PlanWorkflowInput,
  ): Promise<WorkflowValidationResult> {
    const result = await this.#validator.validate(candidate);
    if (!result.valid || result.definition === undefined) return result;
    const errors: { code: string; path: string; message: string }[] = [];
    if (
      result.definition.workflowDefinitionId !== input.workflowDefinitionId ||
      result.definition.version !== input.workflowVersion
    )
      errors.push({
        code: 'WORKFLOW_IDENTITY_MISMATCH',
        path: 'workflowDefinitionId',
        message: 'Generated definition identity does not match the requested immutable version.',
      });
    if (
      result.definition.goalId !== input.goalId ||
      result.definition.goalVersion !== input.goalVersion
    )
      errors.push({
        code: 'WORKFLOW_GOAL_VERSION_MISMATCH',
        path: 'goalId',
        message: 'Generated Workflow must reference the requested Goal version.',
      });
    return errors.length === 0 ? result : { valid: false, errors };
  }
}

function addPreferredTemplate(
  instruction: string,
  template: Awaited<ReturnType<WorkflowTemplateService['findPreferred']>>,
): string {
  if (template === undefined) return instruction;
  try {
    const parsed = JSON.parse(instruction) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return JSON.stringify({
        ...parsed,
        preferredWorkflowTemplate: {
          templateId: template.templateId,
          version: template.version,
          workflow: template.workflow,
          instruction:
            'Prefer this successful structure, but adjust identities, parameters, and nodes for the current Goal and validate the complete DSL.',
        },
      });
  } catch {
    // Non-JSON planning instructions remain supported through an explicit wrapper.
  }
  return JSON.stringify({
    operation: 'plan_with_preferred_workflow_template',
    originalInstruction: instruction,
    preferredWorkflowTemplate: template,
  });
}

function toAttempt(
  planId: string,
  attempt: number,
  candidate: unknown,
  validation: WorkflowValidationResult,
  createdAt: string,
): WorkflowPlanAttempt {
  return {
    planId,
    attempt,
    candidate,
    validationErrors: validation.errors,
    valid: validation.valid,
    createdAt,
  };
}

export type WorkflowPlannerErrorCode =
  | 'WORKFLOW_PLANNER_ATTEMPTS_INVALID'
  | 'WORKFLOW_PLANNING_FAILED'
  | 'WORKFLOW_REVISION_SOURCE_REQUIRED'
  | 'WORKFLOW_REPAIR_SOURCE_NOT_CONFIRMED';
export class WorkflowPlannerError extends Error {
  readonly code: WorkflowPlannerErrorCode;
  constructor(code: WorkflowPlannerErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowPlannerError';
    this.code = code;
  }
}
