import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  NodeControlSmppRegistryError,
  type ConfigurationMutationContext,
  type NodeControlSmppRegistryRepository,
  type SmppSnapshotHead,
} from '../../node-control-application/src/index.js';
import {
  rehydrateSmppRegistrySource,
  transitionManagementOperation,
  type ManagementOperation,
  type SmppProviderCandidate,
  type SmppProviderCandidateDirectoryEntry,
  type SmppRegistrySnapshot,
  type SmppRegistrySource,
} from '../../node-control-domain/src/index.js';

interface SourceRow extends QueryResultRow {
  smpp_source_id: string;
  revision: string;
  name: string | null;
  registry_endpoint: string;
  credential_ref: string;
  tenant_id: string | null;
  project_id: string | null;
  environment: string;
  sync_mode: SmppRegistrySource['syncMode'];
  snapshot_ttl_seconds: number;
  lkg_policy: SmppRegistrySource['lkgPolicy'];
  status: SmppRegistrySource['status'];
  active_snapshot_revision: string | null;
  active_snapshot_checksum: string | null;
  last_sync_at: Date | null;
  last_error_code: string | null;
}

interface SnapshotHeadRow extends QueryResultRow {
  snapshot_revision: string;
  checksum: string;
  etag: string;
  valid_until: Date;
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

interface ReceiptRow extends QueryResultRow {
  request_hash: string;
  operation_id: string | null;
  configuration_id: string | null;
  revision: string | null;
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

export class PostgresNodeControlSmppRegistryRepository implements NodeControlSmppRegistryRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  createSource(
    source: SmppRegistrySource,
    context: ConfigurationMutationContext,
  ): Promise<SmppRegistrySource> {
    return this.transaction(async (client) => {
      const replay = await readReceipt(client, 'smpp-source:create', context);
      if (replay !== undefined) {
        const existing = await findSource(
          client,
          replay.configuration_id ?? '',
          Number(replay.revision),
        );
        if (existing === undefined) throw new Error('CONTROL_SMPP_SOURCE_RECEIPT_DANGLING');
        return existing;
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `smpp-source:${source.smppSourceId}`,
      ]);
      const lockedReplay = await readReceipt(client, 'smpp-source:create', context);
      if (lockedReplay !== undefined) {
        const existing = await findSource(
          client,
          lockedReplay.configuration_id ?? '',
          Number(lockedReplay.revision),
        );
        if (existing === undefined) throw new Error('CONTROL_SMPP_SOURCE_RECEIPT_DANGLING');
        return existing;
      }
      const latest = await findSource(client, source.smppSourceId);
      if (
        (latest === undefined && source.revision !== 1) ||
        (latest !== undefined && source.revision !== latest.revision + 1)
      )
        throw new NodeControlSmppRegistryError(
          'SMPP_SOURCE_CONFLICT',
          'SMPP Source revisions must be created monotonically without gaps.',
        );
      await client.query(
        `INSERT INTO sdar_control.smpp_registry_source(
           smpp_source_id,revision,name,registry_endpoint,credential_ref,tenant_id,project_id,
           environment,sync_mode,snapshot_ttl_seconds,lkg_policy,status,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [
          source.smppSourceId,
          source.revision,
          source.name ?? null,
          source.registryEndpoint,
          source.credentialRef,
          source.tenantId ?? null,
          source.projectId ?? null,
          source.environment,
          source.syncMode,
          source.snapshotTtlSeconds,
          source.lkgPolicy,
          source.status,
          context.occurredAt,
        ],
      );
      await insertReceipt(
        client,
        'smpp-source:create',
        context,
        source.smppSourceId,
        source.revision,
      );
      await insertAudit(client, 'smpp_source.create', source, context, 'accepted');
      return source;
    });
  }

  findSource(sourceId: string, revision?: number): Promise<SmppRegistrySource | undefined> {
    return findSource(this.#pool, sourceId, revision);
  }

  async listSources(limit: number): Promise<readonly SmppRegistrySource[]> {
    const result = await this.#pool.query<SourceRow>(
      `SELECT DISTINCT ON (smpp_source_id) *
         FROM sdar_control.smpp_registry_source
        ORDER BY smpp_source_id,revision DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapSource);
  }

  async listScheduledSources(limit: number): Promise<readonly SmppRegistrySource[]> {
    const result = await this.#pool.query<SourceRow>(
      `SELECT * FROM (
         SELECT DISTINCT ON (smpp_source_id) *
           FROM sdar_control.smpp_registry_source
          ORDER BY smpp_source_id,revision DESC
       ) source
       WHERE sync_mode IN ('poll','watch') AND status IN ('draft','active')
       ORDER BY smpp_source_id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapSource);
  }

  async findActiveSnapshot(sourceId: string): Promise<SmppSnapshotHead | undefined> {
    const result = await this.#pool.query<SnapshotHeadRow>(
      `SELECT snapshot_revision::text,checksum::text,etag,valid_until
         FROM sdar_control.smpp_registry_snapshot snapshot
        WHERE smpp_source_id=$1 AND snapshot_revision=(
          SELECT active_snapshot_revision
            FROM sdar_control.smpp_registry_source
           WHERE smpp_source_id=$1 AND active_snapshot_revision IS NOT NULL
           ORDER BY revision DESC LIMIT 1
        )`,
      [sourceId],
    );
    return mapSnapshotHead(result.rows[0]);
  }

  async findSyncReplay(
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined> {
    const receipt = await readReceiptFromDatabase(this.#pool, 'smpp-source:sync', context);
    if (receipt?.operation_id === null || receipt?.operation_id === undefined) return undefined;
    const operation = await findOperation(this.#pool, receipt.operation_id);
    if (operation === undefined) throw new Error('CONTROL_SMPP_OPERATION_RECEIPT_DANGLING');
    return operation;
  }

  applySnapshot(
    source: SmppRegistrySource,
    snapshot: SmppRegistrySnapshot,
    validUntil: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    return this.completeSync(source, operation, context, async (client) => {
      const active = await activeSnapshotForUpdate(client, source.smppSourceId);
      if (active !== undefined && snapshot.revision < Number(active.snapshot_revision))
        return failedOutcome('SMPP_SNAPSHOT_ROLLBACK_REJECTED', snapshot);
      if (
        active !== undefined &&
        snapshot.revision === Number(active.snapshot_revision) &&
        snapshot.checksum !== active.checksum.trim()
      )
        return failedOutcome('SMPP_SNAPSHOT_DRIFT_REJECTED', snapshot);
      if (
        active !== undefined &&
        snapshot.revision === Number(active.snapshot_revision) &&
        snapshot.checksum === active.checksum.trim()
      ) {
        await activateSourceRevision(client, source, active, context.occurredAt);
        return successOutcome('not_modified', active);
      }

      await client.query(
        `INSERT INTO sdar_control.smpp_registry_snapshot(
           smpp_source_id,snapshot_revision,checksum,etag,generated_at,external_expires_at,
           valid_until,provider_count,applied_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          snapshot.smppSourceId,
          snapshot.revision,
          snapshot.checksum,
          snapshot.etag,
          snapshot.generatedAt,
          snapshot.expiresAt,
          validUntil,
          snapshot.candidates.length,
          context.occurredAt,
        ],
      );
      for (const candidate of snapshot.candidates)
        await insertCandidate(client, snapshot, candidate);
      await activateSourceRevision(
        client,
        source,
        {
          snapshot_revision: String(snapshot.revision),
          checksum: snapshot.checksum,
          etag: snapshot.etag,
          valid_until: new Date(validUntil),
        },
        context.occurredAt,
      );
      return Object.freeze({
        status: 'succeeded' as const,
        outcome: 'applied' as const,
        result: Object.freeze({
          snapshotRevision: snapshot.revision,
          checksum: snapshot.checksum,
          etag: snapshot.etag,
          validUntil,
          candidateCount: snapshot.candidates.length,
          authority: 'candidate_directory_only',
        }),
        snapshot,
      });
    });
  }

  recordNotModified(
    source: SmppRegistrySource,
    etag: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    return this.completeSync(source, operation, context, async (client) => {
      const active = await activeSnapshotForUpdate(client, source.smppSourceId);
      if (active === undefined) return failedOutcome('SMPP_SOURCE_UNAVAILABLE');
      await activateSourceRevision(client, source, { ...active, etag }, context.occurredAt);
      return successOutcome('not_modified', { ...active, etag });
    });
  }

  recordSyncFailure(
    source: SmppRegistrySource,
    errorCode: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    return this.completeSync(source, operation, context, async (client) => {
      await client.query(
        `UPDATE sdar_control.smpp_registry_source
            SET last_sync_at=$2,last_error_code=$3,updated_at=$2
          WHERE smpp_source_id=$1 AND revision=$4`,
        [source.smppSourceId, context.occurredAt, errorCode, source.revision],
      );
      return failedOutcome(errorCode);
    });
  }

  async listCandidates(
    filter: Readonly<{ sourceId?: string; observedAt: string; limit: number }>,
  ): Promise<readonly SmppProviderCandidateDirectoryEntry[]> {
    const result = await this.#pool.query<CandidateRow>(
      `WITH latest_source AS (
         SELECT DISTINCT ON (smpp_source_id) *
           FROM sdar_control.smpp_registry_source
          WHERE status='active'
          ORDER BY smpp_source_id,revision DESC
       )
       SELECT candidate.smpp_source_id,candidate.external_provider_id,
              candidate.external_server_id,candidate.composite_identity,
               candidate.server_endpoint,candidate.display_name,candidate.catalog_revision,
               candidate.labels,snapshot.snapshot_revision::text,snapshot.checksum::text,
               snapshot.etag,snapshot.valid_until
         FROM latest_source source
         JOIN sdar_control.smpp_registry_snapshot snapshot
           ON snapshot.smpp_source_id=source.smpp_source_id
          AND snapshot.snapshot_revision=source.active_snapshot_revision
         JOIN sdar_control.smpp_provider_candidate candidate
           ON candidate.smpp_source_id=snapshot.smpp_source_id
          AND candidate.snapshot_revision=snapshot.snapshot_revision
        WHERE snapshot.valid_until > $1
          AND ($2::text IS NULL OR source.smpp_source_id=$2)
          AND (source.lkg_policy='allow_unexpired' OR source.last_error_code IS NULL)
        ORDER BY candidate.smpp_source_id,candidate.external_provider_id,candidate.external_server_id
        LIMIT $3`,
      [filter.observedAt, filter.sourceId ?? null, filter.limit],
    );
    return result.rows.map(mapCandidate);
  }

  private completeSync(
    source: SmppRegistrySource,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
    work: (client: PoolClient) => Promise<SyncOutcome>,
  ): Promise<ManagementOperation> {
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `smpp-source:${source.smppSourceId}`,
      ]);
      const replay = await readReceipt(client, 'smpp-source:sync', context);
      if (replay?.operation_id) {
        const previous = await findOperation(client, replay.operation_id);
        if (previous === undefined) throw new Error('CONTROL_SMPP_OPERATION_RECEIPT_DANGLING');
        return previous;
      }
      const latest = await findSource(client, source.smppSourceId);
      if (latest?.revision !== source.revision)
        throw new NodeControlSmppRegistryError(
          'SMPP_SOURCE_CONFLICT',
          'SMPP Source revision changed before synchronization completed.',
        );
      const outcome = await work(client);
      const running = transitionManagementOperation(operation, 'running', context.occurredAt);
      const completed =
        outcome.status === 'failed'
          ? transitionManagementOperation(running, 'failed', context.occurredAt, {
              errorCode: outcome.errorCode,
            })
          : transitionManagementOperation(running, 'succeeded', context.occurredAt, {
              result: outcome.result,
            });
      await insertOperation(client, completed);
      await insertReceipt(
        client,
        'smpp-source:sync',
        context,
        source.smppSourceId,
        source.revision,
        completed.operationId,
      );
      await insertAttempt(client, source, outcome, completed, context);
      await insertAudit(
        client,
        'smpp_source.sync',
        source,
        context,
        outcome.status === 'failed' ? outcome.errorCode : outcome.outcome,
      );
      return completed;
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

