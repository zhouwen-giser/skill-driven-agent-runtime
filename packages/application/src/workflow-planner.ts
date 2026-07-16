import {
  assertGoalExecutionContractIdentity,
  goalExecutionContractsEqual,
  snapshotGoalExecutionContract,
  snapshotSkillCompositionContext,
  snapshotWorkflowToolExecutionSemantics,
  type GoalExecutionContract,
  type SkillCompositionContext,
  type WorkflowPlanAttempt,
  type WorkflowPlanRecord,
  type WorkflowToolExecutionSemanticsSnapshot,
} from '../../domain/src/index.js';
import type { Clock, StructuredModelProvider, WorkflowPlanRepository } from './ports.js';
import type { WorkflowValidationResult, WorkflowValidator } from './workflow-validator.js';
import type { WorkflowTemplateService } from './workflow-template.js';
import type { MemoryService } from './memory-service.js';
import type { SkillCompositionPlanner, SkillCompositionRoot } from './skill-composition.js';

export interface PlanWorkflowInput {
  readonly planId: string;
  readonly workflowDefinitionId: string;
  readonly workflowVersion: number;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly goalContract: GoalExecutionContract;
  readonly compositionRoot?: SkillCompositionRoot;
  readonly compositionContext?: SkillCompositionContext;
  readonly capabilityGapSkillIds?: readonly string[];
  readonly toolExecutionSemantics?: readonly WorkflowToolExecutionSemanticsSnapshot[];
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
  readonly #memories: Pick<MemoryService, 'searchForStage'> | undefined;
  readonly #composition: Pick<SkillCompositionPlanner, 'compose'> | undefined;

