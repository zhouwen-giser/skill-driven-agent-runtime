import type {
  ConfigurationApplyMode,
  ConfigurationRevision,
  ConfigurationTargetType,
  ControlAuditEvent,
  JsonValue,
  LlmProviderDefinition,
  ManagementOperation,
  McpProviderBinding,
  McpProviderBindingRecord,
  CapabilityImplementationBinding,
  CapabilityImplementationType,
  ModelRouteDefinition,
  NodeCapabilityDefinitionVersion,
  NodeProfile,
  RuntimeRevisionAck,
  SmppProviderCandidateDirectoryEntry,
  SmppRegistrySnapshot,
  SmppRegistrySource,
} from '../../node-control-domain/src/index.js';

export interface NodeControlFoundationRepository {
  migrate(): Promise<void>;
  probe(): Promise<boolean>;
  findNodeProfile(): Promise<NodeProfile | undefined>;
  bootstrapNodeProfile(profile: NodeProfile, audit: ControlAuditEvent): Promise<boolean>;
  listManagementOperations(limit: number): Promise<readonly ManagementOperation[]>;
  findManagementOperation(operationId: string): Promise<ManagementOperation | undefined>;
  listAuditEvents(limit: number): Promise<readonly ControlAuditEvent[]>;
}

export interface NodeControlClock {
  now(): string;
}

export interface NodeControlIdGenerator {
  next(): string;
}

export interface ConfigurationMutationContext {
  readonly actorId: string;
  readonly reason: string;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
  readonly occurredAt: string;
}

