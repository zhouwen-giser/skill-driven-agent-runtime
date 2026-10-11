import { type A2AHttpEndpointHandle } from '../../../../packages/a2a-adapter/src/http-endpoint.js';
import type {
  ArtifactRegistryService,
  ArtifactShadowApplicationService,
  FastGatewayService,
  FrozenMcpRegistryService,
  McpRegistryService,
  PlanningKnowledgeRetriever,
  ProviderSubscriptionCoordinator,
  TemplateRuntimeService,
} from '../../../../packages/application/src/index.js';
import {
  type ArtifactShadowCurrentStateReader,
  type ArtifactShadowEnrollment,
  type CognitiveStructuredModelStageInvoker,
  type FastGatewayOptions,
  type GatewayArtifactAdapterRegistry,
  type GatewayCancellationPort,
  type GatewayDriftSignalPort,
  type GatewayFallbackPort,
  type GatewayPrecheckPort,
  type GatewayRetrievalPort,
  type GatewayRulePort,
  type GatewayTemplatePort,
  type GovernedControlPrincipalResolver,
  type InitialModelProviderConfiguration,
  type ManagementPrincipalResolver,
  type OperatorIdentityPort,
  type RegisterSkillVersionInput,
  type RemoteTaskPollingOptions,
  type SkillSelectionDecider,
  type SkillUsageSlotChoice,
  type StructuredModelProvider,
  type TaskTypeDefinition,
  type TemplateRuntimeStateReader,
  type TextEmbeddingProvider,
} from '../../../../packages/application/src/index.js';
import {
  type AgentTask,
  type CognitiveInjectionMode,
  type GoalExecutionContract,
  type RuntimeRequestContext,
  type SkillUsageSelectionContext,
  type SkillVersion,
  type WorkflowBudgetLimits,
} from '../../../../packages/domain/src/index.js';
import { type WorkflowCallCosts } from '../../../../packages/langgraph-runtime/src/index.js';
import { type ManagementHttpEndpointHandle } from '../../../../packages/management-api/src/index.js';
import type {
  PostgresFastGatewayRepository,
  PostgresSkillCallWorkflowRepository,
  PostgresSkillDraftRepository,
  PostgresTaskBusinessRepository,
  PostgresWorkflowExecutionRepository,
} from '../../../../packages/persistence-postgres/src/index.js';
import {
  type CapabilityAuthorityReader,
  type CurrentMcpProviderBindingAuthorityReader,
} from '../../../../packages/runtime-control-application/src/index.js';
import { type RedisConnectionConfig } from '../../../../packages/runtime-redis/src/index.js';
import type { GowmSharedStorageConfiguration } from '.././gowm-storage-configuration.js';
import { type UgvMovePositionPolicy } from '.././ugv-move-position-result.js';