type SyncOutcome =
  | Readonly<{
      status: 'succeeded';
      outcome: 'applied' | 'not_modified';
      result: Readonly<Record<string, unknown>>;
      snapshot?: SmppRegistrySnapshot;
    }>
  | Readonly<{
      status: 'failed';
      outcome: 'failed';
      errorCode: string;
      snapshot?: SmppRegistrySnapshot;
    }>;

function failedOutcome(errorCode: string, snapshot?: SmppRegistrySnapshot): SyncOutcome {
  return Object.freeze({
    status: 'failed',
    outcome: 'failed',
    errorCode,
    ...(snapshot === undefined ? {} : { snapshot }),
  });
}

function successOutcome(
  outcome: 'not_modified',
  head: Readonly<{ snapshot_revision: string; checksum: string; etag: string; valid_until: Date }>,
): SyncOutcome {
  return Object.freeze({
    status: 'succeeded',
    outcome,
    result: Object.freeze({
      snapshotRevision: Number(head.snapshot_revision),
      checksum: head.checksum.trim(),
      etag: head.etag,
      validUntil: head.valid_until.toISOString(),
      authority: 'candidate_directory_only',
    }),
  });
}

async function findSource(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  sourceId: string,
  revision?: number,
): Promise<SmppRegistrySource | undefined> {
  const result = await database.query<SourceRow>(
    `SELECT * FROM sdar_control.smpp_registry_source
      WHERE smpp_source_id=$1 AND ($2::bigint IS NULL OR revision=$2)
      ORDER BY revision DESC LIMIT 1`,
    [sourceId, revision ?? null],
  );
  return result.rows[0] === undefined ? undefined : mapSource(result.rows[0]);
}

