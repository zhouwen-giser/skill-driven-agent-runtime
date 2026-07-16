import type { Pool, PoolClient, QueryResultRow } from 'pg';

import type {
  RemoteTaskCancellationClaimResult,
  RemoteTaskCancellationMutationResult,
  RemoteTaskCancellationRepository,
  RemoteTaskCancellationRequestResult,
} from '../../application/src/index.js';
import type {
  RemoteTaskCancellationAttempt,
  RemoteTaskCancellationAttemptStatus,
  RemoteTaskCancellationDeliveryStatus,
  RemoteTaskCancellationProviderTerminalStatus,
  RemoteTaskCancellationRequest,
} from '../../domain/src/index.js';

interface CancellationRequestRow extends QueryResultRow {
  cancel_request_id: string;
  binding_id: string;
  idempotency_key: string;
  source: RemoteTaskCancellationRequest['source'];
  reason_code: string;
  summary: string;
  delivery_status: RemoteTaskCancellationDeliveryStatus;
  provider_terminal_status: RemoteTaskCancellationProviderTerminalStatus | null;
  protocol_revision: string | null;
  acknowledged_at: Date | string | null;
  resolved_at: Date | string | null;
  claim_token: string | null;
  claimed_at: Date | string | null;
  claim_expires_at: Date | string | null;
  attempt_count: number;
  last_safe_error_code: string | null;
  requested_at: Date | string;
  updated_at: Date | string;
  version: string | number;
}

interface CancellationAttemptRow extends QueryResultRow {
  attempt_id: string;
  cancel_request_id: string;
  binding_id: string;
  expected_request_version: string | number;
  protocol_revision: string;
  status: RemoteTaskCancellationAttemptStatus;
  error_code: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  duration_ms: string | number;
}

