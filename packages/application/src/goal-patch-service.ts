import { z } from 'zod';

import {
  createGoalExecutionContract,
  type Goal,
  type GoalPatchChanges,
  type GoalPatchRecord,
} from '../../domain/src/index.js';
import type {
  Clock,
  GoalPatchRepository,
  GoalRepository,
  SkillRepository,
  StructuredModelProvider,
  WorkflowPlanRepository,
} from './ports.js';
import type { WorkflowPlannerService } from './workflow-planner.js';

const GoalPatchDecisionSchema = z
  .object({
    changes: z
      .object({
        title: z.string().min(1).optional(),
        description: z.string().min(1).optional(),
        constraints: z.array(z.string()).optional(),
        successCriteria: z.array(z.string()).optional(),
      })
      .strict(),
    decisionSummary: z.string().min(1),
  })
  .strict();
const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['changes', 'decisionSummary'],
  properties: {
    changes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        constraints: { type: 'array', items: { type: 'string' } },
        successCriteria: { type: 'array', items: { type: 'string' } },
      },
    },
    decisionSummary: { type: 'string', minLength: 1 },
  },
} as const;

export class GoalPatchService {
  readonly #goals: GoalRepository;
  readonly #patches: GoalPatchRepository;
  readonly #plans: WorkflowPlanRepository;
  readonly #planner: Pick<WorkflowPlannerService, 'plan'>;
  readonly #skills: SkillRepository;
  readonly #model: StructuredModelProvider;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextPatchId(): string; nextPlanId(): string }>;
  readonly #beforeReplan:
    | Readonly<{
        prepare(
          input: Readonly<{ goal: Goal; taskId: string }>,
        ): Promise<
          | Readonly<{ status: 'ready'; planningContext?: unknown }>
          | Readonly<{ status: 'input_required' }>
        >;
      }>
    | undefined;

  constructor(
    dependencies: Readonly<{
      goals: GoalRepository;
      patches: GoalPatchRepository;
      plans: WorkflowPlanRepository;
      planner: Pick<WorkflowPlannerService, 'plan'>;
      skills: SkillRepository;
      model: StructuredModelProvider;
      clock: Clock;
      ids: Readonly<{ nextPatchId(): string; nextPlanId(): string }>;
      beforeReplan?: Readonly<{
        prepare(
          input: Readonly<{ goal: Goal; taskId: string }>,
        ): Promise<
          | Readonly<{ status: 'ready'; planningContext?: unknown }>
          | Readonly<{ status: 'input_required' }>
        >;
      }>;
    }>,
  ) {
    this.#goals = dependencies.goals;
    this.#patches = dependencies.patches;
    this.#plans = dependencies.plans;
    this.#planner = dependencies.planner;
    this.#skills = dependencies.skills;
    this.#model = dependencies.model;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#beforeReplan = dependencies.beforeReplan;
  }

