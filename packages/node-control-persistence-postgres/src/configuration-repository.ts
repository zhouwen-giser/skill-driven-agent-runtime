import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  NodeControlConfigurationError,
  type ConfigurationDraftInput,
  type ConfigurationMutationContext,
  type ConfigurationReference,
  type NodeControlConfigurationRepository,
} from '../../node-control-application/src/index.js';
import {
  configurationEtag,
  createConfigurationRevision,
  observeConfigurationRevision,
  publishConfigurationRevision,
  rehydrateConfigurationRevision,
  transitionManagementOperation,
  validateConfigurationRevision,
  type ConfigurationRevision,
  type DesiredObservedState,
  type JsonValue,
  type ManagementOperation,
  type RuntimeRevisionAck,
} from '../../node-control-domain/src/index.js';

interface ConfigurationRow extends QueryResultRow {
  configuration_id: string;
  target_type: ConfigurationRevision['targetType'];
  target_id: string;
  revision: string;
  status: ConfigurationRevision['status'];
  apply_mode: ConfigurationRevision['applyMode'];
  content: JsonValue;
  checksum: string;
  created_by: string;
  created_at: Date;
  published_at: Date | null;
  desired_revision: string | null;
  desired_status: string | null;
  desired_checksum: string | null;
  observed_revision: string | null;
  observed_status: string | null;
  observed_checksum: string | null;
  observed_runtime_version: string | null;
  observed_at: Date | null;
  convergence_status: DesiredObservedState['convergence']['status'] | null;
  reason_code: string | null;
  state_detail: string | null;
}

interface ReceiptRow extends QueryResultRow {
  request_hash: string;
  configuration_id: string | null;
  revision: string | null;
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

const CONFIGURATION_SELECT = `
  SELECT revision.configuration_id, revision.target_type, revision.target_id,
         revision.revision::text, revision.status, revision.apply_mode, revision.content,
         revision.checksum::text, revision.created_by, revision.created_at, revision.published_at,
         state.desired_revision::text, state.desired_status, state.desired_checksum::text,
         state.observed_revision::text, state.observed_status, state.observed_checksum::text,
         state.observed_runtime_version, state.observed_at, state.convergence_status,
         state.reason_code, state.detail AS state_detail
    FROM sdar_control.configuration_revision revision
    LEFT JOIN sdar_control.configuration_target_state state
      ON state.target_type=revision.target_type AND state.target_id=revision.target_id`;

export class PostgresNodeControlConfigurationRepository implements NodeControlConfigurationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  createDraft(
    input: ConfigurationDraftInput,
    context: ConfigurationMutationContext,
  ): Promise<ConfigurationRevision> {
    return this.transaction(async (client) => {
      const scope = `configuration.create:${input.targetType}:${input.targetId}`;
      const receipt = await lockReceipt(client, scope, context);
      if (receipt !== undefined) return configurationFromReceipt(client, receipt);
      await lockTarget(client, input.targetType, input.targetId);
      const latest = await client.query<{ revision: string; apply_mode: string }>(
        `SELECT revision::text, apply_mode
           FROM sdar_control.configuration_revision
          WHERE target_type=$1 AND target_id=$2
          ORDER BY revision DESC LIMIT 1`,
        [input.targetType, input.targetId],
      );
      const previous = latest.rows[0];
      if (previous?.apply_mode === 'immutable')
        throw new NodeControlConfigurationError(
          'CONTROL_REVISION_IMMUTABLE',
          'An immutable Configuration target cannot receive another revision.',
        );
      const expectedRevision = Number(previous?.revision ?? '0') + 1;
      if (input.requestedRevision !== expectedRevision)
        throw new NodeControlConfigurationError(
          'CONTROL_REVISION_CONFLICT',
          `Next Configuration revision is ${String(expectedRevision)}, not ${String(input.requestedRevision)}.`,
        );
      const revision = createConfigurationRevision(
        {
          configurationId: input.configurationId,
          targetType: input.targetType,
          targetId: input.targetId,
          revision: expectedRevision,
          applyMode: input.applyMode,
          content: input.content,
          createdBy: input.createdBy,
        },
        input.createdAt,
      );
      if (revision.checksum !== input.requestedChecksum)
        throw new NodeControlConfigurationError(
          'CONTROL_REVISION_CONFLICT',
          'Requested checksum does not match canonical Configuration content.',
        );
      await insertConfiguration(client, revision);
      await insertAudit(
        client,
        'configuration.draft_created',
        revision,
        context,
        revision.revision,
      );
      await insertReceipt(client, scope, context, revision, undefined);
      return revision;
    });
  }

