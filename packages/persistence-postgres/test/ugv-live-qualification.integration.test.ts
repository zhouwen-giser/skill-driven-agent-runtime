import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import {
  hashCanonicalEvidenceJson,
  type McpInvocation,
  type RemoteTaskAuthoritySnapshot,
} from '../../domain/src/index.js';
import { PostgresMcpRegistryRepository, PostgresUgvLiveQualificationStore } from '../src/index.js';

// RunController only. This fixture never connects to a Provider or issues a device command.
const database = 'sdar_wi070_live_qualification_integration';
const at = '2026-08-26T08:00:00.000Z';
let pool: Pool | undefined;
let created = false;
function adminUrl() {
  const value = process.env['SDAR_TEST_POSTGRES_URL'];
  if (value === undefined) throw new Error('WI070_EXPLICIT_LEASED_POSTGRES_URL_REQUIRED');
  return value;
}
beforeAll(async () => {
  const admin = new Pool({ connectionString: adminUrl() });
  try {
    await admin.query(`CREATE DATABASE ${database} TEMPLATE template0`);
    created = true;
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl());
  url.pathname = `/${database}`;
  pool = new Pool({ connectionString: url.toString(), max: 4 });
  await applyRuntimeMigrations(pool);
  await pool.query(
    `INSERT INTO mcp_server(server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,created_at,updated_at)
    VALUES ('qualification-server','Qualification','http://provider.test/mcp','streamable_http','enabled',1,'none',$1,$1)`,
    [at],
  );
}, 60_000);
afterAll(async () => {
  if (pool !== undefined) await pool.end();
  if (!created) return;
  const admin = new Pool({ connectionString: adminUrl() });
  try {
    await admin.query(`DROP DATABASE ${database}`);
  } finally {
    await admin.end();
  }
});
function databasePool() {
  if (pool === undefined) throw new Error('TEST_DATABASE_REQUIRED');
  return pool;
}
function store() {
  return new PostgresUgvLiveQualificationStore(databasePool());
}
const snapshot: RemoteTaskAuthoritySnapshot = {
  schemaVersion: '1.0',
  capturedAt: at,
  runtime: {
    serverId: 'qualification-server',
    endpoint: 'http://provider.test/mcp',
    serverUpdatedAt: at,
    toolRevision: 1,
    protocolSnapshotId: 'snapshot',
    catalogRevision: '1',
    catalogChecksum: 'a'.repeat(64),
    operationCount: 1,
  },
  providerBinding: {
    bindingId: 'provider-binding',
    revision: 1,
    providerId: 'provider',
    endpointRef: 'http://provider.test/mcp',
    catalogRevision: '1',
    catalogChecksum: 'a'.repeat(64),
    operationCount: 1,
    availabilityValidUntil: '2026-08-26T08:05:00.000Z',
    observedAt: at,
    originType: 'smpp_registry',
    externalServerId: 'external-server',
    smppSourceId: 'configured-source',
    registry: { externalProviderId: 'provider', revision: '1', checksum: 'b'.repeat(64) },
    scope: { tenantId: 'tenant', projectId: 'project', environment: 'development' },
  },
};
function invocation(id: string): McpInvocation {
  return {
    invocationId: id,
    executionMode: 'live',
    serverId: 'qualification-server',
    toolName: 'vehicle_get_state',
    arguments: { resourceId: 'vehicle:ugv1', include: ['chassis', 'health'] },
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: 'allowed',
      source: 'mcp_declared',
    },
    result: { content: [], isError: false, structuredContent: { revision: 'one' } },
    status: 'succeeded',
    startedAt: at,
    completedAt: at,
    durationMs: 0,
  };
}
async function reserve(requestId: string, invocationId: string) {
  await store().reserve({ requestId, invocationId, createdAt: at });
  await store().freezeDispatch({
    requestId,
    invocationId,
    authoritySnapshot: snapshot,
    dispatchHash: `sha256:${'c'.repeat(64)}`,
  });
}

describe('WI070 actual SQL LIVE qualification provenance', () => {
  it('reserves one invocation for concurrent requests before any receipt exists', async () => {
    const result = await Promise.all([
      store().reserve({ requestId: 'race', invocationId: 'race-a', createdAt: at }),
      store().reserve({ requestId: 'race', invocationId: 'race-b', createdAt: at }),
    ]);
    expect(result.filter(Boolean)).toHaveLength(1);
    const saved = await store().load('race');
    expect(saved?.record.status).toBe('dispatching');
    expect(saved?.invocation).toBeUndefined();
    await expect(
      databasePool().query(
        `UPDATE ugv_live_qualification SET invocation_id='changed' WHERE request_id='race'`,
      ),
    ).rejects.toThrow('UGV_LIVE_QUALIFICATION_IMMUTABLE');
  });
  it('joins the exact taskless invocation and freezes its canonical result hash across reload', async () => {
    await reserve('exact', 'exact-invocation');
    const value = invocation('exact-invocation');
    const repository = new PostgresMcpRegistryRepository(databasePool());
    await repository.saveInvocation(value);
    await repository.saveInvocation({
      ...invocation('unrelated-later'),
      result: { unrelated: true },
    });
    await expect(
      store().complete('exact', value.invocationId, `sha256:${'0'.repeat(64)}`),
    ).rejects.toThrow('UGV_LIVE_QUALIFICATION_RECEIPT_CONFLICT');
    const hash = hashCanonicalEvidenceJson(value.result);
    await store().complete('exact', value.invocationId, hash);
    const saved = await store().load('exact');
    expect(saved?.record).toMatchObject({
      status: 'completed',
      resultHash: hash,
      authoritySnapshot: snapshot,
    });
    expect(saved?.invocation).toEqual(value);
    expect(
      await store().reserve({ requestId: 'exact', invocationId: 'another', createdAt: at }),
    ).toBe(false);
    await expect(
      databasePool().query(
        `UPDATE ugv_live_qualification SET status='dispatching' WHERE request_id='exact'`,
      ),
    ).rejects.toThrow('UGV_LIVE_QUALIFICATION_IMMUTABLE');
  });
  it('does not reopen an uncertain dispatch or substitute a late receipt', async () => {
    await reserve('uncertain', 'uncertain-invocation');
    await store().markUncertain('uncertain', 'uncertain-invocation');
    const value = invocation('uncertain-invocation');
    await new PostgresMcpRegistryRepository(databasePool()).saveInvocation(value);
    expect(
      await store().reserve({ requestId: 'uncertain', invocationId: 'retry', createdAt: at }),
    ).toBe(false);
    await expect(
      store().complete('uncertain', value.invocationId, hashCanonicalEvidenceJson(value.result)),
    ).rejects.toThrow('UGV_LIVE_QUALIFICATION_RECEIPT_CONFLICT');
    expect((await store().load('uncertain'))?.record.status).toBe('uncertain');
  });
  it('cannot persist a simulation context in a LIVE qualification request', async () => {
    await expect(
      databasePool().query(
        `INSERT INTO ugv_live_qualification(request_id,invocation_id,execution_context,status,created_at) VALUES ('wrong-mode','wrong-mode-invocation','{"mode":"simulation","simulationId":"fake"}','dispatching',$1)`,
        [at],
      ),
    ).rejects.toThrow();
  });
});
