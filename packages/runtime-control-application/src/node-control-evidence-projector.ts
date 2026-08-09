import {
  EVIDENCE_RECORD_CATALOG,
  createCatalogEvidenceEnvelope,
  createEvidenceRecordId,
  getEvidenceCatalogEntry,
  hashCanonicalEvidenceJson,
  type CanonicalEvidenceEnvelope,
  type EvidenceJsonValue,
  type EvidenceObservationGeneration,
  type EvidenceSourceCheckpoint,
} from '../../domain/src/index.js';
import { NODE_EVENT_TYPES } from '../../node-control-domain/src/index.js';

export const NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION = 'node-control/v1' as const;

export const NODE_CONTROL_EVIDENCE_RECORD_TYPES = Object.freeze([
  'node_control.profile_revision',
  'node_control.health_observation',
  'node_control.configuration_revision',
  'node_control.configuration_apply_ack',
  'node_control.configuration_lkg_transition',
  'node_control.llm_provider_revision',
  'node_control.model_route_revision',
  'node_control.smpp_source_revision',
  'node_control.mcp_provider_binding_revision',
  'node_control.skill_governance',
  'node_control.plan_template_governance',
  'node_control.capability_revision',
  'node_control.capability_readiness',
  'node_control.a2a_exposure',
  'node_control.agent_card_revision',
  'node_control.management_operation',
  'node_control.audit_event',
  'node_control.node_event',
  'node_control.telemetry_configuration',
  'node_control.telemetry_delivery',
  'node_control.telemetry_ack',
] as const);

export type NodeControlEvidenceRecordType = (typeof NODE_CONTROL_EVIDENCE_RECORD_TYPES)[number];
export type NodeControlEvidenceSourceRow = Readonly<Record<string, EvidenceJsonValue>>;

export type NodeControlEvidenceProjectionErrorCode =
  | 'NODE_CONTROL_EVIDENCE_SOURCE_NOT_FOUND'
  | 'NODE_CONTROL_EVIDENCE_RECORD_TYPE_INVALID'
  | 'NODE_CONTROL_EVIDENCE_AUTHORITY_DRIFT'
  | 'NODE_CONTROL_EVIDENCE_SOURCE_PARTITION_DRIFT'
  | 'NODE_CONTROL_EVIDENCE_REFERENCE_UNEXPECTED'
  | 'NODE_CONTROL_EVIDENCE_REFERENCE_REQUIRED'
  | 'NODE_CONTROL_EVIDENCE_REFERENCE_ORPHAN'
  | 'NODE_CONTROL_EVIDENCE_REFERENCE_DUPLICATE'
  | 'NODE_CONTROL_EVIDENCE_SEQUENCE_RANGE_INVALID'
  | 'NODE_CONTROL_EVIDENCE_ARRAY_INVALID'
  | 'NODE_CONTROL_EVIDENCE_TIMESTAMP_INVALID'
  | 'NODE_CONTROL_EVIDENCE_ORGANIZATION_SCOPE_MISMATCH'
  | 'NODE_CONTROL_EVIDENCE_TENANT_SCOPE_MISMATCH'
  | 'NODE_CONTROL_EVIDENCE_SOURCE_REVISION_INVALID'
  | 'NODE_CONTROL_EVIDENCE_POSITIVE_VERSION_INVALID'
  | 'NODE_CONTROL_EVIDENCE_NON_NEGATIVE_INTEGER_INVALID'
  | 'NODE_CONTROL_EVIDENCE_DECIMAL_SEQUENCE_INVALID'
  | 'NODE_CONTROL_EVIDENCE_OBSERVATION_GENERATION_INVALID'
  | 'NODE_CONTROL_EVIDENCE_ENUM_INVALID'
  | 'NODE_CONTROL_EVIDENCE_HASH_INVALID'
  | 'NODE_CONTROL_EVIDENCE_TEXT_INVALID'
  | 'NODE_CONTROL_EVIDENCE_CATALOG_CARDINALITY_DRIFT';

export class NodeControlEvidenceProjectionError extends Error {
  readonly code: NodeControlEvidenceProjectionErrorCode;

