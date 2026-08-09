import type { Pool, PoolClient } from 'pg';

import { hashCanonicalEvidenceJson, type EvidenceJsonValue } from '../../domain/src/index.js';
import type {
  NodeControlEvidenceProjectionPartition,
  NodeControlEvidenceReadPrincipal,
  NodeControlEvidenceRecordType,
  NodeControlEvidenceReference,
  NodeControlEvidenceSnapshot,
  NodeControlEvidenceSource,
  NodeControlEvidenceSourceCursor,
  NodeControlEvidenceSourcePage,
  NodeControlEvidenceSourceRow,
} from '../../runtime-control-application/src/index.js';
import type { NodeHealth, NodeHealthObservation } from '../../node-control-domain/src/index.js';

const projectorVersion = 'node-control/v1';
const eventRecordTypes = new Set<NodeControlEvidenceRecordType>([
  'node_control.node_event',
  'node_control.capability_readiness',
]);

interface ObservationRow {
  readonly observation_sequence: string;
  readonly record_type: NodeControlEvidenceRecordType;
  readonly source_record_id: string;
  readonly authority_payload: Readonly<Record<string, unknown>>;
  readonly occurred_at: Date | string;
}

interface RuntimeProjectionState {
  readonly checkpoints: ReadonlyMap<string, string>;
  readonly backoffPartitions: ReadonlySet<string>;
}

export class NodeControlEvidenceSourceError extends Error {
  readonly code:
    | 'NODE_CONTROL_EVIDENCE_CURSOR_INVALID'
    | 'NODE_CONTROL_EVIDENCE_CURSOR_NOT_FOUND'
    | 'NODE_CONTROL_EVIDENCE_AUTHORITY_INVALID'
    | 'NODE_CONTROL_EVIDENCE_READ_FORBIDDEN'
    | 'NODE_CONTROL_EVIDENCE_SCOPE_MISMATCH'
    | 'NODE_CONTROL_EVIDENCE_REVISION_REGRESSION'
    | 'NODE_CONTROL_EVIDENCE_REFERENCE_AMBIGUOUS';

  constructor(code: NodeControlEvidenceSourceError['code'], detail: string) {
    super(`${code}:${detail}`);
    this.name = 'NodeControlEvidenceSourceError';
    this.code = code;
  }
}

/**
 * Read-only source over Control PostgreSQL's immutable observation ledger. Runtime PostgreSQL is
 * optional and is used only to honor durable projection checkpoints/backoff; it is never written.
 */
export class PostgresNodeControlEvidenceSource implements NodeControlEvidenceSource {
  readonly #control: Pool;
  readonly #runtime: Pool | undefined;
  readonly #principal: NodeControlEvidenceReadPrincipal;

  constructor(
    control: Pool,
    runtime: Pool | undefined,
    principal: NodeControlEvidenceReadPrincipal,
  ) {
    this.#control = control;
    this.#runtime = runtime;
    this.#principal = authorizeEvidenceReadPrincipal(principal);
  }

  async pendingPartitions(
    limit: number,
    cursor?: NodeControlEvidenceSourceCursor,
  ): Promise<readonly NodeControlEvidenceProjectionPartition[]> {
    return (await this.pendingPage(limit, cursor)).partitions;
  }

  async pendingPage(
    limit: number,
    cursor?: NodeControlEvidenceSourceCursor,
  ): Promise<NodeControlEvidenceSourcePage> {
    authorizeEvidenceReadPrincipal(this.#principal);
    boundedLimit(limit);
    const bounds = await this.#sequenceBounds(cursor);
    const runtimeState = await this.#runtimeState();
    const checkpointSequences = await this.#checkpointSequences(runtimeState.checkpoints);
    const result = await this.#control.query<ObservationRow>(
      `WITH checkpoint AS (
         SELECT key AS source_partition,value::bigint AS observation_sequence
           FROM jsonb_each_text($2::jsonb)
       ), pending AS (
         SELECT observation.observation_sequence,observation.record_type,
                observation.source_record_id,observation.authority_payload,
                observation.occurred_at,
                'node-control:' || observation.record_type || ':' ||
                  observation.source_record_id AS source_partition
           FROM sdar_control.node_control_evidence_observation observation
           LEFT JOIN checkpoint ON checkpoint.source_partition=
             'node-control:' || observation.record_type || ':' || observation.source_record_id
          WHERE observation.observation_sequence>COALESCE(checkpoint.observation_sequence,0)
       ), earliest_pending AS (
         SELECT DISTINCT ON (source_partition)
                observation_sequence,record_type,source_record_id,authority_payload,
                occurred_at,source_partition
           FROM pending
          ORDER BY source_partition,observation_sequence
       )
       SELECT observation_sequence::text,record_type,source_record_id,authority_payload,occurred_at
         FROM earliest_pending
        WHERE (
          (record_type IN ('node_control.node_event','node_control.capability_readiness')
            AND observation_sequence>$1::bigint)
          OR
          (record_type NOT IN ('node_control.node_event','node_control.capability_readiness')
            AND observation_sequence>$5::bigint)
        )
          AND NOT (source_partition=ANY($3::text[]))
        ORDER BY observation_sequence
        LIMIT $4`,
      [
        bounds.eventAfter,
        JSON.stringify(Object.fromEntries(checkpointSequences)),
        [...runtimeState.backoffPartitions],
        limit,
        bounds.globalAfter,
      ],
    );
    const partitions = Object.freeze(result.rows.map(partitionFromRow));
    const last = result.rows.at(-1);
    if (last === undefined) return Object.freeze({ partitions });
    const lastEvent = [...result.rows]
      .reverse()
      .find((row) => row.record_type === 'node_control.node_event');
    return Object.freeze({
      partitions,
      nextCursor: Object.freeze({
        afterObservationSequence: last.observation_sequence,
        ...(lastEvent === undefined ? {} : { lastEventId: lastEvent.source_record_id }),
      }),
    });
  }

