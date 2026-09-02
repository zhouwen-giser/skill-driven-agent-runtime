import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { createRemoteTaskProviderExecutionLink } from '../../domain/src/index.js';
import {
  PostgresRemoteTaskProviderExecutionLinkStore,
  PostgresRemoteTaskReconciliationAttemptStore,
} from '../src/index.js';

const databaseUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString: databaseUrl });

describe('MCP Task consumer sync PostgreSQL authority', () => {
  beforeAll(async () => {
    await applyRuntimeMigrations(pool);
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  it('persists idempotent exact reconciliation and source-linked execution identity', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role=replica');
      await seedIntent(client);
      const repositoryPool = queryPool(client);
      const attempts = new PostgresRemoteTaskReconciliationAttemptStore(repositoryPool);
      const links = new PostgresRemoteTaskProviderExecutionLinkStore(repositoryPool);
      const attempt = {
        attemptId: `remote-reconcile-${'a'.repeat(64)}`,
        intentId: 'intent-consumer-sync',
        logicalInvocationId: `mcp-logical-${'1'.repeat(64)}`,
        expectedIntentVersion: 3,
        attemptNumber: 1,
        sourceContract: 'sdar.smpp-diagnostics/v1+frozen-mcp-v1' as const,
        requestHash: `sha256:${'2'.repeat(64)}`,
        status: 'found_exact' as const,
        remoteTaskId: 'remote-task-consumer-sync',
        externalExecutionId: 'provider-execution-consumer-sync',
        identityValidated: true,
        startedAt: '2026-08-31T07:00:00.000Z',
        completedAt: '2026-08-31T07:00:01.000Z',
        durationMs: 1_000,
        resultHash: `sha256:${'3'.repeat(64)}`,
        version: 1 as const,
      };
      expect(await attempts.append(attempt)).toEqual(attempt);
      expect(await attempts.append(attempt)).toEqual(attempt);
      expect(await attempts.nextAttemptNumber(attempt.intentId)).toBe(2);
      await expect(
        attempts.append({ ...attempt, resultHash: `sha256:${'9'.repeat(64)}` }),
      ).rejects.toThrow('REMOTE_TASK_RECONCILIATION_ATTEMPT_CONFLICT');

      const link = createRemoteTaskProviderExecutionLink({
        bindingId: 'remote-binding-consumer-sync',
        logicalInvocationId: attempt.logicalInvocationId,
        remoteTaskId: attempt.remoteTaskId,
        providerId: 'isr.vehicle.ugv.ugv1',
        runtimeServerId: 'ugv-smpp-runtime',
        providerBindingId: 'mcp-binding-ugv-smpp',
        providerOriginType: 'smpp_registry',
        smppSourceId: 'smpp-source-ugv',
        externalServerId: 'ugv1',
        operationName: 'vehicle_navigate',
        executionStatus: 'exact',
        externalExecutionId: attempt.externalExecutionId,
        missionStatus: 'unresolved',
        provenance: 'reconcile_found_exact',
        sourceContract: 'sdar.node-control-provider-binding/v1+frozen-mcp-v1',
        sourceRevision: 'binding:2/catalog:2',
        observedAt: attempt.completedAt,
      });
      expect(await links.save(link)).toEqual(link);
      expect(await links.save(link)).toEqual(link);
      expect(await links.findByBindingId(link.bindingId)).toEqual(link);
      const conflictingLink = createRemoteTaskProviderExecutionLink({
        ...link,
        externalExecutionId: 'provider-execution-conflict',
      });
      await expect(links.save(conflictingLink)).rejects.toThrow(
        'REMOTE_TASK_PROVIDER_EXECUTION_LINK_CONFLICT',
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

async function seedIntent(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO remote_task_admission_intent(
       intent_id,invocation_id,binding_id,task_id,context_id,server_id,operation_name,
       arguments_hash,local_envelope_json,status,dispatch_hash,dispatched_at,reason_code,
       closed_at,created_at,updated_at,version,logical_invocation_id,logical_identity_hash,
       reconciliation_contract_json)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'uncertain',$10,$11,$12,$11,$11,$11,3,
            $13,$14,$15::jsonb)`,
    [
      'intent-consumer-sync',
      'invocation-consumer-sync',
      'remote-binding-consumer-sync',
      'task-consumer-sync',
      'context-consumer-sync',
      'ugv-smpp-runtime',
      'vehicle_navigate',
      '4'.repeat(64),
      '{}',
      `sha256:${'5'.repeat(64)}`,
      '2026-08-31T07:00:00.000Z',
      'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
      `mcp-logical-${'1'.repeat(64)}`,
      `sha256:${'6'.repeat(64)}`,
      JSON.stringify({ logicalIdentity: { logicalInvocationId: `mcp-logical-${'1'.repeat(64)}` } }),
    ],
  );
}

function queryPool(client: PoolClient): Pool {
  return { query: client.query.bind(client) } as unknown as Pool;
}