  async apply(
    input: Readonly<{ goalId: string; sourcePlanId: string; instruction: string; taskId?: string }>,
  ) {
    const goal = await this.#goals.findById(input.goalId);
    if (goal?.status !== 'active')
      throw new GoalPatchError('GOAL_PATCH_GOAL_NOT_ACTIVE', 'Active Goal was not found.');
    const sourcePlan = await this.#plans.findPlan(input.sourcePlanId);
    if (
      sourcePlan?.definition === undefined ||
      sourcePlan.goalId !== goal.goalId ||
      sourcePlan.goalVersion !== goal.version ||
      !['awaiting_confirmation', 'confirmed'].includes(sourcePlan.confirmationStatus)
    )
      throw new GoalPatchError(
        'GOAL_PATCH_SOURCE_PLAN_INVALID',
        'Source plan must be active and match the current Goal version.',
      );
    const decision = GoalPatchDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'goal',
        instruction: JSON.stringify({
          operation: 'generate_goal_patch',
          goal,
          instruction: input.instruction,
        }),
        responseSchema,
        correctionErrors: [],
      }),
    );
    const changes = exactChanges(decision.changes);
    if (Object.keys(changes).length === 0)
      throw new GoalPatchError('GOAL_PATCH_EMPTY', 'Goal Patch must change at least one field.');
    const timestamp = this.#clock.now();
    const afterGoal = applyChanges(goal, changes, timestamp);
    const compensation = await this.#compensationEvidence(sourcePlan.definition);
    const newPlanId = this.#ids.nextPlanId();
    const baseRecord = {
      patchId: this.#ids.nextPatchId(),
      goalId: goal.goalId,
      fromVersion: goal.version,
      toVersion: afterGoal.version,
      instruction: input.instruction,
      changes,
      decisionSummary: decision.decisionSummary,
      compensationWarnings: compensation.warnings,
      newPlanId,
      beforeGoal: goal,
      afterGoal,
      createdAt: timestamp,
    };
    const readiness =
      input.taskId === undefined || this.#beforeReplan === undefined
        ? ({ status: 'ready' } as const)
        : await this.#beforeReplan.prepare({ goal: afterGoal, taskId: input.taskId });
    if (readiness.status === 'input_required')
      throw new GoalPatchError(
        'GOAL_PATCH_SKILL_INPUT_REQUIRED',
        'Goal Patch was not applied because its formal Skill input is unresolved.',
      );
    const patch = await this.#patches.apply(baseRecord, input.taskId);
    await this.#planner.plan({
      planId: newPlanId,
      workflowDefinitionId: sourcePlan.definition.workflowDefinitionId,
      workflowVersion: sourcePlan.definition.version + 1,
      goalId: goal.goalId,
      goalVersion: afterGoal.version,
      goalContract: createGoalExecutionContract(afterGoal),
      planningInstruction: JSON.stringify({
        operation: 'goal_patch_replan',
        patch,
        workflowIdentity: {
          workflowDefinitionId: sourcePlan.definition.workflowDefinitionId,
          version: sourcePlan.definition.version + 1,
          goalId: goal.goalId,
          goalVersion: afterGoal.version,
        },
        compensationGuidance: compensation.guidance,
        ...(readiness.planningContext === undefined
          ? {}
          : { skillInputResolution: readiness.planningContext }),
        confirmationPolicy: 'always_require_confirmation',
      }),
      sourcePlanId: sourcePlan.planId,
      revisionKind: 'replan',
    });
    return this.get(patch.patchId);
  }

  async get(patchId: string): Promise<GoalPatchRecord> {
    const patch = await this.#patches.find(patchId);
    if (patch === undefined)
      throw new GoalPatchError('GOAL_PATCH_NOT_FOUND', 'Goal Patch was not found.');
    return patch;
  }

  list(goalId: string) {
    return this.#patches.listByGoal(goalId);
  }

  async #compensationEvidence(
    definition: NonNullable<Awaited<ReturnType<WorkflowPlanRepository['findPlan']>>>['definition'],
  ) {
    const guidance: string[] = [];
    const warnings: string[] = [];
    for (const node of definition?.nodes ?? []) {
      if (node.type === 'mcp_tool')
        warnings.push(
          `Direct side-effect status for ${node.tool.serverId}/${node.tool.toolName} is unknown; no automatic compensation was attempted.`,
        );
      if (node.type !== 'skill_call') continue;
      const skill = await this.#skills.findCurrentVersion(node.skillId);
      const value = skill?.runtimePolicy.compensationGuidance?.trim();
      if (value === undefined || value === '')
        warnings.push(
          `Skill ${node.skillId} has no compensation guidance; no automatic compensation was attempted.`,
        );
      else guidance.push(`${node.skillId}: ${value}`);
    }
    return { guidance, warnings } as const;
  }
}

function exactChanges(value: z.infer<typeof GoalPatchDecisionSchema>['changes']): GoalPatchChanges {
  return {
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.constraints === undefined ? {} : { constraints: value.constraints }),
    ...(value.successCriteria === undefined ? {} : { successCriteria: value.successCriteria }),
  };
}

function applyChanges(goal: Goal, changes: GoalPatchChanges, timestamp: string): Goal {
  return {
    ...goal,
    version: goal.version + 1,
    title: changes.title ?? goal.title,
    description: changes.description ?? goal.description,
    constraints: changes.constraints ?? goal.constraints,
    successCriteria: changes.successCriteria ?? goal.successCriteria,
    updatedAt: timestamp,
  };
}

export type GoalPatchErrorCode =
  | 'GOAL_PATCH_EMPTY'
  | 'GOAL_PATCH_GOAL_NOT_ACTIVE'
  | 'GOAL_PATCH_NOT_FOUND'
  | 'GOAL_PATCH_SKILL_INPUT_REQUIRED'
  | 'GOAL_PATCH_SOURCE_PLAN_INVALID';
export class GoalPatchError extends Error {
  readonly code: GoalPatchErrorCode;
  constructor(code: GoalPatchErrorCode, message: string) {
    super(message);
    this.name = 'GoalPatchError';
    this.code = code;
  }
}