export interface ServerRuntimeOptions {
  readonly gowmStorage?: GowmSharedStorageConfiguration;
  readonly disableDeviceWeapons?: boolean;
  readonly developmentPreauthorizationActorId?: string;
  readonly postgresUrl: string;
  readonly redis: RedisConnectionConfig;
  readonly masterKeyBase64: string;
  /** Optional startup-only seed; persisted Provider/Prompt/route rows remain authoritative. */
  readonly modelBootstrap?: InitialModelProviderConfiguration;
  readonly evidenceEnvironment?: string;
  readonly ugvAgentProfileSkillScope?: 'all_enabled' | 'profile_reviewed';
  readonly evidenceObservationScope?: Readonly<{ tenantId: string; projectId: string }>;
  /** Required frozen thresholds for the external-simulation UGV final-position hard gate. */
  readonly ugvMovePositionPolicy?: UgvMovePositionPolicy;
  /** Authenticated full-state reader for Control-owned Capability definitions and bindings. */
  readonly capabilityAuthorityReader?: CapabilityAuthorityReader;
  /** Authenticated current-state authority for Node Control-owned MCP Provider Bindings. */
  readonly currentMcpProviderBindingAuthorityReader?: CurrentMcpProviderBindingAuthorityReader;
  readonly queueName?: string;
  readonly applyMigrations?: boolean;
  readonly a2aHost?: string;
  readonly a2aPublicBaseUrl?: string;
  readonly a2aPort?: number;
  readonly managementHost?: string;
  readonly managementPort?: number;
  /** Bearer token for the frozen Node Control -> Runtime governance adapter. */
  readonly runtimeControlServiceToken?: string;
  /** Maps the Runtime service credential to the existing Artifact management identity. */
  readonly runtimeControlArtifactPrincipalResolver?: ManagementPrincipalResolver;
  /** Optional non-breaking bearer guard for cognitive management writes only. */
  readonly cognitiveManagementBearerToken?: string;
  /** Required for P06 human approval/activation; production deployments must supply a provider-backed port. */
  readonly artifactOperatorIdentity?: OperatorIdentityPort;
  /** Required to expose P12 management endpoints; identity is never read from request JSON. */
  readonly artifactManagementPrincipalResolver?: ManagementPrincipalResolver;
  /** Trusted-human Bearer identity for issue/revoke of physical-control confirmations. */
  readonly governedControlPrincipalResolver?: GovernedControlPrincipalResolver;
  /** Required to execute P06 shadow work; missing current facts fail closed as stale. */
  readonly artifactShadowStateReader?: ArtifactShadowCurrentStateReader;
  /**
   * Deployment-owned P08 current-fact reader. The template runtime has no
   * public endpoint and remains unavailable until this reader is supplied.
   */
  readonly templateRuntimeStateReader?: TemplateRuntimeStateReader;
  /**
   * Deployment-owned P10 adapters. PostgreSQL Gateway persistence and
   * idempotency are composed here; trusted auth/policy/current-state facts and
   * the existing P07/P09/P08 adapters remain explicit ports.
   */
  readonly fastGateway?: Readonly<{
    contexts: Readonly<{
      create(
        input: Readonly<{ task: AgentTask; requestText: string }>,
      ): Promise<RuntimeRequestContext>;
    }>;
    precheck: GatewayPrecheckPort;
    retrieval: GatewayRetrievalPort;
    rule: GatewayRulePort;
    template: GatewayTemplatePort;
    fallback: GatewayFallbackPort;
    cancellation: GatewayCancellationPort;
    drift: GatewayDriftSignalPort;
    /** P11 type-keyed adapters; ignored unless their feature flags are enabled. */
    adapters?: GatewayArtifactAdapterRegistry;
    options?: Partial<FastGatewayOptions>;
  }>;
  readonly skillAuthoringModel?: StructuredModelProvider;
  readonly skillSelection?: Readonly<{
    embeddings: TextEmbeddingProvider;
    decider?: SkillSelectionDecider;
  }>;
  /** Supplies trusted, deployment-owned context observations and mode policy to Usage-aware selection. */
  readonly skillUsageContext?: Readonly<{
    resolve(
      input: Readonly<{
        goalContract: GoalExecutionContract;
        task?: AgentTask;
      }>,
    ): SkillUsageSelectionContext | Promise<SkillUsageSelectionContext>;
  }>;
  /** Supplies an exact deployment/model decision for declared capability slots; empty is fail-closed. */
  readonly skillUsageComposition?: Readonly<{
    resolveSlotChoices(
      input: Readonly<{
        goalContract: GoalExecutionContract;
        skill: SkillVersion;
        value: unknown;
        task?: AgentTask;
      }>,
    ): readonly SkillUsageSlotChoice[] | Promise<readonly SkillUsageSlotChoice[]>;
  }>;
  readonly capabilityNarrative?: CognitiveStructuredModelStageInvoker;
  readonly taskUnderstanding?: Readonly<{
    readonly profile?:
      | 'home_lab_read_only'
      | 'home_lab_governed_light_control'
      | 'managed_capability'
      | 'ugv-agent-profile';
    readonly taskTypes: readonly TaskTypeDefinition[];
    readonly entryPolicy?: 'ambiguous_only' | 'all_requests';
    readonly skillSelectionMode?: 'exact_compatible_only' | 'model_ranked';
    readonly lowRiskUserPreferences?: readonly string[];
    readonly modelTimeoutMs?: number;
    readonly interactiveGoalBudgets?: Readonly<{
      maxClarificationRounds: number;
      maxContractRevisions: number;
      maxElapsedMs: number;
    }>;
  }>;
  /** Controls governed planning-knowledge injection; the frozen V1.2.3 default is shadow. */
  readonly cognitiveInjectionMode?: CognitiveInjectionMode;
  readonly workflowBudgetDefaults?: WorkflowBudgetLimits;
  readonly workflowCallCosts?: WorkflowCallCosts;
  readonly taskWaitSweepIntervalMs?: number;
  readonly taskAttemptDispatchIntervalMs?: number;
  readonly frozenMcpTasks?: Readonly<{
    /** Explicit opt-in for the additive V1.1 migration/runtime profile. */
    isolationAcknowledged: true;
    queueName?: string;
    reconcileIntervalMs?: number;
    polling?: RemoteTaskPollingOptions;
  }>;
  readonly businessEvents?: Readonly<{
    readonly enabled: true;
    readonly requiredForRuntimeReady?: boolean;
    readonly reconnectDelayMs?: number;
    readonly processingIntervalMs?: number;
    readonly maxSubscriptions?: number;
  }>;
  readonly outboundEndpointPolicy?: Readonly<{
    readonly unsafeTestOpen: boolean;
    readonly mcpAllowedAuthorities: readonly string[];
    readonly providerAllowedAuthorities: readonly string[];
  }>;
  /** Compatibility policy for MCP servers that treat an absent mode header as live. */
  readonly mcpExecutionModeHeaderPolicy?: 'emit' | 'omit_live';
  readonly a2aWaitTimeoutMs?: number;
  readonly a2aSafetyPollIntervalMs?: number;
  readonly a2aTerminalReconciliationIntervalMs?: number;
}