async function activeSnapshotForUpdate(
  client: PoolClient,
  sourceId: string,
): Promise<SnapshotHeadRow | undefined> {
  const result = await client.query<SnapshotHeadRow>(
    `SELECT snapshot.snapshot_revision::text,snapshot.checksum::text,snapshot.etag,snapshot.valid_until
       FROM sdar_control.smpp_registry_source source
       JOIN sdar_control.smpp_registry_snapshot snapshot
         ON snapshot.smpp_source_id=source.smpp_source_id
        AND snapshot.snapshot_revision=source.active_snapshot_revision
      WHERE source.smpp_source_id=$1
      ORDER BY source.revision DESC LIMIT 1
      FOR UPDATE OF source`,
    [sourceId],
  );
  return result.rows[0];
}

async function activateSourceRevision(
  client: PoolClient,
  source: SmppRegistrySource,
  snapshot: SnapshotHeadRow,
  occurredAt: string,
): Promise<void> {
  await client.query(
    `UPDATE sdar_control.smpp_registry_source
        SET status='suspended',updated_at=$3
      WHERE smpp_source_id=$1 AND revision<>$2 AND status='active'`,
    [source.smppSourceId, source.revision, occurredAt],
  );
  const updated = await client.query(
    `UPDATE sdar_control.smpp_registry_source
        SET status='active',active_snapshot_revision=$3,active_snapshot_checksum=$4,
            active_snapshot_etag=$5,last_sync_at=$6,last_error_code=NULL,updated_at=$6
      WHERE smpp_source_id=$1 AND revision=$2`,
    [
      source.smppSourceId,
      source.revision,
      Number(snapshot.snapshot_revision),
      snapshot.checksum.trim(),
      snapshot.etag,
      occurredAt,
    ],
  );
  if (updated.rowCount !== 1) throw new Error('CONTROL_SMPP_SOURCE_ACTIVATION_MISSING');
}

