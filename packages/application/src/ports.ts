import type {
  AgentTask,
  ConversationContext,
  Goal,
  McpServer,
  McpDependencyWarning,
  McpInvocation,
  McpTool,
  McpToolEnhancement,
  ModelInvocationRecord,
  ModelProviderConfiguration,
  ModelStage,
  PromptEffectSummary,
  PromptVersion,
  McpToolDependencyChange,
  MemoryItem,
  MemorySearchHit,
  MemoryStatusTransition,
  MemoryRetentionPolicy,
  Skill,
  SkillRelation,
  SkillPerformanceMetrics,
  SkillReplacementPlan,
  SkillSelectionRecord,
  SkillQualityObservation,
  SkillQualityWarning,
  SkillQualityWarningKind,
  SkillDraft,
  SkillCallWorkflowRecord,
  SkillVersion,
  SkillFormalizationCandidate,
  SkillEvolutionCorrectionExperience,
  EvolutionExperience,
  EvolutionPolicy,
  EvolutionTriggerRecord,
  TemporarySkill,
  TemporarySkillExperience,
  ToolReference,
  WorkflowPlanAttempt,
  WorkflowPlanRecord,
  WorkflowDefinition,
  WorkflowBudgetLimits,
  WorkflowBudgetTerminationReason,
  WorkflowBudgetUsage,
  WorkflowInstance,
  WorkflowTemplate,
  WorkflowTemplateOccurrence,
  WorkflowTemplateUse,
  WorkflowNodeEvent,
  WorkflowControlRecord,
  WorkflowControlRound,
  GoalEvaluationResult,
  GoalPatchRecord,
  GoalInferenceSource,
  GoalInputInferenceRecord,
  GoalTransitionRecord,
  GoalCancellationRecord,
  ProcessedResultRecord,
  TaskWaitPolicy,
  TaskQualityReport,
} from '../../domain/src/index.js';

export interface ConversationContextRepository {
  findById(contextId: string): Promise<ConversationContext | undefined>;
  save(context: ConversationContext): Promise<void>;
}

export interface GoalRepository {
  findById(goalId: string): Promise<Goal | undefined>;
  findActiveByContextId(contextId: string): Promise<Goal | undefined>;
  findLatestByContextId(contextId: string): Promise<Goal | undefined>;
  listByContextId(contextId: string): Promise<readonly Goal[]>;
  listTransitions(contextId: string): Promise<readonly GoalTransitionRecord[]>;
  save(goal: Goal, transition?: GoalTransitionRecord): Promise<void>;
}

export interface GoalPatchRepository {
  apply(
    record: Omit<GoalPatchRecord, 'invalidatedPlanIds' | 'invalidatedInstanceIds'>,
    triggeringTaskId?: string,
  ): Promise<GoalPatchRecord>;
  find(patchId: string): Promise<GoalPatchRecord | undefined>;
  listByGoal(goalId: string): Promise<readonly GoalPatchRecord[]>;
}

export interface GoalCancellationRepository {
  cancel(
    input: Omit<
      GoalCancellationRecord,
      'canceledTaskIds' | 'invalidatedPlanIds' | 'canceledInstanceIds'
    >,
  ): Promise<GoalCancellationRecord>;
  find(cancellationId: string): Promise<GoalCancellationRecord | undefined>;
  listByGoal(goalId: string): Promise<readonly GoalCancellationRecord[]>;
}

export interface ProcessedResultRepository {
  save(record: ProcessedResultRecord): Promise<void>;
  find(resultId: string): Promise<ProcessedResultRecord | undefined>;
  listByTask(taskId: string): Promise<readonly ProcessedResultRecord[]>;
}

export interface TaskQualityReportRepository {
  save(report: TaskQualityReport): Promise<void>;
  findByTask(taskId: string): Promise<TaskQualityReport | undefined>;
}

export interface MemoryRepository {
  save(
    item: MemoryItem,
    embedding: Readonly<{ providerId: string; vector: readonly number[] }>,
  ): Promise<void>;
  find(memoryId: string): Promise<MemoryItem | undefined>;
  search(
    query: Readonly<{ providerId: string; vector: readonly number[]; limit: number }>,
  ): Promise<readonly MemorySearchHit[]>;
  saveAndSupersede(
    replacement: MemoryItem,
    embedding: Readonly<{ providerId: string; vector: readonly number[] }>,
    transitions: readonly MemoryStatusTransition[],
  ): Promise<void>;
  invalidate(transition: MemoryStatusTransition): Promise<void>;
  listTransitions(memoryId: string): Promise<readonly MemoryStatusTransition[]>;
}