  constructor(code: NodeControlEvidenceProjectionErrorCode, detail?: string) {
    super(detail === undefined ? code : `${code}:${detail}`);
    this.name = 'NodeControlEvidenceProjectionError';
    this.code = code;
  }
}

export interface NodeControlEvidenceProjectionPartition {
  readonly recordType: NodeControlEvidenceRecordType;
  readonly sourcePartition: string;
  readonly sourceRecordId: string;
  /**
   * Exact immutable authority revision only. It must not include the payload hash: a repeated
   * Event ID/revision with changed payload must reach EvidenceStore as a payload conflict.
   */
  readonly sourceRevision: EvidenceJsonValue;
  /** Durable source cursor only; excluded from Evidence identity and payload hashing. */
  readonly observationSequence: string;
}

export interface NodeControlEvidenceReference {
  readonly recordType: string;
  readonly sourceRecordId: string;
  readonly sourceRevision: EvidenceJsonValue;
}

export interface NodeControlEvidenceScope {
  readonly correlationId: string;
  readonly nodeId?: string;
  readonly tenantId?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly causationId?: string;
}

export interface NodeControlEvidenceSnapshot {
  readonly partition: NodeControlEvidenceProjectionPartition;
  readonly occurredAt: string;
  readonly payload: NodeControlEvidenceSourceRow;
  readonly references: readonly NodeControlEvidenceReference[];
  readonly scope: NodeControlEvidenceScope;
  readonly observationGeneration?: EvidenceObservationGeneration;
  readonly artifactRefs?: readonly string[];
  readonly checkpoint?: EvidenceSourceCheckpoint;
}

export interface NodeControlEvidenceSourceCursor {
  /** Opaque decimal ledger sequence; never used as Evidence source identity or revision. */
  readonly afterObservationSequence?: string;
  /** Exact frozen Control Event identity for Last-Event-ID resume. */
  readonly lastEventId?: string;
}

export const NODE_CONTROL_EVIDENCE_READ_PERMISSION = 'node_control.evidence.read' as const;

/**
 * Internal service identity for the durable Control authority reader. This is deliberately not a
 * public Node Control API role: organization, viewer, operator and user principals must never be
 * accepted as a substitute for the projector service.
 */
export interface NodeControlEvidenceReadPrincipal {
  readonly principalType: 'service';
  readonly actorId: string;
  readonly role: 'node_control_evidence_projector';
  readonly permission: typeof NODE_CONTROL_EVIDENCE_READ_PERMISSION;
  readonly authorityScope: 'global_authority';
  readonly organizationScope: 'node_local';
  readonly nodeId: string;
  readonly allowedDataClassifications: readonly ('public' | 'internal' | 'restricted')[];
}

export interface NodeControlEvidenceSourcePage {
  readonly partitions: readonly NodeControlEvidenceProjectionPartition[];
  readonly nextCursor?: NodeControlEvidenceSourceCursor;
}

export interface NodeControlEvidenceSource {
  /** Compatibility adapter only. New orchestration must persist and pass the page cursor. */
  pendingPartitions(
    limit: number,
    cursor?: NodeControlEvidenceSourceCursor,
  ): Promise<readonly NodeControlEvidenceProjectionPartition[]>;
  pendingPage(
    limit: number,
    cursor?: NodeControlEvidenceSourceCursor,
  ): Promise<NodeControlEvidenceSourcePage>;
  load(
    partition: NodeControlEvidenceProjectionPartition,
  ): Promise<NodeControlEvidenceSnapshot | undefined>;
}

export interface NodeControlEvidenceWriter {
  hasRecord(recordId: string): Promise<boolean>;
  append(
    envelope: CanonicalEvidenceEnvelope,
    capturedAt: string,
    sourcePartition: string,
  ): Promise<string>;
  saveCheckpoint(checkpoint: EvidenceSourceCheckpoint): Promise<void>;
}

export interface NodeControlEvidenceProjectionResult {
  readonly sourcePartition: string;
  readonly recordType: NodeControlEvidenceRecordType;
  readonly recordId: string;
  readonly evidenceSequence?: string;
  readonly skipped: boolean;
}