async function readReceiptFromDatabase(
  database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  scope: string,
  context: ConfigurationMutationContext,
): Promise<ReceiptRow | undefined> {
  const result = await database.query<ReceiptRow>(
    `SELECT request_hash::text,operation_id,configuration_id,revision::text
       FROM sdar_control.configuration_command_receipt
      WHERE command_scope=$1 AND idempotency_key_hash=$2`,
    [scope, context.idempotencyKeyHash],
  );
  const receipt = result.rows[0];
  if (receipt !== undefined && receipt.request_hash.trim() !== context.requestHash)
    throw new NodeControlSmppRegistryError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was already used for a different command.',
    );
  return receipt;
}

function readReceipt(client: PoolClient, scope: string, context: ConfigurationMutationContext) {
  return readReceiptFromDatabase(client, scope, context);
}

function insertReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
  sourceId: string,
  revision: number,
  operationId?: string,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.configuration_command_receipt(
       command_scope,idempotency_key_hash,request_hash,configuration_id,revision,operation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope,
      context.idempotencyKeyHash,
      context.requestHash,
      sourceId,
      revision,
      operationId ?? null,
      context.occurredAt,
    ],
  );
}

function insertOperation(client: PoolClient, operation: ManagementOperation): Promise<unknown> {
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

function insertCandidate(
  client: PoolClient,
  snapshot: SmppRegistrySnapshot,
  candidate: SmppProviderCandidate,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.smpp_provider_candidate(
       smpp_source_id,snapshot_revision,external_provider_id,external_server_id,
       composite_identity,server_endpoint,display_name,catalog_revision,labels)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      candidate.smppSourceId,
      snapshot.revision,
      candidate.externalProviderId,
      candidate.externalServerId,
      candidate.compositeIdentity,
      candidate.serverEndpoint,
      candidate.displayName ?? null,
      candidate.catalogRevision ?? null,
      JSON.stringify(candidate.labels),
    ],
  );
}