export interface MemoryRetentionPolicyRepository {
  get(): Promise<MemoryRetentionPolicy>;
  update(policy: MemoryRetentionPolicy): Promise<void>;
}

export interface GoalInputInferenceRepository {
  collect(
    contextId: string,
    excludeTaskId: string,
    limit: number,
  ): Promise<
    Readonly<{
      conversationHistory: readonly GoalInferenceSource[];
      existingData: readonly GoalInferenceSource[];
    }>
  >;
  save(record: GoalInputInferenceRecord): Promise<void>;
  listByTask(taskId: string): Promise<readonly GoalInputInferenceRecord[]>;
}

export interface RuntimeRecoveryRepository {
  failInterrupted(
    timestamp: string,
  ): Promise<Readonly<{ tasks: number; workflowInstances: number }>>;
}

export interface WorkflowControlRepository {
  find(controlId: string): Promise<WorkflowControlRecord | undefined>;
  save(control: WorkflowControlRecord): Promise<void>;
  saveRound(round: WorkflowControlRound): Promise<void>;
  listRounds(controlId: string): Promise<readonly WorkflowControlRound[]>;
}

export interface GoalEvaluator {
  evaluate(
    input: Readonly<{ goal: Goal; instance: WorkflowInstance }>,
  ): Promise<GoalEvaluationResult>;
}

export interface AgentTaskRepository {
  findById(taskId: string): Promise<AgentTask | undefined>;
  save(task: AgentTask): Promise<void>;
}

export interface TaskWaitPolicyRepository {
  get(): Promise<TaskWaitPolicy>;
  update(policy: TaskWaitPolicy): Promise<void>;
  expireWaiting(cutoff: string, timestamp: string): Promise<readonly AgentTask[]>;
}

export interface SkillDraftRepository {
  findById(draftId: string): Promise<SkillDraft | undefined>;
  listByContextId(contextId: string): Promise<readonly SkillDraft[]>;
  save(draft: SkillDraft): Promise<void>;
  markPublished(
    draftId: string,
    publication: Readonly<{
      skillId: string;
      version: number;
      publishedBy: string;
      publishedAt: string;
    }>,
  ): Promise<SkillDraft>;
}

export interface SkillRepository {
  find(skillId: string): Promise<Skill | undefined>;
  findCurrentVersion(skillId: string): Promise<SkillVersion | undefined>;
  findVersion(skillId: string, version: number): Promise<SkillVersion | undefined>;
  listVersions(skillId: string): Promise<readonly SkillVersion[]>;
  listEnabledVersions(): Promise<readonly SkillVersion[]>;
  listCurrentVersions(): Promise<readonly SkillVersion[]>;
  saveVersionAndSetCurrent(version: SkillVersion, timestamp: string): Promise<void>;
}

export interface SkillGraphRepository {
  listRelations(): Promise<readonly SkillRelation[]>;
  saveRelation(relation: SkillRelation): Promise<void>;
  deleteRelation(relationId: string): Promise<void>;
}

export interface SkillSelectionRepository {
  findMetrics(skillId: string): Promise<SkillPerformanceMetrics | undefined>;
  saveMetrics(skillId: string, metrics: SkillPerformanceMetrics, updatedAt: string): Promise<void>;
  saveSelection(record: SkillSelectionRecord): Promise<void>;
  findSelection(selectionId: string): Promise<SkillSelectionRecord | undefined>;
  saveReplacementPlan(plan: SkillReplacementPlan): Promise<void>;
}

export interface SkillQualityRepository {
  saveObservation(observation: SkillQualityObservation): Promise<void>;
  listRecentObservations(
    skillId: string,
    skillVersion: number,
    limit: number,
  ): Promise<readonly SkillQualityObservation[]>;
  findActiveWarning(
    skillId: string,
    skillVersion: number,
    kind: SkillQualityWarningKind,
  ): Promise<SkillQualityWarning | undefined>;
  saveWarning(warning: SkillQualityWarning): Promise<void>;
  listWarnings(skillId?: string): Promise<readonly SkillQualityWarning[]>;
}