const recordTypes = new Set<string>(NODE_CONTROL_EVIDENCE_RECORD_TYPES);
const nodeEventTypes = new Set<string>(NODE_EVENT_TYPES);
const frozenAuthorityTables = new Map<NodeControlEvidenceRecordType, string>([
  ['node_control.profile_revision', 'sdar_control.node_profile_revision'],
  ['node_control.health_observation', 'sdar_control.node_health_observation'],
  ['node_control.configuration_revision', 'sdar_control.configuration_revision'],
  ['node_control.configuration_apply_ack', 'sdar_control.configuration_application'],
  ['node_control.configuration_lkg_transition', 'sdar_control.configuration_target_state'],
  ['node_control.llm_provider_revision', 'sdar_control.llm_provider_definition'],
  ['node_control.model_route_revision', 'sdar_control.model_route_definition'],
  ['node_control.smpp_source_revision', 'sdar_control.smpp_registry_source'],
  ['node_control.mcp_provider_binding_revision', 'sdar_control.mcp_provider_binding'],
  ['node_control.skill_governance', 'sdar_control.control_audit_event[action prefix=skill.]'],
  [
    'node_control.plan_template_governance',
    'sdar_control.control_audit_event[action prefix=plan-template.]',
  ],
  ['node_control.capability_revision', 'sdar_control.node_capability_definition_version'],
  [
    'node_control.capability_readiness',
    'sdar_control.node_event_outbox[event_type=node.capability.readiness_changed] + sdar_control.management_operation[result]',
  ],
  ['node_control.a2a_exposure', 'sdar_control.a2a_exposure_version'],
  ['node_control.agent_card_revision', 'sdar_control.agent_card_revision'],
  ['node_control.management_operation', 'sdar_control.management_operation'],
  ['node_control.audit_event', 'sdar_control.control_audit_event'],
  ['node_control.node_event', 'sdar_control.node_event_outbox'],
  [
    'node_control.telemetry_configuration',
    'sdar_control.configuration_revision[target_type=telemetry_link]',
  ],
  ['node_control.telemetry_delivery', 'evidence_export_batch'],
  ['node_control.telemetry_ack', 'evidence_export_ack'],
]);
const statusPolicies = new Map<NodeControlEvidenceRecordType, ReadonlySet<string>>([
  ['node_control.profile_revision', new Set(['draft', 'active', 'maintenance', 'retired'])],
  [
    'node_control.health_observation',
    new Set(['healthy', 'degraded', 'unavailable', 'maintenance']),
  ],
  [
    'node_control.configuration_revision',
    new Set([
      'draft',
      'validated',
      'published',
      'applying',
      'applied',
      'partially_applied',
      'rejected',
      'rolled_back',
    ]),
  ],
  [
    'node_control.configuration_apply_ack',
    new Set([
      'pending',
      'staging',
      'applied',
      'partially_applied',
      'rejected',
      'restart_required',
      'stale',
      'unavailable',
    ]),
  ],
  [
    'node_control.llm_provider_revision',
    new Set(['draft', 'active', 'degraded', 'suspended', 'retired']),
  ],
  ['node_control.model_route_revision', new Set(['draft', 'active', 'suspended', 'retired'])],
  ['node_control.smpp_source_revision', new Set(['draft', 'active', 'suspended', 'retired'])],
  [
    'node_control.capability_readiness',
    new Set(['available', 'degraded', 'unavailable', 'suspended']),
  ],
  [
    'node_control.management_operation',
    new Set(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
  ],
  [
    'node_control.telemetry_configuration',
    new Set([
      'draft',
      'validated',
      'published',
      'applying',
      'applied',
      'partially_applied',
      'rejected',
      'rolled_back',
    ]),
  ],
  ['node_control.telemetry_delivery', new Set(['attempted'])],
]);

const optionalStatusPolicies = new Map<NodeControlEvidenceRecordType, ReadonlySet<string>>([
  [
    'node_control.mcp_provider_binding_revision',
    new Set(['candidate', 'imported', 'active', 'degraded', 'suspended', 'removed']),
  ],
  [
    'node_control.capability_revision',
    new Set(['draft', 'validating', 'published', 'suspended', 'deprecated', 'retired']),
  ],
  ['node_control.a2a_exposure', new Set(['draft', 'published', 'suspended', 'retired'])],
  [
    'node_control.agent_card_revision',
    new Set(['candidate', 'staged', 'active', 'rejected', 'superseded']),
  ],
]);

const configurationTargetTypes = new Set([
  'node',
  'llm_provider',
  'model_route',
  'smpp_source',
  'mcp_provider_binding',
  'telemetry_link',
  'runtime_policy',
]);
const configurationApplyModes = new Set([
  'hot_reload',
  'new_task_only',
  'reconnect_required',
  'restart_required',
  'immutable',
]);
const closedEnumPolicies = new Map<
  NodeControlEvidenceRecordType,
  Readonly<Record<string, ReadonlySet<string>>>
>([
  [
    'node_control.configuration_revision',
    { targetType: configurationTargetTypes, applyMode: configurationApplyModes },
  ],
  ['node_control.configuration_lkg_transition', { targetType: configurationTargetTypes }],
  [
    'node_control.llm_provider_revision',
    {
      providerType: new Set(['openai_compatible', 'anthropic', 'local']),
      secretStatus: new Set(['unknown', 'available', 'unavailable', 'invalid']),
    },
  ],
  [
    'node_control.model_route_revision',
    {
      stage: new Set([
        'understanding',
        'planning',
        'execution',
        'evaluation',
        'summary',
        'embedding',
      ]),
      scopeType: new Set(['stage', 'task', 'case']),
    },
  ],
  [
    'node_control.smpp_source_revision',
    {
      syncMode: new Set(['manual', 'poll', 'watch']),
      lkgPolicy: new Set(['allow_unexpired', 'deny_when_unavailable']),
    },
  ],
  [
    'node_control.mcp_provider_binding_revision',
    {
      originType: new Set(['direct', 'smpp_registry']),
      availabilityStatus: new Set(['unknown', 'available', 'degraded', 'unavailable']),
    },
  ],
  [
    'node_control.capability_revision',
    { riskLevel: new Set(['low', 'medium', 'high', 'critical']) },
  ],
  [
    'node_control.a2a_exposure',
    {
      visibility: new Set(['organization', 'public']),
      readinessPublicationPolicy: new Set([
        'publish_when_available',
        'publish_degraded',
        'always_publish_with_status',
      ]),
    },
  ],
  ['node_control.telemetry_configuration', { applyMode: configurationApplyModes }],
]);

const positiveFields = new Map<NodeControlEvidenceRecordType, readonly string[]>([
  ['node_control.profile_revision', ['revision']],
  ['node_control.health_observation', ['observationRevision']],
  ['node_control.configuration_revision', ['revision']],
  ['node_control.configuration_apply_ack', ['revision']],
  ['node_control.configuration_lkg_transition', ['desiredRevision', 'generation']],
  ['node_control.llm_provider_revision', ['revision']],
  ['node_control.model_route_revision', ['revision']],
  ['node_control.smpp_source_revision', ['revision']],
  ['node_control.mcp_provider_binding_revision', ['revision']],
  ['node_control.capability_revision', ['version']],
  ['node_control.capability_readiness', ['capabilityVersion', 'snapshotVersion']],
  ['node_control.a2a_exposure', ['version', 'capabilityVersion']],
  ['node_control.agent_card_revision', ['revision']],
  ['node_control.node_event', ['aggregateRevision']],
  ['node_control.telemetry_configuration', ['revision']],
  ['node_control.telemetry_delivery', ['configurationRevision', 'recordCount', 'attemptNo']],
]);

const optionalPositiveFields = new Map<NodeControlEvidenceRecordType, readonly string[]>([
  ['node_control.configuration_lkg_transition', ['observedRevision']],
  ['node_control.smpp_source_revision', ['activeSnapshotRevision']],
  ['node_control.mcp_provider_binding_revision', ['registryRevision']],
  ['node_control.skill_governance', ['expectedRevision', 'resultRevision']],
  ['node_control.plan_template_governance', ['expectedRevision', 'resultRevision']],
  ['node_control.capability_revision', ['previousVersion']],
  ['node_control.audit_event', ['expectedRevision', 'resultRevision']],
]);

export class NodeControlEvidenceProjector {
  readonly #source: NodeControlEvidenceSource;
  readonly #writer: NodeControlEvidenceWriter;
  readonly #environment: string;
  readonly #clock: Readonly<{ now(): string }>;

  constructor(input: {
    readonly source: NodeControlEvidenceSource;
    readonly writer: NodeControlEvidenceWriter;
    readonly environment: string;
    readonly clock?: Readonly<{ now(): string }>;
  }) {
    this.#source = input.source;
    this.#writer = input.writer;
    this.#environment = requiredText(input.environment, 'environment');
    this.#clock = input.clock ?? { now: () => new Date().toISOString() };
  }

  async projectPartition(
    partition: NodeControlEvidenceProjectionPartition,
  ): Promise<NodeControlEvidenceProjectionResult> {
    validatePartition(partition);
    const snapshot = await this.#source.load(partition);
    if (snapshot === undefined) {
      throw failure('NODE_CONTROL_EVIDENCE_SOURCE_NOT_FOUND', partition.sourcePartition);
    }
    assertSamePartition(partition, snapshot.partition);
    const catalog = getEvidenceCatalogEntry(partition.recordType);
    if (catalog.recordFamily !== 'node_control') {
      throw failure('NODE_CONTROL_EVIDENCE_RECORD_TYPE_INVALID', partition.recordType);
    }
    const frozenAuthorityTable = frozenAuthorityTables.get(partition.recordType);
    if (frozenAuthorityTable !== undefined && catalog.sourceTable !== frozenAuthorityTable) {
      throw failure('NODE_CONTROL_EVIDENCE_AUTHORITY_DRIFT', partition.recordType);
    }
    const occurredAt = timestamp(snapshot.occurredAt, 'occurredAt');
    const recordedAt = timestamp(this.#clock.now(), 'recordedAt');
    const sourceRevision = sourceRevisionHash(partition.sourceRevision);
    const payload = validatePayload(partition.recordType, snapshot.payload, snapshot.scope);
    const evidenceRefs = exactReferenceIds(catalog.expectedReferences, snapshot.references);
    for (const evidenceRef of evidenceRefs) {
      if (!(await this.#writer.hasRecord(evidenceRef))) {
        throw failure('NODE_CONTROL_EVIDENCE_REFERENCE_ORPHAN', partition.recordType);
      }
    }
    const observationGeneration = envelopeObservationGeneration(
      partition.recordType,
      snapshot.observationGeneration,
    );
    const envelope = createCatalogEvidenceEnvelope({
      recordType: partition.recordType,
      sourceRecordId: requiredText(partition.sourceRecordId, 'sourceRecordId'),
      sourceRevision,
      environment: this.#environment,
      correlationId: requiredText(snapshot.scope.correlationId, 'correlationId'),
      occurredAt,
      recordedAt,
      evidenceRefs,
      artifactRefs: uniqueStrings(snapshot.artifactRefs ?? []),
      ...(observationGeneration === undefined ? {} : { observationGeneration }),
      ...(snapshot.scope.tenantId === undefined
        ? {}
        : { tenantId: requiredText(snapshot.scope.tenantId, 'tenantId') }),
      ...(snapshot.scope.projectId === undefined
        ? {}
        : { projectId: requiredText(snapshot.scope.projectId, 'projectId') }),
      ...(snapshot.scope.nodeId === undefined
        ? {}
        : { nodeId: requiredText(snapshot.scope.nodeId, 'nodeId') }),
      ...(snapshot.scope.causationId === undefined
        ? {}
        : { causationId: requiredText(snapshot.scope.causationId, 'causationId') }),
      payload,
    });

    if (
      snapshot.checkpoint?.projectorVersion === NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION &&
      snapshot.checkpoint.lastSourceRecordId === partition.sourceRecordId &&
      snapshot.checkpoint.lastSourceRevision === sourceRevision &&
      snapshot.checkpoint.lastPayloadHash === envelope.payloadHash
    ) {
      return {
        sourcePartition: partition.sourcePartition,
        recordType: partition.recordType,
        recordId: envelope.recordId,
        skipped: true,
      };
    }

    // EvidenceStore owns same-ID/different-payload conflict detection. Do not pre-deduplicate here.
    const evidenceSequence = await this.#writer.append(
      envelope,
      recordedAt,
      requiredText(partition.sourcePartition, 'sourcePartition'),
    );
    await this.#writer.saveCheckpoint({
      sourceFamily: 'node_control',
      sourcePartition: partition.sourcePartition,
      lastOccurredAt: occurredAt,
      lastSourceRecordId: partition.sourceRecordId,
      lastSourceRevision: sourceRevision,
      lastPayloadHash: envelope.payloadHash,
      lastProjectedAt: recordedAt,
      projectorVersion: NODE_CONTROL_EVIDENCE_PROJECTOR_VERSION,
    });
    return {
      sourcePartition: partition.sourcePartition,
      recordType: partition.recordType,
      recordId: envelope.recordId,
      evidenceSequence,
      skipped: false,
    };
  }
}

