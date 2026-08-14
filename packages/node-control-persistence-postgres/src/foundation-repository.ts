import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { NodeControlFoundationRepository } from '../../node-control-application/src/index.js';
import type { ConfigurationMutationContext } from '../../node-control-application/src/index.js';
import {
  rehydrateNodeProfile,
  type ControlAuditEvent,
  type ManagementOperation,
  type NodeProfile,
} from '../../node-control-domain/src/index.js';
import { applyControlMigrations } from './migrations.js';

interface NodeProfileRow extends QueryResultRow {
  node_id: string;
  node_type: string;
  display_name: string;
  description: string;
  environment: string;
  labels: Record<string, string>;
  authority_scopes: string[];
  runtime_endpoint_ref: string;
  telemetry_source_id: string | null;
  status: NodeProfile['status'];
  revision: string;
  updated_at: Date;
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

interface AuditRow extends QueryResultRow {
  audit_id: string;
  actor_id: string;
  action: string;
  aggregate_type: string;
  aggregate_id: string;
  expected_revision: string | null;
  result_revision: string | null;
  reason: string;
  request_hash: string;
  result_code: string;
  created_at: Date;
}

export class PostgresNodeControlFoundationRepository implements NodeControlFoundationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async migrate(): Promise<void> {
    await applyControlMigrations(this.#pool);
  }

  async probe(): Promise<boolean> {
    const result = await this.#pool.query<{ ready: number }>('SELECT 1::integer AS ready');
    return result.rows[0]?.ready === 1;
  }

  async findNodeProfile(): Promise<NodeProfile | undefined> {
    const result = await this.#pool.query<NodeProfileRow>(
      `SELECT node_id, node_type, display_name, description, environment, labels,
              authority_scopes, runtime_endpoint_ref, telemetry_source_id, status,
              revision::text, updated_at
         FROM sdar_control.node_profile
        ORDER BY created_at, node_id
        LIMIT 2`,
    );
    if (result.rows.length > 1) throw new Error('CONTROL_SINGLE_NODE_INVARIANT_VIOLATED');
    const row = result.rows[0];
    return row === undefined ? undefined : mapNodeProfile(row);
  }

