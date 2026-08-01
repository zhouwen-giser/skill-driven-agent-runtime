import { performance } from 'node:perf_hooks';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { A2AArtifactProjectionService } from '../../application/src/index.js';
import { applyRuntimeMigrations } from '../../../apps/server/src/runtime.js';
import { PostgresArtifactManagementQueryRepository } from '../src/index.js';

const connectionString =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const pool = new Pool({ connectionString, max: 40 });

beforeAll(async () => {
  await applyRuntimeMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('P12 local performance baselines', () => {
  it('measures indexed 1k/10k/100k projections, concurrent operators and A2A overhead', async () => {
    const client = await pool.connect();
    const scaleMs: Record<string, number> = {};
    try {
      await client.query(
        `CREATE TEMP TABLE p12_artifact_bench(
           id bigint PRIMARY KEY,tenant_id text NOT NULL,created_at timestamptz NOT NULL,
           task_type_refs jsonb NOT NULL
         )`,
      );
      await client.query(
        `INSERT INTO p12_artifact_bench
         SELECT value,'tenant-' || (value % 20)::text,
                timestamptz '2026-07-30T00:00:00Z' - make_interval(secs=>value::double precision),
                '["task.test"]'::jsonb
         FROM generate_series(1,100000) value`,
      );
      await client.query(
        `CREATE INDEX p12_artifact_bench_tenant_time
           ON p12_artifact_bench(tenant_id,created_at DESC,id);
         CREATE INDEX p12_artifact_bench_task_type
           ON p12_artifact_bench USING gin(task_type_refs);
         ANALYZE p12_artifact_bench`,
      );
      for (const scale of [1_000, 10_000, 100_000]) {
        const started = performance.now();
        await client.query(
          `SELECT * FROM p12_artifact_bench
           WHERE id<=$1 AND tenant_id=$2 AND task_type_refs ? $3
           ORDER BY created_at DESC,id DESC LIMIT 50`,
          [scale, 'tenant-1', 'task.test'],
        );
        scaleMs[String(scale)] = round(performance.now() - started);
      }
    } finally {
      client.release();
    }

    const repository = new PostgresArtifactManagementQueryRepository(pool);
    const concurrentStarted = performance.now();
    await Promise.all(
      Array.from({ length: 32 }, () =>
        repository.listArtifacts({
          tenantId: 'tenant-a',
          includeGlobal: false,
          limit: 50,
          sort: 'created_desc',
        }),
      ),
    );
    const concurrentOperatorsMs = round(performance.now() - concurrentStarted);

    const projection = new A2AArtifactProjectionService();
    const a2aStarted = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      projection.project({
        capabilities: ['validated-planning-templates', 'internal-route'],
        inputRequired: true,
        confirmation: true,
        formalTaskState: 'unchanged',
        evidence: { artifactEnhancement: true, credential: 'redact' },
      });
    }
    const a2aTenThousandMs = round(performance.now() - a2aStarted);

    const evidence = {
      environment: 'local Docker PostgreSQL; acceptance baseline, not a production SLO',
      artifactListMs: scaleMs,
      concurrentOperators: 32,
      concurrentOperatorsMs,
      a2aProjectionIterations: 10_000,
      a2aTenThousandMs,
    };
    process.stdout.write(`P12_PERFORMANCE ${JSON.stringify(evidence)}\n`);
    expect(Math.max(...Object.values(scaleMs))).toBeLessThan(1_000);
    expect(concurrentOperatorsMs).toBeLessThan(2_000);
    expect(a2aTenThousandMs).toBeLessThan(2_000);
  });
});

function round(value: number): number {
  return Number(value.toFixed(3));
}
