import {
  createGoalExecutionContract,
  goalExecutionContractsEqual,
  isTerminalWorkflowControlStatus,
  type Goal,
  type GoalEvaluationResult,
  type ProcessedResultRecord,
  type RuntimeEnhancementWarning,
  type WorkflowControlRecord,
  type WorkflowDefinition,
  type WorkflowInstance,
} from '../../domain/src/index.js';
import type {
  Clock,
  GoalEvaluator,
  GoalRepository,
  RuntimeTerminalOutcomeRepository,
  WorkflowControlRepository,
  WorkflowPlanRepository,
} from './ports.js';
import type { WorkflowExecutionService } from './workflow-execution.js';
import type { WorkflowPlannerService } from './workflow-planner.js';
import type { EvolutionExperienceService } from './evolution-experience.js';
import type { MemoryService } from './memory-service.js';
import type { TransitiveSkillConfirmationEvaluator } from './skill-confirmation.js';

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

export interface WorkflowControllerTaskOutcomes {
  reportCapabilityGap(taskId: string, evaluation: GoalEvaluationResult): Promise<unknown>;
  prepareAchieved(
    taskId: string,
    instance: WorkflowInstance,
    evaluation: GoalEvaluationResult,
  ): Promise<ProcessedResultRecord>;
  enhanceResultMemory(processedResult: ProcessedResultRecord): Promise<void>;
  enhanceTaskQuality(
    taskId: string,
    instance: WorkflowInstance,
    evaluation: GoalEvaluationResult,
    processedResult: ProcessedResultRecord,
  ): Promise<void>;
  enhanceTemporarySkill(taskId: string): Promise<string | undefined>;
  enhanceSkillEvolution(candidateId: string): Promise<void>;
  requestInput(
    taskId: string,
    question: string,
    controlId: string,
    controlRoundIndex: number,
  ): Promise<unknown>;
  requestSkillConfirmation(
    taskId: string,
    input: Readonly<{
      childPlanId: string;
      childSkillId: string;
      childSkillVersion: number;
    }>,
  ): Promise<unknown>;
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
  reportInputContinuationPlan(
    taskId: string,
    input: Readonly<{
      planId: string;
      goalId: string;
      goalVersion: number;
      summary: string;
    }>,
  ): Promise<unknown>;
}

export class WorkflowControllerService {
  readonly #controls: WorkflowControlRepository;
  readonly #plans: WorkflowPlanRepository;
  readonly #goals: GoalRepository;
  readonly #confirmation: Pick<TransitiveSkillConfirmationEvaluator, 'evaluate'>;
  readonly #planner: Pick<WorkflowPlannerService, 'plan'>;
  readonly #execution: Pick<
    WorkflowExecutionService,
    'confirm' | 'execute' | 'get' | 'waitForPauseResolution'
  >;
  readonly #evaluator: GoalEvaluator;
  readonly #experiences: Pick<EvolutionExperienceService, 'record'> | undefined;
  readonly #memories: Pick<MemoryService, 'recordEvolution'> | undefined;
  readonly #taskOutcomes: Readonly<WorkflowControllerTaskOutcomes> | undefined;
  readonly #terminalOutcomes: RuntimeTerminalOutcomeRepository;
  readonly #reportWarning: ((warning: RuntimeEnhancementWarning) => void) | undefined;
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
      confirmation: Pick<TransitiveSkillConfirmationEvaluator, 'evaluate'>;
      planner: Pick<WorkflowPlannerService, 'plan'>;
      execution: Pick<
        WorkflowExecutionService,
        'confirm' | 'execute' | 'get' | 'waitForPauseResolution'
      >;
      evaluator: GoalEvaluator;
      experiences?: Pick<EvolutionExperienceService, 'record'>;
      memories?: Pick<MemoryService, 'recordEvolution'>;
      taskOutcomes?: Readonly<WorkflowControllerTaskOutcomes>;
      terminalOutcomes: RuntimeTerminalOutcomeRepository;
      reportWarning?: (warning: RuntimeEnhancementWarning) => void;
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
    this.#confirmation = dependencies.confirmation;
    this.#planner = dependencies.planner;
    this.#execution = dependencies.execution;
    this.#evaluator = dependencies.evaluator;
    this.#experiences = dependencies.experiences;
    this.#memories = dependencies.memories;
    this.#taskOutcomes = dependencies.taskOutcomes;
    this.#terminalOutcomes = dependencies.terminalOutcomes;
    this.#reportWarning = dependencies.reportWarning;
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
    if (!goalExecutionContractsEqual(plan.goalContract, createGoalExecutionContract(goal)))
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_GOAL_CONTRACT_MISMATCH',
        'Initial plan does not contain the active Goal execution contract.',
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