  constructor(
    dependencies: Readonly<{
      model: StructuredModelProvider;
      validator: WorkflowValidator;
      repository: WorkflowPlanRepository;
      workflowSchema: unknown;
      clock: Clock;
      maxAttempts: number;
      templates?: Pick<WorkflowTemplateService, 'findPreferred' | 'recordUse'>;
      memories?: Pick<MemoryService, 'searchForStage'>;
      composition?: Pick<SkillCompositionPlanner, 'compose'>;
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
    this.#memories = dependencies.memories;
    this.#composition = dependencies.composition;
  }

  async plan(input: PlanWorkflowInput): Promise<WorkflowPlanRecord> {
    let goalContract: GoalExecutionContract;
    try {
      goalContract = snapshotGoalExecutionContract(input.goalContract);
      assertGoalExecutionContractIdentity(goalContract, {
        goalId: input.goalId,
        goalVersion: input.goalVersion,
      });
    } catch {
      throw new WorkflowPlannerError(
        'WORKFLOW_GOAL_CONTRACT_MISMATCH',
        'Planner Goal identity does not match the supplied execution contract snapshot.',
      );
    }
    if (input.compositionRoot !== undefined && input.compositionContext !== undefined)
      throw new WorkflowPlannerError(
        'WORKFLOW_COMPOSITION_AUTHORITY_AMBIGUOUS',
        'Planning must use either an exact graph root or an inherited composition snapshot.',
      );
    const compositionContext =
      input.compositionRoot === undefined
        ? input.compositionContext === undefined
          ? undefined
          : snapshotSkillCompositionContext(input.compositionContext)
        : await this.#requireComposition().compose(input.compositionRoot);
    const capabilityGapSkillIds = normalizeSkillIds(input.capabilityGapSkillIds ?? []);
    const suppliedToolExecutionSemantics =
      input.toolExecutionSemantics === undefined
        ? undefined
        : snapshotWorkflowToolExecutionSemantics(input.toolExecutionSemantics);
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
    if (source !== undefined && !goalExecutionContractsEqual(source.goalContract, goalContract))
      throw new WorkflowPlannerError(
        'WORKFLOW_REPAIR_GOAL_CONTRACT_MISMATCH',
        'Repair source confirmation belongs to a different Goal execution contract.',
      );
    if (
      source !== undefined &&
      suppliedToolExecutionSemantics !== undefined &&
      !toolExecutionSemanticsEqual(
        source.toolExecutionSemantics ?? [],
        suppliedToolExecutionSemantics,
      )
    )
      throw new WorkflowPlannerError(
        'WORKFLOW_REPAIR_TOOL_SEMANTICS_MISMATCH',
        'Repair planning cannot replace the confirmed Tool execution semantics snapshot.',
      );
    const toolExecutionSemantics =
      suppliedToolExecutionSemantics ?? source?.toolExecutionSemantics ?? [];
    if (
      source !== undefined &&
      (!skillCompositionContextsEqual(source.compositionContext, compositionContext) ||
        !stringListsEqual(source.capabilityGapSkillIds ?? [], capabilityGapSkillIds))
    )
      throw new WorkflowPlannerError(
        'WORKFLOW_REPAIR_COMPOSITION_CONTEXT_MISMATCH',
        'Repair source confirmation belongs to different Skill composition authority.',
      );
    const preferredTemplate =
      input.templateQuery === undefined
        ? undefined
        : await this.#templates?.findPreferred(input.templateQuery);
    const memoryContext = await this.#memories?.searchForStage(
      'workflow_generation',
      input.templateQuery ?? input.planningInstruction,
    );
    const withContract = addPlanningContracts(
      input.planningInstruction,
      goalContract,
      compositionContext,
      capabilityGapSkillIds,
      toolExecutionSemantics,
    );
    const withMemory = addMemoryContext(withContract, memoryContext);
    const planningInstruction =
      preferredTemplate === undefined
        ? withMemory
        : addPreferredTemplate(withMemory, preferredTemplate);
    let correctionErrors: readonly string[] = [];
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      const candidate = await this.#model.generateStructured({
        stage: 'workflow_planning',
        instruction: planningInstruction,
        responseSchema: this.#schema,
        correctionErrors,
      });
      const validation = await this.#validateExpected(
        candidate,
        input,
        compositionContext,
        capabilityGapSkillIds,
      );
      await this.#repository.saveAttempt(
        toAttempt(
          input.planId,
          goalContract,
          compositionContext,
          capabilityGapSkillIds,
          toolExecutionSemantics,
          attempt,
          candidate,
          validation,
          this.#clock.now(),
        ),
      );
      if (validation.valid && validation.definition !== undefined) {
        const plan: WorkflowPlanRecord = {
          planId: input.planId,
          goalId: input.goalId,
          goalVersion: input.goalVersion,
          goalContract,
          ...(compositionContext === undefined ? {} : { compositionContext }),
          ...(capabilityGapSkillIds.length === 0 ? {} : { capabilityGapSkillIds }),
          ...(toolExecutionSemantics.length === 0 ? {} : { toolExecutionSemantics }),
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
      goalContract,
      ...(compositionContext === undefined ? {} : { compositionContext }),
      ...(capabilityGapSkillIds.length === 0 ? {} : { capabilityGapSkillIds }),
      ...(toolExecutionSemantics.length === 0 ? {} : { toolExecutionSemantics }),
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
    compositionContext: SkillCompositionContext | undefined,
    capabilityGapSkillIds: readonly string[],
  ): Promise<WorkflowValidationResult> {
    const result = await this.#validator.validate(candidate, {
      enforceSkillComposition: true,
      allowedChildSkillIds: compositionContext?.allowedChildSkillIds ?? [],
      capabilityGapSkillIds,
    });
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

  #requireComposition(): Pick<SkillCompositionPlanner, 'compose'> {
    if (this.#composition === undefined)
      throw new WorkflowPlannerError(
        'WORKFLOW_COMPOSITION_PLANNER_UNAVAILABLE',
        'An exact Skill composition root requires the graph composition planner.',
      );
    return this.#composition;
  }
}

