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
  NodeProfileDraftInput,
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
  createNodeProfileDraft(
    profile: NodeProfile,
    expectedRevision: number,
    context: ConfigurationMutationContext,
  ): Promise<NodeProfile>;
  validateNodeProfileDraft(
    revision: number,
    expectedRevision: number,
    context: ConfigurationMutationContext,
  ): Promise<NodeProfile>;
  publishNodeProfileDraft(
    revision: number,
    expectedRevision: number,
    operation: ManagementOperation,
    audit: ControlAuditEvent,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  listManagementOperations(limit: number): Promise<readonly ManagementOperation[]>;
  findManagementOperation(operationId: string): Promise<ManagementOperation | undefined>;
  findGovernanceOperationReplay?(
    operationType: string,
    idempotencyKeyHash: string,
  ): Promise<ManagementOperation | undefined>;
  recordGovernanceOperation?(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
  startGovernanceOperation?(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
  cancelGovernanceOperation?(
    operationId: string,
    audit: ControlAuditEvent,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined>;
  completeGovernanceOperation?(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation>;
  listAuditEvents(limit: number): Promise<readonly ControlAuditEvent[]>;
}

export type { NodeProfileDraftInput };

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

export interface SmppRegistryResponseLineage {
  readonly nativeRevision: number;
  readonly nativeChecksum: string;
  readonly projectionContract: 'sdar-registry-v1';
}

export type SmppRegistryFetchResult =
  | Readonly<{
      status: 'not_modified';
      etag: string;
      nativeLineage: SmppRegistryResponseLineage;
    }>
  | Readonly<{
      status: 'snapshot';
      snapshot: SmppRegistrySnapshot;
      nativeLineage: SmppRegistryResponseLineage;
    }>;

export interface SmppRegistryClient {
  fetchLatest(source: SmppRegistrySource, ifNoneMatch?: string): Promise<SmppRegistryFetchResult>;
}

export interface SmppSnapshotHead {
  readonly revision: number;
  readonly checksum: string;
  readonly etag: string;
  readonly externalExpiresAt: string;
  readonly validUntil: string;
  readonly nativeLineage?: SmppRegistryResponseLineage;
}

export interface SmppRegistrySyncObservation {
  readonly revision: number;
  readonly checksum: string;
  readonly etag: string;
  readonly validUntil?: string;
  readonly nativeLineage: SmppRegistryResponseLineage;
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
    nativeLineage: SmppRegistryResponseLineage,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  recordNotModified(
    source: SmppRegistrySource,
    active: SmppSnapshotHead,
    nativeLineage: SmppRegistryResponseLineage,
    validUntil: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation>;
  recordSyncFailure(
    source: SmppRegistrySource,
    errorCode: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    observation?: SmppRegistrySyncObservation,
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

export interface McpBindingRebindRequest {
  readonly expectedRevision: number;
  readonly smppSourceId: string;
  readonly externalProviderId: string;
  readonly externalServerId: string;
  readonly registryRevision: number;
  readonly registryChecksum: string;
  readonly endpointRef: string;
}

export interface CurrentMcpProviderBindingAuthority {
  readonly observedAt: string;
  readonly binding: Readonly<{
    bindingId: string;
    revision: number;
    localServerId: string;
    originType: 'direct' | 'smpp_registry';
    providerId: string;
    externalProviderId?: string;
    externalServerId?: string;
    registryRevision?: number;
    registryChecksum?: string;
    catalogRevision: string;
    catalogChecksum: string;
    endpointRef: string;
    availabilityValidUntil: string;
    catalogObservedAt: string;
    operationCount: number;
  }>;
  readonly sourceCandidateLineage?: Readonly<{
    smppSourceId: string;
    externalProviderId: string;
    externalServerId: string;
    registryRevision: number;
    registryChecksum: string;
    nativeRevision: number;
    nativeChecksum: string;
    projectionContract: 'sdar-registry-v1';
    candidateEndpoint: string;
  }>;
}

export interface NodeControlMcpProviderBindingRepository {
  find(bindingId: string, revision?: number): Promise<McpProviderBindingRecord | undefined>;
  findLatestActive(bindingId: string): Promise<McpProviderBindingRecord | undefined>;
  list(limit: number): Promise<readonly McpProviderBinding[]>;
  findSelectable(
    localServerId: string,
    observedAt: string,
  ): Promise<McpProviderBinding | undefined>;
  findCurrentAuthority(
    input: Readonly<{ bindingId?: string; localServerId: string; observedAt: string }>,
  ): Promise<CurrentMcpProviderBindingAuthority | undefined>;
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

export interface NodeControlCapabilitySchemaValidator {
  checkSchema(schema: unknown): Readonly<{ valid: boolean; errors: readonly string[] }>;
}

export interface NodeControlCapabilityRepository {
  createDraft(
    capability: NodeCapabilityDefinitionVersion,
    context: ConfigurationMutationContext,
  ): Promise<NodeCapabilityDefinitionVersion>;
  find(capabilityId: string, version: number): Promise<NodeCapabilityDefinitionVersion | undefined>;
  list(
    status: string | undefined,
    limit: number,
  ): Promise<readonly NodeCapabilityDefinitionVersion[]>;
  createImplementation(
    binding: CapabilityImplementationBinding,
    context: ConfigurationMutationContext,
  ): Promise<CapabilityImplementationBinding>;
  listImplementations(
    capabilityId: string,
    version: number,
    limit: number,
  ): Promise<readonly CapabilityImplementationBinding[]>;
  hasCommandReceipt(scope: string, context: ConfigurationMutationContext): Promise<boolean>;
  findImplementationReplay(
    context: ConfigurationMutationContext,
    bindingId: string,
    revision: number,
  ): Promise<CapabilityImplementationBinding | undefined>;
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