function validatePartition(partition: NodeControlEvidenceProjectionPartition) {
  if (!recordTypes.has(partition.recordType)) {
    throw failure('NODE_CONTROL_EVIDENCE_RECORD_TYPE_INVALID', partition.recordType);
  }
  requiredText(partition.sourcePartition, 'sourcePartition');
  requiredText(partition.sourceRecordId, 'sourceRecordId');
  decimalSequence(partition.observationSequence, 'observationSequence');
  sourceRevisionHash(partition.sourceRevision);
}

function assertSamePartition(
  requested: NodeControlEvidenceProjectionPartition,
  loaded: NodeControlEvidenceProjectionPartition,
) {
  if (
    requested.recordType !== loaded.recordType ||
    requested.sourcePartition !== loaded.sourcePartition ||
    requested.sourceRecordId !== loaded.sourceRecordId ||
    requested.observationSequence !== loaded.observationSequence ||
    sourceRevisionHash(requested.sourceRevision) !== sourceRevisionHash(loaded.sourceRevision)
  ) {
    throw failure('NODE_CONTROL_EVIDENCE_SOURCE_PARTITION_DRIFT');
  }
}

function exactReferenceIds(
  expectedTypes: readonly string[],
  references: readonly NodeControlEvidenceReference[],
) {
  const expected = new Set(expectedTypes);
  const refsByType = new Map<string, NodeControlEvidenceReference[]>();
  for (const reference of references) {
    if (!expected.has(reference.recordType)) {
      throw failure('NODE_CONTROL_EVIDENCE_REFERENCE_UNEXPECTED', reference.recordType);
    }
    const values = refsByType.get(reference.recordType) ?? [];
    values.push(reference);
    refsByType.set(reference.recordType, values);
  }
  for (const expectedType of expectedTypes) {
    if ((refsByType.get(expectedType)?.length ?? 0) === 0) {
      throw failure('NODE_CONTROL_EVIDENCE_REFERENCE_REQUIRED', expectedType);
    }
  }
  const ids = references.map((reference) => {
    const catalog = getEvidenceCatalogEntry(reference.recordType);
    return createEvidenceRecordId({
      sourceSystem: catalog.sourceSystem,
      sourceTable: catalog.sourceTable,
      sourceRecordId: requiredText(reference.sourceRecordId, 'reference.sourceRecordId'),
      sourceRevision: sourceRevisionHash(reference.sourceRevision),
      schemaName: catalog.schemaName,
      schemaVersion: catalog.schemaVersion,
    });
  });
  const unique = uniqueStrings(ids);
  if (unique.length !== ids.length) throw failure('NODE_CONTROL_EVIDENCE_REFERENCE_DUPLICATE');
  return unique;
}

