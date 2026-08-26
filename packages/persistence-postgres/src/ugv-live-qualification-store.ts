import type { Pool, QueryResultRow } from 'pg';

import type {
  UgvLiveQualificationRecord,
  UgvLiveQualificationStore,
} from '../../application/src/ugv-live-qualification.js';
import {
  createRemoteTaskAuthoritySnapshot,
  hashCanonicalEvidenceJson,
} from '../../domain/src/index.js';
import { mapMcpInvocationRow, type McpInvocationRow } from './repositories.js';

interface QualificationRow extends QueryResultRow {
  request_id: string;
  invocation_id: string;
  execution_context: UgvLiveQualificationRecord['executionContext'];
  status: UgvLiveQualificationRecord['status'];
  created_at: Date | string;
  authority_snapshot: unknown;
  dispatch_hash: string | null;
  result_hash: `sha256:${string}` | null;
  invocation: McpInvocationRow | null;
}

export class PostgresUgvLiveQualificationStore implements UgvLiveQualificationStore {
  constructor(private readonly pool: Pool) {}

  async reserve(input: Parameters<UgvLiveQualificationStore['reserve']>[0]): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO ugv_live_qualification(request_id,invocation_id,status,created_at)
       VALUES ($1,$2,'dispatching',$3) ON CONFLICT (request_id) DO NOTHING`,
      [input.requestId, input.invocationId, input.createdAt],
    );
    return result.rowCount === 1;
  }

  async freezeDispatch(
    input: Parameters<UgvLiveQualificationStore['freezeDispatch']>[0],
  ): Promise<void> {
    const snapshot = createRemoteTaskAuthoritySnapshot(input.authoritySnapshot);
    const result = await this.pool.query(
      `UPDATE ugv_live_qualification SET authority_snapshot=$3::jsonb,dispatch_hash=$4
       WHERE request_id=$1 AND invocation_id=$2 AND status='dispatching'
       AND authority_snapshot IS NULL`,
      [input.requestId, input.invocationId, JSON.stringify(snapshot), input.dispatchHash],
    );
    if (result.rowCount !== 1) throw new Error('UGV_LIVE_QUALIFICATION_DISPATCH_CONFLICT');
  }

  async complete(
    requestId: string,
    invocationId: string,
    resultHash: `sha256:${string}`,
  ): Promise<void> {
    const saved = await this.load(requestId);
    const invocation = saved?.invocation;
    if (
      saved?.record.invocationId !== invocationId ||
      saved.record.authoritySnapshot === undefined ||
      invocation?.invocationId !== invocationId ||
      invocation.taskId !== undefined ||
      invocation.capabilityAttemptId !== undefined ||
      invocation.executionMode !== 'live' ||
      invocation.simulationId !== undefined ||
      invocation.status !== 'succeeded' ||
      invocation.toolName !== 'vehicle_get_state' ||
      invocation.serverId !== saved.record.authoritySnapshot.runtime.serverId ||
      hashCanonicalEvidenceJson(invocation.result) !== resultHash
    )
      throw new Error('UGV_LIVE_QUALIFICATION_RECEIPT_CONFLICT');
    const result = await this.pool.query(
      `UPDATE ugv_live_qualification SET status='completed',result_hash=$3
       WHERE request_id=$1 AND invocation_id=$2 AND status='dispatching' AND authority_snapshot IS NOT NULL`,
      [requestId, invocationId, resultHash],
    );
    if (result.rowCount !== 1) throw new Error('UGV_LIVE_QUALIFICATION_RECEIPT_CONFLICT');
  }

  async markUncertain(requestId: string, invocationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ugv_live_qualification SET status='uncertain'
       WHERE request_id=$1 AND invocation_id=$2 AND status='dispatching'`,
      [requestId, invocationId],
    );
  }

  async load(requestId: string) {
    const result = await this.pool.query<QualificationRow>(
      `SELECT q.*, CASE WHEN i.invocation_id IS NULL THEN NULL ELSE row_to_json(i) END AS invocation
       FROM ugv_live_qualification q LEFT JOIN mcp_invocation i ON i.invocation_id=q.invocation_id
       WHERE q.request_id=$1`,
      [requestId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const record: UgvLiveQualificationRecord = Object.freeze({
      requestId: row.request_id,
      invocationId: row.invocation_id,
      executionContext: row.execution_context,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      ...(row.authority_snapshot === null
        ? {}
        : {
            authoritySnapshot: createRemoteTaskAuthoritySnapshot(
              row.authority_snapshot as Parameters<typeof createRemoteTaskAuthoritySnapshot>[0],
            ),
          }),
      ...(row.dispatch_hash === null ? {} : { dispatchHash: row.dispatch_hash }),
      ...(row.result_hash === null ? {} : { resultHash: row.result_hash }),
    });
    return Object.freeze({
      record,
      ...(row.invocation === null ? {} : { invocation: mapMcpInvocationRow(row.invocation) }),
    });
  }
}
