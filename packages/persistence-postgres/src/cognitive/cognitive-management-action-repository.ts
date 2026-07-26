import type { Pool, QueryResultRow } from 'pg';

import type {
  CognitiveManagementActionClaim,
  CognitiveManagementActionClaimResult,
  CognitiveManagementActionRecord,
  CognitiveManagementOperation,
  CognitiveManagementActionRepository,
} from '../../../application/src/index.js';

interface CognitiveManagementActionRow extends QueryResultRow {
  action_id: string;
  operation: CognitiveManagementOperation;
  subject_id: string;
  expected_version: number;
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
           actor_id,reason,request_hash,status,claimed_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$9)
         ON CONFLICT(operation,subject_id,idempotency_key) DO NOTHING
         RETURNING action_id,request_hash,status,result,error_code`,
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
        ],
      );
      if (inserted.rows[0] !== undefined) {
        await client.query('COMMIT');
        return { disposition: 'claimed' };
      }
      const existing = await client.query<CognitiveManagementActionRow>(
        `SELECT action_id,request_hash,status,result,error_code
         FROM cognitive_management_action
         WHERE operation=$1 AND subject_id=$2 AND idempotency_key=$3`,
        [input.operation, input.subjectId, input.idempotencyKey],
      );
      await client.query('COMMIT');
      const row = existing.rows[0];
      if (row?.request_hash !== input.requestHash) {
        return { disposition: 'conflict' };
      }
      if (row.status === 'completed') {
        return { disposition: 'completed', result: row.result };
      }
      return row.status === 'failed'
        ? {
            disposition: 'failed',
            ...(row.error_code === null ? {} : { errorCode: row.error_code }),
          }
        : { disposition: 'pending' };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(actionId: string, result: unknown, completedAt: string): Promise<void> {
    const updated = await this.#pool.query(
      `UPDATE cognitive_management_action
       SET status='completed',result=$2::jsonb,completed_at=$3,updated_at=$3
       WHERE action_id=$1 AND status='pending'`,
      [actionId, JSON.stringify(result ?? null), completedAt],
    );
    if (updated.rowCount !== 1) throw new Error('COGNITIVE_MANAGEMENT_ACTION_COMPLETION_CONFLICT');
  }

  async fail(actionId: string, errorCode: string, failedAt: string): Promise<void> {
    const updated = await this.#pool.query(
      `UPDATE cognitive_management_action
       SET status='failed',error_code=$2,failed_at=$3,updated_at=$3
       WHERE action_id=$1 AND status='pending'`,
      [actionId, errorCode, failedAt],
    );
    if (updated.rowCount !== 1) throw new Error('COGNITIVE_MANAGEMENT_ACTION_FAILURE_CONFLICT');
  }

  async list(limit = 100): Promise<readonly CognitiveManagementActionRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('COGNITIVE_MANAGEMENT_AUDIT_LIMIT_INVALID');
    }
    const result = await this.#pool.query<CognitiveManagementActionRow>(
      `SELECT action_id,operation,subject_id,expected_version,idempotency_key,actor_id,
         reason,request_hash,status,result,error_code,claimed_at,completed_at,failed_at,updated_at
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
          expectedVersion: row.expected_version,
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
        }),
      ),
    );
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
