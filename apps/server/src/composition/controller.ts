import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  EvolutionExperienceService,
  McpRegistryService,
  MemoryService,
  ModelRuntimeService,
  PlanPreparationProcessor,
  PlanningCorrectionService,
  ResultProcessingService,
  ResultProcessor,
  RuntimeTaskCapabilityService,
  SkillCallWorkflowService,
  SkillExecutionRecordingService,
  SkillSelectionService,
  TaskBusinessCommandService,
  TaskQualityEvaluationService,
  TaskService,
  TransitiveSkillConfirmationEvaluator,
  UserGoalPlanController,
  UserGoalRecoveryService,
  WorkflowExecutionService,
  WorkflowPlannerService,
} from '../../../../packages/application/src/index.js';
import {
  DeferredSkillEvolutionService,
  RemoteTaskContinuationReconciler,
  RemoteTaskContinuationService,
  RemoteTaskInputService,
  StructuredGoalEvaluator,
  TemporarySkillResolver,
  TemporarySkillService,
  WorkflowControllerService,
  assertHomeLabReadOnlyWorkflowContract,
  verifiedHomeLabReadOnlyOutcomeRefs,
} from '../../../../packages/application/src/index.js';
import { verifiedTaskBusinessOutcomeRefs } from '../../../../packages/application/src/task-business-outcome.js';
import {
  createGoalExecutionContract,
  type AgentTask,
  type GoalExecutionContract,
  type SkillUsageSelectionContext,
  type WorkflowContinuationSnapshot,
  type WorkflowInstance,
} from '../../../../packages/domain/src/index.js';
import type { WorkflowControlRecord as CompositionWorkflowControlRecord } from '../../../../packages/domain/src/workflow-control.js';
import type { AjvJsonSchemaValidator } from '../../../../packages/json-schema-adapter/src/index.js';
import type {
  PostgresAgentTaskRepository,
  PostgresEvolutionPolicyRepository,
  PostgresGoalRepository,
  PostgresMcpRegistryRepository,
  PostgresRemoteTaskRepository,
  PostgresRuntimeEventPublisher,
  PostgresSkillCallWorkflowRepository,
  PostgresSkillExecutionRepository,
  PostgresSkillRepository,
  PostgresTaskBusinessRepository,
  PostgresTemporarySkillRepository,
  PostgresWorkflowChildCallRepository,
  PostgresWorkflowContinuationRepository,
  PostgresWorkflowPlanRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  PostgresRemoteTaskInputRepository,
  PostgresWorkflowControlRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import type {
  BullMqRemoteTaskContinuationQueue,
  BullMqRemoteTaskPollQueue,
  ContextSerialExecutor,
} from '../../../../packages/runtime-redis/src/index.js';
import {
  assertHomeLabGovernedLightWorkflowContract,
  verifiedHomeLabGovernedLightOutcomeRefs,
} from '.././home-lab-governed-light-workflow-contract.js';
import { continueRemoteTaskWorkflowHierarchy } from '.././remote-task-workflow-hierarchy.js';
import {
  isHistoricalUgvPointSkill,
  ugvCapabilityForSkill,
} from '.././ugv-agent-profile-catalog.js';
import {
  UGV_AGENT_PROFILE_SKILL_ID,
  UGV_AGENT_PROFILE_SKILL_VERSION,
  prepareUgvAgentProfileReadOnlyResult,
  verifiedUgvAgentProfileOutcomeRefs,
} from '.././ugv-agent-profile.js';
import type { UgvMoveTerminalOutcomeAuthority } from '.././ugv-move-terminal-outcome.js';
import {
  UgvMoveDeterministicGoalEvaluator,
  UgvProfileGoalEvaluator,
} from '.././ugv-move-terminal-outcome.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import {
  isRecord,
  requireHomeLabReadOnlyTerminalPreparation,
  runtimeErrorCode,
} from './runtime-support.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeControllerDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly pool: Pool;
  readonly workflowPlans: PostgresWorkflowPlanRepository;
  readonly goals: PostgresGoalRepository;
  readonly skillConfirmation: TransitiveSkillConfirmationEvaluator;
  readonly workflowPlanner: WorkflowPlannerService;
  readonly workflowExecution: WorkflowExecutionService;
  readonly ugvMoveTerminalOutcomeAuthority: RuntimeValueRef<
    UgvMoveTerminalOutcomeAuthority | undefined
  >;
  readonly modelRuntime: ModelRuntimeService;
  readonly memories: MemoryService;
  readonly userGoalRecovery: UserGoalRecoveryService;
  readonly taskCapabilities: RuntimeTaskCapabilityService;
  readonly evolutionExperiences: EvolutionExperienceService;
  readonly service: RuntimeValueRef<TaskService>;
  readonly skillSelection: SkillSelectionService;
  readonly resolveSkillUsageContext: (
    goalContract: GoalExecutionContract,
    task?: AgentTask,
  ) => Promise<SkillUsageSelectionContext>;
  readonly skills: PostgresSkillRepository;
  readonly processor: RuntimeValueRef<PlanPreparationProcessor>;
  readonly ugvAgentProfile: boolean;
  readonly homeLabGovernedLightProfile: boolean;
  readonly homeLabReadOnlyProfile: boolean;
  readonly temporarySkillRepository: PostgresTemporarySkillRepository;
  readonly resultProcessing: ResultProcessingService;
  readonly mcpRepository: PostgresMcpRegistryRepository;
  readonly resultProcessor: ResultProcessor;
  readonly taskBusinessRepository: PostgresTaskBusinessRepository;
  readonly taskQuality: TaskQualityEvaluationService;
  readonly userGoalPlanController: UserGoalPlanController;
  readonly skillExecutionRecording: SkillExecutionRecordingService;
  readonly planningCorrections: PlanningCorrectionService;
  readonly clock: { now: () => string };
  readonly skillCallWorkflows: PostgresSkillCallWorkflowRepository;
  readonly workflowChildCalls: PostgresWorkflowChildCallRepository;
  readonly skillCallWorkflowService: SkillCallWorkflowService;
  readonly workflowContinuations: PostgresWorkflowContinuationRepository;
  readonly recordSkillProjectionSafely: (operation: () => Promise<unknown>) => Promise<void>;
  readonly remoteTaskRepository: PostgresRemoteTaskRepository | undefined;
  readonly remoteTaskQueue: BullMqRemoteTaskPollQueue | undefined;
  readonly remoteTaskContinuationQueue: BullMqRemoteTaskContinuationQueue | undefined;
  readonly remoteTaskInput: RuntimeValueRef<RemoteTaskInputService | undefined>;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly tasks: PostgresAgentTaskRepository;
  readonly events: PostgresRuntimeEventPublisher;
  readonly mcpRegistry: McpRegistryService;
  readonly schemaValidator: AjvJsonSchemaValidator;
  readonly contextSerial: ContextSerialExecutor;
  readonly publishTaskState: (task: AgentTask) => void;
  readonly taskBusinessCommands: TaskBusinessCommandService | undefined;
  readonly evolutionPolicyRepository: PostgresEvolutionPolicyRepository;
  readonly skillExecutionRepository: PostgresSkillExecutionRepository;
  readonly workflowController: RuntimeValueRef<WorkflowControllerService>;
  readonly projectSkillExecutionControl: RuntimeValueRef<
    (
      workflowPlanId: string,
      control: Awaited<
        ReturnType<(controlId: string) => Promise<CompositionWorkflowControlRecord>>
      >,
    ) => Promise<void>
  >;
}
export function composeController(dependencies: composeControllerDependencies) {
  const {
    options,
    pool,
    workflowPlans,
    goals,
    skillConfirmation,
    workflowPlanner,
    workflowExecution,
    modelRuntime,
    memories,
    userGoalRecovery,
    taskCapabilities,
    evolutionExperiences,
    skillSelection,
    resolveSkillUsageContext,
    skills,
    ugvAgentProfile,
    homeLabGovernedLightProfile,
    homeLabReadOnlyProfile,
    temporarySkillRepository,
    resultProcessing,
    mcpRepository,
    resultProcessor,
    taskBusinessRepository,
    taskQuality,
    userGoalPlanController,
    skillExecutionRecording,
    planningCorrections,
    clock,
    skillCallWorkflows,
    workflowChildCalls,
    skillCallWorkflowService,
    workflowContinuations,
    recordSkillProjectionSafely,
    remoteTaskRepository,
    remoteTaskQueue,
    remoteTaskContinuationQueue,
    deviceWorkScope,
    tasks,
    events,
    mcpRegistry,
    schemaValidator,
    contextSerial,
    publishTaskState,
    taskBusinessCommands,
    evolutionPolicyRepository,
    skillExecutionRepository,
  } = dependencies;
  dependencies.workflowController.value = new WorkflowControllerService({
    controls: new PostgresWorkflowControlRepository(pool),
    plans: workflowPlans,
    goals,
    confirmation: skillConfirmation,
    planner: workflowPlanner,
    execution: workflowExecution,
    evaluator:
      dependencies.ugvMoveTerminalOutcomeAuthority.value === undefined
        ? new StructuredGoalEvaluator(modelRuntime, memories)
        : new UgvProfileGoalEvaluator(
            new UgvMoveDeterministicGoalEvaluator(
              dependencies.ugvMoveTerminalOutcomeAuthority.value,
            ),
            new StructuredGoalEvaluator(modelRuntime, memories),
          ),
    recovery: userGoalRecovery,
    resolveExecutionContext: (taskId) => taskCapabilities.resolveRuntimeExecutionContext(taskId),
    experiences: evolutionExperiences,
    memories,
    taskOutcomes: {
      reportCapabilityGap: (taskId, evaluation) =>
        dependencies.service.value.reportCapabilityGap(taskId, evaluation),
      requestInput: (taskId, question, controlId, controlRoundIndex) =>
        dependencies.service.value.requestInput(taskId, question, {
          source: 'goal_evaluation',
          controlId,
          controlRoundIndex,
        }),
      requestSkillConfirmation: (taskId, input) =>
        dependencies.service.value.requestNestedSkillConfirmation(taskId, input),
      async prepareSkillReplacement(taskId) {
        const task = await dependencies.service.value.get(taskId);
        if (task.skillSelectionId === undefined || task.selectedSkillId === undefined)
          throw new Error('TASK_SKILL_SELECTION_NOT_BOUND');
        if (task.goalId === undefined || task.goalVersion === undefined)
          throw new Error('TASK_GOAL_NOT_ATTACHED');
        const goal = await goals.findById(task.goalId);
        if (goal?.version !== task.goalVersion) throw new Error('TASK_GOAL_VERSION_STALE');
        const replacement = await skillSelection.planReplacement(
          task.skillSelectionId,
          task.selectedSkillId,
          createGoalExecutionContract(goal),
          await resolveSkillUsageContext(createGoalExecutionContract(goal), task),
        );
        return {
          skillId: replacement.replacementSkillId,
          skillVersion: replacement.replacementSkillVersion,
          decisionSummary: replacement.decisionSummary,
        };
      },
      async prepareCompositionRefresh(taskId) {
        const task = await dependencies.service.value.get(taskId);
        if (task.selectedSkillId === undefined || task.selectedSkillVersion === undefined)
          throw new Error('TASK_SKILL_SELECTION_NOT_BOUND');
        const selected = await skills.findVersion(task.selectedSkillId, task.selectedSkillVersion);
        if (selected?.status !== 'enabled') throw new Error('TASK_SKILL_VERSION_NOT_ENABLED');
        return {
          skillId: selected.skillId,
          skillVersion: selected.version,
          decisionSummary:
            'Recomposed the immutable parent Workflow against current child Skill versions.',
        };
      },
      reportReplacementPlan: (taskId, input) =>
        dependencies.service.value.awaitReplacementConfirmation(taskId, input),
      reportReplanPlan: (taskId, input) =>
        dependencies.service.value.awaitWorkflowReplanConfirmation(taskId, input),
      reportInputContinuationPlan: (taskId, input) =>
        dependencies.service.value.awaitInputContinuationConfirmation(taskId, input),
      continueUserGoalPlan: (taskId, userGoalPlanId) =>
        dependencies.processor.value.continueUserGoalPlan(taskId, userGoalPlanId),
      async prepareAchieved(taskId, instance) {
        const task = await dependencies.service.value.get(taskId);
        if (
          ugvAgentProfile &&
          task.selectedSkillId !== undefined &&
          task.selectedSkillVersion !== undefined &&
          isHistoricalUgvPointSkill(task.selectedSkillId, task.selectedSkillVersion)
        ) {
          if (
            task.selectedSkillId !== UGV_AGENT_PROFILE_SKILL_ID ||
            task.selectedSkillVersion !== UGV_AGENT_PROFILE_SKILL_VERSION ||
            dependencies.ugvMoveTerminalOutcomeAuthority.value === undefined
          )
            throw new Error('UGV_MOVE_TERMINAL_OUTCOME_TASK_AUTHORITY_REQUIRED');
          return dependencies.ugvMoveTerminalOutcomeAuthority.value.prepare(taskId, instance);
        }
        const homeLabReadOnlyErrors = requireHomeLabReadOnlyTerminalPreparation(
          options.taskUnderstanding?.profile,
          task,
          instance,
        );
        if (homeLabGovernedLightProfile) {
          if (task.temporarySkillId !== undefined)
            throw new Error('HOME_LAB_GOVERNED_LIGHT_TEMPORARY_SKILL_FORBIDDEN');
          if (instance.status !== 'succeeded')
            throw new Error('HOME_LAB_GOVERNED_LIGHT_TERMINAL_INSTANCE_NOT_SUCCEEDED');
          if (Object.keys(instance.errors).length !== 0)
            throw new Error('HOME_LAB_GOVERNED_LIGHT_TERMINAL_INSTANCE_ERRORS_PRESENT');
        }
        if (homeLabReadOnlyProfile) {
          const persistedPlan = await workflowPlans.findPlan(instance.planId);
          if (persistedPlan?.definition === undefined)
            throw new Error('HOME_LAB_READ_ONLY_TERMINAL_WORKFLOW_AUTHORITY_REQUIRED');
          assertHomeLabReadOnlyWorkflowContract(persistedPlan.definition);
        }
        if (task.temporarySkillId !== undefined) {
          const temporary = await temporarySkillRepository.find(task.temporarySkillId);
          if (temporary?.status !== 'active') throw new Error('TEMPORARY_SKILL_NOT_ACTIVE');
          const processedResult = await resultProcessing.prepare({
            resultId: `processed-result-terminal-${taskId}`,
            taskId,
            skillId: temporary.temporarySkillId,
            skillVersion: 1,
            outputInstruction: `Evaluate Temporary Skill ${temporary.name} output.`,
            outputSchema: temporary.outputSchema,
            rawResult: instance.result,
            ...(homeLabReadOnlyErrors === undefined ? {} : { errors: homeLabReadOnlyErrors }),
          });
          const capabilityTerminalProof = await taskCapabilities.assertTerminalSuccess(
            taskId,
            processedResult.output.structured,
            { outputSchemaValid: true },
          );
          return Object.freeze({
            processedResult,
            ...(capabilityTerminalProof === undefined ? {} : { capabilityTerminalProof }),
          });
        }
        const selected = instance.skillVersions[0];
        if (selected === undefined) throw new Error('TASK_SKILL_VERSION_REQUIRED');
        const skill = await skills.findVersion(selected.skillId, selected.version);
        if (skill?.status !== 'enabled') throw new Error('TASK_SKILL_VERSION_NOT_ENABLED');
        if (homeLabGovernedLightProfile) {
          if (
            task.selectedSkillId !== skill.skillId ||
            task.selectedSkillVersion !== skill.version ||
            skill.version !== 3 ||
            !['home.light.get-state', 'home.light.set-power'].includes(skill.skillId)
          )
            throw new Error('HOME_LAB_GOVERNED_LIGHT_TERMINAL_SKILL_AUTHORITY_MISMATCH');
          const persistedPlan = await workflowPlans.findPlan(instance.planId);
          if (persistedPlan?.definition === undefined)
            throw new Error('HOME_LAB_GOVERNED_LIGHT_TERMINAL_WORKFLOW_AUTHORITY_REQUIRED');
          assertHomeLabGovernedLightWorkflowContract(persistedPlan.definition, {
            skillId: skill.skillId,
            skillVersion: skill.version,
          });
        }
        const processedResult =
          (ugvAgentProfile && ugvCapabilityForSkill(skill.skillId)?.kind === 'read_only'
            ? prepareUgvAgentProfileReadOnlyResult({
                taskId,
                contextId: task.contextId,
                selectedPlanId: task.planId,
                selectedSkillId: task.selectedSkillId,
                selectedSkillVersion: task.selectedSkillVersion,
                instance,
                invocations: await mcpRepository.listInvocationsByTask(taskId),
                latestCapabilityAttempt: (await taskCapabilities.listAttempts(taskId)).at(-1),
                skill,
                processor: resultProcessor,
              })
            : undefined) ??
          (await resultProcessing.prepare({
            resultId: `processed-result-terminal-${taskId}`,
            taskId,
            skillId: skill.skillId,
            skillVersion: skill.version,
            outputInstruction: skill.outputInstruction,
            outputSchema: skill.outputSchema,
            rawResult: instance.result,
            ...(homeLabReadOnlyErrors === undefined ? {} : { errors: homeLabReadOnlyErrors }),
          }));
        if (
          homeLabReadOnlyProfile &&
          (task.selectedSkillId !== skill.skillId || task.selectedSkillVersion !== skill.version)
        )
          throw new Error('HOME_LAB_READ_ONLY_TERMINAL_SKILL_AUTHORITY_MISMATCH');
        const capabilityTerminalProof = await taskCapabilities.assertTerminalSuccess(
          taskId,
          processedResult.output.structured,
          {
            outputSchemaValid: true,
            ...(homeLabReadOnlyProfile
              ? {
                  requiredBinding: {
                    requestedCapabilityId: 'home.living-room.read-state',
                    capabilityVersion: 1,
                  },
                }
              : homeLabGovernedLightProfile
                ? {
                    requiredBinding: {
                      requestedCapabilityId:
                        skill.skillId === 'home.light.get-state'
                          ? 'home.light.read-state'
                          : 'home.light.set-power',
                      capabilityVersion: 3,
                    },
                  }
                : {}),
          },
        );
        if (
          (homeLabReadOnlyProfile || homeLabGovernedLightProfile) &&
          capabilityTerminalProof === undefined
        )
          throw new Error(
            homeLabGovernedLightProfile
              ? 'HOME_LAB_GOVERNED_LIGHT_TERMINAL_CAPABILITY_PROOF_REQUIRED'
              : 'HOME_LAB_READ_ONLY_TERMINAL_CAPABILITY_PROOF_REQUIRED',
          );
        return Object.freeze({
          processedResult,
          ...(capabilityTerminalProof === undefined ? {} : { capabilityTerminalProof }),
          ...(homeLabReadOnlyProfile
            ? { verifiedOutcomeRefs: verifiedHomeLabReadOnlyOutcomeRefs(skill) }
            : homeLabGovernedLightProfile
              ? { verifiedOutcomeRefs: verifiedHomeLabGovernedLightOutcomeRefs(skill) }
              : ugvAgentProfile && capabilityTerminalProof !== undefined
                ? {
                    verifiedOutcomeRefs: verifiedUgvAgentProfileOutcomeRefs({
                      taskId,
                      ...(task.selectedSkillId === undefined
                        ? {}
                        : { selectedSkillId: task.selectedSkillId }),
                      ...(task.selectedSkillVersion === undefined
                        ? {}
                        : { selectedSkillVersion: task.selectedSkillVersion }),
                      workflowSkillVersions: instance.skillVersions,
                      skill,
                      proof: capabilityTerminalProof,
                    }),
                  }
                : {
                    ...(skill.runtimePolicy.taskBusinessEvidencePolicy === undefined
                      ? {}
                      : {
                          verifiedOutcomeRefs: verifiedTaskBusinessOutcomeRefs({
                            taskId,
                            ...(task.selectedSkillId === undefined
                              ? {}
                              : { selectedSkillId: task.selectedSkillId }),
                            ...(task.selectedSkillVersion === undefined
                              ? {}
                              : { selectedSkillVersion: task.selectedSkillVersion }),
                            workflowSkillVersions: instance.skillVersions,
                            ...(capabilityTerminalProof === undefined
                              ? {}
                              : { proof: capabilityTerminalProof }),
                            skill,
                            result: processedResult.output.structured,
                            projections: await taskBusinessRepository.listByTask(taskId),
                          }),
                        }),
                  }),
        });
      },
      enhanceResultMemory: (processed) => resultProcessing.enhance(processed),
      async enhanceTaskQuality(taskId, instance, evaluation, processed) {
        const task = await dependencies.service.value.get(taskId);
        const plan = await workflowPlans.findPlan(instance.planId);
        const goal = await goals.findById(instance.goalId);
        if (plan?.definition === undefined || goal === undefined)
          throw new Error('TASK_QUALITY_EVIDENCE_MISSING');
        const temporary =
          task.temporarySkillId === undefined
            ? undefined
            : await temporarySkillRepository.find(task.temporarySkillId);
        const skill =
          temporary === undefined
            ? await skills.findVersion(processed.skillId, processed.skillVersion)
            : {
                skillId: temporary.temporarySkillId,
                version: 1,
                inputSchema: temporary.inputSchema,
                outputSchema: temporary.outputSchema,
              };
        if (skill === undefined) throw new Error('TASK_QUALITY_SKILL_EVIDENCE_MISSING');
        await taskQuality.evaluate({
          taskId,
          goal,
          goalEvaluation: evaluation,
          workflow: plan.definition,
          instance,
          skill,
          processedResult: processed,
          isTemporarySkill: temporary !== undefined,
        });
      },
      async enhanceTemporarySkill(taskId) {
        const task = await dependencies.service.value.get(taskId);
        if (task.temporarySkillId === undefined) return undefined;
        const completed = await temporarySkills.complete(
          task.temporarySkillId,
          true,
          'Temporary Skill Workflow completed and its output Schema passed.',
        );
        return completed.formalizationCandidate?.candidateId;
      },
      async enhanceSkillEvolution(candidateId) {
        // Retain the committed candidate without running deferred validation/publication.
        await skillEvolution.get(candidateId);
      },
    },
    terminalAuthority: userGoalPlanController,
    onTerminalCommitted: async ({ outcome, control, instance }) => {
      try {
        const degraded = isRecord(instance.result) && instance.result['status'] === 'degraded';
        await skillExecutionRecording.recordReference({
          workflowPlanId: control.currentPlanId,
          kind: 'outcome',
          referenceId: outcome.outcomeId,
          referenceType: 'runtime.terminal_outcome',
          sourceSystem: 'workflow_controller',
          producerRefs: outcome.finalInstanceId === undefined ? [] : [outcome.finalInstanceId],
          metadata: { workflowControlStatus: outcome.controlStatus, controlId: control.controlId },
        });
        await skillExecutionRecording.recordStatus({
          workflowPlanId: control.currentPlanId,
          eventType: degraded
            ? 'skill.execution_degraded'
            : outcome.controlStatus === 'achieved'
              ? 'skill.execution_completed'
              : outcome.controlStatus === 'canceled'
                ? 'skill.execution_failed'
                : 'skill.execution_failed',
          status: degraded
            ? 'degraded'
            : outcome.controlStatus === 'achieved'
              ? 'completed'
              : outcome.controlStatus === 'canceled'
                ? 'cancelled'
                : 'failed',
          summary: degraded
            ? `Authoritative terminal outcome ${outcome.outcomeId} retained degraded patrol evidence.`
            : `Authoritative terminal outcome ${outcome.outcomeId} was committed atomically.`,
          details: {
            workflowControlStatus: outcome.controlStatus,
            ...(degraded
              ? {
                  missingEffects: instance.result['missingEffects'] ?? [],
                  missingEvidence: instance.result['missingEvidence'] ?? [],
                }
              : {}),
          },
        });
      } catch (error: unknown) {
        process.stderr.write(
          `${JSON.stringify({
            level: 'warn',
            event: 'skill_execution_terminal_projection_failed',
            errorCode: runtimeErrorCode(error),
            outcomeId: outcome.outcomeId,
          })}\n`,
        );
      }
      if (control.taskId !== undefined) {
        try {
          await planningCorrections.recordOutcome({
            taskId: control.taskId,
            outcomeRef: `runtime-outcome:${outcome.outcomeId}`,
            ...(outcome.controlStatus === 'achieved'
              ? {}
              : { counterexampleRefs: [`runtime-outcome:${outcome.outcomeId}`] }),
          });
        } catch (error: unknown) {
          process.stderr.write(
            `${JSON.stringify({
              level: 'warn',
              event: 'planning_interaction_outcome_capture_failed',
              taskId: control.taskId,
              outcomeId: outcome.outcomeId,
              errorCode: runtimeErrorCode(error),
            })}\n`,
          );
        }
      }
    },
    reportWarning: (warning) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'runtime.enhancement.warning', ...warning })}\n`,
      );
    },
    clock,
    ids: {
      nextPlanId: (controlId, replanCount) =>
        `plan-${controlId}-${String(replanCount)}-${randomUUID()}`,
      nextInstanceId: (controlId, roundIndex) =>
        `instance-${controlId}-${String(roundIndex)}-${randomUUID()}`,
    },
  });
  const continueWorkflowHierarchy = async (
    input: Readonly<{
      snapshot: WorkflowContinuationSnapshot;
      instance: WorkflowInstance;
      continuationAttemptId: string;
    }>,
  ): Promise<void> => {
    await continueRemoteTaskWorkflowHierarchy(
      {
        skillCallWorkflows,
        childCalls: workflowChildCalls,
        skillCallWorkflow: skillCallWorkflowService,
        continuations: workflowContinuations,
        execution: workflowExecution,
        controller: dependencies.workflowController.value,
        recordRootResume: (snapshot) =>
          recordSkillProjectionSafely(() =>
            skillExecutionRecording.recordStatus({
              workflowPlanId: snapshot.workflowPlanId,
              eventType: 'skill.execution_started',
              status: 'executing',
              summary: 'Authoritative Workflow resumed after an external Task observation.',
            }),
          ),
        projectControl: (snapshot, control) =>
          dependencies.projectSkillExecutionControl.value(snapshot.workflowPlanId, control),
      },
      input,
    );
  };
  const remoteTaskContinuation =
    remoteTaskRepository === undefined ||
    remoteTaskQueue === undefined ||
    remoteTaskContinuationQueue === undefined
      ? undefined
      : (() => {
          dependencies.remoteTaskInput.value = new RemoteTaskInputService({
            continuations: workflowContinuations,
            remoteTasks: remoteTaskRepository,
            inputs: new PostgresRemoteTaskInputRepository(pool, deviceWorkScope),
            tasks,
            events,
            sender: mcpRegistry,
            pollQueue: remoteTaskQueue,
            schemas: schemaValidator,
            serial: contextSerial,
            clock,
            ids: {
              nextInputRequestId: () => `remote-task-input-${randomUUID()}`,
              nextClaimToken: () => `remote-task-input-claim-${randomUUID()}`,
              nextProtocolAttemptId: () => `remote-task-input-attempt-${randomUUID()}`,
              nextEventId: () => `remote-task-input-event-${randomUUID()}`,
            },
            onTaskChanged: publishTaskState,
            ...(taskBusinessCommands === undefined
              ? {}
              : { businessCommands: taskBusinessCommands }),
          });
          return new RemoteTaskContinuationService({
            continuations: workflowContinuations,
            remoteTasks: remoteTaskRepository,
            execution: workflowExecution,
            serial: contextSerial,
            clock,
            ids: {
              nextClaimToken: () => `workflow-continuation-claim-${randomUUID()}`,
              nextAttemptId: () => `workflow-continuation-attempt-${randomUUID()}`,
            },
            async failTask(taskId, errorCode, summary) {
              await dependencies.service.value.fail(taskId, errorCode, summary);
            },
            onContinued: continueWorkflowHierarchy,
            inputRequired: dependencies.remoteTaskInput.value,
          });
        })();
  const remoteTaskContinuationReconciler =
    remoteTaskContinuation === undefined || remoteTaskContinuationQueue === undefined
      ? undefined
      : new RemoteTaskContinuationReconciler({
          continuations: workflowContinuations,
          queue: remoteTaskContinuationQueue,
          clock,
        });
  const temporarySkills = new TemporarySkillService({
    repository: temporarySkillRepository,
    tools: mcpRepository,
    schemas: schemaValidator,
    clock,
    ids: {
      nextTemporarySkillId: () => `temporary-skill-${randomUUID()}`,
      nextExperienceId: () => `temporary-skill-experience-${randomUUID()}`,
      nextFormalizationCandidateId: () => `skill-formalization-candidate-${randomUUID()}`,
      nextEvolutionTriggerId: () => `evolution-trigger-${randomUUID()}`,
    },
    fingerprint: (canonical) => createHash('sha256').update(canonical).digest('hex'),
    evolutionPolicy: evolutionPolicyRepository,
  });
  const temporarySkillResolver = new TemporarySkillResolver({
    mcp: mcpRepository,
    model: modelRuntime,
    temporarySkills,
  });
  const skillEvolution = new DeferredSkillEvolutionService(temporarySkillRepository);
  dependencies.projectSkillExecutionControl.value = async (
    workflowPlanId: string,
    control: Awaited<ReturnType<typeof dependencies.workflowController.value.get>>,
  ): Promise<void> => {
    const status = control.status;
    if (status === 'running') {
      await recordSkillProjectionSafely(() =>
        skillExecutionRecording.recordStatus({
          workflowPlanId,
          eventType: 'skill.execution_waiting_external',
          status: 'waiting_external',
          summary: 'Authoritative Workflow is waiting for an external Task.',
        }),
      );
      return;
    }
    if (status === 'awaiting_confirmation' || status === 'awaiting_input') {
      await recordSkillProjectionSafely(() =>
        skillExecutionRecording.recordEvent({
          workflowPlanId,
          eventType: 'skill.human_intervention',
          summary:
            status === 'awaiting_confirmation'
              ? 'Authoritative Workflow is awaiting confirmation.'
              : 'Authoritative Workflow is awaiting user input.',
          details: { workflowControlStatus: status },
        }),
      );
      return;
    }
    if (status === 'achieved') {
      await recordSkillControlOutcome(workflowPlanId, control);
      await recordSkillProjectionSafely(async () => {
        const projected = await skillExecutionRepository.findByPlan(workflowPlanId);
        if (projected?.status === 'degraded') return;
        await skillExecutionRecording.recordStatus({
          workflowPlanId,
          eventType: 'skill.execution_completed',
          status: 'completed',
          summary: 'Authoritative Workflow achieved the Goal.',
        });
      });
      return;
    }
    await recordSkillControlOutcome(workflowPlanId, control);
    await recordSkillProjectionSafely(() =>
      skillExecutionRecording.recordStatus({
        workflowPlanId,
        eventType: 'skill.execution_failed',
        status: status === 'canceled' ? 'cancelled' : 'failed',
        summary:
          status === 'canceled'
            ? 'Authoritative Workflow execution was cancelled.'
            : `Authoritative Workflow terminated with ${status}.`,
        details: { workflowControlStatus: status },
      }),
    );
  };
  const recordSkillControlOutcome = async (
    workflowPlanId: string,
    control: Awaited<ReturnType<typeof dependencies.workflowController.value.get>>,
  ): Promise<void> => {
    const referenceId = control.terminalOutcomeId ?? control.finalInstanceId;
    if (referenceId === undefined) return;
    await recordSkillProjectionSafely(() =>
      skillExecutionRecording.recordReference({
        workflowPlanId,
        kind: 'outcome',
        referenceId,
        referenceType:
          control.terminalOutcomeId === undefined
            ? 'workflow.instance.outcome'
            : 'runtime.terminal_outcome',
        sourceSystem: 'workflow_controller',
        producerRefs: control.finalInstanceId === undefined ? [] : [control.finalInstanceId],
        metadata: { workflowControlStatus: control.status, controlId: control.controlId },
      }),
    );
  };
  const temporarySkillOperations = {
    create: temporarySkills.create.bind(temporarySkills),
    listByTask: temporarySkills.listByTask.bind(temporarySkills),
    async complete(temporarySkillId: string, successful: boolean, outcomeSummary: string) {
      const completed = await temporarySkills.complete(
        temporarySkillId,
        successful,
        outcomeSummary,
      );
      if (completed.formalizationCandidate === undefined) return completed;
      return {
        ...completed,
        formalizationCandidate: await skillEvolution.get(
          completed.formalizationCandidate.candidateId,
        ),
      };
    },
  };
  const skillGoalSelectionRecords = new Map<string, string>();
  return {
    skillGoalSelectionRecords,
    temporarySkillResolver,
    remoteTaskContinuation,
    remoteTaskContinuationReconciler,
    temporarySkillOperations,
    skillEvolution,
  };
}