  async find(
    configurationId: string,
    revision: number,
  ): Promise<ConfigurationRevision | undefined> {
    return findConfiguration(this.#pool, configurationId, revision);
  }

  async list(filter: Readonly<{ targetType?: string; targetId?: string; limit?: number }> = {}) {
    const limit = boundedLimit(filter.limit);
    const result = await this.#pool.query<ConfigurationRow>(
      `${CONFIGURATION_SELECT}
        WHERE ($1::text IS NULL OR revision.target_type=$1)
          AND ($2::text IS NULL OR revision.target_id=$2)
        ORDER BY revision.created_at DESC, revision.configuration_id, revision.revision DESC
        LIMIT $3`,
      [filter.targetType ?? null, filter.targetId ?? null, limit],
    );
    return result.rows.map(mapConfiguration);
  }

  validate(
    configurationId: string,
    revision: number,
    expectedEtag: string,
    context: ConfigurationMutationContext,
  ): Promise<ConfigurationRevision> {
    return this.transaction(async (client) => {
      const scope = `configuration.validate:${configurationId}:${String(revision)}`;
      const receipt = await lockReceipt(client, scope, context);
      if (receipt !== undefined) return configurationFromReceipt(client, receipt);
      const current = await lockConfiguration(client, configurationId, revision);
      assertEtag(current, expectedEtag);
      const validated = validateConfigurationRevision(current);
      await client.query(
        `UPDATE sdar_control.configuration_revision SET status='validated'
          WHERE configuration_id=$1 AND revision=$2 AND status='draft'`,
        [configurationId, revision],
      );
      await insertAudit(client, 'configuration.validated', validated, context, revision);
      await insertReceipt(client, scope, context, validated, undefined);
      return validated;
    });
  }