  async load(
    partition: NodeControlEvidenceProjectionPartition,
  ): Promise<NodeControlEvidenceSnapshot | undefined> {
    authorizeEvidenceReadPrincipal(this.#principal);
    const client = await this.#control.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await client.query<ObservationRow>(
        `SELECT observation_sequence::text,record_type,source_record_id,authority_payload,occurred_at
           FROM sdar_control.node_control_evidence_observation
          WHERE observation_sequence=$1::bigint AND record_type=$2 AND source_record_id=$3`,
        [partition.observationSequence, partition.recordType, partition.sourceRecordId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        await client.query('COMMIT');
        return undefined;
      }
      const loaded = partitionFromRow(row);
      if (!samePartition(partition, loaded)) {
        throw new NodeControlEvidenceSourceError(
          'NODE_CONTROL_EVIDENCE_AUTHORITY_INVALID',
          partition.sourcePartition,
        );
      }
      assertAuthorityReadAllowed(this.#principal, row);
      const context = { client, row };
      await assertAggregateRevisionNoRegression(context);
      const payload = await payloadFor(context);
      assertAuthorityScopePreserved(row, payload);
      const references = await referencesFor(context, payload);
      const scope = scopeFor(row, payload);
      await client.query('COMMIT');
      return Object.freeze({
        partition: loaded,
        occurredAt: iso(row.occurred_at, 'occurred_at'),
        payload,
        references,
        scope,
        observationGeneration: 0,
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async #sequenceBounds(cursor: NodeControlEvidenceSourceCursor | undefined): Promise<{
    readonly globalAfter: string;
    readonly eventAfter: string;
  }> {
    const explicit = cursor?.afterObservationSequence;
    if (explicit !== undefined) decimal(explicit, 'afterObservationSequence');
    let eventSequence = '0';
    if (cursor?.lastEventId !== undefined) {
      const eventId = requiredText(cursor.lastEventId, 'lastEventId');
      const result = await this.#control.query<{ observation_sequence: string }>(
        `SELECT observation_sequence::text FROM sdar_control.node_control_evidence_observation
          WHERE record_type='node_control.node_event' AND source_record_id=$1
          ORDER BY node_control_evidence_observation.observation_sequence DESC LIMIT 1`,
        [eventId],
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new NodeControlEvidenceSourceError('NODE_CONTROL_EVIDENCE_CURSOR_NOT_FOUND', eventId);
      eventSequence = row.observation_sequence;
    }
    const globalAfter = explicit ?? '0';
    return {
      globalAfter,
      eventAfter: BigInt(globalAfter) > BigInt(eventSequence) ? globalAfter : eventSequence,
    };
  }

  async #runtimeState(): Promise<RuntimeProjectionState> {
    if (this.#runtime === undefined)
      return { checkpoints: new Map(), backoffPartitions: new Set() };
    const checkpoints = await this.#runtime.query<{
      source_partition: string;
      last_source_revision: string;
    }>(
      `SELECT source_partition,last_source_revision
         FROM evidence_source_checkpoint
        WHERE source_family='node_control' AND projector_version=$1
          AND last_source_revision IS NOT NULL`,
      [projectorVersion],
    );
    const backoff = await this.#runtime.query<{ source_partition: string }>(
      `SELECT DISTINCT source_partition FROM evidence_projection_issue
        WHERE projector_version=$1 AND retryable AND resolved_at IS NULL
          AND created_at + interval '5 seconds' > clock_timestamp()`,
      [projectorVersion],
    );
    return {
      checkpoints: new Map(
        checkpoints.rows.map((row) => [row.source_partition, row.last_source_revision]),
      ),
      backoffPartitions: new Set(backoff.rows.map((row) => row.source_partition)),
    };
  }

  async #checkpointSequences(
    checkpoints: ReadonlyMap<string, string>,
  ): Promise<ReadonlyMap<string, string>> {
    const result = new Map<string, string>();
    for (const [sourcePartition, revisionHash] of checkpoints) {
      const prefix = 'node-control:';
      if (!sourcePartition.startsWith(prefix)) continue;
      const rows = await this.#control.query<ObservationRow>(
        `SELECT observation_sequence::text,record_type,source_record_id,authority_payload,occurred_at
           FROM sdar_control.node_control_evidence_observation
          WHERE 'node-control:' || record_type || ':' || source_record_id=$1
          ORDER BY node_control_evidence_observation.observation_sequence`,
        [sourcePartition],
      );
      const matched = rows.rows.find(
        (row) => hashCanonicalEvidenceJson(sourceRevisionFromRow(row)) === revisionHash,
      );
      if (matched !== undefined) result.set(sourcePartition, matched.observation_sequence);
    }
    return result;
  }
}

export interface NodeHealthObservationMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly actorId?: string;
}

/** Commits the health authority and its frozen hint event atomically in Control PostgreSQL. */
export class PostgresNodeHealthObservationProducer {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async record(
    observation: NodeHealthObservation,
    metadata: NodeHealthObservationMetadata = {},
  ): Promise<NodeHealthObservation> {
    validateHealth(observation);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `node-health:${observation.nodeId}`,
      ]);
      await recordHealth(client, observation, metadata);
      await client.query('COMMIT');
      return observation;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordNext(
    observationId: string,
    health: NodeHealth,
    metadata: NodeHealthObservationMetadata = {},
  ): Promise<NodeHealthObservation> {
    requiredText(observationId, 'observationId');
    validateHealthValue(health);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `node-health:${health.nodeId}`,
      ]);
      const latest = await client.query<{ revision: string }>(
        `SELECT COALESCE(MAX(observation_revision),0)::text AS revision
           FROM sdar_control.node_health_observation WHERE node_id=$1`,
        [health.nodeId],
      );
      const revision = BigInt(latest.rows[0]?.revision ?? '0') + 1n;
      if (revision > BigInt(Number.MAX_SAFE_INTEGER))
        throw Object.assign(new Error('Node health Observation revision overflowed.'), {
          code: 'NODE_HEALTH_OBSERVATION_REVISION_INVALID',
        });
      const observation: NodeHealthObservation = Object.freeze({
        ...health,
        observationId,
        observationRevision: Number(revision),
      });
      await recordHealth(client, observation, metadata);
      await client.query('COMMIT');
      return observation;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

interface SnapshotContext {
  readonly client: PoolClient;
  readonly row: ObservationRow;
}

interface AggregateRevisionDescriptor {
  readonly key: Readonly<Record<string, unknown>>;
  readonly revisionField: string;
  readonly revision: number;
}

async function assertAggregateRevisionNoRegression(context: SnapshotContext) {
  const descriptor = aggregateRevisionDescriptor(context.row);
  if (descriptor === undefined) return;
  const result = await context.client.query<{ source_record_id: string }>(
    `SELECT source_record_id
       FROM sdar_control.node_control_evidence_observation
      WHERE record_type=$1 AND observation_sequence<$2::bigint
        AND authority_payload @> $3::jsonb
        AND (authority_payload->>$4)::bigint>$5::bigint
      ORDER BY node_control_evidence_observation.observation_sequence DESC LIMIT 1`,
    [
      context.row.record_type,
      context.row.observation_sequence,
      JSON.stringify(descriptor.key),
      descriptor.revisionField,
      descriptor.revision,
    ],
  );
  if (result.rows[0] !== undefined) {
    throw new NodeControlEvidenceSourceError(
      'NODE_CONTROL_EVIDENCE_REVISION_REGRESSION',
      `${context.row.record_type}:${context.row.source_record_id}`,
    );
  }
}

