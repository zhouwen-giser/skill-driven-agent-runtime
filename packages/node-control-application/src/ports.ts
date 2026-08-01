import type {
  ConfigurationApplyMode,
  ConfigurationRevision,
  ConfigurationTargetType,
  ControlAuditEvent,
  JsonValue,
  ManagementOperation,
  NodeProfile,
  RuntimeRevisionAck,
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
