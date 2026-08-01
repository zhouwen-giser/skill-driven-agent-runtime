import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { PostgresArtifactManagementQueryRepository } from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ??
  process.env['SDAR_POSTGRES_URL'] ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 4 });
const NOW = '2026-07-30T03:00:00.000Z';
const HASH = `sha256:${'a'.repeat(64)}`;

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

beforeEach(async () => {
  await pool.query(
    `TRUNCATE artifact_management_read_audit,cognitive_runtime_outbox,
       fast_gateway_feedback,fast_gateway_decision,fast_gateway_request,
       model_cascade_step,model_cascade_run,model_route_decision,
       compiled_artifact,artifact_lineage CASCADE`,
  );
  await seedArtifact('artifact-a', 'tenant-a');
  await seedArtifact('artifact-c', 'tenant-a');
  await seedArtifact('artifact-b', 'tenant-b');
});

afterAll(async () => {
  await pool.end();
});

describe('P12 PostgreSQL management projection', () => {
  it('enforces tenant scope in SQL and persists immutable read audit', async () => {
    const repository = new PostgresArtifactManagementQueryRepository(pool);
    const result = await repository.listArtifacts({
      tenantId: 'tenant-a',
      includeGlobal: false,
      limit: 10,
      sort: 'created_desc',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ artifact_id: 'artifact-a', tenant_id: 'tenant-a' }),
        expect.objectContaining({ artifact_id: 'artifact-c', tenant_id: 'tenant-a' }),
      ]),
    );
    await expect(
      repository.getArtifact('artifact-b', { tenantId: 'tenant-a', includeGlobal: false }),
    ).resolves.toBeUndefined();

    await repository.recordReadAudit({
      auditId: 'audit-a',
      actorId: 'operator-a',
      roles: ['viewer'],
      tenantId: 'tenant-a',
      operation: 'artifact.list',
      target: '*',
      requestId: 'request-a',
      result: 'allowed',
      sourceIp: '127.0.0.1',
      occurredAt: NOW,
    });
    await repository.recordReadAudit({
      auditId: 'audit-retry',
      actorId: 'operator-a',
      roles: ['viewer'],
      tenantId: 'tenant-a',
      operation: 'artifact.list',
      target: '*',
      requestId: 'request-a',
      result: 'allowed',
      occurredAt: NOW,
    });
    await expect(
      pool.query(`SELECT count(*)::integer AS count FROM artifact_management_read_audit`),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it.each(['created_desc', 'created_asc', 'key_asc'] as const)(
    'uses a stable, sort-bound cursor for %s',
    async (sort) => {
      const repository = new PostgresArtifactManagementQueryRepository(pool);
      const first = await repository.listArtifacts({
        tenantId: 'tenant-a',
        includeGlobal: false,
        limit: 1,
        sort,
      });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeDefined();
      const cursor = first.nextCursor;
      if (cursor === undefined) throw new Error('expected cursor');
      const second = await repository.listArtifacts({
        tenantId: 'tenant-a',
        includeGlobal: false,
        limit: 1,
        sort,
        cursor,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]).not.toMatchObject(first.items[0] as Record<string, unknown>);
      await expect(
        repository.listArtifacts({
          tenantId: 'tenant-a',
          includeGlobal: false,
          limit: 1,
          sort: sort === 'created_desc' ? 'created_asc' : 'created_desc',
          cursor,
        }),
      ).rejects.toThrow('ARTIFACT_MANAGEMENT_CURSOR_SORT_MISMATCH');
    },
  );

  it('restricts read-audit projections to the authorized tenant scope', async () => {
    const repository = new PostgresArtifactManagementQueryRepository(pool);
    await repository.recordReadAudit({
      auditId: 'audit-tenant-a',
      actorId: 'operator-a',
      roles: ['reviewer'],
      tenantId: 'tenant-a',
      operation: 'artifact.audit',
      target: 'artifact-a',
      requestId: 'request-tenant-a',
      result: 'allowed',
      occurredAt: NOW,
    });
    await repository.recordReadAudit({
      auditId: 'audit-tenant-b',
      actorId: 'operator-b',
      roles: ['reviewer'],
      tenantId: 'tenant-b',
      operation: 'artifact.detail',
      target: 'artifact-a',
      requestId: 'request-tenant-b',
      result: 'not_found',
      sourceIp: '192.0.2.10',
      occurredAt: NOW,
    });
    await repository.recordReadAudit({
      auditId: 'audit-global',
      actorId: 'operator-global',
      roles: ['security_operator'],
      operation: 'artifact.audit',
      target: 'artifact-a',
      requestId: 'request-global',
      result: 'allowed',
      occurredAt: NOW,
    });

    const tenantView = (await repository.getArtifactView('artifact-a', 'audit', {
      tenantId: 'tenant-a',
      includeGlobal: false,
    })) as { items: readonly { record_type: string; record: Record<string, unknown> }[] };
    const tenantReadActors = tenantView.items
      .filter((item) => item.record_type === 'read')
      .map((item) => item.record['actor_id']);
    expect(tenantReadActors).toEqual(['operator-a']);

    const elevatedView = (await repository.getArtifactView('artifact-a', 'audit', {
      tenantId: 'tenant-a',
      includeGlobal: true,
    })) as { items: readonly { record_type: string; record: Record<string, unknown> }[] };
    const elevatedReadActors = elevatedView.items
      .filter((item) => item.record_type === 'read')
      .map((item) => item.record['actor_id']);
    expect(elevatedReadActors).toEqual(expect.arrayContaining(['operator-a', 'operator-global']));
    expect(elevatedReadActors).not.toContain('operator-b');
  });

  it('resumes ordered tenant-filtered SSE facts from the formal Outbox', async () => {
    await pool.query(
      `INSERT INTO fast_gateway_request(
         request_id,task_id,context_id,tenant_id,idempotency_key,request_hash,
         request_context,created_at)
       VALUES('request-a','task-a','context-a','tenant-a','idempotency-a',$1,'{}',$2),
             ('request-b','task-b','context-b','tenant-b','idempotency-b',$1,'{}',$2)`,
      [HASH, NOW],
    );
    await pool.query(
      `INSERT INTO fast_gateway_decision(
         gateway_decision_id,request_id,runtime_decision_id,runtime_decision,
         decision_record,decision_hash,created_at)
       VALUES('decision-a','request-a','runtime-a','{}','{}',$1,$2),
             ('decision-b','request-b','runtime-b','{}','{}',$1,$2)`,
      [HASH, NOW],
    );
    await pool.query(
      `INSERT INTO cognitive_runtime_outbox(
         event_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         correlation,payload,occurred_at
       ) VALUES
       ('event-a','artifact.activated','artifact','artifact-a',1,
        '{"tenantId":"tenant-a"}','{"artifactId":"artifact-a","credential":"must-redact"}',$1),
       ('event-b','artifact.activated','artifact','artifact-b',1,
        '{"tenantId":"tenant-b"}','{"artifactId":"artifact-b"}',$1),
       ('event-internal','compiler.internal_debug','compiler','artifact-a',1,
        '{"tenantId":"tenant-a"}','{"secret":"must-not-project"}',$1),
       ('event-gateway-a','gateway.route_selected','fast_gateway_decision','decision-a',1,
        '{}','{"requestId":"request-a"}',$1),
       ('event-gateway-b','gateway.route_selected','fast_gateway_decision','decision-b',1,
        '{}','{"requestId":"request-b"}',$1),
       ('event-candidate','compiler.artifact_candidate_created','compiled_artifact','artifact-a',1,
        '{}','{"artifactId":"artifact-a"}',$1)`,
      [NOW],
    );
    const repository = new PostgresArtifactManagementQueryRepository(pool);
    const events = await repository.listEvents({
      tenantId: 'tenant-a',
      includeGlobal: false,
      afterSequence: 0,
      limit: 10,
    });
    expect(events).toHaveLength(3);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: 'event-a',
          eventType: 'artifact.activated',
          tenantId: 'tenant-a',
        }),
        expect.objectContaining({
          eventId: 'event-gateway-a',
          eventType: 'gateway.route_selected',
          tenantId: 'tenant-a',
        }),
        expect.objectContaining({
          eventId: 'event-candidate',
          eventType: 'artifact.candidate_created',
          tenantId: 'tenant-a',
        }),
      ]),
    );
    await expect(
      repository.listEvents({
        tenantId: 'tenant-a',
        includeGlobal: false,
        afterSequence: events.at(-1)?.sequence ?? 0,
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  it('uses exact task type membership, hides cross-tenant views and executes runtime SQL', async () => {
    const repository = new PostgresArtifactManagementQueryRepository(pool);
    const exact = await repository.listArtifacts({
      tenantId: 'tenant-a',
      includeGlobal: false,
      taskTypeId: 'test',
      limit: 10,
      sort: 'created_desc',
    });
    expect(exact.items).toHaveLength(2);
    await expect(
      repository.listArtifacts({
        tenantId: 'tenant-a',
        includeGlobal: false,
        taskTypeId: 'tes',
        limit: 10,
        sort: 'created_desc',
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      repository.getArtifactView('artifact-b', 'lineage', {
        tenantId: 'tenant-a',
        includeGlobal: false,
      }),
    ).resolves.toBeUndefined();

    await pool.query(
      `INSERT INTO fast_gateway_request(
         request_id,task_id,context_id,tenant_id,idempotency_key,request_hash,
         request_context,created_at)
       VALUES('runtime-request','runtime-task','runtime-context','tenant-a',
              'runtime-idempotency',$1,'{}',$2)`,
      [HASH, NOW],
    );
    await pool.query(
      `INSERT INTO fast_gateway_decision(
         gateway_decision_id,request_id,runtime_decision_id,runtime_decision,
         decision_record,decision_hash,created_at)
       VALUES('runtime-decision','runtime-request','runtime-decision-id','{}','{}',$1,$2)`,
      [HASH, NOW],
    );
    await expect(
      repository.getRuntimeView('decisions', { tenantId: 'tenant-a', limit: 10 }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ gateway_decision_id: 'runtime-decision' })],
    });
  });
});

async function seedArtifact(artifactId: string, tenantId: string): Promise<void> {
  const lineageId = `lineage-${artifactId}`;
  await pool.query('BEGIN');
  try {
    await pool.query(
      `INSERT INTO compiled_artifact(
         artifact_id,artifact_key,version,artifact_type,tenant_id,domain,status,risk_level,
         definition,applicability,dependency_snapshot,lineage_id,content_hash,created_at
       ) VALUES($1,$2,1,'plan_template',$3,'test','candidate','low',
         '{"nodes":[]}','{}','{"taskTypeVersionRefs":["test"]}',$4,$5,$6)`,
      [artifactId, `key-${artifactId}`, tenantId, lineageId, HASH, NOW],
    );
    await pool.query(
      `INSERT INTO artifact_lineage(
         lineage_id,artifact_id,artifact_version,source_episode_refs,source_knowledge_refs,
         source_correction_refs,source_pattern_refs,generation_methods,compiler_version,created_at
       ) VALUES($1,$2,1,'[]','[]','[]','[]','["p12-fixture"]','compiler-1',$3)`,
      [lineageId, artifactId, NOW],
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}