function validatePayload(
  recordType: NodeControlEvidenceRecordType,
  payload: NodeControlEvidenceSourceRow,
  scope: NodeControlEvidenceScope,
): NodeControlEvidenceSourceRow {
  for (const field of positiveFields.get(recordType) ?? []) positive(payload[field], field);
  for (const field of optionalPositiveFields.get(recordType) ?? []) {
    if (payload[field] !== null && payload[field] !== undefined) positive(payload[field], field);
  }
  if (recordType === 'node_control.telemetry_ack') {
    hash(payload['batchHash'], 'batchHash');
    requiredTextValue(payload['batchId'], 'batchId');
    requiredTextValue(payload['exportId'], 'exportId');
    const disposition = payload['ackDisposition'];
    enumValue(disposition, 'ackDisposition', new Set(['accepted', 'partial', 'rejected']));
    if (disposition === 'rejected') {
      if (payload['acknowledgedSequence'] !== null) {
        throw failure('NODE_CONTROL_EVIDENCE_DECIMAL_SEQUENCE_INVALID', 'acknowledgedSequence');
      }
      requiredTextValue(payload['errorCode'], 'errorCode');
    } else {
      decimalSequence(payload['acknowledgedSequence'], 'acknowledgedSequence');
      if (payload['errorCode'] !== null) {
        throw failure('NODE_CONTROL_EVIDENCE_ENUM_INVALID', 'errorCode');
      }
    }
  }
  if (recordType === 'node_control.telemetry_delivery') {
    hash(payload['batchHash'], 'batchHash');
    requiredTextValue(payload['batchId'], 'batchId');
    requiredTextValue(payload['exportId'], 'exportId');
    decimalSequence(payload['firstSequence'], 'firstSequence');
    decimalSequence(payload['lastSequence'], 'lastSequence');
    if (BigInt(payload['firstSequence'] as string) > BigInt(payload['lastSequence'] as string)) {
      throw failure('NODE_CONTROL_EVIDENCE_SEQUENCE_RANGE_INVALID');
    }
  }
  if (recordType === 'node_control.health_observation') {
    requiredTextValue(payload['observationId'], 'observationId');
    positive(payload['observationRevision'], 'observationRevision');
    requiredTextValue(payload['nodeId'], 'nodeId');
    nonNegative(payload['activeTasks'], 'activeTasks');
    const components = payload['components'];
    if (!isEvidenceArray(components)) {
      throw failure('NODE_CONTROL_EVIDENCE_ARRAY_INVALID', 'components');
    }
    for (const component of components) validateHealthComponent(component);
    const observedAt = payload['observedAt'];
    if (typeof observedAt !== 'string') {
      throw failure('NODE_CONTROL_EVIDENCE_TIMESTAMP_INVALID', 'observedAt');
    }
    timestamp(observedAt, 'observedAt');
  }
  const statusPolicy = statusPolicies.get(recordType);
  if (statusPolicy !== undefined) {
    const statusField =
      recordType === 'node_control.health_observation'
        ? 'healthStatus'
        : recordType === 'node_control.capability_readiness'
          ? 'readinessStatus'
          : recordType === 'node_control.telemetry_delivery'
            ? 'deliveryStatus'
            : 'status';
    enumValue(payload[statusField], statusField, statusPolicy);
  }
  const optionalStatusPolicy = optionalStatusPolicies.get(recordType);
  if (optionalStatusPolicy !== undefined && payload['status'] !== undefined) {
    enumValue(payload['status'], 'status', optionalStatusPolicy);
  }
  for (const [field, policy] of Object.entries(closedEnumPolicies.get(recordType) ?? {})) {
    enumValue(payload[field], field, policy);
  }
  if (
    recordType === 'node_control.configuration_lkg_transition' &&
    payload['convergenceStatus'] !== undefined
  ) {
    enumValue(
      payload['convergenceStatus'],
      'convergenceStatus',
      new Set(['converged', 'pending', 'degraded', 'rejected', 'restart_required', 'unavailable']),
    );
  }
  if (recordType === 'node_control.node_event') {
    decimalSequence(payload['sequence'], 'sequence');
    enumValue(payload['eventType'], 'eventType', nodeEventTypes);
    if (payload['dataClassification'] !== undefined) {
      enumValue(
        payload['dataClassification'],
        'dataClassification',
        new Set(['public', 'internal', 'restricted']),
      );
    }
  }
  if (scope.organizationId !== undefined) {
    const organizationId = requiredText(scope.organizationId, 'organizationId');
    if (payload['organizationId'] !== organizationId) {
      throw failure('NODE_CONTROL_EVIDENCE_ORGANIZATION_SCOPE_MISMATCH');
    }
  }
  if (scope.tenantId !== undefined && payload['tenantId'] !== undefined) {
    if (payload['tenantId'] !== scope.tenantId) {
      throw failure('NODE_CONTROL_EVIDENCE_TENANT_SCOPE_MISMATCH');
    }
  }
  return payload;
}

