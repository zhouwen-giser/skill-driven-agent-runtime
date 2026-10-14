import { randomUUID } from 'node:crypto';
import { createAreaReportInitialAdmission } from '../area-report-initial-admission.js';
import type { QueryResult as CompositionQueryResult, Pool } from 'pg';
import type {
  CapabilitySummaryService,
  ArtifactFeatureFlags as CompositionArtifactFeatureFlags,
  InteractiveGoalSessionService,
  ModelRuntimeService,
  PlanningKnowledgeRetriever,
  RuntimeTaskCapabilityService,
  SkillInputResolutionService,
  TaskService,
  WorkflowExecutionService,
  WorkflowPlannerService,
} from '../../../../packages/application/src/index.js';
import {
  BasePlannerFallbackPolicy,
  ConfirmedPlanHandoff,
  ExperienceEnrichedUserGoalPlanningService,
  FastGatewayService,
  FeatureRolloutPolicy,
  GoalCancellationService,
  GoalPatchService,
  GoalService,
  HomeLabReadOnlyUserGoalPlanCandidateGuard,
  InteractiveActionRouter,
  InteractivePlanPatchService,
  InteractivePlanningSessionService,
  P02GatewayArtifactFeedbackAdapter,
  PlanningExperienceContextBuilder,
  TaskCapabilityUserGoalPlanAuthorityResolver,
  TemplateRuntimeService,
  UserGoalPlanCandidateValidator,
  UserGoalPlanController,
  UserGoalPlanningService,
  UserGoalRecoveryService,
  type CognitiveStructuredModelStageInvoker,
  type GatewayArtifactAdapterRegistry,
  type PlanningCorrectionObserver,
} from '../../../../packages/application/src/index.js';
import {
  DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
  type AgentTask,
} from '../../../../packages/domain/src/index.js';
import type {
  PostgresAgentTaskCommandContext,
  PostgresConversationContextRepository,
  PostgresFastGatewayRepository,
  PostgresGoalRepository,
  PostgresInteractivePlanningRepository,
  PostgresRuntimeTerminalOutcomeRepository,
  PostgresSkillRepository,
  PostgresTaskInputRepository,
  PostgresWorkflowExecutionRepository,
  PostgresWorkflowPlanRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  PostgresArtifactExecutionRepository,
  PostgresArtifactRepository,
  PostgresGoalCancellationRepository,
  PostgresGoalPatchRepository,
  PostgresGoalVersionLock,
  PostgresRuleUsageRepository,
  PostgresUserGoalRuntimeRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  UgvAgentProfileInitialAdmission,
  UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver,
  UgvAgentProfileUserGoalPlanCandidateGuard,
} from '.././ugv-agent-profile-admission.js';
import type { UgvAgentProfileSkillRepositoryView } from '.././ugv-agent-profile.js';
import { UGV_AGENT_PROFILE_CAPABILITY_ID } from '.././ugv-agent-profile.js';
import type { ServerRuntimeOptions } from './contracts.js';
import type { RuntimeCleanupScope } from './runtime-cleanup-scope.js';
import type { RuntimeValueRef } from './runtime-value-ref.js';
export interface composeCognitiveDependencies {
  readonly cleanupScope: RuntimeCleanupScope;
  options: ServerRuntimeOptions;
  readonly goals: PostgresGoalRepository;
  readonly contexts: PostgresConversationContextRepository;
  readonly clock: { now: () => string };
  readonly pool: Pool;
  readonly deviceWorkScope:
    { allowedDeviceIds: string[]; sdarServiceKey: string; includeNonDevice: boolean } | undefined;
  readonly ugvAgentProfile: boolean;
  readonly taskCapabilities: RuntimeTaskCapabilityService;
  readonly profileSkills: UgvAgentProfileSkillRepositoryView | PostgresSkillRepository;
  readonly skills: PostgresSkillRepository;
  readonly publishTaskState: (task: AgentTask) => void;
  readonly taskCommands: PostgresAgentTaskCommandContext;
  readonly runtimeTerminalOutcomes: PostgresRuntimeTerminalOutcomeRepository;
  readonly modelRuntime: ModelRuntimeService;
  readonly managedCapabilityProfile: boolean;
  readonly homeLabGovernedLightProfile: boolean;
  readonly homeLabReadOnlyProfile: boolean;
  readonly planningKnowledge: PlanningKnowledgeRetriever;
  readonly capabilitySummaries: CapabilitySummaryService;
  readonly interactivePlanningSessions: RuntimeValueRef<InteractivePlanningSessionService>;
  readonly interactivePlanningRepository: PostgresInteractivePlanningRepository;
  readonly cognitiveModel: CognitiveStructuredModelStageInvoker;
  readonly planningCorrectionObserver: PlanningCorrectionObserver;
  readonly interactiveGoalSessions: InteractiveGoalSessionService;
  readonly artifactAuthorityReady: CompositionQueryResult<{ installed: boolean }>;
  readonly artifactFlags: CompositionArtifactFeatureFlags;
  readonly fastGatewayRepository: PostgresFastGatewayRepository;
  readonly workflowInstances: PostgresWorkflowExecutionRepository;
  readonly workflowExecution: WorkflowExecutionService;
  readonly workflowPlans: PostgresWorkflowPlanRepository;
  readonly workflowPlanner: WorkflowPlannerService;
  readonly service: RuntimeValueRef<TaskService>;
  readonly skillInputResolution: SkillInputResolutionService;
  readonly taskInputs: PostgresTaskInputRepository;
}
export function composeCognitive(dependencies: composeCognitiveDependencies) {
  const {
    options,
    goals,
    contexts,
    clock,
    pool,
    deviceWorkScope,
    ugvAgentProfile,
    taskCapabilities,
    profileSkills,
    skills,
    publishTaskState,
    taskCommands,
    runtimeTerminalOutcomes,
    modelRuntime,
    managedCapabilityProfile,
    homeLabGovernedLightProfile,
    homeLabReadOnlyProfile,
    planningKnowledge,
    capabilitySummaries,
    interactivePlanningRepository,
    cognitiveModel,
    planningCorrectionObserver,
    interactiveGoalSessions,
    artifactAuthorityReady,
    artifactFlags,
    fastGatewayRepository,
    workflowInstances,
    workflowExecution,
    workflowPlans,
    workflowPlanner,
    skillInputResolution,
    taskInputs,
  } = dependencies;
  const goalService = new GoalService({ goals, contexts, clock });
  const userGoalRuntimeRepository = new PostgresUserGoalRuntimeRepository(pool, deviceWorkScope);
  const ugvUserGoalPlanAuthority = ugvAgentProfile
    ? new UgvAgentProfileTaskCapabilityUserGoalPlanAuthorityResolver({
        bindings: taskCapabilities,
        skills: profileSkills,
      })
    : undefined;
  const genericTaskCapabilityGoalAuthority = new TaskCapabilityUserGoalPlanAuthorityResolver({
    bindings: taskCapabilities,
    skills,
  });
  const profileUserGoalPlanAuthority =
    !ugvAgentProfile || ugvUserGoalPlanAuthority === undefined
      ? ugvUserGoalPlanAuthority
      : {
          async resolve(taskId: string) {
            const binding = await taskCapabilities.findBinding(taskId);
            return binding?.requestedCapabilityId === UGV_AGENT_PROFILE_CAPABILITY_ID
              ? ugvUserGoalPlanAuthority.resolve(taskId)
              : genericTaskCapabilityGoalAuthority.resolve(taskId);
          },
        };
  const ugvUserGoalPlanGuard = ugvAgentProfile
    ? new UgvAgentProfileUserGoalPlanCandidateGuard()
    : undefined;
  const goalCancellationRepository = new PostgresGoalCancellationRepository(
    pool,
    publishTaskState,
    taskCommands,
  );
  const userGoalPlanController = new UserGoalPlanController({
    terminal: runtimeTerminalOutcomes,
    outcomes: userGoalRuntimeRepository,
    goalCancellations: goalCancellationRepository,
  });
  const userGoalPlanning = new UserGoalPlanningService({
    model: modelRuntime,
    repository: userGoalRuntimeRepository,
    now: () => clock.now(),
    nextPlanId: () => `user-goal-plan-${randomUUID()}`,
    ...(profileUserGoalPlanAuthority !== undefined
      ? { candidateAuthority: profileUserGoalPlanAuthority }
      : managedCapabilityProfile || homeLabGovernedLightProfile
        ? {
            candidateAuthority: new TaskCapabilityUserGoalPlanAuthorityResolver({
              bindings: taskCapabilities,
              skills,
            }),
          }
        : {}),
    ...(homeLabReadOnlyProfile
      ? { candidateGuard: new HomeLabReadOnlyUserGoalPlanCandidateGuard() }
      : ugvUserGoalPlanGuard === undefined
        ? {}
        : {
            candidateGuard: {
              assert(plan, contract) {
                if (plan.skillGoals[0]?.capabilityNeeds.includes(UGV_AGENT_PROFILE_CAPABILITY_ID))
                  ugvUserGoalPlanGuard.assert(plan, contract);
              },
            },
          }),
  });
  const ugvInitialAdmission =
    ugvUserGoalPlanAuthority === undefined || ugvUserGoalPlanGuard === undefined
      ? undefined
      : new UgvAgentProfileInitialAdmission({
          bindings: taskCapabilities,
          authority: ugvUserGoalPlanAuthority,
          goals: goalService,
          planning: userGoalPlanning.commits,
          plans: userGoalRuntimeRepository,
          guard: ugvUserGoalPlanGuard,
          clock,
        });
  const areaReportInitialAdmission = ugvAgentProfile
    ? createAreaReportInitialAdmission({
        capabilities: taskCapabilities,
        goals: goalService,
        authority: genericTaskCapabilityGoalAuthority,
        planning: userGoalPlanning,
        plans: userGoalRuntimeRepository,
        clock,
      })
    : undefined;
  const experiencePlanning = new ExperienceEnrichedUserGoalPlanningService({
    base: userGoalPlanning.candidates,
    contexts: new PlanningExperienceContextBuilder(planningKnowledge, {
      async getCatalogHash() {
        const active = await capabilitySummaries.getSummary();
        if (active === undefined) throw new Error('EXPERIENCE_PLANNING_CATALOG_UNAVAILABLE');
        return active.summary.catalogHash;
      },
    }),
    fallback: new BasePlannerFallbackPolicy(),
  });
  const configuredInjectionMode =
    options.cognitiveInjectionMode ?? DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS.injectionMode;
  const effectiveInjectionMode = new FeatureRolloutPolicy().evaluate({
    stage: 'shadow',
    flags: {
      ...DEFAULT_COGNITIVE_RUNTIME_FEATURE_FLAGS,
      injectionMode: configuredInjectionMode,
    },
  }).effectiveInjectionMode;
  {
    const planCandidateValidator = new UserGoalPlanCandidateValidator({
      ...(homeLabReadOnlyProfile
        ? { externalGuard: new HomeLabReadOnlyUserGoalPlanCandidateGuard() }
        : {}),
    });
    dependencies.interactivePlanningSessions.value = new InteractivePlanningSessionService({
      repository: interactivePlanningRepository,
      planner: userGoalPlanning.candidates,
      experiencePlanner: experiencePlanning,
      experienceUsage: interactivePlanningRepository,
      injectionMode: effectiveInjectionMode,
      patches: new InteractivePlanPatchService({
        model: cognitiveModel,
        validator: planCandidateValidator,
        clock,
        nextCandidateId: () => `plan-candidate-${randomUUID()}`,
        nextPlanId: () => `user-goal-plan-${randomUUID()}`,
      }),
      validator: planCandidateValidator,
      handoff: new ConfirmedPlanHandoff({
        lock: new PostgresGoalVersionLock(pool),
        planner: userGoalPlanning.commits,
      }),
      goals: goalService,
      clock,
      ids: {
        nextSessionId: () => `planning-session-${randomUUID()}`,
        nextTurnId: () => `planning-turn-${randomUUID()}`,
        nextCandidateId: () => `plan-candidate-${randomUUID()}`,
      },
      maxRevisions: 4,
      maxElapsedMs: 900000,
      defaultConfirmationPolicy: 'manual_all',
      interactions: planningCorrectionObserver,
    });
  }
  const interactiveActions = new InteractiveActionRouter({
    goalSessions: interactiveGoalSessions,
    planningSessions: dependencies.interactivePlanningSessions.value,
  });
  const templateRuntime =
    artifactAuthorityReady.rows[0]?.installed === true &&
    artifactFlags.retrievalEnabled &&
    artifactFlags.templateEnabled &&
    options.templateRuntimeStateReader !== undefined
      ? new TemplateRuntimeService({
          artifacts: new PostgresArtifactRepository(pool),
          executions: new PostgresArtifactExecutionRepository(pool, deviceWorkScope),
          states: options.templateRuntimeStateReader,
          planning: dependencies.interactivePlanningSessions.value,
          clock,
        })
      : undefined;
  const fastGatewayAdapters: GatewayArtifactAdapterRegistry | undefined =
    options.fastGateway?.adapters !== undefined &&
    (artifactFlags.caseEnabled ||
      (artifactFlags.modelCascadeEnabled && artifactFlags.modelRouteEnabled))
      ? {
          find(artifactType) {
            if (artifactType === 'case_template' && !artifactFlags.caseEnabled) {
              return undefined;
            }
            if (
              artifactType === 'model_route' &&
              (!artifactFlags.modelCascadeEnabled || !artifactFlags.modelRouteEnabled)
            ) {
              return undefined;
            }
            return options.fastGateway?.adapters?.find(artifactType);
          },
        }
      : undefined;
  const fastGateway =
    artifactAuthorityReady.rows[0]?.installed === true &&
    artifactFlags.artifactMode === 'active' &&
    artifactFlags.retrievalEnabled &&
    artifactFlags.fastGatewayEnabled &&
    options.fastGateway !== undefined
      ? new FastGatewayService({
          precheck: options.fastGateway.precheck,
          retrieval: options.fastGateway.retrieval,
          rule: options.fastGateway.rule,
          template: options.fastGateway.template,
          fallback: options.fastGateway.fallback,
          cancellation: options.fastGateway.cancellation,
          persistence: fastGatewayRepository,
          drift: options.fastGateway.drift,
          artifactFeedback: new P02GatewayArtifactFeedbackAdapter(
            new PostgresRuleUsageRepository(pool),
          ),
          ...(fastGatewayAdapters === undefined ? {} : { adapters: fastGatewayAdapters }),
          clock: {
            now: () => clock.now(),
            nowMs: () => Date.parse(clock.now()),
          },
          ids: {
            nextGatewayDecisionId: () => `gateway-decision-${randomUUID()}`,
          },
          ...(options.fastGateway.options === undefined
            ? {}
            : { options: options.fastGateway.options }),
        })
      : undefined;
  const fastGatewayContexts = options.fastGateway?.contexts;
  const userGoalRecovery = new UserGoalRecoveryService({
    repository: userGoalRuntimeRepository,
    ids: {
      nextProgressObservationId: () => `progress-observation-${randomUUID()}`,
      nextRecoveryDecisionId: () => `recovery-decision-${randomUUID()}`,
    },
    now: () => clock.now(),
  });
  const goalCancellations = new GoalCancellationService({
    goals,
    instances: workflowInstances,
    execution: workflowExecution,
    repository: goalCancellationRepository,
    terminalAuthority: userGoalPlanController,
    clock,
    nextId: () => `goal-cancellation-${randomUUID()}`,
  });
  const goalPatches = new GoalPatchService({
    goals,
    patches: new PostgresGoalPatchRepository(pool, publishTaskState, taskCommands),
    plans: workflowPlans,
    planner: workflowPlanner,
    skills,
    model: modelRuntime,
    clock,
    ids: {
      nextPatchId: () => `goal-patch-${randomUUID()}`,
      nextPlanId: () => `plan-goal-patch-${randomUUID()}`,
    },
    userGoalPlanning,
    userGoalPlans: userGoalRuntimeRepository,
    beforeReplan: {
      async prepare({ goal, taskId }) {
        const task = await dependencies.service.value.get(taskId);
        if (task.selectedSkillId === undefined || task.selectedSkillVersion === undefined)
          return { status: 'ready' } as const;
        const skill = await skills.findVersion(task.selectedSkillId, task.selectedSkillVersion);
        if (skill?.status !== 'enabled') throw new Error('SELECTED_SKILL_NOT_EXECUTABLE');
        const resolution = await skillInputResolution.resolve({
          task: { ...task, goalId: goal.goalId, goalVersion: goal.version },
          goal,
          skill,
          supplementaryInputs: await taskInputs.listResponses(taskId),
        });
        if (resolution.status === 'input_required') return { status: 'input_required' } as const;
        if (resolution.status !== 'resolved') throw new Error('TASK_SKILL_INPUT_NOT_RESOLVED');
        return {
          status: 'ready',
          planningContext: {
            resolutionId: resolution.resolutionId,
            structuredInput: resolution.structuredInput,
            sourceRefs: resolution.sourceRefs,
          },
        } as const;
      },
    },
  });
  return {
    goalPatches,
    userGoalPlanController,
    goalCancellations,
    userGoalRecovery,
    goalService,
    userGoalPlanning,
    ugvInitialAdmission,
    areaReportInitialAdmission,
    userGoalRuntimeRepository,
    interactiveActions,
    fastGateway,
    fastGatewayContexts,
    templateRuntime,
  };
}