export class PostgresRemoteTaskCancellationRepository implements RemoteTaskCancellationRepository {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  requestCancellation(
    request: RemoteTaskCancellationRequest,
    expectedBindingVersion: number,
  ): Promise<RemoteTaskCancellationRequestResult> {
    return withTransaction(this.#pool, async (client) => {
      const binding = (
        await client.query<{
          binding_id: string;
          protocol_status: string;
          local_state: string;
          terminal_at: Date | string | null;
          version: string | number;
        }>('SELECT * FROM remote_task_binding WHERE binding_id=$1 FOR UPDATE', [request.bindingId])
      ).rows[0];
      if (binding === undefined) return { requested: false, reason: 'missing' };
      const existing = (
        await client.query<CancellationRequestRow>(
          `SELECT * FROM remote_task_cancel_request
           WHERE binding_id=$1 AND idempotency_key=$2 FOR UPDATE`,
          [request.bindingId, request.idempotencyKey],
        )
      ).rows[0];
      if (existing !== undefined) {
        const mapped = mapCancellationRequest(existing);
        if (!sameCancellationRequest(mapped, request))
          throw new Error('REMOTE_TASK_CANCELLATION_IDEMPOTENCY_CONFLICT');
        return { requested: true, request: mapped, created: false };
      }
      if (
        binding.terminal_at !== null ||
        ['completed', 'failed', 'cancelled'].includes(binding.protocol_status)
      )
        return { requested: false, reason: 'terminal' };
      if (['closed', 'reentered', 'quarantined'].includes(binding.local_state))
        return { requested: false, reason: 'closed' };
      if (toSafeNumber(binding.version) !== expectedBindingVersion)
        return { requested: false, reason: 'stale' };
      const inserted = await client.query<CancellationRequestRow>(
        `INSERT INTO remote_task_cancel_request(
           cancel_request_id,binding_id,idempotency_key,source,reason_code,summary,
           delivery_status,attempt_count,requested_at,updated_at,version)
         VALUES($1,$2,$3,$4,$5,$6,'requested',0,$7,$7,1)
         RETURNING *`,
        [
          request.requestId,
          request.bindingId,
          request.idempotencyKey,
          request.source,
          request.reasonCode,
          request.summary,
          request.requestedAt,
        ],
      );
      const updated = await client.query(
        `UPDATE remote_task_binding
         SET local_state='cancel_observing',next_poll_at=$3,
             poll_claim_token=NULL,poll_claimed_at=NULL,poll_claim_expires_at=NULL,
             updated_at=$3,version=version+1
         WHERE binding_id=$1 AND version=$2`,
        [request.bindingId, expectedBindingVersion, request.requestedAt],
      );
      if (updated.rowCount !== 1) throw new Error('REMOTE_TASK_CANCELLATION_BINDING_CAS_FAILED');
      const row = inserted.rows[0];
      if (row === undefined) throw new Error('REMOTE_TASK_CANCELLATION_INSERT_FAILED');
      return { requested: true, request: mapCancellationRequest(row), created: true };
    });
  }

  async findCancellation(requestId: string): Promise<RemoteTaskCancellationRequest | undefined> {
    const result = await this.#pool.query<CancellationRequestRow>(
      'SELECT * FROM remote_task_cancel_request WHERE cancel_request_id=$1',
      [requestId],
    );
    return result.rows[0] === undefined ? undefined : mapCancellationRequest(result.rows[0]);
  }

  async listRequiringDelivery(
    now: string,
    limit: number,
  ): Promise<readonly RemoteTaskCancellationRequest[]> {
    const result = await this.#pool.query<CancellationRequestRow>(
      `SELECT * FROM remote_task_cancel_request
       WHERE delivery_status='requested' AND provider_terminal_status IS NULL
         AND (claim_expires_at IS NULL OR claim_expires_at <= $1)
       ORDER BY updated_at,cancel_request_id LIMIT $2`,
      [now, Math.max(1, Math.min(1_000, Math.trunc(limit)))],
    );
    return result.rows.map(mapCancellationRequest);
  }

  async claimCancellation(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      claimedAt: string;
      expiresAt: string;
    }>,
  ): Promise<RemoteTaskCancellationClaimResult> {
    const result = await this.#pool.query<CancellationRequestRow>(
      `UPDATE remote_task_cancel_request
       SET claim_token=$3,claimed_at=$4,claim_expires_at=$5,
           attempt_count=attempt_count+1,updated_at=$4,version=version+1
       WHERE cancel_request_id=$1 AND version=$2
         AND delivery_status IN ('requested','uncertain')
         AND provider_terminal_status IS NULL
         AND (claim_expires_at IS NULL OR claim_expires_at <= $4)
       RETURNING *`,
      [input.requestId, input.expectedVersion, input.claimToken, input.claimedAt, input.expiresAt],
    );
    const row = result.rows[0];
    if (row !== undefined) return { claimed: true, request: mapCancellationRequest(row) };
    const current = await this.findCancellation(input.requestId);
    if (current === undefined) return { claimed: false, reason: 'missing' };
    if (current.providerTerminalStatus !== undefined) return { claimed: false, reason: 'resolved' };
    if (
      current.claimExpiresAt !== undefined &&
      Date.parse(current.claimExpiresAt) > Date.parse(input.claimedAt)
    )
      return { claimed: false, reason: 'leased' };
    return { claimed: false, reason: 'stale' };
  }

  recordCancellationAcknowledged(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      attempt: RemoteTaskCancellationAttempt;
      acknowledgedAt: string;
      protocolRevision: string;
    }>,
  ): Promise<RemoteTaskCancellationMutationResult> {
    return this.#recordAttempt(input, async (client) => {
      const updated = await client.query<CancellationRequestRow>(
        `UPDATE remote_task_cancel_request
         SET delivery_status='acknowledged',protocol_revision=$4,acknowledged_at=$5,
             claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
             last_safe_error_code=NULL,updated_at=$5,version=version+1
         WHERE cancel_request_id=$1 AND version=$2 AND claim_token=$3
           AND provider_terminal_status IS NULL
         RETURNING *`,
        [
          input.requestId,
          input.expectedVersion,
          input.claimToken,
          input.protocolRevision,
          input.acknowledgedAt,
        ],
      );
      return updated.rows[0];
    });
  }

  recordCancellationUncertain(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      attempt: RemoteTaskCancellationAttempt;
      errorCode: string;
      observedAt: string;
    }>,
  ): Promise<RemoteTaskCancellationMutationResult> {
    return this.#recordAttempt(input, async (client) => {
      const updated = await client.query<CancellationRequestRow>(
        `UPDATE remote_task_cancel_request
         SET delivery_status='uncertain',claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
             last_safe_error_code=$4,updated_at=$5,version=version+1
         WHERE cancel_request_id=$1 AND version=$2 AND claim_token=$3
           AND provider_terminal_status IS NULL
         RETURNING *`,
        [
          input.requestId,
          input.expectedVersion,
          input.claimToken,
          input.errorCode,
          input.observedAt,
        ],
      );
      return updated.rows[0];
    });
  }

  async resolveCancellationFromProvider(
    bindingId: string,
    status: RemoteTaskCancellationProviderTerminalStatus,
    resolvedAt: string,
  ): Promise<readonly RemoteTaskCancellationRequest[]> {
    const result = await this.#pool.query<CancellationRequestRow>(
      `UPDATE remote_task_cancel_request
       SET provider_terminal_status=$2,resolved_at=$3,
           claim_token=NULL,claimed_at=NULL,claim_expires_at=NULL,
           updated_at=$3,version=version+1
       WHERE binding_id=$1 AND provider_terminal_status IS NULL
       RETURNING *`,
      [bindingId, status, resolvedAt],
    );
    return result.rows.map(mapCancellationRequest);
  }

  async listCancellationAttempts(
    requestId: string,
  ): Promise<readonly RemoteTaskCancellationAttempt[]> {
    const result = await this.#pool.query<CancellationAttemptRow>(
      `SELECT * FROM remote_task_cancel_attempt
       WHERE cancel_request_id=$1 ORDER BY started_at,attempt_id`,
      [requestId],
    );
    return result.rows.map(mapCancellationAttempt);
  }

  async #recordAttempt(
    input: Readonly<{
      requestId: string;
      expectedVersion: number;
      claimToken: string;
      attempt: RemoteTaskCancellationAttempt;
    }>,
    update: (client: PoolClient) => Promise<CancellationRequestRow | undefined>,
  ): Promise<RemoteTaskCancellationMutationResult> {
    return withTransaction(this.#pool, async (client) => {
      const current = (
        await client.query<CancellationRequestRow>(
          'SELECT * FROM remote_task_cancel_request WHERE cancel_request_id=$1 FOR UPDATE',
          [input.requestId],
        )
      ).rows[0];
      if (current === undefined) return { applied: false, reason: 'missing' };
      if (current.provider_terminal_status !== null) {
        await insertAttempt(client, {
          ...input.attempt,
          status: 'stale_terminal',
          errorCode: 'REMOTE_TASK_CANCELLATION_PROVIDER_TERMINAL',
        });
        return { applied: false, reason: 'resolved' };
      }
      await insertAttempt(client, input.attempt);
      if (
        toSafeNumber(current.version) !== input.expectedVersion ||
        current.claim_token !== input.claimToken
      )
        return { applied: false, reason: 'stale' };
      const row = await update(client);
      if (row === undefined) throw new Error('REMOTE_TASK_CANCELLATION_CAS_FAILED');
      return { applied: true, request: mapCancellationRequest(row) };
    });
  }
}