  async bootstrapNodeProfile(profile: NodeProfile, audit: ControlAuditEvent): Promise<boolean> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_control_single_node'))");
      const existing = await client.query<{ node_id: string }>(
        'SELECT node_id FROM sdar_control.node_profile LIMIT 1',
      );
      if (existing.rows[0] !== undefined) {
        if (existing.rows[0].node_id !== profile.nodeId) {
          throw new Error('CONTROL_SINGLE_NODE_IDENTITY_CONFLICT');
        }
        await client.query('COMMIT');
        return false;
      }
      await insertProfile(client, profile);
      await insertProfileRevision(client, profile, 'deployment-bootstrap', profile.updatedAt);
      await insertAudit(client, audit);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createNodeProfileDraft(
    profile: NodeProfile,
    expectedRevision: number,
    context: ConfigurationMutationContext,
  ): Promise<NodeProfile> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_control_node_profile'))");
      const replay = await findProfileReceipt(client, 'node.profile.draft', context);
      if (replay !== undefined) {
        const existing = await findProfileRevision(client, replay.revision);
        if (existing === undefined) throw new Error('NODE_PROFILE_RECEIPT_DANGLING');
        await client.query('COMMIT');
        return draftReplay(existing);
      }
      const latest = await latestProfileRevision(client);
      if (latest !== expectedRevision)
        throw profileError('PRECONDITION_FAILED', 'The Node Profile revision has advanced.', 412);
      if (profile.revision !== latest + 1)
        throw profileError(
          'NODE_PROFILE_REVISION_CONFLICT',
          'The Node Profile revision is not contiguous.',
          409,
        );
      await insertProfileRevision(client, profile, context.actorId, context.occurredAt);
      await insertProfileReceipt(client, 'node.profile.draft', context, profile.revision, null);
      await client.query('COMMIT');
      return profile;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async validateNodeProfileDraft(
    revision: number,
    expectedRevision: number,
    context: ConfigurationMutationContext,
  ): Promise<NodeProfile> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_control_node_profile'))");
      const replay = await findProfileReceipt(client, 'node.profile.validate', context);
      if (replay !== undefined) {
        const existing = await findProfileRevision(client, replay.revision);
        if (existing === undefined) throw new Error('NODE_PROFILE_RECEIPT_DANGLING');
        await client.query('COMMIT');
        return draftReplay(existing);
      }
      const latest = await latestProfileRevision(client);
      if (latest !== expectedRevision || revision !== latest)
        throw profileError('PRECONDITION_FAILED', 'The Node Profile draft is stale.', 412);
      const profile = await findProfileRevision(client, revision, true);
      if (profile?.status !== 'draft')
        throw profileError('NODE_PROFILE_DRAFT_NOT_FOUND', 'Node Profile draft not found.', 404);
      await client.query(
        `UPDATE sdar_control.node_profile_revision
            SET validated_at=$2
          WHERE node_id=$1 AND revision=$3 AND status='draft'`,
        [profile.nodeId, context.occurredAt, revision],
      );
      await insertProfileReceipt(client, 'node.profile.validate', context, revision, null);
      await client.query('COMMIT');
      return profile;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async publishNodeProfileDraft(
    revision: number,
    expectedRevision: number,
    operation: ManagementOperation,
    audit: ControlAuditEvent,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_control_node_profile'))");
      const replay = await findProfileReceipt(client, 'node.profile.publish', context);
      if (replay?.operationId !== undefined) {
        const existing = await findOperation(client, replay.operationId);
        if (existing === undefined) throw new Error('NODE_PROFILE_OPERATION_RECEIPT_DANGLING');
        await client.query('COMMIT');
        return existing;
      }
      const latest = await latestProfileRevision(client);
      if (latest !== expectedRevision || revision !== latest)
        throw profileError('PRECONDITION_FAILED', 'The Node Profile draft is stale.', 412);
      const draft = await client.query<NodeProfileRow>(
        `${profileRevisionSelect}
          WHERE revision=$1 AND status='draft' AND validated_at IS NOT NULL
          FOR UPDATE`,
        [revision],
      );
      const row = draft.rows[0];
      if (row === undefined)
        throw profileError(
          'NODE_PROFILE_DRAFT_NOT_VALIDATED',
          'The latest Node Profile draft must be validated before publication.',
          422,
        );
      await client.query(
        `UPDATE sdar_control.node_profile_revision
            SET status='active',published_at=$2
          WHERE node_id=$1 AND revision=$3`,
        [row.node_id, context.occurredAt, revision],
      );
      await client.query(
        `UPDATE sdar_control.node_profile
            SET node_type=$2,display_name=$3,description=$4,environment=$5,labels=$6::jsonb,
                authority_scopes=$7::jsonb,runtime_endpoint_ref=$8,telemetry_source_id=$9,
                status='active',revision=$10,updated_at=$11
          WHERE node_id=$1`,
        [
          row.node_id,
          row.node_type,
          row.display_name,
          row.description,
          row.environment,
          JSON.stringify(row.labels),
          JSON.stringify(row.authority_scopes),
          row.runtime_endpoint_ref,
          row.telemetry_source_id,
          revision,
          context.occurredAt,
        ],
      );
      await insertOperation(client, operation);
      await insertAudit(client, audit);
      await insertProfileReceipt(
        client,
        'node.profile.publish',
        context,
        revision,
        operation.operationId,
      );
      await client.query('COMMIT');
      return operation;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listManagementOperations(limit: number): Promise<readonly ManagementOperation[]> {
    const result = await this.#pool.query<OperationRow>(
      `SELECT operation_id, operation_type, target_type, target_id, target_version,
              target_revision::text, status, idempotency_key_hash::text, input_hash::text,
              actor_id, reason, result, error_code, created_at, started_at, completed_at
         FROM sdar_control.management_operation
        ORDER BY created_at DESC, operation_id DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapOperation);
  }

  async findManagementOperation(operationId: string): Promise<ManagementOperation | undefined> {
    const result = await this.#pool.query<OperationRow>(
      `SELECT operation_id, operation_type, target_type, target_id, target_version,
              target_revision::text, status, idempotency_key_hash::text, input_hash::text,
              actor_id, reason, result, error_code, created_at, started_at, completed_at
         FROM sdar_control.management_operation
        WHERE operation_id=$1`,
      [operationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapOperation(row);
  }

  async findGovernanceOperationReplay(
    operationType: string,
    idempotencyKeyHash: string,
  ): Promise<ManagementOperation | undefined> {
    const result = await this.#pool.query<OperationRow>(
      `${operationSelect}
        WHERE operation_type=$1 AND idempotency_key_hash=$2`,
      [operationType, idempotencyKeyHash],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapOperation(row);
  }

  async recordGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await insertOperation(client, operation);
      const result = await client.query<OperationRow>(
        `${operationSelect}
          WHERE operation_type=$1 AND idempotency_key_hash=$2
          FOR UPDATE`,
        [operation.operationType, operation.idempotencyKeyHash],
      );
      const persisted = result.rows[0];
      if (persisted === undefined) throw new Error('CONTROL_GOVERNANCE_OPERATION_NOT_PERSISTED');
      if (persisted.input_hash !== operation.inputHash)
        throw Object.assign(new Error('Governance operation idempotency conflict.'), {
          code: 'RUNTIME_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          status: 409,
        });
      await insertAudit(client, audit);
      await client.query('COMMIT');
      return mapOperation(persisted);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async startGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<OperationRow>(
        `${operationSelect} WHERE operation_id=$1 FOR UPDATE`,
        [operation.operationId],
      );
      const current = currentResult.rows[0];
      if (current === undefined) {
        throw Object.assign(new Error('Governance operation intent was not persisted.'), {
          code: 'RUNTIME_GOVERNANCE_INTENT_NOT_FOUND',
          status: 409,
        });
      }
      assertGovernanceOperationIdentity(current, operation);
      if (['succeeded', 'failed', 'canceled'].includes(current.status)) {
        await client.query('COMMIT');
        return mapOperation(current);
      }
      if (current.status === 'running') {
        throw Object.assign(
          new Error('Governance operation dispatch was already started and is not replayable.'),
          { code: 'RUNTIME_GOVERNANCE_DISPATCH_ALREADY_STARTED', status: 409 },
        );
      }
      const started = await client.query<OperationRow>(
        `UPDATE sdar_control.management_operation
            SET status='running',started_at=$2
          WHERE operation_id=$1 AND status='accepted'
          RETURNING operation_id,operation_type,target_type,target_id,target_version,
            target_revision::text,status,idempotency_key_hash::text,input_hash::text,
            actor_id,reason,result,error_code,created_at,started_at,completed_at`,
        [operation.operationId, audit.createdAt],
      );
      const row = started.rows[0];
      if (row === undefined) throw new Error('CONTROL_GOVERNANCE_OPERATION_NOT_STARTED');
      await insertAudit(client, audit);
      await client.query('COMMIT');
      return mapOperation(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markGovernanceOperationReconciliationPending(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    assertRuntimeReconciliationPendingOperation(operation);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<OperationRow>(
        `${operationSelect} WHERE operation_id=$1 FOR UPDATE`,
        [operation.operationId],
      );
      const current = currentResult.rows[0];
      if (current === undefined) {
        throw Object.assign(new Error('Governance operation intent was not persisted.'), {
          code: 'RUNTIME_GOVERNANCE_INTENT_NOT_FOUND',
          status: 409,
        });
      }
      assertGovernanceOperationIdentity(current, operation);
      if (['succeeded', 'failed', 'canceled'].includes(current.status)) {
        await client.query('COMMIT');
        return mapOperation(current);
      }
      if (current.status !== 'running') {
        throw Object.assign(
          new Error('Only a running Governance operation can await Runtime reconciliation.'),
          { code: 'RUNTIME_GOVERNANCE_RECONCILIATION_STATE_CONFLICT', status: 409 },
        );
      }
      assertCompatibleReconciliationMarker(current, operation);
      const pending = await client.query<OperationRow>(
        `UPDATE sdar_control.management_operation
            SET result=$2::jsonb,error_code=$3
          WHERE operation_id=$1 AND status='running' AND completed_at IS NULL
          RETURNING operation_id,operation_type,target_type,target_id,target_version,
            target_revision::text,status,idempotency_key_hash::text,input_hash::text,
            actor_id,reason,result,error_code,created_at,started_at,completed_at`,
        [operation.operationId, JSON.stringify(operation.result), operation.errorCode],
      );
      const row = pending.rows[0];
      if (row === undefined)
        throw Object.assign(new Error('Governance operation reconciliation state changed.'), {
          code: 'RUNTIME_GOVERNANCE_RECONCILIATION_STATE_CONFLICT',
          status: 409,
        });
      await insertAudit(client, audit);
      await client.query('COMMIT');
      return mapOperation(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelGovernanceOperation(
    operationId: string,
    audit: ControlAuditEvent,
    context: ConfigurationMutationContext,
  ): Promise<ManagementOperation | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<OperationRow>(
        `${operationSelect} WHERE operation_id=$1 FOR UPDATE`,
        [operationId],
      );
      const current = currentResult.rows[0];
      if (current === undefined) {
        await client.query('COMMIT');
        return undefined;
      }
      if (!cancellableBeforeDispatchOperationTypes.has(current.operation_type)) {
        throw Object.assign(
          new Error('This Governance operation type has no pre-dispatch cancellation contract.'),
          { code: 'MANAGEMENT_OPERATION_NOT_CANCELLABLE', status: 409 },
        );
      }
      if (current.status === 'canceled') {
        const replay = cancellationReceipt(current.result);
        if (
          replay?.actorId !== context.actorId ||
          replay.idempotencyKeyHash !== context.idempotencyKeyHash ||
          replay.requestHash !== context.requestHash
        )
          throw Object.assign(new Error('Cancellation idempotency identity conflicts.'), {
            code: 'MANAGEMENT_OPERATION_CANCEL_IDEMPOTENCY_CONFLICT',
            status: 409,
          });
        await client.query('COMMIT');
        return mapOperation(current);
      }
      if (current.status !== 'accepted') {
        throw Object.assign(
          new Error('Only a pre-dispatch accepted Governance operation can be canceled.'),
          { code: 'MANAGEMENT_OPERATION_NOT_CANCELLABLE', status: 409 },
        );
      }
      const canceled = await client.query<OperationRow>(
        `UPDATE sdar_control.management_operation
            SET status='canceled',result=$2::jsonb,completed_at=$3
          WHERE operation_id=$1 AND status='accepted'
          RETURNING operation_id,operation_type,target_type,target_id,target_version,
            target_revision::text,status,idempotency_key_hash::text,input_hash::text,
            actor_id,reason,result,error_code,created_at,started_at,completed_at`,
        [
          operationId,
          JSON.stringify({
            canceledBeforeDispatch: true,
            cancellation: {
              actorId: context.actorId,
              idempotencyKeyHash: context.idempotencyKeyHash,
              requestHash: context.requestHash,
            },
          }),
          audit.createdAt,
        ],
      );
      const row = canceled.rows[0];
      if (row === undefined) throw new Error('CONTROL_GOVERNANCE_OPERATION_NOT_CANCELED');
      await insertAudit(client, audit);
      await client.query('COMMIT');
      return mapOperation(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeGovernanceOperation(
    operation: ManagementOperation,
    audit: ControlAuditEvent,
  ): Promise<ManagementOperation> {
    if (!['succeeded', 'failed', 'canceled'].includes(operation.status)) {
      throw Object.assign(new Error('Governance operation completion must be terminal.'), {
        code: 'RUNTIME_GOVERNANCE_TERMINAL_STATUS_REQUIRED',
        status: 409,
      });
    }
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const currentResult = await client.query<OperationRow>(
        `${operationSelect} WHERE operation_id=$1 FOR UPDATE`,
        [operation.operationId],
      );
      const current = currentResult.rows[0];
      if (current === undefined) {
        throw Object.assign(new Error('Governance operation intent was not persisted.'), {
          code: 'RUNTIME_GOVERNANCE_INTENT_NOT_FOUND',
          status: 409,
        });
      }
      if (
        current.operation_type !== operation.operationType ||
        current.idempotency_key_hash !== operation.idempotencyKeyHash ||
        current.input_hash !== operation.inputHash ||
        current.actor_id !== operation.actorId
      ) {
        throw Object.assign(new Error('Governance operation completion identity conflicts.'), {
          code: 'RUNTIME_GOVERNANCE_IDEMPOTENCY_CONFLICT',
          status: 409,
        });
      }
      if (['succeeded', 'failed', 'canceled'].includes(current.status)) {
        await client.query('COMMIT');
        return mapOperation(current);
      }
      const completed = await client.query<OperationRow>(
        `UPDATE sdar_control.management_operation SET
           status=$2,result=$3::jsonb,error_code=$4,started_at=$5,completed_at=$6
         WHERE operation_id=$1 AND status IN ('accepted','running')
         RETURNING operation_id,operation_type,target_type,target_id,target_version,
           target_revision::text,status,idempotency_key_hash::text,input_hash::text,
           actor_id,reason,result,error_code,created_at,started_at,completed_at`,
        [
          operation.operationId,
          operation.status,
          operation.result === undefined ? null : JSON.stringify(operation.result),
          operation.errorCode ?? null,
          operation.startedAt ?? operation.createdAt,
          operation.completedAt ?? audit.createdAt,
        ],
      );
      const row = completed.rows[0];
      if (row === undefined) throw new Error('CONTROL_GOVERNANCE_OPERATION_NOT_COMPLETED');
      await insertAudit(client, audit);
      await client.query('COMMIT');
      return mapOperation(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listAuditEvents(limit: number): Promise<readonly ControlAuditEvent[]> {
    const result = await this.#pool.query<AuditRow>(
      `SELECT audit_id, actor_id, action, aggregate_type, aggregate_id,
              expected_revision::text, result_revision::text, reason, request_hash::text,
              result_code, created_at
         FROM sdar_control.control_audit_event
        ORDER BY created_at DESC, audit_id DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapAudit);
  }
}