export interface SkillSemanticRetriever {
  score(
    goalDescription: string,
    skills: readonly SkillVersion[],
  ): Promise<Readonly<Record<string, number>>>;
}

export interface TextEmbeddingProvider {
  embed(text: string): Promise<Readonly<{ providerId: string; vector: readonly number[] }>>;
}

export interface SkillEmbeddingRepository {
  upsert(
    input: Readonly<{
      skillId: string;
      skillVersion: number;
      providerId: string;
      searchableText: string;
      vector: readonly number[];
      updatedAt: string;
    }>,
  ): Promise<void>;
  cosineScores(
    input: Readonly<{
      skillIds: readonly string[];
      providerId: string;
      vector: readonly number[];
    }>,
  ): Promise<Readonly<Record<string, number>>>;
}

export interface SkillSelectionDecider {
  decide(
    input: Readonly<{
      goalDescription: string;
      candidates: SkillSelectionRecord['candidates'];
      mode: 'initial' | 'replacement';
      failedSkillId?: string;
    }>,
  ): Promise<Readonly<{ selectedSkillId: string; decisionSummary: string }>>;
}

export interface TemporarySkillRepository {
  find(temporarySkillId: string): Promise<TemporarySkill | undefined>;
  listByTask(taskId: string): Promise<readonly TemporarySkill[]>;
  save(skill: TemporarySkill): Promise<void>;
  expireAndSaveExperience(
    skill: TemporarySkill,
    experience: TemporarySkillExperience,
  ): Promise<void>;
  listSuccessfulExperiences(
    capabilityFingerprint: string,
  ): Promise<readonly TemporarySkillExperience[]>;
  findFormalizationCandidate(
    capabilityFingerprint: string,
  ): Promise<SkillFormalizationCandidate | undefined>;
  findFormalizationCandidateById(
    candidateId: string,
  ): Promise<SkillFormalizationCandidate | undefined>;
  saveFormalizationCandidate(candidate: SkillFormalizationCandidate): Promise<void>;
  saveCorrectionExperience(correction: SkillEvolutionCorrectionExperience): Promise<void>;
  listCorrectionExperiences(
    candidateId: string,
  ): Promise<readonly SkillEvolutionCorrectionExperience[]>;
}

export interface EvolutionExperienceRepository {
  save(experience: EvolutionExperience): Promise<void>;
  find(experienceId: string): Promise<EvolutionExperience | undefined>;
  listByGoal(goalId: string): Promise<readonly EvolutionExperience[]>;
  listBySkill(skillId: string): Promise<readonly EvolutionExperience[]>;
  listByTool(reference: ToolReference): Promise<readonly EvolutionExperience[]>;
}

export interface WorkflowTemplateRepository {
  saveOccurrence(occurrence: WorkflowTemplateOccurrence): Promise<void>;
  listOccurrences(
    goalKey: string,
    structureKey: string,
  ): Promise<readonly WorkflowTemplateOccurrence[]>;
  findPreferred(goalKey: string): Promise<WorkflowTemplate | undefined>;
  saveTemplate(template: WorkflowTemplate): Promise<void>;
  saveUse(use: WorkflowTemplateUse): Promise<void>;
  findPlannedUse(
    workflowDefinitionId: string,
    workflowVersion: number,
  ): Promise<WorkflowTemplateUse | undefined>;
  completeUse(use: WorkflowTemplateUse, template: WorkflowTemplate): Promise<void>;
  listTemplates(): Promise<readonly WorkflowTemplate[]>;
  listUses(templateId: string): Promise<readonly WorkflowTemplateUse[]>;
}

export interface EvolutionPolicyRepository {
  get(): Promise<EvolutionPolicy>;
  update(policy: EvolutionPolicy): Promise<void>;
  saveTrigger(trigger: EvolutionTriggerRecord): Promise<void>;
  listTriggers(capabilityFingerprint?: string): Promise<readonly EvolutionTriggerRecord[]>;
}

export interface McpToolCatalog {
  exists(reference: ToolReference): Promise<boolean>;
  getInputSchema(reference: ToolReference): Promise<unknown>;
}