function validateHealthComponent(value: EvidenceJsonValue) {
  if (!isEvidenceObject(value)) {
    throw failure('NODE_CONTROL_EVIDENCE_ARRAY_INVALID', 'components');
  }
  requiredTextValue(value['component'], 'components.component');
  enumValue(
    value['status'],
    'components.status',
    new Set(['healthy', 'degraded', 'unavailable', 'disabled']),
  );
  const observedAt = value['observedAt'];
  if (typeof observedAt !== 'string') {
    throw failure('NODE_CONTROL_EVIDENCE_TIMESTAMP_INVALID', 'components.observedAt');
  }
  timestamp(observedAt, 'components.observedAt');
}

function isEvidenceObject(value: EvidenceJsonValue): value is NodeControlEvidenceSourceRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEvidenceArray(
  value: EvidenceJsonValue | undefined,
): value is readonly EvidenceJsonValue[] {
  return Array.isArray(value);
}

function sourceRevisionHash(value: EvidenceJsonValue) {
  if (value === null) throw failure('NODE_CONTROL_EVIDENCE_SOURCE_REVISION_INVALID');
  return hashCanonicalEvidenceJson(value);
}

function positive(value: EvidenceJsonValue | undefined, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw failure('NODE_CONTROL_EVIDENCE_POSITIVE_VERSION_INVALID', field);
  }
}