async function insertProfile(client: PoolClient, profile: NodeProfile): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.node_profile (
       node_id, node_type, display_name, description, environment, labels,
       authority_scopes, runtime_endpoint_ref, telemetry_source_id, status, revision, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12)`,
    [
      profile.nodeId,
      profile.nodeType,
      profile.displayName,
      profile.description,
      profile.environment,
      JSON.stringify(profile.labels),
      JSON.stringify(profile.authorityScopes),
      profile.runtimeEndpointRef,
      profile.telemetrySourceId ?? null,
      profile.status,
      profile.revision,
      profile.updatedAt,
    ],
  );
}

const profileRevisionSelect = `SELECT node_id,node_type,display_name,description,environment,labels,
  authority_scopes,runtime_endpoint_ref,telemetry_source_id,status,revision::text,updated_at
  FROM sdar_control.node_profile_revision`;

async function insertProfileRevision(
  client: PoolClient,
  profile: NodeProfile,
  createdBy: string,
  createdAt: string,
): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.node_profile_revision(
       node_id,node_type,display_name,description,environment,labels,authority_scopes,
       runtime_endpoint_ref,telemetry_source_id,status,revision,created_by,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT(node_id,revision) DO NOTHING`,
    [
      profile.nodeId,
      profile.nodeType,
      profile.displayName,
      profile.description,
      profile.environment,
      JSON.stringify(profile.labels),
      JSON.stringify(profile.authorityScopes),
      profile.runtimeEndpointRef,
      profile.telemetrySourceId ?? null,
      profile.status,
      profile.revision,
      createdBy,
      createdAt,
      profile.updatedAt,
    ],
  );
}