function aggregateRevisionDescriptor(row: ObservationRow): AggregateRevisionDescriptor | undefined {
  const value = row.authority_payload;
  switch (row.record_type) {
    case 'node_control.profile_revision':
      return revisionDescriptor(value, ['node_id'], 'revision');
    case 'node_control.health_observation':
      return revisionDescriptor(value, ['node_id'], 'observation_revision');
    case 'node_control.configuration_revision':
    case 'node_control.telemetry_configuration':
      return revisionDescriptor(value, ['target_type', 'target_id'], 'revision');
    case 'node_control.configuration_apply_ack':
      return revisionDescriptor(value, ['configuration_id'], 'revision');
    case 'node_control.configuration_lkg_transition':
      return revisionDescriptor(value, ['target_type', 'target_id'], 'generation');
    case 'node_control.llm_provider_revision':
      return revisionDescriptor(value, ['provider_id'], 'revision');
    case 'node_control.model_route_revision':
      return revisionDescriptor(value, ['route_id'], 'revision');
    case 'node_control.smpp_source_revision':
      return revisionDescriptor(value, ['smpp_source_id'], 'revision');
    case 'node_control.mcp_provider_binding_revision':
      return revisionDescriptor(value, ['binding_id'], 'revision');
    case 'node_control.capability_revision':
      return revisionDescriptor(value, ['capability_id'], 'version');
    case 'node_control.a2a_exposure':
      return revisionDescriptor(value, ['exposure_id'], 'version');
    case 'node_control.agent_card_revision':
      return revisionDescriptor(value, ['node_id'], 'revision');
    case 'node_control.node_event':
    case 'node_control.capability_readiness':
      return revisionDescriptor(value, ['aggregate_type', 'aggregate_id'], 'aggregate_revision');
    default:
      return undefined;
  }
}

function revisionDescriptor(
  row: Readonly<Record<string, unknown>>,
  keyFields: readonly string[],
  revisionField: string,
): AggregateRevisionDescriptor {
  return {
    key: Object.freeze(Object.fromEntries(keyFields.map((field) => [field, text(row, field)]))),
    revisionField,
    revision: integer(row, revisionField),
  };
}