function nonNegative(value: EvidenceJsonValue | undefined, field: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw failure('NODE_CONTROL_EVIDENCE_NON_NEGATIVE_INTEGER_INVALID', field);
  }
}

function decimalSequence(value: EvidenceJsonValue | undefined, field: string) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw failure('NODE_CONTROL_EVIDENCE_DECIMAL_SEQUENCE_INVALID', field);
  }
  if (BigInt(value) > 9_223_372_036_854_775_807n) {
    throw failure('NODE_CONTROL_EVIDENCE_DECIMAL_SEQUENCE_INVALID', field);
  }
}

function envelopeObservationGeneration(
  recordType: NodeControlEvidenceRecordType,
  value: EvidenceObservationGeneration | undefined,
) {
  const derived =
    recordType === 'node_control.telemetry_delivery' || recordType === 'node_control.telemetry_ack';
  if (derived && value !== 1) {
    throw failure('NODE_CONTROL_EVIDENCE_OBSERVATION_GENERATION_INVALID');
  }
  if (!derived && value !== undefined && value !== 0) {
    throw failure('NODE_CONTROL_EVIDENCE_OBSERVATION_GENERATION_INVALID');
  }
  return derived ? (1 as const) : undefined;
}

function enumValue(
  value: EvidenceJsonValue | undefined,
  field: string,
  allowed: ReadonlySet<string>,
) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw failure('NODE_CONTROL_EVIDENCE_ENUM_INVALID', field);
  }
}