  async continueAfterInput(
    input: Readonly<{
      controlId: string;
      taskId: string;
      inputRequestId: string;
      controlRoundIndex: number;
      content: unknown;
    }>,
  ): Promise<WorkflowControlRecord> {
    const control = await this.#requireControl(input.controlId);
    if (control.status !== 'awaiting_input')
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_NOT_AWAITING_INPUT',
        'Workflow control is not awaiting supplementary input.',
      );
    if (control.taskId !== input.taskId)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_INPUT_TASK_MISMATCH',
        'Supplementary input belongs to another Task.',
      );
    if (input.controlRoundIndex !== control.roundCount - 1)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_INPUT_ROUND_MISMATCH',
        'Supplementary input is not associated with the waiting control round.',
      );
    const sourcePlan = await this.#plans.findPlan(control.currentPlanId);
    if (sourcePlan?.definition === undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_INPUT_SOURCE_PLAN_INVALID',
        'The waiting control source plan is unavailable.',
      );
    const goal = await this.#requireActiveGoal(
      control.goalId,
      control.contextId,
      control.goalVersion,
    );
    if (!goalExecutionContractsEqual(sourcePlan.goalContract, createGoalExecutionContract(goal)))
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_GOAL_CONTRACT_MISMATCH',
        'Input-continuation source plan does not contain the active Goal execution contract.',
      );
    const nextReplanCount = control.replanCount + 1;
    const nextPlan = await this.#planner.plan({
      planId: this.#ids.nextPlanId(control.controlId, nextReplanCount),
      workflowDefinitionId: sourcePlan.definition.workflowDefinitionId,
      workflowVersion: sourcePlan.definition.version + 1,
      goalId: control.goalId,
      goalVersion: control.goalVersion,
      goalContract: createGoalExecutionContract(goal),
      sourcePlanId: sourcePlan.planId,
      revisionKind: 'replan',
      supersedeSourcePlan: true,
      planningInstruction: JSON.stringify({
        operation: 'workflow_control_continue_after_input',
        workflowIdentity: {
          workflowDefinitionId: sourcePlan.definition.workflowDefinitionId,
          version: sourcePlan.definition.version + 1,
          goalId: control.goalId,
          goalVersion: control.goalVersion,
        },
        instruction: control.planningInstruction,
        sourceDefinition: sourcePlan.definition,
        inputRequestId: input.inputRequestId,
        sourceRoundIndex: input.controlRoundIndex,
        supplementaryInput: input.content,
      }),
    });
    if (nextPlan.definition === undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_INPUT_PLAN_INVALID',
        'Supplementary input did not produce a valid next plan.',
      );
    const continued: WorkflowControlRecord = {
      ...control,
      status: 'awaiting_confirmation',
      currentPlanId: nextPlan.planId,
      input: mergeSupplementaryInput(control.input, input.inputRequestId, input.content),
      replanCount: nextReplanCount,
      updatedAt: this.#clock.now(),
    };
    await this.#controls.save(continued);
    if (this.#taskOutcomes === undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
        'Input-continuation Task projection is unavailable.',
      );
    await this.#taskOutcomes.reportInputContinuationPlan(input.taskId, {
      planId: nextPlan.planId,
      goalId: control.goalId,
      goalVersion: control.goalVersion,
      summary: `Supplementary input for control round ${String(input.controlRoundIndex)} produced a new plan.`,
    });
    return continued;
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
      if (isTerminalWorkflowControlStatus(latest.status)) throw error;
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
      const goal = await this.#requireActiveGoal(
        control.goalId,
        control.contextId,
        control.goalVersion,
      );
      if (!goalExecutionContractsEqual(plan.goalContract, createGoalExecutionContract(goal)))
        throw new WorkflowControllerError(
          'WORKFLOW_CONTROL_GOAL_CONTRACT_MISMATCH',
          'Current plan does not contain the active Goal execution contract.',
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
      while (instance.status === 'paused') {
        const pending = instance.pendingConfirmation;
        if (pending?.kind === 'skill_confirmation' && control.taskId !== undefined) {
          if (
            this.#taskOutcomes === undefined ||
            pending.childPlanId === undefined ||
            pending.childSkillId === undefined ||
            pending.childSkillVersion === undefined
          )
            throw new WorkflowControllerError(
              'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
              'Nested Skill confirmation Task projection is unavailable.',
            );
          await this.#taskOutcomes.requestSkillConfirmation(control.taskId, {
            childPlanId: pending.childPlanId,
            childSkillId: pending.childSkillId,
            childSkillVersion: pending.childSkillVersion,
          });
        }
        instance = await this.#execution.waitForPauseResolution(instance.instanceId, pending);
      }
      const evaluation = await this.#evaluator.evaluate({ goal, instance });
      const round = {
        controlId: control.controlId,
        roundIndex: control.roundCount,
        planId: plan.planId,
        instanceId,
        workflowVersion: plan.definition.version,
        evaluation,
        createdAt: this.#clock.now(),
      } as const;
      const completedRound = control.roundCount + 1;
      if (evaluation.decision === 'achieved' || evaluation.decision === 'unachievable') {
        const processed =
          evaluation.decision === 'achieved' && control.taskId !== undefined
            ? await this.#prepareAchieved(control.taskId, instance, evaluation)
            : undefined;
        const outcomeId = terminalOutcomeId(control);
        const outcome =
          evaluation.decision === 'achieved'
            ? await this.#terminalOutcomes.commitAchieved({
                outcomeId,
                ...(control.taskId === undefined ? {} : { taskId: control.taskId }),
                goalId: control.goalId,
                goalVersion: control.goalVersion,
                controlId: control.controlId,
                round,
                ...(processed === undefined ? {} : { processedResult: processed }),
                summary: evaluation.summary,
                ...(control.taskId === undefined
                  ? {}
                  : { eventId: `event-terminal-${control.taskId}` }),
                committedAt: this.#clock.now(),
              })
            : await this.#terminalOutcomes.commitUnachievable({
                outcomeId,
                ...(control.taskId === undefined ? {} : { taskId: control.taskId }),
                goalId: control.goalId,
                goalVersion: control.goalVersion,
                controlId: control.controlId,
                controlStatus: 'unachievable',
                round,
                summary: evaluation.summary,
                ...(control.taskId === undefined
                  ? {}
                  : { eventId: `event-terminal-${control.taskId}` }),
                committedAt: this.#clock.now(),
              });
        await this.#runTerminalEnhancements({
          outcomeId: outcome.outcomeId,
          control,
          goal,
          workflow: plan.definition,
          instance,
          evaluation,
          ...(processed === undefined ? {} : { processedResult: processed }),
        });
        return this.#requireCommittedControl(control.controlId);
      }
      if (control.replanCount >= instance.budgetLimits.maxReplans) {
        const outcome = await this.#terminalOutcomes.commitUnachievable({
          outcomeId: terminalOutcomeId(control),
          ...(control.taskId === undefined ? {} : { taskId: control.taskId }),
          goalId: control.goalId,
          goalVersion: control.goalVersion,
          controlId: control.controlId,
          controlStatus: 'replan_budget_exhausted',
          round,
          summary: 'Goal replan budget exhausted.',
          ...(control.taskId === undefined ? {} : { eventId: `event-terminal-${control.taskId}` }),
          committedAt: this.#clock.now(),
        });
        await this.#runTerminalEnhancements({
          outcomeId: outcome.outcomeId,
          control,
          goal,
          workflow: plan.definition,
          instance,
          evaluation,
        });
        return this.#requireCommittedControl(control.controlId);
      }
      await this.#controls.saveRound(round);
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
      await this.#memories?.recordEvolution({
        kind: 'evaluation_conclusion',
        sourceRef: `workflow-control-round:${control.controlId}:${String(control.roundCount)}`,
        summary: evaluation.summary,
        content: {
          controlId: control.controlId,
          roundIndex: control.roundCount,
          goalId: goal.goalId,
          goalVersion: goal.version,
          workflowDefinitionId: plan.definition.workflowDefinitionId,
          workflowVersion: plan.definition.version,
          decision: evaluation.decision,
          instanceStatus: instance.status,
          errors: instance.errors,
        },
        confidence: 1,
        successful: false,
      });
      if (evaluation.decision === 'request_input' || evaluation.decision === 'capability_gap') {
        if (evaluation.decision === 'request_input' && control.taskId !== undefined) {
          if (this.#taskOutcomes === undefined || evaluation.question === undefined)
            throw new WorkflowControllerError(
              'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
              'Input-required Task projection is unavailable.',
            );
          await this.#taskOutcomes.requestInput(
            control.taskId,
            evaluation.question,
            control.controlId,
            control.roundCount,
          );
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
        goalContract: createGoalExecutionContract(goal),
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
      const autoConfirm =
        replacement === undefined &&
        (await this.#confirmation.evaluate(nextSkillIds, nextPlan.definition)).autoConfirm;
      if (autoConfirm) await this.#execution.confirm(nextPlan.planId, control.taskId);
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

  async #prepareAchieved(
    taskId: string,
    instance: WorkflowInstance,
    evaluation: GoalEvaluationResult,
  ): Promise<ProcessedResultRecord> {
    if (this.#taskOutcomes === undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE',
        'Achieved Task result preparation is unavailable.',
      );
    return this.#taskOutcomes.prepareAchieved(taskId, instance, evaluation);
  }

  async #runTerminalEnhancements(
    input: Readonly<{
      outcomeId: string;
      control: WorkflowControlRecord;
      goal: Goal;
      workflow: WorkflowDefinition;
      instance: WorkflowInstance;
      evaluation: GoalEvaluationResult;
      processedResult?: ProcessedResultRecord;
    }>,
  ): Promise<void> {
    await this.#runEnhancement(input.outcomeId, 'evolution_experience', async () => {
      await this.#experiences?.record({
        controlId: input.control.controlId,
        roundIndex: input.control.roundCount,
        ...(input.control.taskId === undefined ? {} : { taskId: input.control.taskId }),
        contextId: input.control.contextId,
        goal: input.goal,
        workflow: input.workflow,
        instance: input.instance,
        evaluation: input.evaluation,
        createdAt: this.#clock.now(),
      });
    });
    await this.#runEnhancement(input.outcomeId, 'evaluation_memory', async () => {
      await this.#memories?.recordEvolution({
        kind: 'evaluation_conclusion',
        sourceRef: `workflow-control-round:${input.control.controlId}:${String(input.control.roundCount)}`,
        summary: input.evaluation.summary,
        content: {
          controlId: input.control.controlId,
          roundIndex: input.control.roundCount,
          goalId: input.goal.goalId,
          goalVersion: input.goal.version,
          workflowDefinitionId: input.workflow.workflowDefinitionId,
          workflowVersion: input.workflow.version,
          decision: input.evaluation.decision,
          instanceStatus: input.instance.status,
          errors: input.instance.errors,
        },
        confidence: 1,
        successful: input.evaluation.decision === 'achieved',
      });
    });
    if (
      input.processedResult === undefined ||
      input.control.taskId === undefined ||
      this.#taskOutcomes === undefined
    )
      return;
    const processedResult = input.processedResult;
    const taskId = input.control.taskId;
    const taskOutcomes = this.#taskOutcomes;
    await this.#runEnhancement(input.outcomeId, 'result_memory', () =>
      taskOutcomes.enhanceResultMemory(processedResult),
    );
    await this.#runEnhancement(input.outcomeId, 'task_quality', () =>
      taskOutcomes.enhanceTaskQuality(taskId, input.instance, input.evaluation, processedResult),
    );
    let candidateId: string | undefined;
    await this.#runEnhancement(input.outcomeId, 'temporary_skill', async () => {
      candidateId = await taskOutcomes.enhanceTemporarySkill(taskId);
    });
    const formalizationCandidateId = candidateId;
    if (formalizationCandidateId !== undefined)
      await this.#runEnhancement(input.outcomeId, 'skill_evolution', () =>
        taskOutcomes.enhanceSkillEvolution(formalizationCandidateId),
      );
  }

  async #runEnhancement(
    outcomeId: string,
    source: RuntimeEnhancementWarning['source'],
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      const warning: RuntimeEnhancementWarning = {
        source,
        code: enhancementErrorCode(error),
        message: enhancementErrorMessage(error),
        occurredAt: this.#clock.now(),
      };
      try {
        await this.#terminalOutcomes.recordEnhancementWarning(outcomeId, warning);
      } catch (warningPersistenceError: unknown) {
        this.#reportWarning?.({
          source,
          code: enhancementErrorCode(warningPersistenceError),
          message: `Unable to persist enhancement warning: ${enhancementErrorMessage(warningPersistenceError)}`,
          occurredAt: this.#clock.now(),
        });
      }
      this.#reportWarning?.(warning);
    }
  }

  async #requireCommittedControl(controlId: string): Promise<WorkflowControlRecord> {
    const control = await this.#requireControl(controlId);
    if (!isTerminalWorkflowControlStatus(control.status) || control.terminalOutcomeId === undefined)
      throw new WorkflowControllerError(
        'WORKFLOW_CONTROL_TERMINAL_COMMIT_INCOMPLETE',
        'Atomic terminal outcome did not project a terminal WorkflowControl.',
      );
    return control;
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