async function latestProfileRevision(client: PoolClient): Promise<number> {
  const result = await client.query<{ revision: string }>(
    'SELECT COALESCE(MAX(revision),0)::text AS revision FROM sdar_control.node_profile_revision',
  );
  return Number(result.rows[0]?.revision ?? 0);
}

async function findProfileRevision(
  client: PoolClient,
  revision: number,
  lock = false,
): Promise<NodeProfile | undefined> {
  const result = await client.query<NodeProfileRow>(
    `${profileRevisionSelect} WHERE revision=$1${lock ? ' FOR UPDATE' : ''}`,
    [revision],
  );
  return result.rows[0] === undefined ? undefined : mapNodeProfile(result.rows[0]);
}

interface ProfileReceiptRow extends QueryResultRow {
  request_hash: string;
  revision: string;
  operation_id: string | null;
}

async function findProfileReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
): Promise<Readonly<{ revision: number; operationId?: string }> | undefined> {
  const result = await client.query<ProfileReceiptRow>(
    `SELECT request_hash::text,revision::text,operation_id
       FROM sdar_control.node_profile_command_receipt
      WHERE scope=$1 AND idempotency_key_hash=$2`,
    [scope, context.idempotencyKeyHash],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  if (row.request_hash.trim() !== context.requestHash)
    throw profileError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was reused.', 409);
  return Object.freeze({
    revision: Number(row.revision),
    ...(row.operation_id === null ? {} : { operationId: row.operation_id }),
  });
}

function insertProfileReceipt(
  client: PoolClient,
  scope: string,
  context: ConfigurationMutationContext,
  revision: number,
  operationId: string | null,
): Promise<unknown> {
  return client.query(
    `INSERT INTO sdar_control.node_profile_command_receipt(
       scope,idempotency_key_hash,request_hash,revision,operation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      scope,
      context.idempotencyKeyHash,
      context.requestHash,
      revision,
      operationId,
      context.occurredAt,
    ],
  );
}

async function findOperation(
  client: PoolClient,
  operationId: string,
): Promise<ManagementOperation | undefined> {
  const result = await client.query<OperationRow>(`${operationSelect} WHERE operation_id=$1`, [
    operationId,
  ]);
  return result.rows[0] === undefined ? undefined : mapOperation(result.rows[0]);
}

function profileError(code: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { code, status });
}

function draftReplay(profile: NodeProfile): NodeProfile {
  return profile.status === 'draft'
    ? profile
    : rehydrateNodeProfile(Object.freeze({ ...profile, status: 'draft' }));
}

async function insertAudit(client: PoolClient, audit: ControlAuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.control_audit_event (
       audit_id, actor_id, action, aggregate_type, aggregate_id, expected_revision,
       result_revision, reason, request_hash, result_code, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT(audit_id) DO NOTHING`,
    [
      audit.auditId,
      audit.actorId,
      audit.action,
      audit.aggregateType,
      audit.aggregateId,
      audit.expectedRevision ?? null,
      audit.resultRevision ?? null,
      audit.reason,
      audit.requestHash,
      audit.resultCode,
      audit.createdAt,
    ],
  );
}

async function insertOperation(client: PoolClient, operation: ManagementOperation): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.management_operation(
       operation_id,operation_type,target_type,target_id,target_version,target_revision,status,
       idempotency_key_hash,input_hash,actor_id,reason,result,error_code,created_at,started_at,completed_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
     ON CONFLICT(operation_type,idempotency_key_hash) DO NOTHING`,
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

const operationSelect = `SELECT operation_id, operation_type, target_type, target_id, target_version,
       target_revision::text, status, idempotency_key_hash::text, input_hash::text,
       actor_id, reason, result, error_code, created_at, started_at, completed_at
  FROM sdar_control.management_operation`;

const cancellableBeforeDispatchOperationTypes = new Set([
  'task.pause',
  'task.resume',
  'task.cancel',
  'task.goal_patch',
]);

function assertGovernanceOperationIdentity(
  current: OperationRow,
  expected: ManagementOperation,
): void {
  if (
    current.operation_type !== expected.operationType ||
    current.idempotency_key_hash !== expected.idempotencyKeyHash ||
    current.input_hash !== expected.inputHash ||
    current.actor_id !== expected.actorId
  )
    throw Object.assign(new Error('Governance operation dispatch identity conflicts.'), {
      code: 'RUNTIME_GOVERNANCE_IDEMPOTENCY_CONFLICT',
      status: 409,
    });
}

const runtimeReconciliationCodes = new Set([
  'RUNTIME_TASK_COMMAND_RECONCILIATION_PENDING',
  'COGNITIVE_MANAGEMENT_ACTION_RECONCILIATION_PENDING',
  'COGNITIVE_MANAGEMENT_ACTION_IN_PROGRESS',
  'COGNITIVE_MANAGEMENT_ACTION_LEASE_LOST',
  'RUNTIME_TASK_COMMAND_RECOVERY_INDETERMINATE',
]);

function assertRuntimeReconciliationPendingOperation(operation: ManagementOperation): void {
  const marker = runtimeReconciliationMarker(operation.result);
  if (
    operation.status !== 'running' ||
    operation.completedAt !== undefined ||
    operation.errorCode === undefined ||
    !runtimeReconciliationCodes.has(operation.errorCode) ||
    marker === undefined
  )
    throw Object.assign(
      new Error('Governance operation requires a bounded Runtime reconciliation marker.'),
      { code: 'RUNTIME_GOVERNANCE_RECONCILIATION_MARKER_INVALID', status: 409 },
    );
}

function assertCompatibleReconciliationMarker(
  current: OperationRow,
  expected: ManagementOperation,
): void {
  if (current.result === null && current.error_code === null) return;
  const currentMarker = runtimeReconciliationMarker(current.result);
  const expectedMarker = runtimeReconciliationMarker(expected.result);
  if (
    currentMarker === undefined ||
    expectedMarker === undefined ||
    current.error_code !== expected.errorCode ||
    currentMarker.failureStatus !== expectedMarker.failureStatus
  )
    throw Object.assign(new Error('Governance operation reconciliation marker conflicts.'), {
      code: 'RUNTIME_GOVERNANCE_RECONCILIATION_STATE_CONFLICT',
      status: 409,
    });
}

function runtimeReconciliationMarker(
  value: unknown,
): Readonly<{ failureStatus: number }> | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('runtimeReconciliationPending' in value) ||
    value.runtimeReconciliationPending !== true ||
    !('failureStatus' in value) ||
    typeof value.failureStatus !== 'number' ||
    !Number.isInteger(value.failureStatus) ||
    value.failureStatus < 400 ||
    value.failureStatus > 599
  )
    return undefined;
  return Object.freeze({ failureStatus: value.failureStatus });
}

function cancellationReceipt(value: unknown):
  | Readonly<{
      actorId: string;
      idempotencyKeyHash: string;
      requestHash: string;
    }>
  | undefined {
  if (typeof value !== 'object' || value === null || !('cancellation' in value)) return undefined;
  const receipt = value.cancellation;
  if (typeof receipt !== 'object' || receipt === null) return undefined;
  if (
    !('actorId' in receipt) ||
    typeof receipt.actorId !== 'string' ||
    !('idempotencyKeyHash' in receipt) ||
    typeof receipt.idempotencyKeyHash !== 'string' ||
    !('requestHash' in receipt) ||
    typeof receipt.requestHash !== 'string'
  )
    return undefined;
  return Object.freeze({
    actorId: receipt.actorId,
    idempotencyKeyHash: receipt.idempotencyKeyHash,
    requestHash: receipt.requestHash,
  });
}

function mapNodeProfile(row: NodeProfileRow): NodeProfile {
  return rehydrateNodeProfile({
    nodeId: row.node_id,
    nodeType: row.node_type,
    displayName: row.display_name,
    description: row.description,
    environment: row.environment,
    labels: row.labels,
    authorityScopes: row.authority_scopes,
    runtimeEndpointRef: row.runtime_endpoint_ref,
    ...(row.telemetry_source_id === null ? {} : { telemetrySourceId: row.telemetry_source_id }),
    status: row.status,
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
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
    idempotencyKeyHash: row.idempotency_key_hash,
    inputHash: row.input_hash,
    ...(row.result === null ? {} : { result: row.result }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    createdAt: row.created_at.toISOString(),
    ...(row.started_at === null ? {} : { startedAt: row.started_at.toISOString() }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }),
  });
}

function mapAudit(row: AuditRow): ControlAuditEvent {
  return Object.freeze({
    auditId: row.audit_id,
    actorId: row.actor_id,
    action: row.action,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    ...(row.expected_revision === null ? {} : { expectedRevision: Number(row.expected_revision) }),
    ...(row.result_revision === null ? {} : { resultRevision: Number(row.result_revision) }),
    reason: row.reason,
    requestHash: row.request_hash,
    resultCode: row.result_code,
    createdAt: row.created_at.toISOString(),
  });
}