  publish(
    configurationId: string,
    revision: number,
    expectedEtag: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<Readonly<{ revision: ConfigurationRevision; operation: ManagementOperation }>> {
    return this.transaction(async (client) => {
      const scope = `configuration.publish:${configurationId}:${String(revision)}`;
      const receipt = await lockReceipt(client, scope, context);
      if (receipt !== undefined) {
        return {
          revision: await configurationFromReceipt(client, receipt),
          operation: await operationFromReceipt(client, receipt),
        };
      }
      const current = await lockConfiguration(client, configurationId, revision);
      assertEtag(current, expectedEtag);
      const published = publishConfigurationRevision(current, context.occurredAt);
      await client.query(
        `UPDATE sdar_control.configuration_revision
            SET status='published', published_at=$3
          WHERE configuration_id=$1 AND revision=$2 AND status='validated'`,
        [configurationId, revision, context.occurredAt],
      );
      const runningOperation = transitionManagementOperation(
        operation,
        'running',
        context.occurredAt,
        { result: { desiredRevision: published.revision, applyStatus: 'pending' } },
      );
      await insertOperation(client, runningOperation);
      await client.query(
        `INSERT INTO sdar_control.configuration_target_state (
           target_type,target_id,desired_configuration_id,desired_revision,desired_checksum,
           desired_status,desired_operation_id,observed_status,convergence_status,generation
         ) VALUES ($1,$2,$3,$4,$5,'published',$6,'unavailable','pending',1)
         ON CONFLICT (target_type,target_id) DO UPDATE SET
           desired_configuration_id=EXCLUDED.desired_configuration_id,
           desired_revision=EXCLUDED.desired_revision,
           desired_checksum=EXCLUDED.desired_checksum,
           desired_status='published',desired_operation_id=EXCLUDED.desired_operation_id,
           convergence_status='pending',reason_code=NULL,detail=NULL,
           generation=sdar_control.configuration_target_state.generation+1`,
        [
          published.targetType,
          published.targetId,
          published.configurationId,
          published.revision,
          published.checksum,
          runningOperation.operationId,
        ],
      );
      await insertAudit(client, 'configuration.published', published, context, revision);
      await insertReceipt(client, scope, context, published, runningOperation.operationId);
      return Object.freeze({ revision: published, operation: runningOperation });
    });
  }

  rollback(
    configurationId: string,
    sourceRevision: number,
    expectedEtag: string,
    operation: ManagementOperation,
    context: ConfigurationMutationContext,
  ): Promise<Readonly<{ revision: ConfigurationRevision; operation: ManagementOperation }>> {
    return this.transaction(async (client) => {
      const scope = `configuration.rollback:${configurationId}:${String(sourceRevision)}`;
      const receipt = await lockReceipt(client, scope, context);
      if (receipt !== undefined) {
        return {
          revision: await configurationFromReceipt(client, receipt),
          operation: await operationFromReceipt(client, receipt),
        };
      }
      const source = await lockConfiguration(client, configurationId, sourceRevision);
      assertEtag(source, expectedEtag);
      if (source.applyMode === 'immutable')
        throw new NodeControlConfigurationError(
          'CONTROL_REVISION_IMMUTABLE',
          'Immutable Configuration cannot be rolled back.',
        );
      await lockTarget(client, source.targetType, source.targetId);
      const latest = await client.query<{ revision: string }>(
        `SELECT COALESCE(MAX(revision),0)::text AS revision
           FROM sdar_control.configuration_revision
          WHERE target_type=$1 AND target_id=$2`,
        [source.targetType, source.targetId],
      );
      const nextRevision = Number(latest.rows[0]?.revision ?? '0') + 1;
      const rollback = publishConfigurationRevision(
        validateConfigurationRevision(
          createConfigurationRevision(
            {
              configurationId,
              targetType: source.targetType,
              targetId: source.targetId,
              revision: nextRevision,
              applyMode: source.applyMode,
              content: source.content,
              createdBy: context.actorId,
            },
            context.occurredAt,
          ),
        ),
        context.occurredAt,
      );
      await insertConfiguration(client, rollback);
      const runningOperation = transitionManagementOperation(
        operation,
        'running',
        context.occurredAt,
        { result: { desiredRevision: rollback.revision, applyStatus: 'pending' } },
      );
      await insertOperation(client, runningOperation);
      await client.query(
        `INSERT INTO sdar_control.configuration_target_state (
           target_type,target_id,desired_configuration_id,desired_revision,desired_checksum,
           desired_status,desired_operation_id,observed_status,convergence_status,generation
         ) VALUES ($1,$2,$3,$4,$5,'published',$6,'unavailable','pending',1)
         ON CONFLICT (target_type,target_id) DO UPDATE SET
           desired_configuration_id=EXCLUDED.desired_configuration_id,
           desired_revision=EXCLUDED.desired_revision,
           desired_checksum=EXCLUDED.desired_checksum,
           desired_status='published',desired_operation_id=EXCLUDED.desired_operation_id,
           convergence_status='pending',reason_code=NULL,detail=NULL,
           generation=sdar_control.configuration_target_state.generation+1`,
        [
          rollback.targetType,
          rollback.targetId,
          rollback.configurationId,
          rollback.revision,
          rollback.checksum,
          runningOperation.operationId,
        ],
      );
      await insertAudit(
        client,
        'configuration.rollback_published',
        rollback,
        context,
        rollback.revision,
      );
      await insertReceipt(client, scope, context, rollback, runningOperation.operationId);
      return Object.freeze({ revision: rollback, operation: runningOperation });
    });
  }

  async latestPublished(targetType: string, targetId: string, currentRevision?: number) {
    const result = await this.#pool.query<ConfigurationRow>(
      `${CONFIGURATION_SELECT}
        JOIN sdar_control.configuration_target_state desired
          ON desired.target_type=revision.target_type AND desired.target_id=revision.target_id
         AND desired.desired_configuration_id=revision.configuration_id
         AND desired.desired_revision=revision.revision
        WHERE revision.target_type=$1 AND revision.target_id=$2
          AND ($3::bigint IS NULL OR revision.revision > $3)`,
      [targetType, targetId, currentRevision ?? null],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapConfiguration(row);
  }

  acknowledge(acknowledgement: RuntimeRevisionAck): Promise<ConfigurationRevision> {
    return this.transaction(async (client) => {
      await lockTarget(client, acknowledgement.targetType, acknowledgement.targetId);
      const matched = await client.query<ConfigurationRow>(
        `${CONFIGURATION_SELECT}
          WHERE revision.target_type=$1 AND revision.target_id=$2 AND revision.revision=$3
          FOR UPDATE OF revision`,
        [acknowledgement.targetType, acknowledgement.targetId, acknowledgement.revision],
      );
      const row = matched.rows[0];
      if (row === undefined) notFound();
      const current = mapConfiguration(row);
      if (current.status === 'rejected' && acknowledgement.status === 'applied')
        throw new NodeControlConfigurationError(
          'CONTROL_REVISION_CONFLICT',
          'A rejected Configuration Revision cannot later become applied.',
        );
      const observedStatus = observeConfigurationRevision(current, acknowledgement);
      const applicationId = stableId(
        'configuration-application',
        `${current.configurationId}:${String(current.revision)}:${acknowledgement.runtimeInstanceId}`,
      );
      await client.query(
        `INSERT INTO sdar_control.configuration_application (
           application_id,configuration_id,revision,runtime_instance_id,status,
           observed_runtime_version,active_checksum,reason_code,detail,acknowledged_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT (configuration_id,revision,runtime_instance_id) DO UPDATE SET
           status=EXCLUDED.status,observed_runtime_version=EXCLUDED.observed_runtime_version,
           active_checksum=EXCLUDED.active_checksum,reason_code=EXCLUDED.reason_code,
           detail=EXCLUDED.detail,acknowledged_at=EXCLUDED.acknowledged_at`,
        [
          applicationId,
          current.configurationId,
          current.revision,
          acknowledgement.runtimeInstanceId,
          acknowledgement.status,
          acknowledgement.observedRuntimeVersion,
          acknowledgement.activeChecksum ?? null,
          acknowledgement.reasonCode ?? null,
          JSON.stringify(acknowledgement.detail ?? {}),
          acknowledgement.acknowledgedAt,
        ],
      );
      await client.query(
        `UPDATE sdar_control.configuration_revision SET status=$3
          WHERE configuration_id=$1 AND revision=$2`,
        [current.configurationId, current.revision, observedStatus],
      );
      await updateTargetObservation(client, current, acknowledgement);
      await updateDesiredOperation(client, current, acknowledgement);
      return Object.freeze({ ...current, status: observedStatus });
    });
  }

  async activeConfigurationRefs(): Promise<readonly ConfigurationReference[]> {
    const result = await this.#pool.query<{
      target_type: string;
      observed_configuration_id: string;
      observed_revision: string;
    }>(
      `SELECT target_type,observed_configuration_id,observed_revision::text
         FROM sdar_control.configuration_target_state
        WHERE observed_configuration_id IS NOT NULL
        ORDER BY target_type,target_id`,
    );
    return result.rows.map((row) =>
      Object.freeze({
        type: row.target_type,
        id: row.observed_configuration_id,
        revision: Number(row.observed_revision),
      }),
    );
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

async function findConfiguration(
  queryable: Pool | PoolClient,
  configurationId: string,
  revision: number,
): Promise<ConfigurationRevision | undefined> {
  const result = await queryable.query<ConfigurationRow>(
    `${CONFIGURATION_SELECT}
      WHERE revision.configuration_id=$1 AND revision.revision=$2`,
    [configurationId, revision],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapConfiguration(row);
}

async function lockConfiguration(
  client: PoolClient,
  configurationId: string,
  revision: number,
): Promise<ConfigurationRevision> {
  const result = await client.query<ConfigurationRow>(
    `${CONFIGURATION_SELECT}
      WHERE revision.configuration_id=$1 AND revision.revision=$2
      FOR UPDATE OF revision`,
    [configurationId, revision],
  );
  const row = result.rows[0];
  if (row === undefined) notFound();
  return mapConfiguration(row);
}

function mapConfiguration(row: ConfigurationRow): ConfigurationRevision {
  const state = mapState(row);
  return rehydrateConfigurationRevision({
    configurationId: row.configuration_id,
    targetType: row.target_type,
    targetId: row.target_id,
    revision: Number(row.revision),
    status: row.status,
    applyMode: row.apply_mode,
    content: row.content,
    checksum: row.checksum,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    ...(row.published_at === null ? {} : { publishedAt: row.published_at.toISOString() }),
    ...(state === undefined ? {} : { state }),
  });
}

function mapState(row: ConfigurationRow): DesiredObservedState | undefined {
  if (row.desired_revision === null || row.convergence_status === null) return undefined;
  return Object.freeze({
    desired: Object.freeze({
      revision: Number(row.desired_revision),
      status: row.desired_status ?? 'published',
      ...(row.desired_checksum === null ? {} : { checksum: row.desired_checksum }),
    }),
    observed: Object.freeze({
      status: row.observed_status ?? 'unavailable',
      ...(row.observed_revision === null ? {} : { revision: Number(row.observed_revision) }),
      ...(row.observed_checksum === null ? {} : { checksum: row.observed_checksum }),
      ...(row.observed_runtime_version === null
        ? {}
        : { runtimeVersion: row.observed_runtime_version }),
      ...(row.observed_at === null ? {} : { observedAt: row.observed_at.toISOString() }),
    }),
    convergence: Object.freeze({
      status: row.convergence_status,
      ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
      ...(row.state_detail === null ? {} : { detail: row.state_detail }),
    }),
  });
}

async function lockReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
): Promise<ReceiptRow | undefined> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
    scope,
    context.idempotencyKeyHash,
  ]);
  const result = await client.query<ReceiptRow>(
    `SELECT request_hash::text,configuration_id,revision::text,operation_id
       FROM sdar_control.configuration_command_receipt
      WHERE command_scope=$1 AND idempotency_key_hash=$2`,
    [scope, context.idempotencyKeyHash],
  );
  const receipt = result.rows[0];
  if (receipt !== undefined && receipt.request_hash !== context.requestHash)
    throw new NodeControlConfigurationError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key was reused with a different request hash.',
    );
  return receipt;
}

