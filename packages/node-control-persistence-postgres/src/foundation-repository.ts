import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type { NodeControlFoundationRepository } from '../../node-control-application/src/index.js';
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

async function insertAudit(client: PoolClient, audit: ControlAuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO sdar_control.control_audit_event (
       audit_id, actor_id, action, aggregate_type, aggregate_id, expected_revision,
       result_revision, reason, request_hash, result_code, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