export interface ConfigurationDraftInput {
  readonly configurationId: string;
  readonly targetType: ConfigurationTargetType;
  readonly targetId: string;
  readonly requestedRevision: number;
  readonly applyMode: ConfigurationApplyMode;
  readonly content: JsonValue;
  readonly requestedChecksum: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface ConfigurationReference {
  readonly type: string;
  readonly id: string;
  readonly revision?: number;
}

export interface RuntimeBootstrapProjection {
  readonly nodeProfile: NodeProfile;
  readonly runtimeContractVersion: '1.0.0';
  readonly activeConfigurationRefs: readonly ConfigurationReference[];
  readonly activeCapabilityCatalogRef: ConfigurationReference;
  readonly activeExposureCatalogRef: ConfigurationReference;
  readonly serviceCredentialPolicy: Readonly<Record<string, JsonValue>>;
}

export interface NodeControlConfigurationRepository {
  createDraft(
    input: ConfigurationDraftInput,
    context: ConfigurationMutationContext,
  ): Promise<ConfigurationRevision>;
  find(configurationId: string, revision: number): Promise<ConfigurationRevision | undefined>;
  list(
    filter?: Readonly<{ targetType?: string; targetId?: string; limit?: number }>,
  ): Promise<readonly ConfigurationRevision[]>;
  validate(
    configurationId: string,
    revision: number,
    expectedEtag: string,
    context: ConfigurationMutationContext,
  ): Promise<ConfigurationRevision>;
  publish(
    configurationId: string,
    revision: number,
    expectedEtag: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<Readonly<{ revision: ConfigurationRevision; operation: ManagementOperation }>>;
  rollback(
    configurationId: string,
    sourceRevision: number,
    expectedEtag: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<Readonly<{ revision: ConfigurationRevision; operation: ManagementOperation }>>;
  latestPublished(
    targetType: string,
    targetId: string,
    currentRevision?: number,
  ): Promise<ConfigurationRevision | undefined>;
  acknowledge(acknowledgement: RuntimeRevisionAck): Promise<ConfigurationRevision>;
  activeConfigurationRefs(): Promise<readonly ConfigurationReference[]>;
}

export interface NodeControlLlmGovernanceRepository {
  createProvider(
    definition: LlmProviderDefinition,
    context: ConfigurationMutationContext,
  ): Promise<LlmProviderDefinition>;
  findProvider(providerId: string, revision?: number): Promise<LlmProviderDefinition | undefined>;
  listProviders(limit: number): Promise<readonly LlmProviderDefinition[]>;
  validateProvider(
    providerId: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  createRoute(
    definition: ModelRouteDefinition,
    context: ConfigurationMutationContext,
  ): Promise<ModelRouteDefinition>;
  findRoute(routeId: string, revision?: number): Promise<ModelRouteDefinition | undefined>;
  listRoutes(limit: number): Promise<readonly ModelRouteDefinition[]>;
}

export type SmppRegistryFetchResult =
  | Readonly<{ status: 'not_modified'; etag: string }>
  | Readonly<{ status: 'snapshot'; snapshot: SmppRegistrySnapshot }>;

export interface SmppRegistryClient {
  fetchLatest(source: SmppRegistrySource, ifNoneMatch?: string): Promise<SmppRegistryFetchResult>;
}

export interface SmppSnapshotHead {
  readonly revision: number;
  readonly checksum: string;
  readonly etag: string;
  readonly validUntil: string;
}

export interface NodeControlSmppRegistryRepository {
  createSource(
    source: SmppRegistrySource,
    context: ConfigurationMutationContext,
  ): Promise<SmppRegistrySource>;
  findSource(sourceId: string, revision?: number): Promise<SmppRegistrySource | undefined>;
  listSources(limit: number): Promise<readonly SmppRegistrySource[]>;
  listScheduledSources(limit: number): Promise<readonly SmppRegistrySource[]>;
  findActiveSnapshot(sourceId: string): Promise<SmppSnapshotHead | undefined>;
  findSyncReplay(context: ConfigurationMutationContext): Promise<ManagementOperation | undefined>;
  applySnapshot(
    source: SmppRegistrySource,
    snapshot: SmppRegistrySnapshot,
    validUntil: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  recordNotModified(
    source: SmppRegistrySource,
    etag: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  recordSyncFailure(
    source: SmppRegistrySource,
    errorCode: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  listCandidates(
    filter: Readonly<{ sourceId?: string; observedAt: string; limit: number }>,
  ): Promise<readonly SmppProviderCandidateDirectoryEntry[]>;
}

export interface McpCatalogDiscoveryResult {
  readonly catalogRevision: string;
  readonly catalogChecksum: string;
  readonly availabilityStatus: 'available';
  readonly availabilityValidUntil: string;
  readonly observedAt: string;
  readonly operationCount: number;
}

export interface NodeControlMcpCatalogClient {
  discover(
    input: Readonly<{
      localServerId: string;
      endpointRef: string;
      credentialRef: string;
      bindingRevision: number;
      observedAt: string;
      snapshotId: string;
    }>,
  ): Promise<McpCatalogDiscoveryResult>;
}

export interface McpBindingImportRequest {
  readonly bindingId: string;
  readonly localServerId: string;
  readonly originType: 'direct' | 'smpp_registry';
  readonly endpointRef?: string;
  readonly credentialRef: string;
  readonly smppSourceId?: string;
  readonly externalProviderId?: string;
  readonly externalServerId?: string;
  readonly registryRevision?: number;
  readonly registryChecksum?: string;
}

export interface NodeControlMcpProviderBindingRepository {
  find(bindingId: string, revision?: number): Promise<McpProviderBindingRecord | undefined>;
  findLatestActive(bindingId: string): Promise<McpProviderBindingRecord | undefined>;
  list(limit: number): Promise<readonly McpProviderBinding[]>;
  findSelectable(
    localServerId: string,
    observedAt: string,
  ): Promise<McpProviderBinding | undefined>;
  findSmppCandidate(
    input: Readonly<{
      smppSourceId: string;
      externalProviderId: string;
      externalServerId: string;
      registryRevision: number;
      registryChecksum: string;
      observedAt: string;
    }>,
  ): Promise<SmppProviderCandidateDirectoryEntry | undefined>;
  findCommandReplay(
    scope: string,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined>;
  completeImport(
    record: McpProviderBindingRecord,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  completeRevision(
    prior: McpProviderBindingRecord,
    record: McpProviderBindingRecord,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    resultCode: string,
  ): Promise<ManagementOperation>;
  recordImportFailure(
    bindingId: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    errorCode: string,
  ): Promise<ManagementOperation>;
}

export interface NodeControlCapabilityImplementationCatalog {
  exists(
    implementationType: CapabilityImplementationType,
    implementationId: string,
    implementationVersion: string,
  ): Promise<boolean>;
}

export interface NodeControlCapabilityRepository {
  createDraft(
    capability: NodeCapabilityDefinitionVersion,
  ): Promise<NodeCapabilityDefinitionVersion>;
  find(capabilityId: string, version: number): Promise<NodeCapabilityDefinitionVersion | undefined>;
  list(
    status: string | undefined,
    limit: number,
  ): Promise<readonly NodeCapabilityDefinitionVersion[]>;
  createImplementation(
    binding: CapabilityImplementationBinding,
  ): Promise<CapabilityImplementationBinding>;
  listImplementations(
    capabilityId: string,
    version: number,
    limit: number,
  ): Promise<readonly CapabilityImplementationBinding[]>;
  validate(
    prior: NodeCapabilityDefinitionVersion,
    validating: NodeCapabilityDefinitionVersion,
    context: ConfigurationMutationContext,
  ): Promise<NodeCapabilityDefinitionVersion>;
  findCommandReplay(
    scope: string,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined>;
  transition(
    prior: NodeCapabilityDefinitionVersion,
    next: NodeCapabilityDefinitionVersion,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    resultCode: string,
  ): Promise<ManagementOperation>;
}
