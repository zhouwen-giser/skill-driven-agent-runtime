import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  type CurrentMcpProviderBindingAuthority,
  NodeControlMcpBindingError,
  type ConfigurationMutationContext,
  type NodeControlMcpProviderBindingRepository,
} from '../../node-control-application/src/index.js';
import {
  createMcpProviderBindingRecord,
  transitionManagementOperation,
  type ManagementOperation,
  type McpProviderBinding,
  type McpProviderBindingRecord,
  type SmppProviderCandidateDirectoryEntry,
} from '../../node-control-domain/src/index.js';

interface BindingRow extends QueryResultRow {
  binding_id: string;
  revision: string;
  local_server_id: string;
  origin_type: McpProviderBinding['originType'];
  smpp_source_id: string | null;
  external_provider_id: string | null;
  external_server_id: string | null;
  registry_revision: string | null;
  registry_checksum: string | null;
  catalog_revision: string;
  catalog_checksum: string;
  endpoint_ref: string;
  credential_ref: string;
  status: McpProviderBinding['status'];
  availability_status: McpProviderBinding['availabilityStatus'];
  availability_valid_until: Date;
  catalog_observed_at: Date;
  operation_count: number;
}

interface CandidateRow extends QueryResultRow {
  smpp_source_id: string;
  external_provider_id: string;
  external_server_id: string;
  composite_identity: string;
  server_endpoint: string;
  display_name: string | null;
  catalog_revision: string | null;
  labels: Record<string, string>;
  snapshot_revision: string;
  checksum: string;
  etag: string;
  valid_until: Date;
}

interface AuthorityRow extends BindingRow {
  authority_smpp_source_id: string | null;
  authority_external_provider_id: string | null;
  authority_external_server_id: string | null;
  authority_registry_revision: string | null;
  authority_registry_checksum: string | null;
  authority_native_revision: string | null;
  authority_native_checksum: string | null;
  authority_projection_contract: string | null;
  authority_candidate_endpoint: string | null;
}

interface ReceiptRow extends QueryResultRow {
  request_hash: string;
  operation_id: string | null;
}

interface OperationRow extends QueryResultRow {
  operation_id: string;
  operation_type: string;
  target_type: string;
  target_id: string;
  target_version: string | null;
  target_revision: string | null;
  status: ManagementOperation['status'];
  idempotency_key_hash: string;
  input_hash: string;
  actor_id: string;
  reason: string;
  result: unknown;
  error_code: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export class PostgresNodeControlMcpProviderBindingRepository implements NodeControlMcpProviderBindingRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(bindingId: string, revision?: number): Promise<McpProviderBindingRecord | undefined> {
    return findRecord(this.#pool, bindingId, revision);
  }

  async findLatestActive(bindingId: string): Promise<McpProviderBindingRecord | undefined> {
    const result = await this.#pool.query<BindingRow>(
      `SELECT * FROM sdar_control.mcp_provider_binding
        WHERE binding_id=$1 AND status='active' ORDER BY revision DESC LIMIT 1`,
      [bindingId],
    );
    return result.rows[0] === undefined ? undefined : mapRecord(result.rows[0]);
  }