function addPlanningContracts(
  instruction: string,
  goalContract: GoalExecutionContract,
  compositionContext: SkillCompositionContext | undefined,
  capabilityGapSkillIds: readonly string[],
  toolExecutionSemantics: readonly WorkflowToolExecutionSemanticsSnapshot[],
): string {
  const planningAuthority = {
    goalContract,
    skillCompositionContext: compositionContext ?? null,
    capabilityGapSkillIds,
    toolExecutionSemantics,
    skillCallConstraint:
      'Every skill_call target must be admitted by allowedChildSkillIds or capabilityGapSkillIds.',
  } as const;
  try {
    const parsed = JSON.parse(instruction) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return JSON.stringify({ ...parsed, ...planningAuthority });
  } catch {
    // Plain-language instructions remain data inside a structured planning request.
  }
  return JSON.stringify({
    operation: 'plan_with_goal_execution_contract',
    originalInstruction: instruction,
    ...planningAuthority,
  });
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

function addMemoryContext(
  instruction: string,
  hits: Awaited<ReturnType<MemoryService['searchForStage']>> | undefined,
): string {
  if (hits === undefined || hits.length === 0) return instruction;
  const memoryContext = hits.map((hit) => ({
    memoryId: hit.item.memoryId,
    type: hit.item.type,
    summary: hit.item.summary,
    content: hit.item.content,
    sourceRefs: hit.item.sourceRefs,
    confidence: hit.item.confidence,
    score: hit.score,
  }));
  try {
    const parsed = JSON.parse(instruction) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return JSON.stringify({ ...parsed, memoryContext });
  } catch {
    // Non-JSON instructions remain supported through a data wrapper.
  }
  return JSON.stringify({
    operation: 'plan_with_stage_memory',
    originalInstruction: instruction,
    memoryContext,
  });
}

function toAttempt(
  planId: string,
  goalContract: GoalExecutionContract,
  compositionContext: SkillCompositionContext | undefined,
  capabilityGapSkillIds: readonly string[],
  toolExecutionSemantics: readonly WorkflowToolExecutionSemanticsSnapshot[],
  attempt: number,
  candidate: unknown,
  validation: WorkflowValidationResult,
  createdAt: string,
): WorkflowPlanAttempt {
  return {
    planId,
    goalContract,
    ...(compositionContext === undefined ? {} : { compositionContext }),
    ...(capabilityGapSkillIds.length === 0 ? {} : { capabilityGapSkillIds }),
    ...(toolExecutionSemantics.length === 0 ? {} : { toolExecutionSemantics }),
    attempt,
    candidate,
    validationErrors: validation.errors,
    valid: validation.valid,
    createdAt,
  };
}

function toolExecutionSemanticsEqual(
  left: readonly WorkflowToolExecutionSemanticsSnapshot[],
  right: readonly WorkflowToolExecutionSemanticsSnapshot[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeSkillIds(values: readonly string[]): readonly string[] {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value === ''))
    throw new WorkflowPlannerError(
      'WORKFLOW_CAPABILITY_GAP_SKILL_INVALID',
      'Capability-gap Skill IDs must be non-empty.',
    );
  return Object.freeze([...new Set(normalized)].sort());
}

function skillCompositionContextsEqual(
  left: SkillCompositionContext | undefined,
  right: SkillCompositionContext | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export type WorkflowPlannerErrorCode =
  | 'WORKFLOW_PLANNER_ATTEMPTS_INVALID'
  | 'WORKFLOW_PLANNING_FAILED'
  | 'WORKFLOW_GOAL_CONTRACT_MISMATCH'
  | 'WORKFLOW_CAPABILITY_GAP_SKILL_INVALID'
  | 'WORKFLOW_COMPOSITION_AUTHORITY_AMBIGUOUS'
  | 'WORKFLOW_COMPOSITION_PLANNER_UNAVAILABLE'
  | 'WORKFLOW_REPAIR_GOAL_CONTRACT_MISMATCH'
  | 'WORKFLOW_REPAIR_TOOL_SEMANTICS_MISMATCH'
  | 'WORKFLOW_REPAIR_COMPOSITION_CONTEXT_MISMATCH'
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