async function insertAttempt(client: PoolClient, attempt: RemoteTaskCancellationAttempt) {
  await client.query(
    `INSERT INTO remote_task_cancel_attempt(
       attempt_id,cancel_request_id,binding_id,expected_request_version,method,
       protocol_revision,status,error_code,started_at,completed_at,duration_ms)
     VALUES($1,$2,$3,$4,'tasks/cancel',$5,$6,$7,$8,$9,$10)
     ON CONFLICT(attempt_id) DO NOTHING`,
    [
      attempt.attemptId,
      attempt.requestId,
      attempt.bindingId,
      attempt.expectedRequestVersion,
      attempt.protocolRevision,
      attempt.status,
      attempt.errorCode ?? null,
      attempt.startedAt,
      attempt.completedAt,
      attempt.durationMs,
    ],
  );
}

function mapCancellationRequest(row: CancellationRequestRow): RemoteTaskCancellationRequest {
  return {
    requestId: row.cancel_request_id,
    bindingId: row.binding_id,
    idempotencyKey: row.idempotency_key,
    source: row.source,
    reasonCode: row.reason_code,
    summary: row.summary,
    deliveryStatus: row.delivery_status,
    ...(row.provider_terminal_status === null
      ? {}
      : { providerTerminalStatus: row.provider_terminal_status }),
    ...(row.protocol_revision === null ? {} : { protocolRevision: row.protocol_revision }),
    ...(row.acknowledged_at === null ? {} : { acknowledgedAt: toIsoString(row.acknowledged_at) }),
    ...(row.resolved_at === null ? {} : { resolvedAt: toIsoString(row.resolved_at) }),
    ...(row.claim_token === null ? {} : { claimToken: row.claim_token }),
    ...(row.claimed_at === null ? {} : { claimedAt: toIsoString(row.claimed_at) }),
    ...(row.claim_expires_at === null ? {} : { claimExpiresAt: toIsoString(row.claim_expires_at) }),
    attemptCount: row.attempt_count,
    ...(row.last_safe_error_code === null ? {} : { lastSafeErrorCode: row.last_safe_error_code }),
    requestedAt: toIsoString(row.requested_at),
    updatedAt: toIsoString(row.updated_at),
    version: toSafeNumber(row.version),
  };
}

function mapCancellationAttempt(row: CancellationAttemptRow): RemoteTaskCancellationAttempt {
  return {
    attemptId: row.attempt_id,
    requestId: row.cancel_request_id,
    bindingId: row.binding_id,
    expectedRequestVersion: toSafeNumber(row.expected_request_version),
    protocolRevision: row.protocol_revision,
    status: row.status,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    durationMs: toSafeNumber(row.duration_ms),
  };
}

function sameCancellationRequest(
  current: RemoteTaskCancellationRequest,
  candidate: RemoteTaskCancellationRequest,
): boolean {
  return (
    current.bindingId === candidate.bindingId &&
    current.idempotencyKey === candidate.idempotencyKey &&
    current.source === candidate.source &&
    current.reasonCode === candidate.reasonCode &&
    current.summary === candidate.summary
  );
}

function toSafeNumber(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error('REMOTE_TASK_CANCELLATION_NUMBER_INVALID');
  return parsed;
}

function toIsoString(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error('POSTGRES_TIMESTAMP_INVALID');
  return parsed.toISOString();
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