function mergeSupplementaryInput(
  current: unknown,
  inputRequestId: string,
  content: unknown,
): unknown {
  const existing =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Readonly<Record<string, unknown>>)
      : { originalInput: current };
  const prior: readonly unknown[] = Array.isArray(existing['supplementaryInputs'])
    ? (existing['supplementaryInputs'] as readonly unknown[])
    : [];
  return {
    ...existing,
    supplementaryInputs: [...prior, { inputRequestId, content }],
  };
}

export type WorkflowControllerErrorCode =
  | 'WORKFLOW_CONTROL_ALREADY_EXISTS'
  | 'WORKFLOW_CONTROL_GOAL_INVALID'
  | 'WORKFLOW_CONTROL_GOAL_CONTRACT_MISMATCH'
  | 'WORKFLOW_CONTROL_INITIAL_PLAN_INVALID'
  | 'WORKFLOW_CONTROL_NOT_AWAITING_CONFIRMATION'
  | 'WORKFLOW_CONTROL_NOT_AWAITING_INPUT'
  | 'WORKFLOW_CONTROL_INPUT_TASK_MISMATCH'
  | 'WORKFLOW_CONTROL_INPUT_ROUND_MISMATCH'
  | 'WORKFLOW_CONTROL_INPUT_SOURCE_PLAN_INVALID'
  | 'WORKFLOW_CONTROL_INPUT_PLAN_INVALID'
  | 'WORKFLOW_CONTROL_NOT_FOUND'
  | 'WORKFLOW_CONTROL_TASK_OUTCOME_UNAVAILABLE'
  | 'WORKFLOW_CONTROL_TERMINAL_COMMIT_INCOMPLETE'
  | 'WORKFLOW_CONTROL_PLAN_NOT_CONFIRMED';
export class WorkflowControllerError extends Error {
  readonly code: WorkflowControllerErrorCode;
  constructor(code: WorkflowControllerErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowControllerError';
    this.code = code;
  }
}

function terminalOutcomeId(control: WorkflowControlRecord): string {
  return control.taskId === undefined
    ? `terminal-outcome-control-${control.controlId}`
    : `terminal-outcome-task-${control.taskId}`;
}

function enhancementErrorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return 'RUNTIME_ENHANCEMENT_FAILED';
}

function enhancementErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
