import type { Pool, QueryResultRow } from 'pg';

import type {
  CognitiveManagementActionClaim,
  CognitiveManagementActionClaimResult,
  CognitiveManagementActionExecutionPhase,
  CognitiveManagementActionLease,
  CognitiveManagementActionRecord,
  CognitiveManagementOperation,
  CognitiveManagementActionRepository,
} from '../../../application/src/index.js';

interface CognitiveManagementActionRow extends QueryResultRow {
  action_id: string;
  operation: CognitiveManagementOperation;
  subject_id: string;
  expected_version: string;
  idempotency_key: string;
  actor_id: string;
  reason: string;
  request_hash: string;
  status: 'pending' | 'completed' | 'failed';
  result: unknown;
  error_code: string | null;
  claimed_at: Date | string;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
  updated_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  lease_attempt: number;
  lease_token: string | null;
  execution_phase: CognitiveManagementActionExecutionPhase;
  provider_dispatch_id: string | null;
  provider_dispatch_hash: string | null;
}

export class PostgresCognitiveManagementActionRepository implements CognitiveManagementActionRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async claim(
    input: CognitiveManagementActionClaim,
  ): Promise<CognitiveManagementActionClaimResult> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `cognitive-management:${input.operation}:${input.subjectId}:${input.idempotencyKey}`,
      ]);
      const inserted = await client.query<CognitiveManagementActionRow>(
        `INSERT INTO cognitive_management_action(
           action_id,operation,subject_id,expected_version,idempotency_key,
           actor_id,reason,request_hash,status,claimed_at,updated_at,
           lease_owner,lease_expires_at,lease_attempt,lease_token,execution_phase)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,clock_timestamp(),
           $10,clock_timestamp()+($11::double precision*interval '1 millisecond'),1,$12,'claimed')
         ON CONFLICT(operation,subject_id,idempotency_key) DO NOTHING
         RETURNING action_id,request_hash,status,result,error_code,lease_owner,
           lease_expires_at,lease_attempt,lease_token,execution_phase,
           provider_dispatch_id,provider_dispatch_hash`,
        [
          input.actionId,
          input.operation,
          input.subjectId,
          input.expectedVersion,
          input.idempotencyKey,
          input.actorId,
          input.reason,
          input.requestHash,
          input.claimedAt,
          input.leaseOwner,
          input.leaseDurationMs,
          input.leaseToken,
        ],
      );
      if (inserted.rows[0] !== undefined) {
        await client.query('COMMIT');
        return { disposition: 'claimed', lease: mapLease(inserted.rows[0]) };
      }
      const existing = await client.query<CognitiveManagementActionRow>(
        `SELECT action_id,request_hash,status,result,error_code,lease_owner,
           lease_expires_at,lease_attempt,lease_token,execution_phase,
           provider_dispatch_id,provider_dispatch_hash
         FROM cognitive_management_action
         WHERE operation=$1 AND subject_id=$2 AND idempotency_key=$3
         FOR UPDATE`,
        [input.operation, input.subjectId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row?.request_hash !== input.requestHash) {
        await client.query('COMMIT');
        return { disposition: 'conflict' };
      }
      if (row.status === 'completed') {
        await client.query('COMMIT');
        return { disposition: 'completed', result: row.result };
      }
      if (row.status === 'failed') {
        await client.query('COMMIT');
        return {
          disposition: 'failed',
          ...(row.error_code === null ? {} : { errorCode: row.error_code }),
        };
      }
      const recovered = await client.query<CognitiveManagementActionRow>(
        `UPDATE cognitive_management_action
         SET lease_owner=$2,
             lease_expires_at=clock_timestamp()+($3::double precision*interval '1 millisecond'),
             lease_attempt=lease_attempt+1,
             lease_token=$4,
             updated_at=clock_timestamp()
         WHERE action_id=$1 AND status='pending' AND lease_expires_at<=clock_timestamp()
         RETURNING action_id,request_hash,status,result,error_code,lease_owner,
           lease_expires_at,lease_attempt,lease_token,execution_phase,
           provider_dispatch_id,provider_dispatch_hash`,
        [input.actionId, input.leaseOwner, input.leaseDurationMs, input.leaseToken],
      );
      await client.query('COMMIT');
      const recoveredRow = recovered.rows[0];
      return recoveredRow === undefined
        ? { disposition: 'pending' }
        : { disposition: 'recovered', lease: mapLease(recoveredRow) };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async renewLease(
    lease: CognitiveManagementActionLease,
    leaseDurationMs: number,
  ): Promise<CognitiveManagementActionLease> {
    const updated = await this.#pool.query<CognitiveManagementActionRow>(
      `UPDATE cognitive_management_action
       SET lease_expires_at=clock_timestamp()+($5::double precision*interval '1 millisecond'),
           updated_at=clock_timestamp()
       WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
         AND lease_token=$4 AND lease_expires_at>clock_timestamp()
       RETURNING action_id,status,lease_owner,lease_expires_at,lease_attempt,lease_token,
         execution_phase,provider_dispatch_id,provider_dispatch_hash`,
      [lease.actionId, lease.owner, lease.attempt, lease.token, leaseDurationMs],
    );
    const row = updated.rows[0];
    if (row === undefined) leaseConflict();
    return mapLease(row);
  }

  async assertCurrentLease(lease: CognitiveManagementActionLease): Promise<void> {
    const result = await this.#pool.query(
      `SELECT 1
       FROM cognitive_management_action
       WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
         AND lease_token=$4 AND lease_expires_at>clock_timestamp()`,
      [lease.actionId, lease.owner, lease.attempt, lease.token],
    );
    if (result.rowCount !== 1) leaseConflict();
  }

  async runFencedProjection<T>(
    lease: CognitiveManagementActionLease,
    projection: () => Promise<T>,
  ): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const fenced = await client.query(
        `SELECT 1
         FROM cognitive_management_action
         WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
           AND lease_token=$4 AND lease_expires_at>clock_timestamp()
         FOR UPDATE`,
        [lease.actionId, lease.owner, lease.attempt, lease.token],
      );
      if (fenced.rowCount !== 1) leaseConflict();
      const result = await projection();
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async startExecution(
    lease: CognitiveManagementActionLease,
  ): Promise<CognitiveManagementActionLease> {
    const updated = await this.#pool.query<CognitiveManagementActionRow>(
      `UPDATE cognitive_management_action
       SET execution_phase='execution_started',updated_at=clock_timestamp()
       WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
         AND lease_token=$4 AND execution_phase='claimed'
         AND lease_expires_at>clock_timestamp()
       RETURNING action_id,status,lease_owner,lease_expires_at,lease_attempt,lease_token,
         execution_phase,provider_dispatch_id,provider_dispatch_hash`,
      [lease.actionId, lease.owner, lease.attempt, lease.token],
    );
    const row = updated.rows[0];
    if (row === undefined) leaseConflict();
    return mapLease(row);
  }

  async enterProviderDispatch(
    lease: CognitiveManagementActionLease,
    input: Readonly<{ dispatchId: string; dispatchHash: string }>,
  ): Promise<CognitiveManagementActionLease> {
    const updated = await this.#pool.query<CognitiveManagementActionRow>(
      `UPDATE cognitive_management_action
       SET execution_phase='provider_dispatch',provider_dispatch_id=$5,
           provider_dispatch_hash=$6,updated_at=clock_timestamp()
       WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
         AND lease_token=$4 AND execution_phase='execution_started'
         AND provider_dispatch_id IS NULL AND provider_dispatch_hash IS NULL
         AND lease_expires_at>clock_timestamp()
       RETURNING action_id,status,lease_owner,lease_expires_at,lease_attempt,lease_token,
         execution_phase,provider_dispatch_id,provider_dispatch_hash`,
      [
        lease.actionId,
        lease.owner,
        lease.attempt,
        lease.token,
        input.dispatchId,
        input.dispatchHash,
      ],
    );
    const row = updated.rows[0];
    if (row === undefined) leaseConflict();
    return mapLease(row);
  }

  async complete(
    lease: CognitiveManagementActionLease,
    result: unknown,
    completedAt: string,
  ): Promise<void> {
    const updated = await this.#pool.query(
      `UPDATE cognitive_management_action
       SET status='completed',result=$5::jsonb,completed_at=$6,updated_at=$6,
           lease_owner=NULL,lease_expires_at=NULL,lease_token=NULL,execution_phase='terminal'
       WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
         AND lease_token=$4 AND lease_expires_at>clock_timestamp()`,
      [
        lease.actionId,
        lease.owner,
        lease.attempt,
        lease.token,
        JSON.stringify(result ?? null),
        completedAt,
      ],
    );
    if (updated.rowCount !== 1) leaseConflict();
  }

  async fail(
    lease: CognitiveManagementActionLease,
    errorCode: string,
    failedAt: string,
  ): Promise<void> {
    const updated = await this.#pool.query(
      `UPDATE cognitive_management_action
       SET status='failed',error_code=$5,failed_at=$6,updated_at=$6,
           lease_owner=NULL,lease_expires_at=NULL,lease_token=NULL,execution_phase='terminal'
       WHERE action_id=$1 AND status='pending' AND lease_owner=$2 AND lease_attempt=$3
         AND lease_token=$4 AND lease_expires_at>clock_timestamp()`,
      [lease.actionId, lease.owner, lease.attempt, lease.token, errorCode, failedAt],
    );
    if (updated.rowCount !== 1) leaseConflict();
  }

  async list(limit = 100): Promise<readonly CognitiveManagementActionRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('COGNITIVE_MANAGEMENT_AUDIT_LIMIT_INVALID');
    }
    const result = await this.#pool.query<CognitiveManagementActionRow>(
      `SELECT action_id,operation,subject_id,expected_version::text AS expected_version,idempotency_key,actor_id,
         reason,request_hash,status,result,error_code,claimed_at,completed_at,failed_at,updated_at,
         lease_owner,lease_expires_at,lease_attempt,lease_token,execution_phase
         ,provider_dispatch_id,provider_dispatch_hash
       FROM cognitive_management_action
       ORDER BY updated_at DESC,action_id
       LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          actionId: row.action_id,
          operation: row.operation,
          subjectId: row.subject_id,
          expectedVersion: safeExpectedVersion(row.expected_version),
          idempotencyKey: row.idempotency_key,
          actorId: row.actor_id,
          reason: row.reason,
          requestHash: row.request_hash,
          status: row.status,
          ...(row.result === null ? {} : { result: row.result }),
          ...(row.error_code === null ? {} : { errorCode: row.error_code }),
          claimedAt: toIsoString(row.claimed_at),
          ...(row.completed_at === null ? {} : { completedAt: toIsoString(row.completed_at) }),
          ...(row.failed_at === null ? {} : { failedAt: toIsoString(row.failed_at) }),
          updatedAt: toIsoString(row.updated_at),
          ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
          ...(row.lease_expires_at === null
            ? {}
            : { leaseExpiresAt: toIsoString(row.lease_expires_at) }),
          leaseAttempt: row.lease_attempt,
          executionPhase: row.execution_phase,
          ...(row.provider_dispatch_id === null
            ? {}
            : { providerDispatchId: row.provider_dispatch_id }),
          ...(row.provider_dispatch_hash === null
            ? {}
            : { providerDispatchHash: row.provider_dispatch_hash }),
        }),
      ),
    );
  }
}

function mapLease(row: CognitiveManagementActionRow): CognitiveManagementActionLease {
  if (
    row.status !== 'pending' ||
    row.lease_owner === null ||
    row.lease_expires_at === null ||
    row.lease_token === null ||
    row.execution_phase === 'terminal' ||
    (row.provider_dispatch_id === null) !== (row.provider_dispatch_hash === null) ||
    (row.execution_phase === 'provider_dispatch' && row.provider_dispatch_id === null) ||
    (row.execution_phase !== 'provider_dispatch' && row.provider_dispatch_id !== null)
  )
    leaseConflict();
  return Object.freeze({
    actionId: row.action_id,
    owner: row.lease_owner,
    attempt: row.lease_attempt,
    token: row.lease_token,
    expiresAt: toIsoString(row.lease_expires_at),
    executionPhase: row.execution_phase,
    ...(row.provider_dispatch_id === null
      ? {}
      : {
          providerDispatchId: row.provider_dispatch_id,
          providerDispatchHash: row.provider_dispatch_hash ?? leaseConflict(),
        }),
  });
}

function leaseConflict(): never {
  throw new Error('COGNITIVE_MANAGEMENT_ACTION_LEASE_CONFLICT');
}

function safeExpectedVersion(value: string): number {
  const expectedVersion = Number(value);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
    throw new Error('COGNITIVE_MANAGEMENT_ACTION_EXPECTED_VERSION_INVALID');
  return expectedVersion;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