export interface ServerRuntimeHandle {
  readonly a2a: A2AHttpEndpointHandle;
  readonly management: ManagementHttpEndpointHandle;
  readonly planningKnowledge: PlanningKnowledgeRetriever;
  /** Present once the P02 migration is installed; rebuilt from PostgreSQL during startup. */
  readonly artifactRegistry?: ArtifactRegistryService;
  /** Internal P08 composition root; it accepts only already selected P07 facts. */
  readonly templateRuntime?: TemplateRuntimeService;
  /** Present only when P10 is explicitly enabled and all deployment ports exist. */
  readonly fastGateway?: FastGatewayService;
  gatewayEvidence(taskId: string): ReturnType<PostgresFastGatewayRepository['findByTaskId']>;
  taskBusiness(taskId: string): ReturnType<PostgresTaskBusinessRepository['listByTask']>;
  taskBusinessContent(
    bindingId: string,
    digest: string,
  ): ReturnType<PostgresTaskBusinessRepository['readContent']>;
  /** Explicit formal-runtime sidecar hook; it never selects/retrieves an Artifact. */
  enrollArtifactShadow(
    input: ArtifactShadowEnrollment,
  ): ReturnType<ArtifactShadowApplicationService['enroll']>;
  requestInput(taskId: string, reason: string): Promise<void>;
  listSkillDrafts(contextId: string): ReturnType<PostgresSkillDraftRepository['listByContextId']>;
  registerSkill(input: RegisterSkillVersionInput): Promise<SkillVersion>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<SkillVersion>;
  failTask(taskId: string, errorCode: string, message: string): Promise<void>;
  recordResultForSkill(
    taskId: string,
    skillId: string,
    candidate: Readonly<{ text: string; structured: unknown }>,
  ): Promise<void>;
  registerMcpServer(
    input: Parameters<FrozenMcpRegistryService['register']>[0],
  ): ReturnType<FrozenMcpRegistryService['register']>;
  refreshMcpServer(serverId: string): ReturnType<FrozenMcpRegistryService['refresh']>;
  callMcpTool(
    serverId: string,
    toolName: string,
    arguments_: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    context?: Parameters<McpRegistryService['call']>[4],
  ): Promise<unknown>;
  deleteMcpServer(serverId: string): Promise<void>;
  listMcpInvocations(serverId: string): ReturnType<McpRegistryService['listInvocations']>;
  listSkillCallWorkflows(
    parentInstanceId: string,
  ): ReturnType<PostgresSkillCallWorkflowRepository['listByParent']>;
  getWorkflowInstance(
    instanceId: string,
  ): ReturnType<PostgresWorkflowExecutionRepository['findInstance']>;
  listMcpDependencyWarnings(
    serverId: string,
  ): ReturnType<McpRegistryService['listDependencyWarnings']>;
  updateMcpToolEnhancement(
    serverId: string,
    toolName: string,
    enhancement: Parameters<McpRegistryService['updateToolEnhancement']>[2],
  ): Promise<void>;
  startBusinessEvents(serverId: string): Promise<'disabled' | 'started' | 'already_running'>;
  businessEventsHealth(serverId: string): ReturnType<ProviderSubscriptionCoordinator['health']>;
  close(): Promise<void>;
}

export interface UgvTaskProviderBindingExpectation {
  readonly bindingId: string;
  readonly bindingRevision: number;
  readonly providerId: string;
  readonly localServerId: string;
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
}