async function insertReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
  revision: ConfigurationRevision,
  operationId: string | undefined,
): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.configuration_command_receipt (
       command_scope,idempotency_key_hash,request_hash,configuration_id,revision,operation_id,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      scope,
      context.idempotencyKeyHash,
      context.requestHash,
      revision.configurationId,
      revision.revision,
      operationId ?? null,
      context.occurredAt,
    ],
  );
}

async function configurationFromReceipt(
  client: PoolClient,
  receipt: ReceiptRow,
): Promise<ConfigurationRevision> {
  if (receipt.configuration_id === null || receipt.revision === null) notFound();
  const revision = await findConfiguration(
    client,
    receipt.configuration_id,
    Number(receipt.revision),
  );
  if (revision === undefined) notFound();
  return revision;
}

async function operationFromReceipt(
  client: PoolClient,
  receipt: ReceiptRow,
): Promise<ManagementOperation> {
  if (receipt.operation_id === null) notFound();
  const result = await client.query<OperationRow>(
    `SELECT operation_id,operation_type,target_type,target_id,target_version,
            target_revision::text,status,idempotency_key_hash::text,input_hash::text,
            actor_id,reason,result,error_code,created_at,started_at,completed_at
       FROM sdar_control.management_operation WHERE operation_id=$1`,
    [receipt.operation_id],
  );
  const row = result.rows[0];
  if (row === undefined) notFound();
  return mapOperation(row);
}

