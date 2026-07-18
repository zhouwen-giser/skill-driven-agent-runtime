import type {
  RuntimeExecutionContext,
  SkillCallExecutionResult,
  SkillCallWorkflowRecord,
  SkillApplicabilityStatus,
  SkillVersion,
  WorkflowInstance,
  WorkflowPlanRecord,
} from '../../domain/src/index.js';

import type { McpToolPlanningMetadata } from './mcp-tool-enhancer.js';
import { snapshotMcpToolPlanningExecutionSemantics } from './mcp-tool-enhancer.js';
import type {
  Clock,
  JsonSchemaValidator,
  SkillCallWorkflowRepository,
  SkillRepository,
  WorkflowPlanRepository,
} from './ports.js';
import type { TransitiveSkillConfirmationEvaluator } from './skill-confirmation.js';
import type { WorkflowExecutionService } from './workflow-execution.js';
import type { WorkflowPlannerService } from './workflow-planner.js';
import type { WorkflowValidator } from './workflow-validator.js';
import type { PreparedSkillUsagePlan } from './skill-usage-planning.js';

export interface PreparedChildSkillUsage {
  readonly prepared: PreparedSkillUsagePlan;
  readonly applicabilityStatus: SkillApplicabilityStatus;
  readonly useLegacyPlanningInstruction?: boolean;
}

export type ChildSkillExecutionStatus =
  'executing' | 'waiting_external' | 'completed' | 'failed' | 'cancelled';

export const MAX_SKILL_CALL_DEPTH = 8;
export const MAX_SKILL_CHILD_RESULT_CHARACTERS = 64_000;

