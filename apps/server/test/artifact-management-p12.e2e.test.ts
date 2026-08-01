import { randomBytes, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfiguredOperatorIdentityPort } from '../../../packages/application/src/index.js';
import {
  createIsolatedRuntimeDatabase,
  dropIsolatedRuntimeDatabase,
  isolatedDatabaseUrl,
} from '../test-support/postgres.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';

const postgresAdminUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const databaseName = 'sdar_v13_p12_management_e2e';
const postgresUrl = isolatedDatabaseUrl(postgresAdminUrl, databaseName);
const HASH = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-30T05:00:00.000Z';
let runtime: ServerRuntimeHandle;
let pool: Pool;

beforeAll(async () => {
  await createIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
  runtime = await startServerRuntime({
    postgresUrl,
    redis: { host: '127.0.0.1', port: 56379 },
    masterKeyBase64: randomBytes(32).toString('base64'),
    queueName: `artifact-management-p12-${randomUUID()}`,
    applyMigrations: true,
    a2aPort: 0,
    managementPort: 0,
    artifactOperatorIdentity: new ConfiguredOperatorIdentityPort({ environment: 'test' }),
    artifactManagementPrincipalResolver: {
      resolve: ({ requestId, sourceIp }) =>
        Promise.resolve({
          actorId: 'authenticated-p12-operator',
          tenantId: 'tenant-a',
          roles: new Set(['operator']),
          kind: 'human',
          requestId,
          ...(sourceIp === undefined ? {} : { sourceIp }),
        }),
    },
  });
  pool = new Pool({ connectionString: postgresUrl });
  await seedArtifact(pool, 'artifact-p12-a', 'tenant-a');
  await seedArtifact(pool, 'artifact-p12-b', 'tenant-b');
});

afterAll(async () => {
  await runtime.close();
  await pool.end();
  await dropIsolatedRuntimeDatabase(postgresAdminUrl, databaseName);
});

describe('P12 real server composition', () => {
  it('runs authenticated tenant query and governance command through PostgreSQL authority', async () => {
    const list = await fetch(`${runtime.management.baseUrl}/api/v1/artifacts`);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ artifact_id: 'artifact-p12-a', tenant_id: 'tenant-a' })],
    });

    const command = await fetch(
      `${runtime.management.baseUrl}/api/v1/artifacts/artifact-p12-a/commands/validate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'p12-e2e-command' },
        body: JSON.stringify({
          version: 1,
          expectedVersion: 1,
          validationRunId: 'validation-p12-e2e',
          validationType: 'static',
          datasetRef: 'p12-e2e-dataset',
          idempotencyKey: 'p12-e2e-validation',
          reason: 'P12 real composition verification.',
        }),
      },
    );
    expect(command.status).toBe(202);
    await expect(
      pool.query(
        `SELECT artifact.status,run.status AS validation_status
         FROM compiled_artifact artifact
         JOIN artifact_validation_run run
           ON run.artifact_id=artifact.artifact_id
          AND run.artifact_version=artifact.version
         WHERE artifact.artifact_id='artifact-p12-a'`,
      ),
    ).resolves.toMatchObject({
      rows: [{ status: 'validating', validation_status: 'pending' }],
    });
    await expect(
      pool.query(
        `SELECT actor_id,tenant_id,operation,result
         FROM artifact_management_read_audit
         WHERE actor_id='authenticated-p12-operator'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        expect.objectContaining({
          actor_id: 'authenticated-p12-operator',
          tenant_id: 'tenant-a',
          operation: 'artifact.list',
          result: 'allowed',
        }),
      ],
    });
  });

  it('projects only allowlisted evidence without changing formal A2A task semantics', async () => {
    const card = await fetch(`${runtime.a2a.baseUrl}/.well-known/agent-card.json`);
    expect(card.status).toBe(200);
    const body = JSON.stringify(await card.json());
    expect(body).toContain('urn:sdar:artifact-evidence:v1.1');
    expect(body).toContain('validated-planning-templates');
    expect(body).not.toContain('credential');
    expect(body).not.toContain('candidate');
  });

  it('hides cross-tenant views and projects tenant-derived runtime evidence through SSE', async () => {
    const hidden = await fetch(
      `${runtime.management.baseUrl}/api/v1/artifacts/artifact-p12-b/lineage`,
    );
    expect(hidden.status).toBe(404);

    await pool.query(
      `INSERT INTO fast_gateway_request(
         request_id,task_id,context_id,tenant_id,idempotency_key,request_hash,
         request_context,created_at)
       VALUES('p12-request','p12-task','p12-context','tenant-a','p12-runtime-key',$1,'{}',$2);
      `,
      [HASH, NOW],
    );
    await pool.query(
      `INSERT INTO fast_gateway_decision(
         gateway_decision_id,request_id,runtime_decision_id,runtime_decision,
         decision_record,decision_hash,created_at)
       VALUES('p12-decision','p12-request','p12-runtime-decision','{}','{}',$1,$2)`,
      [HASH, NOW],
    );
    await pool.query(
      `INSERT INTO cognitive_runtime_outbox(
         event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         correlation,payload,occurred_at)
       VALUES('p12-gateway-event','gateway.route_selected','fast_gateway_decision',
              'p12-decision',1,'{}','{"requestId":"p12-request"}',$1)`,
      [NOW],
    );
    const decisions = await fetch(`${runtime.management.baseUrl}/api/v1/runtime/decisions`);
    expect(decisions.status).toBe(200);
    await expect(decisions.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ gateway_decision_id: 'p12-decision' })],
    });
    const events = await fetch(`${runtime.management.baseUrl}/api/v1/artifact-events`);
    expect(events.status).toBe(200);
    const stream = await events.text();
    expect(stream).toContain('event: gateway.route_selected');
    expect(stream).toContain('"tenantId":"tenant-a"');
  });
});

async function seedArtifact(target: Pool, artifactId: string, tenantId: string): Promise<void> {
  const lineageId = `lineage-${artifactId}`;
  await target.query('BEGIN');
  try {
    await target.query(
      `INSERT INTO compiled_artifact(
         artifact_id,artifact_key,version,artifact_type,tenant_id,domain,status,risk_level,
         definition,applicability,dependency_snapshot,lineage_id,content_hash,created_at
       ) VALUES($1,$2,1,'plan_template',$3,'test','candidate','low',
         '{"nodes":[]}','{}','{"taskTypeVersionRefs":["test"]}',$4,$5,$6)`,
      [artifactId, `key-${artifactId}`, tenantId, lineageId, HASH, NOW],
    );
    await target.query(
      `INSERT INTO artifact_lineage(
         lineage_id,artifact_id,artifact_version,source_episode_refs,source_knowledge_refs,
         source_correction_refs,source_pattern_refs,generation_methods,compiler_version,created_at
       ) VALUES($1,$2,1,'[]','[]','[]','[]','["p12-e2e"]','compiler-1',$3)`,
      [lineageId, artifactId, NOW],
    );
    await target.query('COMMIT');
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}