  async list(limit: number): Promise<readonly McpProviderBinding[]> {
    const result = await this.#pool.query<BindingRow>(
      `SELECT DISTINCT ON (binding_id) * FROM sdar_control.mcp_provider_binding
        ORDER BY binding_id,revision DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => mapRecord(row).binding);
  }

  async findSelectable(
    localServerId: string,
    observedAt: string,
  ): Promise<McpProviderBinding | undefined> {
    const result = await this.#pool.query<BindingRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (binding_id) * FROM sdar_control.mcp_provider_binding
          ORDER BY binding_id,revision DESC
       ) binding
       WHERE local_server_id=$1 AND status='active' AND availability_status='available'
         AND availability_valid_until>$2
       ORDER BY binding_id LIMIT 1`,
      [localServerId, observedAt],
    );
    return result.rows[0] === undefined ? undefined : mapRecord(result.rows[0]).binding;
  }

  async findCurrentAuthority(
    input: Readonly<{ bindingId?: string; localServerId: string; observedAt: string }>,
  ): Promise<CurrentMcpProviderBindingAuthority | undefined> {
    const result = await this.#pool.query<AuthorityRow>(
      `WITH latest_binding AS (
         SELECT DISTINCT ON (binding_id) *
           FROM sdar_control.mcp_provider_binding
          WHERE local_server_id=$1 AND ($2::text IS NULL OR binding_id=$2)
          ORDER BY binding_id,revision DESC
       ), latest_source AS (
         SELECT DISTINCT ON (smpp_source_id) *
           FROM sdar_control.smpp_registry_source
          ORDER BY smpp_source_id,revision DESC
       )
       SELECT binding.*,
              candidate.smpp_source_id AS authority_smpp_source_id,
              candidate.external_provider_id AS authority_external_provider_id,
              candidate.external_server_id AS authority_external_server_id,
              snapshot.snapshot_revision::text AS authority_registry_revision,
              snapshot.checksum::text AS authority_registry_checksum,
              lineage.native_revision::text AS authority_native_revision,
              lineage.native_checksum::text AS authority_native_checksum,
              lineage.projection_contract AS authority_projection_contract,
              candidate.server_endpoint AS authority_candidate_endpoint
         FROM latest_binding binding
         LEFT JOIN latest_source source
           ON source.smpp_source_id=binding.smpp_source_id
         LEFT JOIN sdar_control.smpp_registry_snapshot snapshot
           ON snapshot.smpp_source_id=source.smpp_source_id
          AND snapshot.snapshot_revision=source.active_snapshot_revision
         LEFT JOIN sdar_control.smpp_provider_candidate candidate
           ON candidate.smpp_source_id=snapshot.smpp_source_id
          AND candidate.snapshot_revision=snapshot.snapshot_revision
          AND candidate.external_provider_id=binding.external_provider_id
          AND candidate.external_server_id=binding.external_server_id
         LEFT JOIN sdar_control.smpp_registry_snapshot_lineage lineage
           ON lineage.smpp_source_id=snapshot.smpp_source_id
          AND lineage.snapshot_revision=snapshot.snapshot_revision
        WHERE binding.status='active'
          AND binding.availability_status='available'
          AND binding.availability_valid_until>$3
          AND (
            binding.origin_type='direct'
            OR (
              source.status='active'
              AND source.active_snapshot_revision=binding.registry_revision
              AND source.active_snapshot_checksum=binding.registry_checksum
              AND snapshot.snapshot_revision=binding.registry_revision
              AND snapshot.checksum=binding.registry_checksum
              AND source.active_snapshot_valid_until>$3
              AND (source.lkg_policy='allow_unexpired' OR source.last_error_code IS NULL)
              AND candidate.smpp_source_id IS NOT NULL
              AND candidate.server_endpoint=binding.endpoint_ref
              AND lineage.native_revision IS NOT NULL
              AND lineage.native_checksum IS NOT NULL
              AND lineage.projection_contract='sdar-registry-v1'
            )
          )
        ORDER BY binding.binding_id
        LIMIT 2`,
      [input.localServerId, input.bindingId ?? null, input.observedAt],
    );
    if (result.rows.length > 1)
      throw new NodeControlMcpBindingError(
        'MCP_PROVIDER_BINDING_AUTHORITY_AMBIGUOUS',
        'More than one current MCP Provider Binding matches the local Server.',
      );
    return result.rows[0] === undefined
      ? undefined
      : mapCurrentAuthority(result.rows[0], input.observedAt);
  }

  async findSmppCandidate(
    input: Parameters<NodeControlMcpProviderBindingRepository['findSmppCandidate']>[0],
  ): Promise<SmppProviderCandidateDirectoryEntry | undefined> {
    const result = await this.#pool.query<CandidateRow>(
      `WITH latest_source AS (
         SELECT DISTINCT ON (smpp_source_id) *
           FROM sdar_control.smpp_registry_source
          ORDER BY smpp_source_id,revision DESC
       )
       SELECT candidate.smpp_source_id,candidate.external_provider_id,candidate.external_server_id,
              candidate.composite_identity,candidate.server_endpoint,candidate.display_name,
              candidate.catalog_revision,candidate.labels,snapshot.snapshot_revision::text,
              snapshot.checksum::text,snapshot.etag,
              source.active_snapshot_valid_until AS valid_until
         FROM latest_source source
         JOIN sdar_control.smpp_registry_snapshot snapshot
           ON snapshot.smpp_source_id=source.smpp_source_id
          AND snapshot.snapshot_revision=source.active_snapshot_revision
         JOIN sdar_control.smpp_provider_candidate candidate
           ON candidate.smpp_source_id=snapshot.smpp_source_id
          AND candidate.snapshot_revision=snapshot.snapshot_revision
         JOIN sdar_control.smpp_registry_snapshot_lineage lineage
           ON lineage.smpp_source_id=snapshot.smpp_source_id
          AND lineage.snapshot_revision=snapshot.snapshot_revision
        WHERE source.smpp_source_id=$1 AND source.status='active'
          AND candidate.external_provider_id=$2 AND candidate.external_server_id=$3
          AND snapshot.snapshot_revision=$4 AND snapshot.checksum=$5
          AND source.active_snapshot_checksum=snapshot.checksum
          AND source.active_snapshot_valid_until>$6
          AND lineage.native_revision IS NOT NULL
          AND lineage.native_checksum IS NOT NULL
          AND lineage.projection_contract='sdar-registry-v1'
          AND (source.lkg_policy='allow_unexpired' OR source.last_error_code IS NULL)
        ORDER BY source.revision DESC LIMIT 1`,
      [
        input.smppSourceId,
        input.externalProviderId,
        input.externalServerId,
        input.registryRevision,
        input.registryChecksum,
        input.observedAt,
      ],
    );
    return result.rows[0] === undefined ? undefined : mapCandidate(result.rows[0]);
  }

  async findCommandReplay(
    scope: string,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined> {
    const receipt = await readReceipt(this.#pool, scope, context);
    if (receipt?.operation_id === null || receipt?.operation_id === undefined) return undefined;
    const operation = await findOperation(this.#pool, receipt.operation_id);
    if (operation === undefined) throw new Error('CONTROL_MCP_BINDING_RECEIPT_DANGLING');
    return operation;
  }

  completeImport(
    record: McpProviderBindingRecord,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    return this.transaction(async (client) => {
      await lockBinding(client, record.binding.bindingId);
      await lockLocalServer(client, record.binding.localServerId);
      const replay = await lockedReplay(client, 'mcp-binding:import', context);
      if (replay !== undefined) return replay;
      if ((await findRecord(client, record.binding.bindingId)) !== undefined)
        throw new NodeControlMcpBindingError(
          'MCP_PROVIDER_BINDING_CONFLICT',
          'MCP Provider Binding already exists.',
        );
      const local = await client.query(
        `SELECT 1 FROM sdar_control.mcp_provider_binding WHERE local_server_id=$1 LIMIT 1`,
        [record.binding.localServerId],
      );
      if (local.rows[0] !== undefined)
        throw new NodeControlMcpBindingError(
          'MCP_PROVIDER_BINDING_CONFLICT',
          'localServerId is already assigned to another Binding.',
        );
      await insertRecord(client, record, context.occurredAt);
      return finish(client, operation, context, record, 'imported', 'mcp-binding:import');
    });
  }

  completeRevision(
    prior: McpProviderBindingRecord,
    record: McpProviderBindingRecord,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    resultCode: string,
  ): Promise<ManagementOperation> {
    const scope = scopeFor(operation.operationType);
    return this.transaction(async (client) => {
      await lockBinding(client, prior.binding.bindingId);
      const replay = await lockedReplay(client, scope, context);
      if (replay !== undefined) return replay;
      if (scope === 'mcp-binding:rebind') {
        const sourceId = record.binding.smppSourceId;
        if (sourceId === undefined)
          throw new NodeControlMcpBindingError(
            'MCP_PROVIDER_BINDING_CONFLICT',
            'Rebind requires complete SMPP Candidate lineage.',
          );
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `smpp-source:${sourceId}`,
        ]);
        await assertCurrentRebindCandidate(client, record);
      }
      const current = await findRecord(client, prior.binding.bindingId);
      if (current?.binding.revision !== prior.binding.revision)
        throw new NodeControlMcpBindingError(
          'MCP_PROVIDER_BINDING_CONFLICT',
          'MCP Provider Binding revision changed before the command completed.',
        );
      if (record.binding.revision !== prior.binding.revision + 1)
        throw new NodeControlMcpBindingError(
          'MCP_PROVIDER_BINDING_CONFLICT',
          'MCP Provider Binding revisions must be contiguous.',
        );
      await insertRecord(client, record, context.occurredAt);
      return finish(client, operation, context, record, resultCode, scope);
    });
  }

  recordImportFailure(
    bindingId: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    errorCode: string,
  ): Promise<ManagementOperation> {
    return this.transaction(async (client) => {
      await lockBinding(client, bindingId);
      const replay = await lockedReplay(client, 'mcp-binding:import', context);
      if (replay !== undefined) return replay;
      const completed = transitionManagementOperation(
        transitionManagementOperation(operation, 'running', context.occurredAt),
        'failed',
        context.occurredAt,
        { errorCode },
      );
      await insertOperation(client, completed);
      await insertReceipt(
        client,
        'mcp-binding:import',
        context,
        bindingId,
        1,
        completed.operationId,
      );
      await insertAudit(client, bindingId, 1, context, errorCode);
      return completed;
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

async function finish(
  client: PoolClient,
  operation: ManagementOperation,
  context: ConfigurationMutationContext,
  record: McpProviderBindingRecord,
  resultCode: string,
  scope: string,
): Promise<ManagementOperation> {
  const failed = [
    'MCP_PROVIDER_DISCOVERY_FAILED',
    'MCP_ENDPOINT_NOT_ALLOWED',
    'SECRET_REFERENCE_UNAVAILABLE',
  ].includes(resultCode);
  const running = transitionManagementOperation(operation, 'running', context.occurredAt);
  const completed = failed
    ? transitionManagementOperation(running, 'failed', context.occurredAt, {
        errorCode: resultCode,
      })
    : transitionManagementOperation(running, 'succeeded', context.occurredAt, {
        result: Object.freeze({
          bindingId: record.binding.bindingId,
          revision: record.binding.revision,
          status: record.binding.status,
          catalogRevision: record.binding.catalogRevision,
          catalogChecksum: record.binding.catalogChecksum,
          availabilityStatus: record.binding.availabilityStatus,
          operationCount: record.operationCount,
          resultCode,
        }),
      });
  await insertOperation(client, completed);
  await insertReceipt(
    client,
    scope,
    context,
    record.binding.bindingId,
    record.binding.revision,
    completed.operationId,
  );
  await insertObservation(client, record, resultCode);
  await insertAudit(client, record.binding.bindingId, record.binding.revision, context, resultCode);
  return completed;
}

async function findRecord(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  bindingId: string,
  revision?: number,
): Promise<McpProviderBindingRecord | undefined> {
  const result = await database.query<BindingRow>(
    `SELECT * FROM sdar_control.mcp_provider_binding
      WHERE binding_id=$1 AND ($2::bigint IS NULL OR revision=$2)
      ORDER BY revision DESC LIMIT 1`,
    [bindingId, revision ?? null],
  );
  return result.rows[0] === undefined ? undefined : mapRecord(result.rows[0]);
}

function insertRecord(client: PoolClient, record: McpProviderBindingRecord, createdAt: string) {
  const binding = record.binding;
  return client.query(
    `INSERT INTO sdar_control.mcp_provider_binding(
       binding_id,revision,local_server_id,origin_type,smpp_source_id,external_provider_id,
       external_server_id,registry_revision,registry_checksum,catalog_revision,catalog_checksum,
       endpoint_ref,credential_ref,status,availability_status,availability_valid_until,
       catalog_observed_at,operation_count,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      binding.bindingId,
      binding.revision,
      binding.localServerId,
      binding.originType,
      binding.smppSourceId ?? null,
      binding.externalProviderId ?? null,
      binding.externalServerId ?? null,
      binding.registryRevision ?? null,
      binding.registryChecksum ?? null,
      binding.catalogRevision,
      binding.catalogChecksum,
      binding.endpointRef,
      record.credentialRef,
      binding.status,
      binding.availabilityStatus,
      record.availabilityValidUntil,
      record.catalogObservedAt,
      record.operationCount,
      createdAt,
    ],
  );
}

function insertObservation(
  client: PoolClient,
  record: McpProviderBindingRecord,
  resultCode: string,
) {
  return client.query(
    `INSERT INTO sdar_control.mcp_provider_catalog_observation(
       observation_id,binding_id,binding_revision,catalog_revision,catalog_checksum,
       availability_status,availability_valid_until,operation_count,result_code,observed_at)
     VALUES(gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      record.binding.bindingId,
      record.binding.revision,
      record.binding.catalogRevision,
      record.binding.catalogChecksum,
      record.binding.availabilityStatus,
      record.availabilityValidUntil,
      record.operationCount,
      resultCode,
      record.catalogObservedAt,
    ],
  );
}

function lockBinding(client: PoolClient, bindingId: string) {
  return client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mcp-binding:${bindingId}`]);
}

function lockLocalServer(client: PoolClient, localServerId: string) {
  return client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `mcp-binding-local:${localServerId}`,
  ]);
}

async function assertCurrentRebindCandidate(
  client: PoolClient,
  record: McpProviderBindingRecord,
): Promise<void> {
  const binding = record.binding;
  const result = await client.query(
    `WITH latest_source AS (
       SELECT DISTINCT ON (smpp_source_id) *
         FROM sdar_control.smpp_registry_source
        ORDER BY smpp_source_id,revision DESC
     )
     SELECT 1
       FROM latest_source source
       JOIN sdar_control.smpp_registry_snapshot snapshot
         ON snapshot.smpp_source_id=source.smpp_source_id
        AND snapshot.snapshot_revision=source.active_snapshot_revision
       JOIN sdar_control.smpp_provider_candidate candidate
         ON candidate.smpp_source_id=snapshot.smpp_source_id
        AND candidate.snapshot_revision=snapshot.snapshot_revision
       JOIN sdar_control.smpp_registry_snapshot_lineage lineage
         ON lineage.smpp_source_id=snapshot.smpp_source_id
        AND lineage.snapshot_revision=snapshot.snapshot_revision
      WHERE source.smpp_source_id=$1 AND source.status='active'
        AND candidate.external_provider_id=$2 AND candidate.external_server_id=$3
        AND snapshot.snapshot_revision=$4 AND snapshot.checksum=$5
        AND source.active_snapshot_checksum=snapshot.checksum
        AND candidate.server_endpoint=$6
        AND source.active_snapshot_valid_until>CURRENT_TIMESTAMP
        AND lineage.native_revision IS NOT NULL
        AND lineage.native_checksum IS NOT NULL
        AND lineage.projection_contract='sdar-registry-v1'
        AND (source.lkg_policy='allow_unexpired' OR source.last_error_code IS NULL)
      LIMIT 1`,
    [
      binding.smppSourceId,
      binding.externalProviderId,
      binding.externalServerId,
      binding.registryRevision,
      binding.registryChecksum,
      binding.endpointRef,
    ],
  );
  if (result.rows[0] === undefined)
    throw new NodeControlMcpBindingError(
      'MCP_PROVIDER_BINDING_STALE',
      'Rebind Candidate changed or expired before the Binding revision was committed.',
    );
}

async function lockedReplay(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
) {
  const receipt = await readReceipt(client, scope, context);
  if (receipt?.operation_id === null || receipt?.operation_id === undefined) return undefined;
  const operation = await findOperation(client, receipt.operation_id);
  if (operation === undefined) throw new Error('CONTROL_MCP_BINDING_RECEIPT_DANGLING');
  return operation;
}

async function readReceipt(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  scope: string,
  context: ConfigurationMutationContext,
): Promise<ReceiptRow | undefined> {
  const result = await database.query<ReceiptRow>(
    `SELECT request_hash::text,operation_id FROM sdar_control.configuration_command_receipt
      WHERE command_scope=$1 AND idempotency_key_hash=$2`,
    [scope, context.idempotencyKeyHash],
  );
  const receipt = result.rows[0];
  if (receipt !== undefined && receipt.request_hash.trim() !== context.requestHash)
    throw new NodeControlMcpBindingError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was already used for a different command.',
    );
  return receipt;
}

function insertReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
  bindingId: string,
  revision: number,
  operationId: string,
) {
  return client.query(
    `INSERT INTO sdar_control.configuration_command_receipt(
       command_scope,idempotency_key_hash,request_hash,configuration_id,revision,operation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope,
      context.idempotencyKeyHash,
      context.requestHash,
      bindingId,
      revision,
      operationId,
      context.occurredAt,
    ],
  );
}

function insertOperation(client: PoolClient, operation: ManagementOperation) {
  return client.query(
    `INSERT INTO sdar_control.management_operation(
       operation_id,operation_type,target_type,target_id,target_version,target_revision,status,
       idempotency_key_hash,input_hash,actor_id,reason,result,error_code,created_at,started_at,completed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)`,
    [
      operation.operationId,
      operation.operationType,
      operation.target.type,
      operation.target.id,
      operation.target.version ?? null,
      operation.target.revision ?? null,
      operation.status,
      operation.idempotencyKeyHash,
      operation.inputHash,
      operation.actorId,
      operation.reason,
      operation.result === undefined ? null : JSON.stringify(operation.result),
      operation.errorCode ?? null,
      operation.createdAt,
      operation.startedAt ?? null,
      operation.completedAt ?? null,
    ],
  );
}

function insertAudit(
  client: PoolClient,
  bindingId: string,
  revision: number,
  context: ConfigurationMutationContext,
  resultCode: string,
) {
  return client.query(
    `INSERT INTO sdar_control.control_audit_event(
       audit_id,actor_id,action,aggregate_type,aggregate_id,result_revision,reason,
       request_hash,result_code,created_at)
     VALUES(gen_random_uuid()::text,$1,'mcp_provider_binding.command','mcp_provider_binding',$2,$3,$4,$5,$6,$7)`,
    [
      context.actorId,
      bindingId,
      revision,
      context.reason,
      context.requestHash,
      resultCode,
      context.occurredAt,
    ],
  );
}

async function findOperation(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  operationId: string,
): Promise<ManagementOperation | undefined> {
  const result = await database.query<OperationRow>(
    'SELECT * FROM sdar_control.management_operation WHERE operation_id=$1',
    [operationId],
  );
  return result.rows[0] === undefined ? undefined : mapOperation(result.rows[0]);
}

function mapRecord(row: BindingRow): McpProviderBindingRecord {
  return createMcpProviderBindingRecord({
    binding: {
      bindingId: row.binding_id,
      localServerId: row.local_server_id,
      originType: row.origin_type,
      ...(row.smpp_source_id === null ? {} : { smppSourceId: row.smpp_source_id }),
      ...(row.external_provider_id === null
        ? {}
        : { externalProviderId: row.external_provider_id }),
      ...(row.external_server_id === null ? {} : { externalServerId: row.external_server_id }),
      ...(row.registry_revision === null
        ? {}
        : { registryRevision: Number(row.registry_revision) }),
      ...(row.registry_checksum === null ? {} : { registryChecksum: row.registry_checksum.trim() }),
      catalogRevision: row.catalog_revision,
      catalogChecksum: row.catalog_checksum.trim(),
      endpointRef: row.endpoint_ref,
      status: row.status,
      availabilityStatus: row.availability_status,
      revision: Number(row.revision),
    },
    credentialRef: row.credential_ref,
    availabilityValidUntil: row.availability_valid_until.toISOString(),
    catalogObservedAt: row.catalog_observed_at.toISOString(),
    operationCount: row.operation_count,
  });
}

function mapCurrentAuthority(
  row: AuthorityRow,
  observedAt: string,
): CurrentMcpProviderBindingAuthority {
  const record = mapRecord(row);
  const binding = record.binding;
  const providerId = binding.externalProviderId ?? binding.localServerId;
  return Object.freeze({
    observedAt,
    binding: Object.freeze({
      bindingId: binding.bindingId,
      revision: binding.revision,
      localServerId: binding.localServerId,
      originType: binding.originType,
      providerId,
      ...(binding.externalProviderId === undefined
        ? {}
        : { externalProviderId: binding.externalProviderId }),
      ...(binding.externalServerId === undefined
        ? {}
        : { externalServerId: binding.externalServerId }),
      ...(binding.registryRevision === undefined
        ? {}
        : { registryRevision: binding.registryRevision }),
      ...(binding.registryChecksum === undefined
        ? {}
        : { registryChecksum: binding.registryChecksum }),
      catalogRevision: binding.catalogRevision,
      catalogChecksum: binding.catalogChecksum,
      endpointRef: binding.endpointRef,
      availabilityValidUntil: record.availabilityValidUntil,
      catalogObservedAt: record.catalogObservedAt,
      operationCount: record.operationCount,
    }),
    ...(binding.originType === 'direct'
      ? {}
      : {
          sourceCandidateLineage: Object.freeze({
            smppSourceId: requireAuthorityValue(
              row.authority_smpp_source_id,
              'authority_smpp_source_id',
            ),
            externalProviderId: requireAuthorityValue(
              row.authority_external_provider_id,
              'authority_external_provider_id',
            ),
            externalServerId: requireAuthorityValue(
              row.authority_external_server_id,
              'authority_external_server_id',
            ),
            registryRevision: Number(
              requireAuthorityValue(row.authority_registry_revision, 'authority_registry_revision'),
            ),
            registryChecksum: requireAuthorityValue(
              row.authority_registry_checksum,
              'authority_registry_checksum',
            ).trim(),
            nativeRevision: Number(
              requireAuthorityValue(row.authority_native_revision, 'authority_native_revision'),
            ),
            nativeChecksum: requireAuthorityValue(
              row.authority_native_checksum,
              'authority_native_checksum',
            ).trim(),
            projectionContract: requireProjectionContract(row.authority_projection_contract),
            candidateEndpoint: requireAuthorityValue(
              row.authority_candidate_endpoint,
              'authority_candidate_endpoint',
            ),
          }),
        }),
  });
}

function requireAuthorityValue(value: string | null, field: string): string {
  if (value === null || value.trim() === '')
    throw new Error(`MCP_PROVIDER_BINDING_AUTHORITY_INVALID:${field}`);
  return value;
}

function requireProjectionContract(value: string | null): 'sdar-registry-v1' {
  if (value !== 'sdar-registry-v1')
    throw new Error('MCP_PROVIDER_BINDING_AUTHORITY_INVALID:projection_contract');
  return value;
}

function mapCandidate(row: CandidateRow): SmppProviderCandidateDirectoryEntry {
  return Object.freeze({
    smppSourceId: row.smpp_source_id,
    externalProviderId: row.external_provider_id,
    externalServerId: row.external_server_id,
    compositeIdentity: row.composite_identity,
    serverEndpoint: row.server_endpoint,
    ...(row.display_name === null ? {} : { displayName: row.display_name }),
    ...(row.catalog_revision === null ? {} : { catalogRevision: row.catalog_revision }),
    labels: Object.freeze(row.labels),
    registryRevision: Number(row.snapshot_revision),
    registryChecksum: row.checksum.trim(),
    registryEtag: row.etag,
    registryValidUntil: row.valid_until.toISOString(),
  });
}

function mapOperation(row: OperationRow): ManagementOperation {
  return Object.freeze({
    operationId: row.operation_id,
    operationType: row.operation_type,
    target: Object.freeze({
      type: row.target_type,
      id: row.target_id,
      ...(row.target_version === null ? {} : { version: row.target_version }),
      ...(row.target_revision === null ? {} : { revision: Number(row.target_revision) }),
    }),
    status: row.status,
    actorId: row.actor_id,
    reason: row.reason,
    idempotencyKeyHash: row.idempotency_key_hash.trim(),
    inputHash: row.input_hash.trim(),
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: row.created_at.toISOString(),
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  });
}

function scopeFor(operationType: string): string {
  return operationType.endsWith('.refresh')
    ? 'mcp-binding:refresh'
    : operationType.endsWith('.rebind')
      ? 'mcp-binding:rebind'
      : operationType.endsWith('.suspended')
        ? 'mcp-binding:suspended'
        : operationType.endsWith('.removed')
          ? 'mcp-binding:removed'
          : 'mcp-binding:unknown';
}