function hash(value: EvidenceJsonValue | undefined, field: string) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw failure('NODE_CONTROL_EVIDENCE_HASH_INVALID', field);
  }
}

function requiredTextValue(value: EvidenceJsonValue | undefined, field: string) {
  if (typeof value !== 'string') throw failure('NODE_CONTROL_EVIDENCE_TEXT_INVALID', field);
  return requiredText(value, field);
}

function timestamp(value: string, field: string) {
  if (!Number.isFinite(Date.parse(value))) {
    throw failure('NODE_CONTROL_EVIDENCE_TIMESTAMP_INVALID', field);
  }
  return new Date(value).toISOString();
}

function requiredText(value: string, field: string) {
  const clean = value.trim();
  if (clean === '') throw failure('NODE_CONTROL_EVIDENCE_TEXT_INVALID', field);
  return clean;
}

function uniqueStrings(values: readonly string[]) {
  const normalized = values.map((value) => requiredText(value, 'reference'));
  return [...new Set(normalized)].sort();
}

if (
  EVIDENCE_RECORD_CATALOG.filter((entry) => entry.recordFamily === 'node_control').length !==
    NODE_CONTROL_EVIDENCE_RECORD_TYPES.length ||
  frozenAuthorityTables.size !== NODE_CONTROL_EVIDENCE_RECORD_TYPES.length
) {
  throw failure('NODE_CONTROL_EVIDENCE_CATALOG_CARDINALITY_DRIFT');
}

function failure(code: NodeControlEvidenceProjectionErrorCode, detail?: string) {
  return new NodeControlEvidenceProjectionError(code, detail);
}