export interface McpServerRecord {
  readonly server: McpServer;
  readonly encryptedCredential: string;
}

export interface McpRegistryRepository {
  findServer(serverId: string): Promise<McpServerRecord | undefined>;
  listServers(): Promise<readonly McpServer[]>;
  listTools(serverId: string): Promise<readonly McpTool[]>;
  saveServerAndReplaceTools(
    record: McpServerRecord,
    tools: readonly McpTool[],
    changes?: readonly McpToolDependencyChange[],
  ): Promise<void>;
  deleteServer(serverId: string): Promise<void>;
  saveInvocation(invocation: McpInvocation): Promise<void>;
  listInvocations(serverId: string): Promise<readonly McpInvocation[]>;
  listDependencyWarnings(serverId: string): Promise<readonly McpDependencyWarning[]>;
  updateToolEnhancement(
    serverId: string,
    toolName: string,
    enhancement: McpToolEnhancement,
  ): Promise<void>;
}

export interface SecretCipher {
  encrypt(secret: Readonly<Record<string, string>>): string;
  decrypt(encrypted: string): Readonly<Record<string, string>>;
}

export interface McpTransportAdapter {
  discover(
    input: Readonly<{ endpoint: string; headers: Readonly<Record<string, string>> }>,
  ): Promise<
    readonly Readonly<{
      name: string;
      title?: string;
      description?: string;
      inputSchema: unknown;
    }>[]
  >;
  call(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
      toolName: string;
      arguments: Readonly<Record<string, unknown>>;
      signal?: AbortSignal;
    }>,
  ): Promise<unknown>;
  disconnect(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void>;
  ping(
    input: Readonly<{
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ): Promise<void>;
}

/** Rebuildable protocol representation; AgentTask remains the system of record. */
export interface ExternalTaskProjection {
  readonly protocol: 'a2a-v1';
  readonly taskId: string;
  readonly contextId: string;
  readonly state: string;
  readonly statusTimestamp?: string;
  readonly document: unknown;
}

export interface ExternalTaskProjectionQuery {
  readonly protocol: ExternalTaskProjection['protocol'];
  readonly contextId?: string;
  readonly state?: string;
  readonly statusTimestampAfter?: string;
  readonly offset: number;
  readonly limit: number;
}

export interface ExternalTaskProjectionRepository {
  find(
    protocol: ExternalTaskProjection['protocol'],
    taskId: string,
  ): Promise<ExternalTaskProjection | undefined>;
  save(projection: ExternalTaskProjection): Promise<void>;
  list(
    query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>>;
}

export interface PublicSkillCapability {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export interface EnabledSkillCapabilityProvider {
  listEnabled(): Promise<readonly PublicSkillCapability[]>;
}

export interface JsonSchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface JsonSchemaValidator {
  checkSchema(schema: unknown): JsonSchemaValidationResult;
  validate(schema: unknown, value: unknown): JsonSchemaValidationResult;
}

export interface StructuredModelProvider {
  generateStructured(
    input: Readonly<{
      stage: ModelStage;
      instruction: string;
      responseSchema: unknown;
      correctionErrors: readonly string[];
    }>,
  ): Promise<unknown>;
}

export interface WorkflowPlanRepository {
  findPlan(planId: string): Promise<WorkflowPlanRecord | undefined>;
  findConfirmedDefinition(
    workflowDefinitionId: string,
    workflowVersion: number,
  ): Promise<WorkflowPlanRecord | undefined>;
  confirmPlan(planId: string): Promise<void>;
  saveAttempt(attempt: WorkflowPlanAttempt): Promise<void>;
  savePlan(plan: WorkflowPlanRecord): Promise<void>;
  savePlanAndSupersede(plan: WorkflowPlanRecord, sourcePlanId: string): Promise<void>;
}

export interface WorkflowExecutionRepository {
  findInstance(instanceId: string): Promise<WorkflowInstance | undefined>;
  findActiveByPlanId(planId: string): Promise<WorkflowInstance | undefined>;
  listActiveByGoalId(goalId: string): Promise<readonly WorkflowInstance[]>;
  countNodeEvents(instanceId: string): Promise<number>;
  saveInstance(instance: WorkflowInstance): Promise<void>;
  saveNodeEvents(events: readonly WorkflowNodeEvent[]): Promise<void>;
}

export interface SkillCallWorkflowRepository {
  save(record: SkillCallWorkflowRecord): Promise<void>;
  find(
    parentInstanceId: string,
    parentNodeId: string,
  ): Promise<SkillCallWorkflowRecord | undefined>;
  listByParent(parentInstanceId: string): Promise<readonly SkillCallWorkflowRecord[]>;
}

export interface WorkflowExecutor {
  execute(
    definition: WorkflowDefinition,
    input: unknown,
    budgetLimits: WorkflowBudgetLimits,
    signal?: AbortSignal,
    executionId?: string,
  ): Promise<
    Readonly<{
      status: 'paused' | 'succeeded' | 'failed' | 'canceled';
      result?: unknown;
      errors: Readonly<Record<string, Readonly<{ code: string; message: string }>>>;
      budgetUsage: WorkflowBudgetUsage;
      terminationReason?: WorkflowBudgetTerminationReason;
      events: readonly Readonly<{
        nodeId: string;
        type: 'node_started' | 'node_succeeded' | 'node_failed';
        timestamp: string;
        summary: string;
      }>[];
      pendingConfirmation?: WorkflowInstance['pendingConfirmation'];
    }>
  >;
  resumeHumanConfirmation?(
    executionId: string,
    confirmed: boolean,
    signal?: AbortSignal,
  ): ReturnType<WorkflowExecutor['execute']>;
  requestPause?(executionId: string): boolean;
  requestCancel?(executionId: string, interruptCurrent: boolean): boolean;
}

export interface ModelProviderRecord {
  readonly configuration: ModelProviderConfiguration;
  readonly encryptedCredential: string;
}

export interface ModelRuntimeRepository {
  findProvider(providerId: string): Promise<ModelProviderRecord | undefined>;
  findProviderForStage(stage: ModelStage): Promise<ModelProviderRecord | undefined>;
  saveProvider(record: ModelProviderRecord): Promise<void>;
  saveStageRoute(stage: ModelStage, providerId: string, updatedAt: string): Promise<void>;
  saveInvocation(invocation: ModelInvocationRecord): Promise<void>;
  listInvocations(stage?: ModelStage): Promise<readonly ModelInvocationRecord[]>;
  findActivePromptForStage(stage: ModelStage): Promise<PromptVersion | undefined>;
}

export interface PromptRepository {
  findCurrent(stage: ModelStage): Promise<PromptVersion | undefined>;
  findVersion(promptId: string, version: number): Promise<PromptVersion | undefined>;
  listVersions(promptId: string): Promise<readonly PromptVersion[]>;
  saveVersion(version: PromptVersion, setCurrent: boolean): Promise<void>;
  effect(promptId: string, version: number): Promise<PromptEffectSummary>;
}

export interface ModelTransportAdapter {
  generateStructured(
    input: Readonly<{
      configuration: ModelProviderConfiguration;
      credentialHeaders: Readonly<Record<string, string>>;
      instruction: string;
      responseSchema: unknown;
      correctionErrors: readonly string[];
      signal: AbortSignal;
    }>,
  ): Promise<
    Readonly<{
      rawResponse: unknown;
      structuredResult: unknown;
      inputTokens?: number;
      outputTokens?: number;
    }>
  >;
  embed(
    input: Readonly<{
      configuration: ModelProviderConfiguration;
      credentialHeaders: Readonly<Record<string, string>>;
      text: string;
      signal: AbortSignal;
    }>,
  ): Promise<
    Readonly<{
      rawResponse: unknown;
      vector: readonly number[];
      inputTokens?: number;
    }>
  >;
}

export interface ContextTaskQueue {
  enqueue(input: Readonly<{ taskId: string; contextId: string }>): Promise<void>;
}

export interface RuntimeEventPublisher {
  publish(event: RuntimeTaskEvent): Promise<void>;
}

export interface RuntimeTaskEvent {
  readonly eventId: string;
  readonly taskId: string;
  readonly contextId: string;
  readonly eventType: 'task.created' | 'task.phase_changed';
  readonly timestamp: string;
  readonly summary: string;
}

export interface Clock {
  now(): string;
  nowMilliseconds?(): number;
}

export interface IdentifierGenerator {
  nextId(kind: 'context' | 'task' | 'event'): string;
}