async function payloadFor(context: SnapshotContext): Promise<NodeControlEvidenceSourceRow> {
  const row = context.row.authority_payload;
  switch (context.row.record_type) {
    case 'node_control.profile_revision':
      return payload({
        nodeId: text(row, 'node_id'),
        nodeType: text(row, 'node_type'),
        displayName: text(row, 'display_name'),
        description: openText(row, 'description'),
        environment: text(row, 'environment'),
        labels: json(row, 'labels'),
        authorityScopes: json(row, 'authority_scopes'),
        runtimeEndpointRef: text(row, 'runtime_endpoint_ref'),
        telemetrySourceId: nullableText(row, 'telemetry_source_id'),
        status: text(row, 'status'),
        revision: integer(row, 'revision'),
        createdBy: text(row, 'created_by'),
        createdAt: timestamp(row, 'created_at'),
        updatedAt: timestamp(row, 'updated_at'),
        validatedAt: nullableTimestamp(row, 'validated_at'),
        publishedAt: nullableTimestamp(row, 'published_at'),
      });
    case 'node_control.health_observation':
      return payload({
        observationId: text(row, 'observation_id'),
        observationRevision: integer(row, 'observation_revision'),
        nodeId: text(row, 'node_id'),
        healthStatus: text(row, 'health_status'),
        components: healthComponents(row['components']),
        activeTasks: integer(row, 'active_tasks'),
        observedAt: timestamp(row, 'observed_at'),
      });
    case 'node_control.configuration_revision':
      return configurationPayload(row, false);
    case 'node_control.telemetry_configuration':
      return configurationPayload(row, true);
    case 'node_control.configuration_apply_ack':
      return payload({
        applicationId: text(row, 'application_id'),
        configurationId: text(row, 'configuration_id'),
        revision: integer(row, 'revision'),
        runtimeInstanceId: text(row, 'runtime_instance_id'),
        status: text(row, 'status'),
        observedRuntimeVersion: nullableText(row, 'observed_runtime_version'),
        activeChecksum: nullableHash(row, 'active_checksum'),
        reasonCode: nullableText(row, 'reason_code'),
        detail: json(row, 'detail'),
        acknowledgedAt: nullableTimestamp(row, 'acknowledged_at'),
      });
    case 'node_control.configuration_lkg_transition':
      return payload({
        targetType: text(row, 'target_type'),
        targetId: text(row, 'target_id'),
        desiredConfigurationId: text(row, 'desired_configuration_id'),
        desiredRevision: integer(row, 'desired_revision'),
        desiredChecksum: hash(row, 'desired_checksum'),
        desiredStatus: text(row, 'desired_status'),
        desiredOperationId: text(row, 'desired_operation_id'),
        observedConfigurationId: nullableText(row, 'observed_configuration_id'),
        observedRevision: nullableInteger(row, 'observed_revision'),
        observedChecksum: nullableHash(row, 'observed_checksum'),
        observedStatus: text(row, 'observed_status'),
        observedRuntimeVersion: nullableText(row, 'observed_runtime_version'),
        observedAt: nullableTimestamp(row, 'observed_at'),
        convergenceStatus: text(row, 'convergence_status'),
        reasonCode: nullableText(row, 'reason_code'),
        detail: nullableText(row, 'detail'),
        generation: integer(row, 'generation'),
      });
    case 'node_control.llm_provider_revision':
      return payload({
        providerId: text(row, 'provider_id'),
        revision: integer(row, 'revision'),
        providerType: text(row, 'provider_type'),
        baseUrl: text(row, 'base_url'),
        modelCatalog: json(row, 'model_catalog'),
        healthPolicy: json(row, 'health_policy'),
        rateLimitPolicy: json(row, 'rate_limit_policy'),
        status: text(row, 'status'),
        secretStatus: text(row, 'secret_status'),
        lastValidatedAt: nullableTimestamp(row, 'last_validated_at'),
        createdAt: timestamp(row, 'created_at'),
        updatedAt: timestamp(row, 'updated_at'),
      });
    case 'node_control.model_route_revision':
      return payload({
        routeId: text(row, 'route_id'),
        revision: integer(row, 'revision'),
        stage: text(row, 'stage'),
        primaryCandidate: json(row, 'primary_candidate'),
        fallbackCandidates: json(row, 'fallback_candidates'),
        budgetPolicy: json(row, 'budget_policy'),
        scopeType: text(row, 'scope_type'),
        scopeKey: text(row, 'scope_key'),
        status: text(row, 'status'),
        createdAt: timestamp(row, 'created_at'),
        updatedAt: timestamp(row, 'updated_at'),
      });
    case 'node_control.smpp_source_revision':
      return payload({
        smppSourceId: text(row, 'smpp_source_id'),
        revision: integer(row, 'revision'),
        name: nullableText(row, 'name'),
        registryEndpoint: text(row, 'registry_endpoint'),
        tenantId: nullableText(row, 'tenant_id'),
        projectId: nullableText(row, 'project_id'),
        environment: text(row, 'environment'),
        syncMode: text(row, 'sync_mode'),
        snapshotTtlSeconds: integer(row, 'snapshot_ttl_seconds'),
        lkgPolicy: text(row, 'lkg_policy'),
        status: text(row, 'status'),
        activeSnapshotRevision: nullableInteger(row, 'active_snapshot_revision'),
        activeSnapshotChecksum: nullableHash(row, 'active_snapshot_checksum'),
        activeSnapshotEtag: nullableText(row, 'active_snapshot_etag'),
        lastSyncAt: nullableTimestamp(row, 'last_sync_at'),
        lastErrorCode: nullableText(row, 'last_error_code'),
        createdAt: timestamp(row, 'created_at'),
        updatedAt: timestamp(row, 'updated_at'),
      });
    case 'node_control.mcp_provider_binding_revision':
      return payload({
        bindingId: text(row, 'binding_id'),
        revision: integer(row, 'revision'),
        localServerId: text(row, 'local_server_id'),
        originType: text(row, 'origin_type'),
        smppSourceId: nullableText(row, 'smpp_source_id'),
        externalProviderId: nullableText(row, 'external_provider_id'),
        externalServerId: nullableText(row, 'external_server_id'),
        registryRevision: nullableInteger(row, 'registry_revision'),
        registryChecksum: nullableHash(row, 'registry_checksum'),
        catalogRevision: text(row, 'catalog_revision'),
        catalogChecksum: hash(row, 'catalog_checksum'),
        endpointRef: text(row, 'endpoint_ref'),
        status: text(row, 'status'),
        availabilityStatus: text(row, 'availability_status'),
        availabilityValidUntil: timestamp(row, 'availability_valid_until'),
        catalogObservedAt: timestamp(row, 'catalog_observed_at'),
        operationCount: integer(row, 'operation_count'),
        createdAt: timestamp(row, 'created_at'),
      });
    case 'node_control.skill_governance':
    case 'node_control.plan_template_governance':
    case 'node_control.audit_event':
      return auditPayload(row);
    case 'node_control.capability_revision':
      return payload({
        capabilityId: text(row, 'capability_id'),
        version: integer(row, 'version'),
        domain: text(row, 'domain'),
        name: text(row, 'name'),
        description: text(row, 'description'),
        inputSchema: json(row, 'input_schema'),
        outputSchema: json(row, 'output_schema'),
        successCriteria: json(row, 'success_criteria'),
        requiredEvidence: json(row, 'required_evidence'),
        effects: json(row, 'effects'),
        artifacts: json(row, 'artifacts'),
        constraints: json(row, 'constraints'),
        supportedModes: json(row, 'supported_modes'),
        riskLevel: text(row, 'risk_level'),
        status: text(row, 'status'),
        definitionHash: hash(row, 'definition_hash'),
        previousVersion: nullableInteger(row, 'previous_version'),
        createdBy: nullableText(row, 'created_by'),
        createdAt: nullableTimestamp(row, 'created_at'),
        updatedAt: timestamp(row, 'updated_at'),
      });
    case 'node_control.capability_readiness':
      return readinessPayload(context);
    case 'node_control.a2a_exposure':
      return payload({
        exposureId: text(row, 'exposure_id'),
        version: integer(row, 'version'),
        capabilityId: text(row, 'capability_id'),
        capabilityVersion: integer(row, 'capability_version'),
        agentSkillId: text(row, 'agent_skill_id'),
        name: text(row, 'name'),
        description: text(row, 'description'),
        tags: json(row, 'tags'),
        examples: json(row, 'examples'),
        inputModes: json(row, 'input_modes'),
        outputModes: json(row, 'output_modes'),
        requestSchema: json(row, 'request_schema'),
        resultSchema: json(row, 'result_schema'),
        visibility: text(row, 'visibility'),
        requesterPolicy: nullableJson(row, 'requester_policy'),
        readinessPublicationPolicy: text(row, 'readiness_publication_policy'),
        status: text(row, 'status'),
        exposureHash: hash(row, 'exposure_hash'),
        createdAt: timestamp(row, 'created_at'),
        updatedAt: timestamp(row, 'updated_at'),
      });
    case 'node_control.agent_card_revision':
      return payload({
        revision: integer(row, 'revision'),
        nodeId: text(row, 'node_id'),
        exposureRefs: json(row, 'exposure_refs'),
        contentHash: hash(row, 'content_hash'),
        capabilityCatalogHash: hash(row, 'capability_catalog_hash'),
        status: text(row, 'status'),
        card: json(row, 'card'),
        generatedAt: timestamp(row, 'generated_at'),
        activatedAt: nullableTimestamp(row, 'activated_at'),
        rejectionCode: nullableText(row, 'rejection_code'),
      });
    case 'node_control.management_operation':
      return payload({
        operationId: text(row, 'operation_id'),
        operationType: text(row, 'operation_type'),
        target: payload({
          type: text(row, 'target_type'),
          id: text(row, 'target_id'),
          version: nullableText(row, 'target_version'),
          revision: nullableInteger(row, 'target_revision'),
        }),
        status: text(row, 'status'),
        idempotencyKeyHash: hash(row, 'idempotency_key_hash'),
        inputHash: hash(row, 'input_hash'),
        actorId: text(row, 'actor_id'),
        reason: text(row, 'reason'),
        result: nullableJson(row, 'result'),
        errorCode: nullableText(row, 'error_code'),
        createdAt: timestamp(row, 'created_at'),
        startedAt: nullableTimestamp(row, 'started_at'),
        completedAt: nullableTimestamp(row, 'completed_at'),
      });
    case 'node_control.node_event':
      return payload({
        sequence: decimalValue(row, 'sequence'),
        eventId: text(row, 'event_id'),
        eventType: text(row, 'event_type'),
        occurredAt: timestamp(row, 'occurred_at'),
        recordedAt: timestamp(row, 'recorded_at'),
        nodeId: text(row, 'node_id'),
        aggregateType: text(row, 'aggregate_type'),
        aggregateId: text(row, 'aggregate_id'),
        aggregateRevision: integer(row, 'aggregate_revision'),
        correlationId: text(row, 'correlation_id'),
        causationId: nullableText(row, 'causation_id'),
        actorId: nullableText(row, 'actor_id'),
        dataClassification: text(row, 'data_classification'),
        payload: json(row, 'payload'),
      });
    default:
      throw new NodeControlEvidenceSourceError(
        'NODE_CONTROL_EVIDENCE_AUTHORITY_INVALID',
        context.row.record_type,
      );
  }
}

