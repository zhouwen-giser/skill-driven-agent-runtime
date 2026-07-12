import {
  changeGoalStatus,
  type GoalEvaluationResult,
  type WorkflowControlRecord,
  type WorkflowInstance,
} from '../../domain/src/index.js';
import type {
  Clock,
  GoalEvaluator,
  GoalRepository,
  SkillRepository,
  WorkflowControlRepository,
  WorkflowPlanRepository,
} from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';
import type { WorkflowPlannerService } from './workflow-planner.js';
import type { EvolutionExperienceService } from './evolution-experience.js';

export interface StartWorkflowControlInput {
  readonly controlId: string;
  readonly contextId: string;
  readonly goalId: string;
  readonly goalVersion: number;
  readonly taskId?: string;
  readonly initialPlanId: string;
  readonly input: unknown;
  readonly skillIds: readonly string[];
  readonly planningInstruction: string;
}

export class WorkflowControllerService {
  readonly #controls: WorkflowControlRepository;
  readonly #plans: WorkflowPlanRepository;
  readonly #goals: GoalRepository;
  readonly #skills: SkillRepository;
  readonly #planner: Pick<WorkflowPlannerService, 'plan'>;
  readonly #execution: Pick<
    WorkflowExecutionService,
    'confirm' | 'execute' | 'get' | 'waitForPauseResolution'
  >;
  readonly #evaluator: GoalEvaluator;
  readonly #experiences: Pick<EvolutionExperienceService, 'record'> | undefined;
  readonly #taskOutcomes:
    | Readonly<{
        reportCapabilityGap(taskId: string, evaluation: GoalEvaluationResult): Promise<unknown>;
        reportAchieved(taskId: string, instance: WorkflowInstance): Promise<unknown>;
        requestInput(taskId: string, question: string): Promise<unknown>;
        reportUnachievable(taskId: string, summary: string): Promise<unknown>;
        prepareSkillReplacement(
          taskId: string,
        ): Promise<Readonly<{ skillId: string; skillVersion: number; decisionSummary: string }>>;
        reportReplacementPlan(
          taskId: string,
          input: Readonly<{
            planId: string;
            skillId: string;
            skillVersion: number;
            summary: string;
          }>,
        ): Promise<unknown>;
      }>
    | undefined;
  readonly #clock: Clock;
  readonly #ids: Readonly<{
    nextPlanId(controlId: string, replanCount: number): string;
    nextInstanceId(controlId: string, roundIndex: number): string;
  }>;

  constructor(
    dependencies: Readonly<{
      controls: WorkflowControlRepository;
      plans: WorkflowPlanRepository;
      goals: GoalRepository;
      skills: SkillRepository;
      planner: Pick<WorkflowPlannerService, 'plan'>;
      execution: Pick<
        WorkflowExecutionService,
        'confirm' | 'execute' | 'get' | 'waitForPauseResolution'
      >;
      evaluator: GoalEvaluator;
      experiences?: Pick<EvolutionExperienceService, 'record'>;
      taskOutcomes?: Readonly<{
        reportCapabilityGap(taskId: string, evaluation: GoalEvaluationResult): Promise<unknown>;
        reportAchieved(taskId: string, instance: WorkflowInstance): Promise<unknown>;
        requestInput(taskId: string, question: string): Promise<unknown>;
        reportUnachievable(taskId: string, summary: string): Promise<unknown>;
        prepareSkillReplacement(
          taskId: string,
        ): Promise<Readonly<{ skillId: string; skillVersion: number; decisionSummary: string }>>;
        reportReplacementPlan(
          taskId: string,
          input: Readonly<{
            planId: string;
            skillId: string;
            skillVersion: number;
            summary: string;
          }>,
        ): Promise<unknown>;
      }>;
      clock: Clock;
      ids: Readonly<{
        nextPlanId(controlId: string, replanCount: number): string;
        nextInstanceId(controlId: string, roundIndex: number): string;
      }>;
    }>,
  ) {
    this.#controls = dependencies.controls;
    this.#plans = dependencies.plans;
    this.#goals = dependencies.goals;
    this.#skills = dependencies.skills;
    this.#planner = dependencies.planner;
    this.#execution = dependencies.execution;
    this.#evaluator = dependencies.evaluator;
    this.#experiences = dependencies.experiences;
    this.#taskOutcomes = dependencies.taskOutcomes;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async start(input: StartWorkflowControlInput): Promise<WorkflowControlRecord> {
    if ((await this.#controls.find(input.controlId)) !== undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_ALREADY_EXISTS',
        'Workflow control already exists.',
      );
    const goal = await this.#requireActiveGoal(input.goalId, input.contextId, input.goalVersion);
    const plan = await this.#plans.findPlan(input.initialPlanId);
    if (
      plan?.confirmationStatus !== 'confirmed' ||
      plan.definition === undefined ||
      plan.goalId !== goal.goalId ||
      plan.goalVersion !== goal.version
    )
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_INITIAL_PLAN_INVALID',
        'Initial plan must be confirmed and match the active Goal version.',
      );
    const timestamp = this.#clock.now();
    const control: WorkflowControlRecord = {
      controlId: input.controlId,
      contextId: input.contextId,
      goalId: input.goalId,
      goalVersion: input.goalVersion,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      status: 'running',
      currentPlanId: input.initialPlanId,
      input: input.input,
      skillIds: [...new Set(input.skillIds)],
      planningInstruction: input.planningInstruction,
      roundCount: 0,
      replanCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#controls.save(control);
    return this.#advanceOrFail(control);
  }

  async continueAfterConfirmation(controlId: string): Promise<WorkflowControlRecord> {
    const control = await this.#requireControl(controlId);
    if (control.status !== 'awaiting_confirmation')
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_NOT_AWAITING_CONFIRMATION',
        'Workflow control is not awaiting confirmation.',
      );
    const plan = await this.#plans.findPlan(control.currentPlanId);
    if (plan?.confirmationStatus !== 'confirmed')
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_PLAN_NOT_CONFIRMED',
        'Current replan has not been confirmed.',
      );
    const running = { ...control, status: 'running' as const, updatedAt: this.#clock.now() };
    await this.#controls.save(running);
    return this.#advanceOrFail(running);
  }

  get(controlId: string): Promise<WorkflowControlRecord> {
    return this.#requireControl(controlId);
  }

  listRounds(controlId: string) {
    return this.#controls.listRounds(controlId);
  }

  async #advanceOrFail(control: WorkflowControlRecord): Promise<WorkflowControlRecord> {
    try {
      return await this.#advance(control);
    } catch (error: unknown) {
      const latest = (await this.#controls.find(control.controlId)) ?? control;
      const failed = { ...latest, status: 'failed' as const, updatedAt: this.#clock.now() };
      await this.#controls.save(failed);
      throw error;
    }
  }

  async #advance(initial: WorkflowControlRecord): Promise<WorkflowControlRecord> {
    let control = initial;
    while (control.status === 'running') {
      const plan = await this.#plans.findPlan(control.currentPlanId);
      if (plan?.definition === undefined || plan.confirmationStatus !== 'confirmed')
        throw new WorkflowControllerError(
          'WORKFLOW_CONTROL_PLAN_NOT_CONFIRMED',
          'Current plan is not executable.',
        );
      const instanceId = this.#ids.nextInstanceId(control.controlId, control.roundCount);
      let instance: WorkflowInstance;
      try {
        instance = await this.#execution.execute({
          instanceId,
          planId: plan.planId,
          input: control.input,
          skillIds: control.skillIds,
          replanCount: control.replanCount,
        });
      } catch (error: unknown) {
        const failed = await this.#execution.get(instanceId);
        if (failed?.status !== 'failed') throw error;
        instance = failed;
      }
      if (instance.status === 'paused')
        instance = await this.#execution.waitForPauseResolution(instance.instanceId);
      const goal = await this.#requireActiveGoal(
        control.goalId,
        control.contextId,
        control.goalVersion,
      );
      const evaluation = await this.#evaluator.evaluate({ goal, instance });
      await this.#controls.saveRound({
        controlId: control.controlId,
        roundIndex: control.roundCount,
        planId: plan.planId,
        instanceId,
        workflowVersion: plan.definition.version,
        evaluation,
        createdAt: this.#clock.now(),
      });
      await this.#experiences?.record({
        controlId: control.controlId,
        roundIndex: control.roundCount,
        ...(control.taskId === undefined ? {} : { taskId: control.taskId }),
        contextId: control.contextId,
        goal,
        workflow: plan.definition,
        instance,
        evaluation,
        createdAt: this.#clock.now(),
      });
      const completedRound = control.roundCount + 1;
      if (evaluation.decision === 'achieved' || evaluation.decision === 'unachievable') {
        const status = evaluation.decision;
        if (control.taskId !== undefined) {
          if (this.#taskOutcomes === undefined)
            throw new WorkflowControllerError(
              'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
              'Terminal Task outcome projection is unavailable.',
            );
          if (status === 'achieved')
            await this.#taskOutcomes.reportAchieved(control.taskId, instance);
          else await this.#taskOutcomes.reportUnachievable(control.taskId, evaluation.summary);
        }
        await this.#goals.save(changeGoalStatus(goal, status, this.#clock.now()));
        control = {
          ...control,
          status,
          roundCount: completedRound,
          finalInstanceId: instanceId,
          updatedAt: this.#clock.now(),
        };
        await this.#controls.save(control);
        return control;
      }
      if (evaluation.decision === 'request_input' || evaluation.decision === 'capability_gap') {
        if (evaluation.decision === 'request_input' && control.taskId !== undefined) {
          if (this.#taskOutcomes === undefined || evaluation.question === undefined)
            throw new WorkflowControllerError(
              'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
              'Input-required Task projection is unavailable.',
            );
          await this.#taskOutcomes.requestInput(control.taskId, evaluation.question);
        }
        if (evaluation.decision === 'capability_gap' && control.taskId !== undefined) {
          if (this.#taskOutcomes === undefined)
            throw new WorkflowControllerError(
              'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
              'Capability-gap Task projection is unavailable.',
            );
          await this.#taskOutcomes.reportCapabilityGap(control.taskId, evaluation);
        }
        control = {
          ...control,
          status: evaluation.decision === 'request_input' ? 'awaiting_input' : 'capability_gap',
          roundCount: completedRound,
          finalInstanceId: instanceId,
          updatedAt: this.#clock.now(),
        };
        await this.#controls.save(control);
        return control;
      }
      if (control.replanCount >= instance.budgetLimits.maxReplans) {
        if (control.taskId !== undefined) {
          if (this.#taskOutcomes === undefined)
            throw new WorkflowControllerError(
              'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
              'Budget-exhausted Task projection is unavailable.',
            );
          await this.#taskOutcomes.reportUnachievable(
            control.taskId,
            'Goal replan budget exhausted.',
          );
        }
        await this.#goals.save(changeGoalStatus(goal, 'unachievable', this.#clock.now()));
        control = {
          ...control,
          status: 'replan_budget_exhausted',
          roundCount: completedRound,
          finalInstanceId: instanceId,
          updatedAt: this.#clock.now(),
        };
        await this.#controls.save(control);
        return control;
      }
      const nextReplanCount = control.replanCount + 1;
      const nextPlanId = this.#ids.nextPlanId(control.controlId, nextReplanCount);
      const replacement =
        evaluation.decision === 'replace_skill' && control.taskId !== undefined
          ? await this.#taskOutcomes?.prepareSkillReplacement(control.taskId)
          : undefined;
      if (evaluation.decision === 'replace_skill' && replacement === undefined)
        throw new WorkflowControllerError(
          'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
          'Skill replacement preparation is unavailable.',
        );
      const nextPlan = await this.#planner.plan({
        planId: nextPlanId,
        workflowDefinitionId: plan.definition.workflowDefinitionId,
        workflowVersion: plan.definition.version + 1,
        goalId: control.goalId,
        goalVersion: control.goalVersion,
        sourcePlanId: plan.planId,
        revisionKind: 'replan',
        supersedeSourcePlan: true,
        planningInstruction: JSON.stringify({
          operation: 'workflow_control_replan',
          workflowIdentity: {
            workflowDefinitionId: plan.definition.workflowDefinitionId,
            version: plan.definition.version + 1,
            goalId: control.goalId,
            goalVersion: control.goalVersion,
          },
          instruction: control.planningInstruction,
          previousInstanceId: instanceId,
          evaluationSummary: evaluation.summary,
          evaluationDecision: evaluation.decision,
          actionInstruction: evaluation.actionInstruction,
          ...(replacement === undefined ? {} : { replacementSkill: replacement }),
        }),
      });
      const nextSkillIds = replacement === undefined ? control.skillIds : [replacement.skillId];
      const autoConfirmSkillIds = new Set(nextSkillIds);
      for (const node of nextPlan.definition?.nodes ?? [])
        if (node.type === 'skill_call') autoConfirmSkillIds.add(node.skillId);
      const autoConfirm =
        replacement === undefined && (await this.#allSkillsAutoConfirm([...autoConfirmSkillIds]));
      if (autoConfirm) await this.#execution.confirm(nextPlan.planId);
      if (replacement !== undefined && control.taskId !== undefined)
        await this.#taskOutcomes?.reportReplacementPlan(control.taskId, {
          planId: nextPlan.planId,
          skillId: replacement.skillId,
          skillVersion: replacement.skillVersion,
          summary: replacement.decisionSummary,
        });
      control = {
        ...control,
        status: autoConfirm ? 'running' : 'awaiting_confirmation',
        currentPlanId: nextPlan.planId,
        roundCount: completedRound,
        replanCount: nextReplanCount,
        skillIds: nextSkillIds,
        updatedAt: this.#clock.now(),
      };
      await this.#controls.save(control);
      if (!autoConfirm) return control;
    }
    return control;
  }

  async #allSkillsAutoConfirm(skillIds: readonly string[]): Promise<boolean> {
    if (skillIds.length === 0) return false;
    for (const skillId of skillIds) {
      const skill = await this.#skills.findCurrentVersion(skillId);
      if (skill?.status !== 'enabled' || !skill.runtimePolicy.autoConfirmPlan) return false;
    }
    return true;
  }

  async #requireActiveGoal(goalId: string, contextId: string, version: number) {
    const goal = await this.#goals.findById(goalId);
    if (goal?.status !== 'active' || goal.contextId !== contextId || goal.version !== version)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_GOAL_INVALID',
        'Active Goal identity, context, or version does not match.',
      );
    return goal;
  }

  async #requireControl(controlId: string): Promise<WorkflowControlRecord> {
    const control = await this.#controls.find(controlId);
    if (control === undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_NOT_FOUND',
        'Workflow control was not found.',
      );
    return control;
  }
}

export type WorkflowControllerErrorCode =
  | 'WORKFLOW_CONTROL_ALREADY_EXISTS'
  | 'WORKFLOW_CONTROL_GOAL_INVALID'
  | 'WORKFLOW_CONTROL_INITIAL_PLAN_INVALID'
  | 'WORKFLOW_CONTROL_NOT_AWAITING_CONFIRMATION'
  | 'WORKFLOW_CONTROL_NOT_FOUND'
  | 'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE'
  | 'WORKFLOW_CONTROL_PLAN_NOT_CONFIRMED';
export class WorkflowControllerError extends Error {
  readonly code: WorkflowControllerErrorCode;
  constructor(code: WorkflowControllerErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowControllerError';
    this.code = code;
  }
}