async function insertConfiguration(
  client: PoolClient,
  revision: ConfigurationRevision,
): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.configuration_revision (
       configuration_id,target_type,target_id,revision,status,apply_mode,content,checksum,
       created_by,created_at,published_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
    [
      revision.configurationId,
      revision.targetType,
      revision.targetId,
      revision.revision,
      revision.status,
      revision.applyMode,
      JSON.stringify(revision.content),
      revision.checksum,
      revision.createdBy,
      revision.createdAt,
      revision.publishedAt ?? null,
    ],
  );
}

async function insertOperation(client: PoolClient, operation: ManagementOperation): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.management_operation (
       operation_id,operation_type,target_type,target_id,target_version,target_revision,status,
       idempotency_key_hash,input_hash,actor_id,reason,result,error_code,created_at,started_at,completed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)`,
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

async function insertAudit(
  client: PoolClient,
  action: string,
  revision: ConfigurationRevision,
  context: ConfigurationMutationContext,
  resultRevision: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.control_audit_event (
       audit_id,actor_id,action,aggregate_type,aggregate_id,expected_revision,
       result_revision,reason,request_hash,result_code,created_at
     ) VALUES ($1,$2,$3,'configuration_revision',$4,$5,$6,$7,$8,$9,$10)`,
    [
      stableId('configuration-audit', `${action}:${context.idempotencyKeyHash}`),
      context.actorId,
      action,
      revision.configurationId,
      revision.revision,
      resultRevision,
      context.reason,
      context.requestHash,
      action.toUpperCase().replaceAll('.', '_'),
      context.occurredAt,
    ],
  );
}