export class SkillCallWorkflowService {
  readonly #skills: SkillRepository;
  readonly #planner: Pick<WorkflowPlannerService, 'plan'>;
  readonly #validator: Pick<WorkflowValidator, 'validate'>;
  readonly #execution: Pick<
    WorkflowExecutionService,
    'confirm' | 'execute' | 'get' | 'findActiveByPlanId' | 'resumeHumanConfirmation'
  >;
  readonly #plans: Pick<WorkflowPlanRepository, 'findPlan'>;
  readonly #confirmation: Pick<TransitiveSkillConfirmationEvaluator, 'evaluate'>;
  readonly #records: SkillCallWorkflowRepository;
  readonly #schemas: JsonSchemaValidator;
  readonly #toolPlanningMetadata: (
    skill: SkillVersion,
    taskOperations: readonly Readonly<{ providerId: string; operationName: string }>[],
  ) => Promise<readonly McpToolPlanningMetadata[]>;
  readonly #prepareUsage:
    | ((
        input: Readonly<{
          skill: SkillVersion;
          value: unknown;
          goalContract: WorkflowPlanRecord['goalContract'];
          workflowDefinitionId: string;
          taskId?: string;
        }>,
      ) => Promise<PreparedChildSkillUsage | undefined>)
    | undefined;
  readonly #onUsagePlanPrepared:
    | ((
        input: Readonly<{
          skill: SkillVersion;
          plan: WorkflowPlanRecord;
          preparedUsage: PreparedChildSkillUsage;
          parentPlanId: string;
        }>,
      ) => Promise<void>)
    | undefined;
  readonly #onExecutionStatus:
    | ((
        input: Readonly<{
          childPlanId: string;
          childInstanceId?: string;
          status: ChildSkillExecutionStatus;
          summary: string;
        }>,
      ) => Promise<void>)
    | undefined;
  readonly #clock: Clock;
  readonly #nextId: () => string;

  constructor(
    dependencies: Readonly<{
      skills: SkillRepository;
      planner: Pick<WorkflowPlannerService, 'plan'>;
      validator: Pick<WorkflowValidator, 'validate'>;
      execution: Pick<
        WorkflowExecutionService,
        'confirm' | 'execute' | 'get' | 'findActiveByPlanId' | 'resumeHumanConfirmation'
      >;
      plans: Pick<WorkflowPlanRepository, 'findPlan'>;
      confirmation: Pick<TransitiveSkillConfirmationEvaluator, 'evaluate'>;
      records: SkillCallWorkflowRepository;
      schemas: JsonSchemaValidator;
      loadToolPlanningMetadata: (
        skill: SkillVersion,
        taskOperations: readonly Readonly<{ providerId: string; operationName: string }>[],
      ) => Promise<readonly McpToolPlanningMetadata[]>;
      prepareUsage?: (
        input: Readonly<{
          skill: SkillVersion;
          value: unknown;
          goalContract: WorkflowPlanRecord['goalContract'];
          workflowDefinitionId: string;
          taskId?: string;
        }>,
      ) => Promise<PreparedChildSkillUsage | undefined>;
      onUsagePlanPrepared?: (
        input: Readonly<{
          skill: SkillVersion;
          plan: WorkflowPlanRecord;
          preparedUsage: PreparedChildSkillUsage;
          parentPlanId: string;
        }>,
      ) => Promise<void>;
      onExecutionStatus?: (
        input: Readonly<{
          childPlanId: string;
          childInstanceId?: string;
          status: ChildSkillExecutionStatus;
          summary: string;
        }>,
      ) => Promise<void>;
      clock: Clock;
      nextId: () => string;
    }>,
  ) {
    this.#skills = dependencies.skills;
    this.#planner = dependencies.planner;
    this.#validator = dependencies.validator;
    this.#execution = dependencies.execution;
    this.#plans = dependencies.plans;
    this.#confirmation = dependencies.confirmation;
    this.#records = dependencies.records;
    this.#schemas = dependencies.schemas;
    this.#toolPlanningMetadata = dependencies.loadToolPlanningMetadata;
    this.#prepareUsage = dependencies.prepareUsage;
    this.#onUsagePlanPrepared = dependencies.onUsagePlanPrepared;
    this.#onExecutionStatus = dependencies.onExecutionStatus;
    this.#clock = dependencies.clock;
    this.#nextId = dependencies.nextId;
  }

  async execute(
    input: Readonly<{
      skillId: string;
      value: unknown;
      parentPlanId: string;
      parentInstanceId: string;
      parentNodeId: string;
      parentNodeRunId: string;
      parentGoalId: string;
      parentGoalVersion: number;
      signal?: AbortSignal;
      executionContext?: RuntimeExecutionContext;
      continuationAuthority?: Readonly<{
        agentTaskId: string;
        contextId: string;
        workflowControlId: string;
      }>;
    }>,
  ): Promise<SkillCallExecutionResult> {
    const expectedVersion = await this.#assertParentCompositionAuthority(
      input.parentPlanId,
      input.skillId,
    );
    const [skill, current] = await Promise.all([
      expectedVersion === undefined
        ? this.#skills.findCurrentVersion(input.skillId)
        : this.#skills.findVersion(input.skillId, expectedVersion),
      this.#skills.findCurrentVersion(input.skillId),
    ]);
    if (
      expectedVersion !== undefined &&
      (current?.status !== 'enabled' || current.version !== expectedVersion)
    )
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_VERSION_STALE',
        `Parent plan requires ${input.skillId}@${String(expectedVersion)}, which is no longer current and enabled.`,
      );
    if (skill?.status !== 'enabled') throw new Error('WORKFLOW_SKILL_NOT_ENABLED');
    const inputValidation = this.#schemas.validate(skill.inputSchema, input.value);
    if (!inputValidation.valid)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_INPUT_INVALID',
        `Resolved input does not satisfy ${skill.skillId}@${String(skill.version)}: ${inputValidation.errors.join('; ')}`,
      );

    const existing = await this.#records.find(input.parentInstanceId, input.parentNodeId);
    if (existing !== undefined) {
      if (existing.parentPlanId !== input.parentPlanId || existing.skillId !== input.skillId)
        throw new SkillCallWorkflowError(
          'WORKFLOW_SKILL_CONFIRMATION_STALE',
          'Persisted child confirmation does not match the immutable parent node.',
        );
      if (existing.skillVersion !== skill.version) {
        await this.#records.save({
          ...existing,
          confirmationStatus: 'invalidated',
          status: 'invalidated',
          evaluationSummary: `Skill version changed from ${String(existing.skillVersion)} to ${String(skill.version)}; fresh confirmation is required.`,
          completedAt: this.#clock.now(),
        });
      } else if (existing.confirmationStatus === 'awaiting_confirmation') {
        return confirmationRequest(existing);
      } else if (existing.confirmationStatus === 'rejected') {
        throw new SkillCallWorkflowError(
          'WORKFLOW_SKILL_CONFIRMATION_REJECTED',
          'Child Skill plan confirmation was rejected.',
        );
      } else if (existing.confirmationStatus === 'confirmed') {
        const plan = await this.#plans.findPlan(existing.childPlanId);
        if (plan?.confirmationStatus !== 'confirmed')
          throw new SkillCallWorkflowError(
            'WORKFLOW_SKILL_CONFIRMATION_STALE',
            'Confirmed child linkage no longer references a confirmed immutable plan.',
          );
        return this.#executeConfirmed(existing, skill, plan, input);
      }
    }

    return this.#prepare(input, skill);
  }

  async confirmPendingForParentPlan(parentPlanId: string, taskId?: string): Promise<boolean> {
    const parent = await this.#execution.findActiveByPlanId(parentPlanId);
    const pending = parent?.pendingConfirmation;
    if (
      parent?.status !== 'paused' ||
      pending?.kind !== 'skill_confirmation' ||
      pending.parentPlanId !== parentPlanId ||
      pending.childPlanId === undefined
    )
      return false;
    const record = await this.#records.find(parent.instanceId, pending.nodeId);
    if (!matchesPendingCheckpoint(record, parent.instanceId, pending, parentPlanId))
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CONFIRMATION_STALE',
        'Pending child confirmation no longer matches the parent checkpoint.',
      );
    if (record.confirmationStatus === 'confirmed' || record.confirmationStatus === 'invalidated')
      return true;
    if (record.confirmationStatus !== 'awaiting_confirmation')
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CONFIRMATION_STALE',
        'Child confirmation has already received a different decision.',
      );
    const current = await this.#skills.findCurrentVersion(record.skillId);
    const plan = await this.#plans.findPlan(record.childPlanId);
    if (
      current?.status !== 'enabled' ||
      current.version !== record.skillVersion ||
      plan?.confirmationStatus !== 'awaiting_confirmation'
    ) {
      await this.#records.save({
        ...record,
        confirmationStatus: 'invalidated',
        status: 'invalidated',
        evaluationSummary:
          'Child Skill version or immutable plan changed before confirmation; a fresh plan is required.',
        completedAt: this.#clock.now(),
      });
      return true;
    }
    await this.#execution.confirm(record.childPlanId, taskId);
    await this.#records.save({
      ...record,
      confirmationStatus: 'confirmed',
      status: 'running',
      evaluationSummary: `Child plan confirmed for ${record.skillId}@${String(record.skillVersion)}.`,
    });
    return true;
  }

  async resumeConfirmedForParentPlan(
    parentPlanId: string,
    continuationAuthority?: Readonly<{
      agentTaskId: string;
      contextId: string;
      workflowControlId: string;
    }>,
  ): Promise<boolean> {
    const parent = await this.#execution.findActiveByPlanId(parentPlanId);
    const pending = parent?.pendingConfirmation;
    if (parent?.status !== 'paused' || pending?.kind !== 'skill_confirmation') return false;
    const record = await this.#records.find(parent.instanceId, pending.nodeId);
    if (!matchesPendingCheckpoint(record, parent.instanceId, pending, parentPlanId))
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CONFIRMATION_STALE',
        'Child plan no longer matches this parent checkpoint.',
      );
    let resumable = record;
    if (record.confirmationStatus === 'confirmed') {
      const [current, plan] = await Promise.all([
        this.#skills.findCurrentVersion(record.skillId),
        this.#plans.findPlan(record.childPlanId),
      ]);
      if (
        current?.status !== 'enabled' ||
        current.version !== record.skillVersion ||
        plan?.confirmationStatus !== 'confirmed' ||
        plan.definition === undefined
      ) {
        resumable = {
          ...record,
          confirmationStatus: 'invalidated',
          status: 'invalidated',
          evaluationSummary:
            'Confirmed child Skill version or immutable plan changed before parent resume; a fresh plan is required.',
          completedAt: this.#clock.now(),
        };
        await this.#records.save(resumable);
      }
    }
    if (
      resumable.confirmationStatus !== 'confirmed' &&
      resumable.confirmationStatus !== 'invalidated'
    )
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CONFIRMATION_STALE',
        'Child plan was not confirmed for this parent checkpoint.',
      );
    await this.#execution.resumeHumanConfirmation({
      instanceId: parent.instanceId,
      confirmed: true,
      ...(continuationAuthority === undefined ? {} : { continuationAuthority }),
    });
    return true;
  }

  async rejectPendingForParentPlan(parentPlanId: string): Promise<boolean> {
    const parent = await this.#execution.findActiveByPlanId(parentPlanId);
    const pending = parent?.pendingConfirmation;
    if (parent?.status !== 'paused' || pending?.kind !== 'skill_confirmation') return false;
    const record = await this.#records.find(parent.instanceId, pending.nodeId);
    if (!matchesPendingCheckpoint(record, parent.instanceId, pending, parentPlanId))
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CONFIRMATION_STALE',
        'Pending child confirmation no longer matches the parent checkpoint.',
      );
    if (record.confirmationStatus === 'rejected') return true;
    if (record.confirmationStatus !== 'awaiting_confirmation')
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CONFIRMATION_STALE',
        'Child confirmation is no longer awaiting a decision.',
      );
    await this.#records.save({
      ...record,
      confirmationStatus: 'rejected',
      status: 'rejected',
      evaluationSummary: `Child plan rejected for ${record.skillId}@${String(record.skillVersion)}.`,
      completedAt: this.#clock.now(),
    });
    try {
      await this.#execution.resumeHumanConfirmation({
        instanceId: parent.instanceId,
        confirmed: false,
      });
    } catch (error: unknown) {
      const failed = await this.#execution.get(parent.instanceId);
      if (failed?.status !== 'failed') throw error;
    }
    return true;
  }

  async #prepare(
    input: Readonly<{
      skillId: string;
      value: unknown;
      parentPlanId: string;
      parentInstanceId: string;
      parentNodeId: string;
      parentNodeRunId: string;
      parentGoalId: string;
      parentGoalVersion: number;
      signal?: AbortSignal;
      executionContext?: RuntimeExecutionContext;
      continuationAuthority?: Readonly<{
        agentTaskId: string;
        contextId: string;
        workflowControlId: string;
      }>;
    }>,
    skill: SkillVersion,
  ): Promise<SkillCallExecutionResult> {
    const callId = this.#nextId();
    const childPlanId = `plan-skill-call-${callId}`;
    const childWorkflowDefinitionId = `workflow-skill-${skill.skillId}-${String(skill.version)}-${callId}`;
    const createdAt = this.#clock.now();
    const parentPlan = await this.#plans.findPlan(input.parentPlanId);
    if (
      parentPlan?.goalId !== input.parentGoalId ||
      parentPlan.goalVersion !== input.parentGoalVersion
    )
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_PARENT_GOAL_CONTRACT_STALE',
        'Child Skill planning requires the immutable parent plan Goal contract.',
      );
    const preparedUsage = await this.#prepareUsage?.({
      skill,
      value: input.value,
      goalContract: parentPlan.goalContract,
      workflowDefinitionId: childWorkflowDefinitionId,
      ...(input.continuationAuthority === undefined
        ? {}
        : { taskId: input.continuationAuthority.agentTaskId }),
    });
    const toolPlanningMetadata = await this.#toolPlanningMetadata(
      skill,
      preparedUsage?.prepared.policy.taskOperations ?? [],
    );
    const plan = await this.#planner.plan({
      planId: childPlanId,
      workflowDefinitionId: childWorkflowDefinitionId,
      workflowVersion: skill.version,
      goalId: input.parentGoalId,
      goalVersion: input.parentGoalVersion,
      goalContract: parentPlan.goalContract,
      toolExecutionSemantics: snapshotMcpToolPlanningExecutionSemantics(toolPlanningMetadata),
      compositionRoot: { skillId: skill.skillId, skillVersion: skill.version },
      ...(preparedUsage === undefined
        ? {}
        : {
            skillUsagePolicy: preparedUsage.prepared.policy,
            ...(preparedUsage.prepared.deterministicDefinition === undefined
              ? {}
              : { deterministicDefinition: preparedUsage.prepared.deterministicDefinition }),
          }),
      planningInstruction:
        preparedUsage?.useLegacyPlanningInstruction !== true
          ? (preparedUsage?.prepared.planningInstruction ??
            childPlanningInstruction(
              skill,
              input.value,
              toolPlanningMetadata,
              childWorkflowDefinitionId,
              input.parentGoalId,
              input.parentGoalVersion,
            ))
          : childPlanningInstruction(
              skill,
              input.value,
              toolPlanningMetadata,
              childWorkflowDefinitionId,
              input.parentGoalId,
              input.parentGoalVersion,
            ),
    });
    const definition = await this.#requireValidatedDefinition(plan);
    if (preparedUsage !== undefined)
      await this.#onUsagePlanPrepared?.({
        skill,
        plan,
        preparedUsage,
        parentPlanId: input.parentPlanId,
      });
    const evaluation = await this.#confirmation.evaluate([skill.skillId], definition);
    let record: SkillCallWorkflowRecord = {
      callId,
      parentPlanId: input.parentPlanId,
      parentInstanceId: input.parentInstanceId,
      parentNodeId: input.parentNodeId,
      childPlanId,
      skillId: skill.skillId,
      skillVersion: skill.version,
      confirmationStatus: 'awaiting_confirmation',
      status: 'awaiting_confirmation',
      evaluationSummary: `Child plan awaits confirmation because: ${evaluation.blockingSkillIds.join(', ')}.`,
      createdAt,
    };
    await this.#records.save(record);
    if (
      !evaluation.autoConfirm ||
      (plan.executionReadiness !== undefined &&
        (plan.executionReadiness.disposition !== 'ready' ||
          plan.executionReadiness.confirmationRequired))
    )
      return confirmationRequest(record);
    await this.#execution.confirm(childPlanId);
    record = {
      ...record,
      confirmationStatus: 'confirmed',
      status: 'running',
      evaluationSummary: 'Transitive child Skill policy auto-confirmed the plan.',
    };
    await this.#records.save(record);
    return this.#executeConfirmed(record, skill, plan, input);
  }

  async #executeConfirmed(
    record: SkillCallWorkflowRecord,
    skill: SkillVersion,
    plan: WorkflowPlanRecord,
    input: Readonly<{
      value: unknown;
      parentNodeRunId: string;
      signal?: AbortSignal;
      executionContext?: RuntimeExecutionContext;
      continuationAuthority?: Readonly<{
        agentTaskId: string;
        contextId: string;
        workflowControlId: string;
      }>;
    }>,
  ): Promise<SkillCallExecutionResult> {
    const definition = await this.#requireValidatedDefinition(plan);
    if (record.status === 'succeeded' && record.childInstanceId !== undefined) {
      const completed = await this.#execution.get(record.childInstanceId);
      if (completed?.status === 'succeeded')
        return { status: 'completed', output: completed.result };
    }
    const childInstanceId = record.childInstanceId ?? `instance-skill-call-${record.callId}`;
    const child = await this.#execution.execute({
      instanceId: childInstanceId,
      planId: record.childPlanId,
      input: input.value,
      skillIds: [skill.skillId],
      ...(input.executionContext === undefined ? {} : { executionContext: input.executionContext }),
      ...(input.continuationAuthority === undefined
        ? {}
        : { continuationAuthority: input.continuationAuthority }),
      onStarted: async () => {
        await this.#records.save({
          ...record,
          childInstanceId,
          status: 'running',
          evaluationSummary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} is executing.`,
        });
        await this.#onExecutionStatus?.({
          childPlanId: record.childPlanId,
          childInstanceId,
          status: 'executing',
          summary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} started.`,
        });
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (child.status === 'waiting_external') {
      await this.#records.save({
        ...record,
        childInstanceId,
        status: 'waiting_external',
        evaluationSummary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} is waiting for external work.`,
      });
      await this.#onExecutionStatus?.({
        childPlanId: record.childPlanId,
        childInstanceId,
        status: 'waiting_external',
        summary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} is waiting for external work.`,
      });
      return {
        status: 'waiting_external',
        wait: {
          waitId: `child-workflow-${childInstanceId}`,
          kind: 'child_workflow',
          sourceId: childInstanceId,
          nodeId: record.parentNodeId,
          nodeRunId: input.parentNodeRunId,
          state: 'waiting',
        },
      };
    }
    if (child.status !== 'succeeded') {
      await this.#records.save({
        ...record,
        childInstanceId,
        status: child.status === 'canceled' ? 'canceled' : 'failed',
        evaluationSummary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} ended with ${child.status}.`,
        completedAt: child.completedAt ?? this.#clock.now(),
      });
      await this.#onExecutionStatus?.({
        childPlanId: record.childPlanId,
        childInstanceId,
        status: child.status === 'canceled' ? 'cancelled' : 'failed',
        summary: `Skill child Workflow ${definition.workflowDefinitionId}@${String(definition.version)} ended with ${child.status}.`,
      });
      throw new SkillCallWorkflowError(
        child.status === 'canceled'
          ? 'WORKFLOW_SKILL_CHILD_CANCELED'
          : 'WORKFLOW_SKILL_CHILD_FAILED',
        `Skill child Workflow ended with ${child.status}.`,
      );
    }

    const resultSize = jsonSize(child.result);
    if (resultSize > MAX_SKILL_CHILD_RESULT_CHARACTERS) {
      await this.#records.save({
        ...record,
        childInstanceId,
        status: 'failed',
        evaluationSummary: `Skill output contained ${String(resultSize)} JSON characters, exceeding the ${String(MAX_SKILL_CHILD_RESULT_CHARACTERS)} character limit.`,
        completedAt: child.completedAt ?? this.#clock.now(),
      });
      await this.#onExecutionStatus?.({
        childPlanId: record.childPlanId,
        childInstanceId,
        status: 'failed',
        summary: 'Skill child Workflow output exceeded the bounded result size.',
      });
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_OUTPUT_TOO_LARGE',
        `Child result exceeds the ${String(MAX_SKILL_CHILD_RESULT_CHARACTERS)} character limit.`,
      );
    }
    const outputValidation = this.#schemas.validate(skill.outputSchema, child.result);
    if (!outputValidation.valid) {
      await this.#records.save({
        ...record,
        childInstanceId,
        status: 'failed',
        evaluationSummary: `Skill output failed ${skill.skillId}@${String(skill.version)} schema validation: ${outputValidation.errors.join('; ')}`,
        completedAt: child.completedAt ?? this.#clock.now(),
      });
      await this.#onExecutionStatus?.({
        childPlanId: record.childPlanId,
        childInstanceId,
        status: 'failed',
        summary: `Skill child Workflow output failed ${skill.skillId}@${String(skill.version)} validation.`,
      });
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_OUTPUT_INVALID',
        `Child result does not satisfy ${skill.skillId}@${String(skill.version)}: ${outputValidation.errors.join('; ')}`,
      );
    }

    await this.#records.save({
      ...record,
      childInstanceId,
      status: 'succeeded',
      evaluationSummary: `Skill output passed ${skill.skillId}@${String(skill.version)} schema validation after executing ${definition.workflowDefinitionId}@${String(definition.version)}.`,
      completedAt: child.completedAt ?? this.#clock.now(),
    });
    await this.#onExecutionStatus?.({
      childPlanId: record.childPlanId,
      childInstanceId,
      status: 'completed',
      summary: `Skill child Workflow output passed ${skill.skillId}@${String(skill.version)} validation.`,
    });
    return { status: 'completed', output: child.result };
  }

  async completeExternalChild(child: WorkflowInstance): Promise<
    Readonly<{
      parentInstanceId: string;
      parentNodeId: string;
      childInstanceId: string;
      outcome:
        | Readonly<{ kind: 'completed'; result: unknown }>
        | Readonly<{
            kind: 'failed';
            error: Readonly<{
              code: string;
              message: string;
              category: 'child_failed' | 'child_cancelled';
              data?: unknown;
            }>;
          }>;
    }>
  > {
    const record = await this.#records.findByChildInstanceId(child.instanceId);
    if (record?.childInstanceId !== child.instanceId)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CHILD_LINK_NOT_FOUND',
        'The completed child Workflow is not linked to a persisted Skill call.',
      );
    if (
      child.status === 'running' ||
      child.status === 'paused' ||
      child.status === 'waiting_external'
    )
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CHILD_NOT_TERMINAL',
        'A nonterminal child Workflow cannot continue its parent Skill call.',
      );
    const skill = await this.#skills.findVersion(record.skillId, record.skillVersion);
    if (skill === undefined)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_NOT_ENABLED',
        'The exact child Skill version is unavailable for output validation.',
      );
    const completedAt = child.completedAt ?? this.#clock.now();
    if (child.status === 'succeeded') {
      let outputFailure: Readonly<{ code: string; message: string }> | undefined;
      try {
        const resultSize = jsonSize(child.result);
        if (resultSize > MAX_SKILL_CHILD_RESULT_CHARACTERS)
          outputFailure = {
            code: 'WORKFLOW_SKILL_OUTPUT_TOO_LARGE',
            message: `Child result exceeds the ${String(MAX_SKILL_CHILD_RESULT_CHARACTERS)} character limit.`,
          };
      } catch (error: unknown) {
        outputFailure = {
          code: 'WORKFLOW_SKILL_OUTPUT_INVALID',
          message: error instanceof Error ? error.message : 'Child output is not finite JSON.',
        };
      }
      const validation =
        outputFailure === undefined
          ? this.#schemas.validate(skill.outputSchema, child.result)
          : undefined;
      if (validation !== undefined && !validation.valid)
        outputFailure = {
          code: 'WORKFLOW_SKILL_OUTPUT_INVALID',
          message: `Child result does not satisfy ${skill.skillId}@${String(skill.version)}: ${validation.errors.join('; ')}`,
        };
      if (outputFailure !== undefined) {
        await this.#records.save({
          ...record,
          status: 'failed',
          evaluationSummary: outputFailure.message,
          completedAt,
        });
        await this.#onExecutionStatus?.({
          childPlanId: record.childPlanId,
          childInstanceId: child.instanceId,
          status: 'failed',
          summary: outputFailure.message,
        });
        return {
          parentInstanceId: record.parentInstanceId,
          parentNodeId: record.parentNodeId,
          childInstanceId: child.instanceId,
          outcome: {
            kind: 'failed',
            error: {
              ...outputFailure,
              category: 'child_failed',
            },
          },
        };
      }
      await this.#records.save({
        ...record,
        status: 'succeeded',
        evaluationSummary: `Externally continued child output passed ${skill.skillId}@${String(skill.version)} validation.`,
        completedAt,
      });
      await this.#onExecutionStatus?.({
        childPlanId: record.childPlanId,
        childInstanceId: child.instanceId,
        status: 'completed',
        summary: `Externally continued child output passed ${skill.skillId}@${String(skill.version)} validation.`,
      });
      return {
        parentInstanceId: record.parentInstanceId,
        parentNodeId: record.parentNodeId,
        childInstanceId: child.instanceId,
        outcome: { kind: 'completed', result: child.result },
      };
    }
    const canceled = child.status === 'canceled';
    const error = Object.values(child.errors)[0];
    await this.#records.save({
      ...record,
      status: canceled ? 'canceled' : 'failed',
      evaluationSummary: `Externally continued child Workflow ended with ${child.status}.`,
      completedAt,
    });
    await this.#onExecutionStatus?.({
      childPlanId: record.childPlanId,
      childInstanceId: child.instanceId,
      status: canceled ? 'cancelled' : 'failed',
      summary: `Externally continued child Workflow ended with ${child.status}.`,
    });
    return {
      parentInstanceId: record.parentInstanceId,
      parentNodeId: record.parentNodeId,
      childInstanceId: child.instanceId,
      outcome: {
        kind: 'failed',
        error: {
          code: canceled ? 'WORKFLOW_SKILL_CHILD_CANCELED' : 'WORKFLOW_SKILL_CHILD_FAILED',
          message: error?.message ?? `Child Workflow ended with ${child.status}.`,
          category: canceled ? 'child_cancelled' : 'child_failed',
          ...(error === undefined ? {} : { data: error }),
        },
      },
    };
  }

  async #requireValidatedDefinition(plan: WorkflowPlanRecord) {
    if (plan.definition === undefined)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CHILD_PLAN_INVALID',
        'Child Workflow planner returned no executable definition.',
      );
    const validation = await this.#validator.validate(plan.definition, {
      enforceSkillComposition:
        plan.compositionContext !== undefined || plan.capabilityGapSkillIds !== undefined,
      allowedChildSkillIds: plan.compositionContext?.allowedChildSkillIds ?? [],
      capabilityGapSkillIds: plan.capabilityGapSkillIds ?? [],
    });
    if (!validation.valid || validation.definition === undefined)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_CHILD_PLAN_INVALID',
        `Child Workflow failed validation: ${validation.errors.map((error) => `${error.code} at ${error.path}`).join('; ')}`,
      );
    return validation.definition;
  }

  async #assertParentCompositionAuthority(
    parentPlanId: string,
    skillId: string,
  ): Promise<number | undefined> {
    const plan = await this.#plans.findPlan(parentPlanId);
    const nativePolicy = plan?.definition?.skillUsagePolicy;
    const nativeChildren = nativePolicy?.childPolicies.filter(
      (child) => child.child.skillId === skillId,
    );
    const enforced =
      nativePolicy !== undefined ||
      plan?.compositionContext !== undefined ||
      plan?.capabilityGapSkillIds !== undefined;
    const allowedByNativePolicy = nativePolicy?.childPolicies.some(
      (child) => child.child.skillId === skillId,
    );
    if (
      plan === undefined ||
      (enforced &&
        (nativePolicy === undefined
          ? !plan.compositionContext?.allowedChildSkillIds.includes(skillId) &&
            !plan.capabilityGapSkillIds?.includes(skillId)
          : allowedByNativePolicy !== true))
    )
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION',
        `Skill ${skillId} is not authorized by the immutable parent composition context.`,
      );
    if (nativeChildren !== undefined && nativeChildren.length > 1)
      throw new SkillCallWorkflowError(
        'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION',
        `Skill ${skillId} has ambiguous exact-version authority in the parent plan.`,
      );
    return nativeChildren?.[0]?.child.skillVersion;
  }
}

function matchesPendingCheckpoint(
  record: SkillCallWorkflowRecord | undefined,
  parentInstanceId: string,
  pending: NonNullable<WorkflowInstance['pendingConfirmation']>,
  parentPlanId: string,
): record is SkillCallWorkflowRecord {
  return (
    record?.parentPlanId === parentPlanId &&
    record.parentInstanceId === parentInstanceId &&
    record.parentNodeId === pending.nodeId &&
    record.childPlanId === pending.childPlanId &&
    record.skillId === pending.childSkillId &&
    record.skillVersion === pending.childSkillVersion
  );
}

function confirmationRequest(record: SkillCallWorkflowRecord): SkillCallExecutionResult {
  return {
    status: 'awaiting_confirmation',
    callId: record.callId,
    parentPlanId: record.parentPlanId,
    parentInstanceId: record.parentInstanceId,
    parentNodeId: record.parentNodeId,
    childPlanId: record.childPlanId,
    childSkillId: record.skillId,
    childSkillVersion: record.skillVersion,
  };
}

export function nextSkillCallAncestry(
  ancestry: readonly string[],
  skillId: string,
): readonly string[] {
  if (ancestry.includes(skillId))
    throw new SkillCallWorkflowError(
      'WORKFLOW_SKILL_RECURSION_INVALID',
      `Recursive Skill call detected for ${skillId}: ${[...ancestry, skillId].join(' -> ')}.`,
    );
  if (ancestry.length >= MAX_SKILL_CALL_DEPTH)
    throw new SkillCallWorkflowError(
      'WORKFLOW_SKILL_DEPTH_EXCEEDED',
      `Skill call depth exceeds the maximum of ${String(MAX_SKILL_CALL_DEPTH)}.`,
    );
  return Object.freeze([...ancestry, skillId]);
}

function childPlanningInstruction(
  skill: SkillVersion,
  resolvedInput: unknown,
  toolPlanningMetadata: readonly McpToolPlanningMetadata[],
  workflowDefinitionId: string,
  goalId: string,
  goalVersion: number,
): string {
  return JSON.stringify({
    operation: 'skill_call_child_plan',
    workflowIdentity: {
      workflowDefinitionId,
      version: skill.version,
      goalId,
      goalVersion,
    },
    selectedSkill: {
      skillId: skill.skillId,
      version: skill.version,
      name: skill.name,
      description: skill.description,
      workflowGuidance: skill.workflowGuidance,
      inputSchema: skill.inputSchema,
      outputSchema: skill.outputSchema,
      toolPolicy: skill.toolPolicy,
      runtimePolicy: skill.runtimePolicy,
    },
    resolvedInput,
    toolPlanningMetadata,
    constraints: [
      'Use only the restricted Workflow DSL and the listed current MCP Tool contracts.',
      'Bind runtime input or node outputs with exact {op:"ref",path:[...]} values.',
      'Return a result that satisfies the selected Skill outputSchema.',
    ],
  });
}

function jsonSize(value: unknown): number {
  const pending: { value: unknown; leave?: object }[] = [{ value }];
  const active = new WeakSet();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) continue;
    if (entry.leave !== undefined) {
      active.delete(entry.leave);
      continue;
    }
    const current = entry.value;
    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    )
      continue;
    if (typeof current !== 'object') throw invalidJsonOutput();
    if (active.has(current)) throw invalidJsonOutput();
    active.add(current);
    pending.push({ value: null, leave: current });
    if (isUnknownArray(current)) {
      for (const item of current) pending.push({ value: item });
      continue;
    }
    const prototype = Reflect.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) throw invalidJsonOutput();
    for (const item of Object.values(current as Readonly<Record<string, unknown>>))
      pending.push({ value: item });
  }
  return JSON.stringify(value).length;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function invalidJsonOutput(): SkillCallWorkflowError {
  return new SkillCallWorkflowError(
    'WORKFLOW_SKILL_OUTPUT_INVALID',
    'Child result is not finite JSON data.',
  );
}

export type SkillCallWorkflowErrorCode =
  | 'WORKFLOW_SKILL_INPUT_INVALID'
  | 'WORKFLOW_SKILL_OUTPUT_INVALID'
  | 'WORKFLOW_SKILL_OUTPUT_TOO_LARGE'
  | 'WORKFLOW_SKILL_CHILD_PLAN_INVALID'
  | 'WORKFLOW_SKILL_CHILD_FAILED'
  | 'WORKFLOW_SKILL_CHILD_CANCELED'
  | 'WORKFLOW_SKILL_CHILD_LINK_NOT_FOUND'
  | 'WORKFLOW_SKILL_CHILD_NOT_TERMINAL'
  | 'WORKFLOW_SKILL_NOT_ENABLED'
  | 'WORKFLOW_SKILL_VERSION_STALE'
  | 'WORKFLOW_SKILL_CONFIRMATION_REJECTED'
  | 'WORKFLOW_SKILL_CONFIRMATION_STALE'
  | 'WORKFLOW_SKILL_PARENT_GOAL_CONTRACT_STALE'
  | 'WORKFLOW_SKILL_NOT_ALLOWED_BY_COMPOSITION'
  | 'WORKFLOW_SKILL_RECURSION_INVALID'
  | 'WORKFLOW_SKILL_DEPTH_EXCEEDED';

export class SkillCallWorkflowError extends Error {
  readonly code: SkillCallWorkflowErrorCode;

  constructor(code: SkillCallWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'SkillCallWorkflowError';
    this.code = code;
  }
}
