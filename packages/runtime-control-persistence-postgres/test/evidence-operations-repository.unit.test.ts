import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { PostgresEvidenceOperationsRepository } from '../src/index.js';

describe('PostgresEvidenceOperationsRepository', () => {
  it('resets a sparse partition DLQ retry to the actual acknowledged prefix record', async () => {
    const client = new SparseDeadLetterRecoveryClient();
    const repository = new PostgresEvidenceOperationsRepository({
      connect: () => Promise.resolve(client),
    } as unknown as Pool);

    await expect(repository.resumeRecoveryRun(RECOVERY_RUN_ID)).resolves.toMatchObject({
      status: 'succeeded',
      affectedRecords: 1,
    });

    const frontierSql = client.sql.find((sql) => sql.includes('first_unacknowledged'));
    expect(frontierSql).toContain('eligible.sequence < frontier.first_unacknowledged');
    expect(frontierSql).toContain('ORDER BY eligible.sequence DESC');
    expect(frontierSql).not.toMatch(/first_unacknowledged\s*-\s*1/gu);
    expect(client.partitionStateParameters).toEqual([
      SOURCE_PARTITION,
      '2060',
      '2060',
      ACKNOWLEDGED_AT,
      REQUESTED_AT,
      EXPORT_ID,
      1,
    ]);
  });
});

const RECOVERY_RUN_ID = 'evidence-recovery-run:sparse-node-control';
const EXPORT_ID = 'runtime-to-telemetry';
const SOURCE_PARTITION = 'node-control:smpp:sparse';
const REQUESTED_AT = '2026-08-14T08:00:00.000Z';
const ACKNOWLEDGED_AT = '2026-08-14T07:59:00.000Z';
const SHA256 = `sha256:${'a'.repeat(64)}`;

type RecoveryStatus = 'requested' | 'running' | 'succeeded';

class SparseDeadLetterRecoveryClient {
  readonly sql: string[] = [];
  partitionStateParameters?: readonly unknown[];
  #lockedRunReads = 0;

  release(): void {
    return undefined;
  }

  query(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<Readonly<{ rows: readonly Record<string, unknown>[]; rowCount: number }>> {
    this.sql.push(sql);
    if (
      sql === 'BEGIN' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK' ||
      sql.startsWith('SAVEPOINT ') ||
      sql.includes('pg_advisory_xact_lock') ||
      sql.startsWith('UPDATE evidence_dead_letter SET') ||
      sql.startsWith('UPDATE evidence_outbox SET') ||
      sql.includes("state.source_partition='all'")
    ) {
      return Promise.resolve(result([]));
    }
    if (sql.includes('FROM evidence_recovery_run WHERE recovery_run_id=$1 FOR UPDATE')) {
      const status: RecoveryStatus = this.#lockedRunReads++ === 0 ? 'requested' : 'running';
      return Promise.resolve(result([recoveryRow(status)]));
    }
    if (sql.startsWith("UPDATE evidence_recovery_run SET status='running'")) {
      return Promise.resolve(result([recoveryRow('running')]));
    }
    if (sql.startsWith('SELECT 1 FROM evidence_export_configuration')) {
      return Promise.resolve(result([{}]));
    }
    if (sql.includes('FROM evidence_dead_letter dead_letter') && sql.includes('FOR UPDATE OF')) {
      return Promise.resolve(
        result([
          {
            sequence: '2089',
            source_partition: SOURCE_PARTITION,
            requeued_at: null,
          },
        ]),
      );
    }
    if (sql.startsWith('SELECT count(*)::text AS count FROM evidence_outbox')) {
      return Promise.resolve(result([{ count: '0' }]));
    }
    if (sql.includes('first_unacknowledged')) {
      // Global sequences are sparse inside this partition: 2061..2088 belong elsewhere.
      return Promise.resolve(
        result([
          {
            sent_sequence: '2060',
            acknowledged_sequence: '2060',
            acknowledged_at: ACKNOWLEDGED_AT,
          },
        ]),
      );
    }
    if (sql.startsWith("UPDATE evidence_export_state state SET status='idle'")) {
      this.partitionStateParameters = [...parameters];
      const sent = parameters[1];
      const acknowledged = parameters[2];
      if (
        typeof sent === 'string' &&
        typeof acknowledged === 'string' &&
        BigInt(acknowledged) > BigInt(sent)
      ) {
        throw Object.assign(new Error('acknowledged frontier exceeds sent frontier'), {
          code: '23514',
        });
      }
      return Promise.resolve(result([]));
    }
    if (sql.startsWith("UPDATE evidence_recovery_run SET status='succeeded'")) {
      return Promise.resolve(
        result([
          {
            ...recoveryRow('succeeded'),
            affected_records: 1,
            result_summary: { sourcePartitions: 1 },
            completed_at: REQUESTED_AT,
          },
        ]),
      );
    }
    throw new Error(`Unexpected SQL in sparse DLQ recovery test: ${sql}`);
  }
}

function recoveryRow(status: RecoveryStatus): Record<string, unknown> {
  return {
    recovery_run_id: RECOVERY_RUN_ID,
    operation_id: 'retry-sparse-node-control',
    idempotency_key_hash: SHA256,
    request_hash: SHA256,
    export_id: EXPORT_ID,
    configuration_revision: '1',
    operation: 'retry_dead_letter',
    target: { deadLetterId: 'dead-letter-2089' },
    actor_id: 'sdar-evidence-only',
    reason: 'Retry sparse partition dead letter.',
    status,
    affected_records: status === 'succeeded' ? 1 : null,
    result_summary: null,
    last_error_code: null,
    requested_at: REQUESTED_AT,
    started_at: status === 'requested' ? null : REQUESTED_AT,
    completed_at: status === 'succeeded' ? REQUESTED_AT : null,
    revision: status === 'requested' ? '1' : status === 'running' ? '2' : '3',
  };
}

function result(rows: readonly Record<string, unknown>[]) {
  return Object.freeze({ rows, rowCount: rows.length });
}