async function updateTargetObservation(
  client: PoolClient,
  revision: ConfigurationRevision,
  acknowledgement: RuntimeRevisionAck,
): Promise<void> {
  if (acknowledgement.status === 'applied') {
    await client.query(
      `UPDATE sdar_control.configuration_target_state SET
         observed_configuration_id=$3,observed_revision=$4,observed_checksum=$5,
         observed_status='applied',observed_runtime_version=$6,observed_at=$7,
         convergence_status='converged',reason_code=NULL,detail=NULL
       WHERE target_type=$1 AND target_id=$2 AND desired_revision=$4`,
      [
        revision.targetType,
        revision.targetId,
        revision.configurationId,
        revision.revision,
        revision.checksum,
        acknowledgement.observedRuntimeVersion,
        acknowledgement.acknowledgedAt,
      ],
    );
    return;
  }
  const convergence =
    acknowledgement.status === 'partially_applied'
      ? 'degraded'
      : acknowledgement.status === 'rejected'
        ? 'rejected'
        : acknowledgement.status === 'restart_required'
          ? 'restart_required'
          : acknowledgement.status === 'unavailable'
            ? 'unavailable'
            : 'pending';
  await client.query(
    `UPDATE sdar_control.configuration_target_state SET
       observed_status=$3,observed_runtime_version=$4,observed_at=$5,
       convergence_status=$6,reason_code=$7,detail=$8
     WHERE target_type=$1 AND target_id=$2 AND desired_revision=$9`,
    [
      revision.targetType,
      revision.targetId,
      acknowledgement.status,
      acknowledgement.observedRuntimeVersion,
      acknowledgement.acknowledgedAt,
      convergence,
      acknowledgement.reasonCode ?? null,
      acknowledgement.detail === undefined ? null : JSON.stringify(acknowledgement.detail),
      revision.revision,
    ],
  );
}

async function updateDesiredOperation(
  client: PoolClient,
  revision: ConfigurationRevision,
  acknowledgement: RuntimeRevisionAck,
): Promise<void> {
  const terminal =
    acknowledgement.status === 'applied' ||
    acknowledgement.status === 'partially_applied' ||
    acknowledgement.status === 'rejected';
  const operationStatus =
    acknowledgement.status === 'applied'
      ? 'succeeded'
      : acknowledgement.status === 'partially_applied' || acknowledgement.status === 'rejected'
        ? 'failed'
        : 'running';
  await client.query(
    `UPDATE sdar_control.management_operation operation SET
       status=$4,
       result=$5::jsonb,
       error_code=$6,
       completed_at=$7
      FROM sdar_control.configuration_target_state state
     WHERE state.desired_operation_id=operation.operation_id
       AND state.target_type=$1 AND state.target_id=$2 AND state.desired_revision=$3
       AND operation.status='running'`,
    [
      revision.targetType,
      revision.targetId,
      revision.revision,
      operationStatus,
      JSON.stringify({
        desiredRevision: revision.revision,
        applyStatus: acknowledgement.status,
        runtimeInstanceId: acknowledgement.runtimeInstanceId,
      }),
      operationStatus === 'failed'
        ? (acknowledgement.reasonCode ?? 'CONFIGURATION_APPLY_FAILED')
        : null,
      terminal ? acknowledgement.acknowledgedAt : null,
    ],
  );
}

async function lockTarget(client: PoolClient, targetType: string, targetId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [
    targetType,
    targetId,
  ]);
}

function assertEtag(revision: ConfigurationRevision, expectedEtag: string): void {
  if (configurationEtag(revision) !== expectedEtag)
    throw new NodeControlConfigurationError(
      'PRECONDITION_FAILED',
      'If-Match does not match the current Configuration Revision ETag.',
    );
}

function boundedLimit(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1 && value <= 200
    ? value
    : 50;
}

function stableId(namespace: string, value: string): string {
  return `${namespace}-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
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
    idempotencyKeyHash: row.idempotency_key_hash,
    inputHash: row.input_hash,
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: row.created_at.toISOString(),
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  });
}

function notFound(): never {
  throw new NodeControlConfigurationError(
    'CONFIGURATION_NOT_FOUND',
    'Configuration Revision was not found.',
  );
}