function insertAttempt(
  client: PoolClient,
  source: SmppRegistrySource,
  outcome: SyncOutcome,
  operation: ManagementOperation,
  context: ConfigurationMutationContext,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.smpp_registry_sync_attempt(
       attempt_id,operation_id,smpp_source_id,source_revision,outcome,
       observed_snapshot_revision,observed_checksum,observed_etag,error_code,occurred_at)
     VALUES(gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      operation.operationId,
      source.smppSourceId,
      source.revision,
      outcome.outcome,
      outcome.snapshot?.revision ?? null,
      outcome.snapshot?.checksum ?? null,
      outcome.snapshot?.etag ?? null,
      outcome.status === 'failed' ? outcome.errorCode : null,
      context.occurredAt,
    ],
  );
}

function insertAudit(
  client: PoolClient,
  action: string,
  source: SmppRegistrySource,
  context: ConfigurationMutationContext,
  resultCode: string,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.control_audit_event(
       audit_id,actor_id,action,aggregate_type,aggregate_id,result_revision,
       reason,request_hash,result_code,created_at)
     VALUES(gen_random_uuid()::text,$1,$2,'smpp_source',$3,$4,$5,$6,$7,$8)`,
    [
      context.actorId,
      action,
      source.smppSourceId,
      source.revision,
      context.reason,
      context.requestHash,
      resultCode,
      context.occurredAt,
    ],
  );
}

function mapSource(row: SourceRow): SmppRegistrySource {
  if (row.active_snapshot_revision !== null && row.active_snapshot_checksum === null)
    throw new Error('CONTROL_SMPP_SOURCE_ACTIVE_POINTER_INCOMPLETE');
  return rehydrateSmppRegistrySource({
    smppSourceId: row.smpp_source_id,
    ...(row.name === null ? {} : { name: row.name }),
    registryEndpoint: row.registry_endpoint,
    credentialRef: row.credential_ref,
    ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    environment: row.environment,
    syncMode: row.sync_mode,
    snapshotTtlSeconds: row.snapshot_ttl_seconds,
    lkgPolicy: row.lkg_policy,
    status: row.status,
    ...(row.active_snapshot_revision === null
      ? {}
      : {
          activeSnapshotRevision: Number(row.active_snapshot_revision),
          activeSnapshotChecksum: requiredActiveChecksum(row),
        }),
    ...(row.last_sync_at === null ? {} : { lastSyncAt: row.last_sync_at.toISOString() }),
    ...(row.last_error_code === null ? {} : { lastErrorCode: row.last_error_code }),
    revision: Number(row.revision),
  });
}

function requiredActiveChecksum(row: SourceRow): string {
  if (row.active_snapshot_checksum === null)
    throw new Error('CONTROL_SMPP_SOURCE_ACTIVE_POINTER_INCOMPLETE');
  return row.active_snapshot_checksum.trim();
}

function mapSnapshotHead(row: SnapshotHeadRow | undefined): SmppSnapshotHead | undefined {
  return row === undefined
    ? undefined
    : Object.freeze({
        revision: Number(row.snapshot_revision),
        checksum: row.checksum.trim(),
        etag: row.etag,
        validUntil: row.valid_until.toISOString(),
      });
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