async function referencesFor(
  context: SnapshotContext,
  payloadValue: NodeControlEvidenceSourceRow,
): Promise<readonly NodeControlEvidenceReference[]> {
  const row = context.row.authority_payload;
  switch (context.row.record_type) {
    case 'node_control.health_observation':
      return refs(
        await exactReference(
          context.client,
          'node_control.node_event',
          healthEventId(text(row, 'observation_id')),
          context.row.observation_sequence,
        ),
      );
    case 'node_control.configuration_apply_ack':
      return refs(
        await exactReference(
          context.client,
          'node_control.configuration_revision',
          `${text(row, 'configuration_id')}:${String(integer(row, 'revision'))}`,
          context.row.observation_sequence,
        ),
      );
    case 'node_control.configuration_lkg_transition': {
      const reference = await referenceByPayload(
        context.client,
        'node_control.configuration_apply_ack',
        {
          configuration_id: text(row, 'desired_configuration_id'),
          revision: integer(row, 'desired_revision'),
          acknowledged_at: nullableText(row, 'observed_at'),
        },
        context.row.observation_sequence,
      );
      return refs(reference);
    }
    case 'node_control.smpp_source_revision':
      return refs(
        await auditReference(
          context.client,
          'smpp_source',
          text(row, 'smpp_source_id'),
          integer(row, 'revision'),
          context.row.occurred_at,
          context.row.observation_sequence,
        ),
      );
    case 'node_control.skill_governance':
    case 'node_control.plan_template_governance':
      return refs(
        await exactReference(
          context.client,
          'node_control.audit_event',
          text(row, 'audit_id'),
          context.row.observation_sequence,
        ),
      );
    case 'node_control.capability_revision':
      return refs(
        await auditReference(
          context.client,
          'node_capability',
          text(row, 'capability_id'),
          integer(row, 'version'),
          context.row.occurred_at,
          context.row.observation_sequence,
        ),
      );
    case 'node_control.capability_readiness': {
      const eventId = text(row, 'event_id');
      const capabilityId = requiredPayloadText(payloadValue, 'capabilityId');
      const capabilityVersion = requiredPayloadInteger(payloadValue, 'capabilityVersion');
      return compact([
        await exactReference(
          context.client,
          'node_control.capability_revision',
          `${capabilityId}:${String(capabilityVersion)}`,
          context.row.observation_sequence,
        ),
        eventReference(eventId, integer(row, 'aggregate_revision')),
      ]);
    }
    case 'node_control.a2a_exposure':
      return refs(
        await exactReference(
          context.client,
          'node_control.capability_revision',
          `${text(row, 'capability_id')}:${String(integer(row, 'capability_version'))}`,
          context.row.observation_sequence,
        ),
      );
    default:
      return [];
  }
}

async function readinessPayload(context: SnapshotContext): Promise<NodeControlEvidenceSourceRow> {
  const row = context.row.authority_payload;
  const eventPayload = record(row['payload'], 'payload');
  const causationId = nullableText(row, 'causation_id');
  let result: Readonly<Record<string, unknown>> = {};
  if (causationId !== null) {
    const operation = await context.client.query<{ result: unknown }>(
      'SELECT result FROM sdar_control.management_operation WHERE operation_id=$1',
      [causationId],
    );
    const value = operation.rows[0]?.result;
    if (value !== null && value !== undefined)
      result = record(value, 'management_operation.result');
  }
  const authority = { ...eventPayload, ...result };
  return payload({
    eventId: text(row, 'event_id'),
    nodeId: text(row, 'node_id'),
    capabilityId: text(authority, 'capabilityId'),
    capabilityVersion: integer(authority, 'capabilityVersion'),
    readinessStatus: text(authority, 'status'),
    snapshotVersion: integer(authority, 'snapshotVersion'),
    snapshotHash: hash(authority, 'snapshotHash'),
    evaluatedAt: timestamp(authority, 'evaluatedAt'),
    validUntil: timestamp(authority, 'validUntil'),
  });
}

function configurationPayload(row: Readonly<Record<string, unknown>>, telemetry: boolean) {
  return payload({
    configurationId: text(row, 'configuration_id'),
    ...(telemetry ? {} : { targetType: text(row, 'target_type') }),
    targetId: text(row, 'target_id'),
    revision: integer(row, 'revision'),
    status: text(row, 'status'),
    applyMode: text(row, 'apply_mode'),
    content: redactSensitiveConfiguration(json(row, 'content')),
    checksum: hash(row, 'checksum'),
    createdBy: text(row, 'created_by'),
    createdAt: timestamp(row, 'created_at'),
    publishedAt: nullableTimestamp(row, 'published_at'),
  });
}

function redactSensitiveConfiguration(value: EvidenceJsonValue, depth = 0): EvidenceJsonValue {
  if (depth > 64) invalid('content');
  if (isEvidenceJsonArray(value)) {
    return Object.freeze(value.map((entry) => redactSensitiveConfiguration(entry, depth + 1)));
  }
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, EvidenceJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^a-z0-9]/giu, '').toLowerCase();
    if (
      normalized.includes('credential') ||
      normalized.includes('secret') ||
      normalized.includes('token')
    )
      continue;
    result[key] = redactSensitiveConfiguration(entry, depth + 1);
  }
  return Object.freeze(result);
}

function isEvidenceJsonArray(value: EvidenceJsonValue): value is readonly EvidenceJsonValue[] {
  return Array.isArray(value);
}

function auditPayload(row: Readonly<Record<string, unknown>>) {
  return payload({
    auditId: text(row, 'audit_id'),
    actorId: text(row, 'actor_id'),
    action: text(row, 'action'),
    aggregateType: text(row, 'aggregate_type'),
    aggregateId: text(row, 'aggregate_id'),
    expectedRevision: nullableInteger(row, 'expected_revision'),
    resultRevision: nullableInteger(row, 'result_revision'),
    reason: text(row, 'reason'),
    requestHash: hash(row, 'request_hash'),
    resultCode: text(row, 'result_code'),
    createdAt: timestamp(row, 'created_at'),
  });
}

async function exactReference(
  client: PoolClient,
  recordType: NodeControlEvidenceRecordType,
  sourceRecordId: string,
  maximumSequence: string,
) {
  const result = await client.query<ObservationRow>(
    `SELECT observation_sequence::text,record_type,source_record_id,authority_payload,occurred_at
       FROM sdar_control.node_control_evidence_observation
      WHERE record_type=$1 AND source_record_id=$2 AND observation_sequence<=$3::bigint
      ORDER BY node_control_evidence_observation.observation_sequence DESC LIMIT 1`,
    [recordType, sourceRecordId, maximumSequence],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : referenceFromRow(row);
}

async function referenceByPayload(
  client: PoolClient,
  recordType: NodeControlEvidenceRecordType,
  required: Readonly<Record<string, unknown>>,
  maximumSequence: string,
) {
  const result = await client.query<ObservationRow>(
    `SELECT observation_sequence::text,record_type,source_record_id,authority_payload,occurred_at
       FROM sdar_control.node_control_evidence_observation
      WHERE record_type=$1 AND observation_sequence<=$2::bigint AND authority_payload @> $3::jsonb
      ORDER BY node_control_evidence_observation.observation_sequence DESC LIMIT 2`,
    [recordType, maximumSequence, JSON.stringify(required)],
  );
  if (result.rows.length > 1)
    throw new NodeControlEvidenceSourceError(
      'NODE_CONTROL_EVIDENCE_REFERENCE_AMBIGUOUS',
      recordType,
    );
  const row = result.rows[0];
  return row === undefined ? undefined : referenceFromRow(row);
}

async function auditReference(
  client: PoolClient,
  aggregateType: string,
  aggregateId: string,
  revision: number,
  authorityOccurredAt: Date | string,
  maximumSequence: string,
) {
  const result = await client.query<ObservationRow>(
    `SELECT observation_sequence::text,record_type,source_record_id,authority_payload,occurred_at
       FROM sdar_control.node_control_evidence_observation
      WHERE record_type='node_control.audit_event'
        AND authority_payload->>'aggregate_type'=$1 AND authority_payload->>'aggregate_id'=$2
        AND COALESCE(authority_payload->>'result_revision',authority_payload->>'expected_revision')=$3
        AND (authority_payload->>'created_at')::timestamptz=$4::timestamptz
        AND observation_sequence<=$5::bigint
      ORDER BY node_control_evidence_observation.observation_sequence DESC LIMIT 2`,
    [
      aggregateType,
      aggregateId,
      String(revision),
      iso(authorityOccurredAt, 'occurred_at'),
      maximumSequence,
    ],
  );
  if (result.rows.length > 1)
    throw new NodeControlEvidenceSourceError(
      'NODE_CONTROL_EVIDENCE_REFERENCE_AMBIGUOUS',
      `${aggregateType}:${aggregateId}:${String(revision)}`,
    );
  const row = result.rows[0];
  return row === undefined ? undefined : referenceFromRow(row);
}

function referenceFromRow(row: ObservationRow): NodeControlEvidenceReference {
  return Object.freeze({
    recordType: row.record_type,
    sourceRecordId: row.source_record_id,
    sourceRevision: sourceRevisionFromRow(row),
  });
}

function eventReference(eventId: string, revision: number): NodeControlEvidenceReference {
  return Object.freeze({
    recordType: 'node_control.node_event',
    sourceRecordId: eventId,
    sourceRevision: revision,
  });
}

function partitionFromRow(row: ObservationRow): NodeControlEvidenceProjectionPartition {
  return Object.freeze({
    recordType: row.record_type,
    sourcePartition: partitionKey(row.record_type, row.source_record_id),
    sourceRecordId: row.source_record_id,
    sourceRevision: sourceRevisionFromRow(row),
    observationSequence: row.observation_sequence,
  });
}

function sourceRevisionFromRow(row: ObservationRow): EvidenceJsonValue {
  if (row.record_type === 'node_control.telemetry_configuration')
    return integer(row.authority_payload, 'revision');
  return eventRecordTypes.has(row.record_type)
    ? integer(row.authority_payload, 'aggregate_revision')
    : row.observation_sequence;
}

function partitionKey(recordType: NodeControlEvidenceRecordType, sourceRecordId: string) {
  return `node-control:${recordType}:${sourceRecordId}`;
}

function samePartition(
  left: NodeControlEvidenceProjectionPartition,
  right: NodeControlEvidenceProjectionPartition,
) {
  return (
    left.recordType === right.recordType &&
    left.sourcePartition === right.sourcePartition &&
    left.sourceRecordId === right.sourceRecordId &&
    left.observationSequence === right.observationSequence &&
    hashCanonicalEvidenceJson(left.sourceRevision) ===
      hashCanonicalEvidenceJson(right.sourceRevision)
  );
}

function scopeFor(row: ObservationRow, payloadValue: NodeControlEvidenceSourceRow) {
  const raw = row.authority_payload;
  const correlationId =
    nullableText(raw, 'correlation_id') ??
    nullableText(raw, 'idempotency_key_hash') ??
    row.source_record_id;
  const nodeId = optionalPayloadText(payloadValue, 'nodeId');
  const tenantId = optionalPayloadText(payloadValue, 'tenantId');
  const projectId = optionalPayloadText(payloadValue, 'projectId');
  const causationId = nullableText(raw, 'causation_id');
  return Object.freeze({
    correlationId,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(tenantId === undefined ? {} : { tenantId }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(causationId === null ? {} : { causationId }),
  });
}

function healthEventId(observationId: string) {
  return `health:${observationId}`;
}

async function recordHealth(
  client: PoolClient,
  observation: NodeHealthObservation,
  metadata: NodeHealthObservationMetadata,
) {
  const existing = await client.query<{ value: Readonly<Record<string, unknown>> }>(
    `SELECT to_jsonb(value) AS value
       FROM sdar_control.node_health_observation value WHERE observation_id=$1`,
    [observation.observationId],
  );
  if (existing.rows[0] !== undefined) {
    if (!sameHealth(existing.rows[0].value, observation)) {
      throw Object.assign(new Error('Node health Observation ID was reused.'), {
        code: 'NODE_HEALTH_OBSERVATION_CONFLICT',
      });
    }
    await assertHealthEvent(client, observation, metadata);
    return;
  }
  const latest = await client.query<{ revision: string }>(
    `SELECT COALESCE(MAX(observation_revision),0)::text AS revision
       FROM sdar_control.node_health_observation WHERE node_id=$1`,
    [observation.nodeId],
  );
  if (BigInt(observation.observationRevision) <= BigInt(latest.rows[0]?.revision ?? '0')) {
    throw Object.assign(new Error('Node health Observation revision regressed.'), {
      code: 'NODE_HEALTH_OBSERVATION_REVISION_REGRESSION',
    });
  }
  await client.query(
    `INSERT INTO sdar_control.node_event_outbox(
       event_id,event_type,occurred_at,node_id,aggregate_type,aggregate_id,
       aggregate_revision,correlation_id,causation_id,actor_id,data_classification,payload)
     VALUES($1,'node.health.changed',$2,$3,'node_health_observation',$4,$5,$6,$7,$8,
       'internal',$9::jsonb)`,
    [
      healthEventId(observation.observationId),
      observation.observedAt,
      observation.nodeId,
      observation.observationId,
      observation.observationRevision,
      metadata.correlationId ?? observation.observationId,
      metadata.causationId ?? null,
      metadata.actorId ?? null,
      JSON.stringify({
        resourceRef: {
          type: 'node_health_observation',
          id: observation.observationId,
          revision: observation.observationRevision,
        },
        changeCode: 'NODE_HEALTH_OBSERVED',
      }),
    ],
  );
  await client.query(
    `INSERT INTO sdar_control.node_health_observation(
       observation_id,node_id,health_status,components,active_tasks,observation_revision,
       observed_at,correlation_id,causation_id,actor_id)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)`,
    [
      observation.observationId,
      observation.nodeId,
      observation.status,
      JSON.stringify(observation.components),
      observation.activeTasks,
      observation.observationRevision,
      observation.observedAt,
      metadata.correlationId ?? observation.observationId,
      metadata.causationId ?? null,
      metadata.actorId ?? null,
    ],
  );
}

async function assertHealthEvent(
  client: PoolClient,
  observation: NodeHealthObservation,
  metadata: NodeHealthObservationMetadata,
) {
  const result = await client.query<{
    aggregate_revision: string;
    payload: unknown;
    correlation_id: string;
    causation_id: string | null;
    actor_id: string | null;
  }>(
    `SELECT aggregate_revision::text,payload,correlation_id,causation_id,actor_id
       FROM sdar_control.node_event_outbox WHERE event_id=$1`,
    [healthEventId(observation.observationId)],
  );
  const row = result.rows[0];
  const expectedPayload = {
    resourceRef: {
      type: 'node_health_observation',
      id: observation.observationId,
      revision: observation.observationRevision,
    },
    changeCode: 'NODE_HEALTH_OBSERVED',
  };
  if (row === undefined) {
    throw Object.assign(new Error('Node health Event replay conflicted.'), {
      code: 'NODE_HEALTH_EVENT_CONFLICT',
    });
  }
  if (
    row.aggregate_revision !== String(observation.observationRevision) ||
    hashCanonicalEvidenceJson(row.payload) !== hashCanonicalEvidenceJson(expectedPayload) ||
    row.correlation_id !== (metadata.correlationId ?? observation.observationId) ||
    row.causation_id !== (metadata.causationId ?? null) ||
    row.actor_id !== (metadata.actorId ?? null)
  ) {
    throw Object.assign(new Error('Node health Event replay conflicted.'), {
      code: 'NODE_HEALTH_EVENT_CONFLICT',
    });
  }
}

function validateHealth(value: NodeHealthObservation) {
  requiredText(value.observationId, 'observationId');
  if (!Number.isSafeInteger(value.observationRevision) || value.observationRevision < 1)
    throw new Error('NODE_HEALTH_OBSERVATION_REVISION_INVALID');
  validateHealthValue(value);
}

function authorizeEvidenceReadPrincipal(
  value: NodeControlEvidenceReadPrincipal,
): NodeControlEvidenceReadPrincipal {
  const principal = value as Partial<NodeControlEvidenceReadPrincipal> | undefined;
  const nodeId = principal?.nodeId;
  const actorId = principal?.actorId;
  const classifications = principal?.allowedDataClassifications;
  const expectedClassifications = ['public', 'internal', 'restricted'] as const;
  if (
    principal?.principalType !== 'service' ||
    principal.role !== 'node_control_evidence_projector' ||
    principal.permission !== 'node_control.evidence.read' ||
    principal.authorityScope !== 'global_authority' ||
    principal.organizationScope !== 'node_local' ||
    typeof nodeId !== 'string' ||
    nodeId.trim() === '' ||
    actorId !== `service:node-control-evidence-projector:${nodeId}` ||
    !Array.isArray(classifications) ||
    classifications.length !== expectedClassifications.length ||
    expectedClassifications.some((classification) => !classifications.includes(classification))
  ) {
    throw new NodeControlEvidenceSourceError(
      'NODE_CONTROL_EVIDENCE_READ_FORBIDDEN',
      'projector_service_principal',
    );
  }
  return Object.freeze({
    principalType: 'service',
    actorId,
    role: 'node_control_evidence_projector',
    permission: 'node_control.evidence.read',
    authorityScope: 'global_authority',
    organizationScope: 'node_local',
    nodeId,
    allowedDataClassifications: Object.freeze([...expectedClassifications]),
  });
}

function assertAuthorityReadAllowed(
  principal: NodeControlEvidenceReadPrincipal,
  row: ObservationRow,
): void {
  const classification =
    row.record_type === 'node_control.node_event'
      ? row.authority_payload['data_classification']
      : 'internal';
  if (
    typeof classification !== 'string' ||
    !principal.allowedDataClassifications.includes(
      classification as 'public' | 'internal' | 'restricted',
    )
  ) {
    throw new NodeControlEvidenceSourceError(
      'NODE_CONTROL_EVIDENCE_READ_FORBIDDEN',
      'data_classification',
    );
  }
}

function assertAuthorityScopePreserved(
  row: ObservationRow,
  mapped: NodeControlEvidenceSourceRow,
): void {
  for (const [authorityField, payloadField] of [
    ['tenant_id', 'tenantId'],
    ['project_id', 'projectId'],
    ['organization_id', 'organizationId'],
  ] as const) {
    const authorityValue = row.authority_payload[authorityField];
    const mappedValue = mapped[payloadField];
    if (
      authorityValue !== undefined &&
      authorityValue !== null &&
      (typeof authorityValue !== 'string' ||
        authorityValue.trim() === '' ||
        mappedValue !== authorityValue)
    ) {
      throw new NodeControlEvidenceSourceError(
        'NODE_CONTROL_EVIDENCE_SCOPE_MISMATCH',
        payloadField,
      );
    }
  }
}

function validateHealthValue(value: NodeHealth) {
  requiredText(value.nodeId, 'nodeId');
  if (!['healthy', 'degraded', 'unavailable', 'maintenance'].includes(value.status))
    throw new Error('NODE_HEALTH_STATUS_INVALID');
  if (!Number.isSafeInteger(value.activeTasks) || value.activeTasks < 0)
    throw new Error('NODE_HEALTH_ACTIVE_TASKS_INVALID');
  iso(value.observedAt, 'observedAt');
  const componentValues: unknown = value.components;
  if (!Array.isArray(componentValues) || componentValues.length > 64)
    throw new Error('NODE_HEALTH_COMPONENTS_INVALID');
  const components: readonly unknown[] = componentValues;
  for (const componentValue of components) {
    const component = record(componentValue, 'components[]');
    text(component, 'component');
    const status = text(component, 'status');
    if (!['healthy', 'degraded', 'unavailable', 'disabled'].includes(status))
      throw new Error('NODE_HEALTH_COMPONENT_STATUS_INVALID');
    nullableText(component, 'reasonCode');
    timestamp(component, 'observedAt');
  }
}

function sameHealth(row: Readonly<Record<string, unknown>>, value: NodeHealthObservation) {
  return (
    text(row, 'node_id') === value.nodeId &&
    text(row, 'health_status') === value.status &&
    integer(row, 'active_tasks') === value.activeTasks &&
    integer(row, 'observation_revision') === value.observationRevision &&
    iso(text(row, 'observed_at'), 'observed_at') === iso(value.observedAt, 'observedAt') &&
    hashCanonicalEvidenceJson(row['components']) === hashCanonicalEvidenceJson(value.components)
  );
}

function healthComponents(value: unknown): EvidenceJsonValue {
  if (!Array.isArray(value)) invalid('components');
  return Object.freeze(
    value.map((entry) => {
      const component = record(entry, 'component');
      return payload({
        component: text(component, 'component'),
        status: text(component, 'status'),
        reasonCode: nullableText(component, 'reasonCode'),
        observedAt: timestamp(component, 'observedAt'),
      });
    }),
  );
}

function payload(value: Readonly<Record<string, EvidenceJsonValue>>): NodeControlEvidenceSourceRow {
  return Object.freeze(value);
}
function compact(values: readonly (NodeControlEvidenceReference | undefined)[]) {
  return Object.freeze(
    values.filter((value): value is NodeControlEvidenceReference => value !== undefined),
  );
}
function refs(value: NodeControlEvidenceReference | undefined) {
  return value === undefined ? [] : [value];
}
function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field);
  return value as Readonly<Record<string, unknown>>;
}
function text(row: Readonly<Record<string, unknown>>, field: string, fallback?: string): string {
  const value = row[field];
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (fallback !== undefined) return fallback;
  invalid(field);
}
function openText(row: Readonly<Record<string, unknown>>, field: string) {
  const value = row[field];
  if (typeof value === 'string') return value;
  invalid(field);
}
function nullableText(row: Readonly<Record<string, unknown>>, field: string) {
  const value = row[field];
  return value === null || value === undefined ? null : text(row, field);
}
function integer(row: Readonly<Record<string, unknown>>, field: string, fallback?: number): number {
  const raw = row[field];
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && /^-?[0-9]+$/u.test(raw)
        ? Number(raw)
        : fallback;
  if (value === undefined || !Number.isSafeInteger(value)) invalid(field);
  return value;
}
function nullableInteger(row: Readonly<Record<string, unknown>>, field: string) {
  return row[field] === null || row[field] === undefined ? null : integer(row, field);
}
function timestamp(row: Readonly<Record<string, unknown>>, field: string) {
  return iso(text(row, field), field);
}
function nullableTimestamp(row: Readonly<Record<string, unknown>>, field: string) {
  const value = nullableText(row, field);
  return value === null ? null : iso(value, field);
}
function iso(value: Date | string, field: string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid(field);
  return parsed.toISOString();
}
function hash(row: Readonly<Record<string, unknown>>, field: string) {
  const value = text(row, field);
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}
function nullableHash(row: Readonly<Record<string, unknown>>, field: string) {
  return row[field] === null || row[field] === undefined ? null : hash(row, field);
}
function json(row: Readonly<Record<string, unknown>>, field: string) {
  return evidenceJson(row[field], field);
}
function nullableJson(row: Readonly<Record<string, unknown>>, field: string) {
  return row[field] === null || row[field] === undefined ? null : json(row, field);
}
function evidenceJson(value: unknown, field: string, depth = 0): EvidenceJsonValue {
  if (depth > 64) invalid(field);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value))
    return Object.freeze(value.map((item) => evidenceJson(item, field, depth + 1)));
  if (typeof value === 'object') {
    const result: Record<string, EvidenceJsonValue> = {};
    for (const [key, item] of Object.entries(value))
      result[key] = evidenceJson(item, `${field}.${key}`, depth + 1);
    return Object.freeze(result);
  }
  invalid(field);
}
function optionalPayloadText(value: NodeControlEvidenceSourceRow, field: string) {
  const item = value[field];
  return typeof item === 'string' && item.trim() !== '' ? item : undefined;
}
function requiredPayloadText(value: NodeControlEvidenceSourceRow, field: string) {
  const item = optionalPayloadText(value, field);
  if (item === undefined) invalid(field);
  return item;
}
function requiredPayloadInteger(value: NodeControlEvidenceSourceRow, field: string) {
  const item = value[field];
  if (typeof item !== 'number' || !Number.isSafeInteger(item)) invalid(field);
  return item;
}
function requiredText(value: string, field: string) {
  const clean = value.trim();
  if (clean === '') invalid(field);
  return clean;
}
function decimal(value: string, field: string) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value))
    throw new NodeControlEvidenceSourceError('NODE_CONTROL_EVIDENCE_CURSOR_INVALID', field);
  return value;
}
function decimalValue(row: Readonly<Record<string, unknown>>, field: string) {
  const value = row[field];
  return decimal(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : typeof value === 'string'
        ? value
        : '',
    field,
  );
}
function boundedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000)
    throw new NodeControlEvidenceSourceError('NODE_CONTROL_EVIDENCE_CURSOR_INVALID', 'limit');
}
function invalid(field: string): never {
  throw new NodeControlEvidenceSourceError('NODE_CONTROL_EVIDENCE_AUTHORITY_INVALID', field);
}
