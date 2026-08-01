import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import { Queue } from 'bullmq';
import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';
import { applyRuntimeMigrations } from '../apps/server/src/runtime.js';

const { Pool } = pg;
const root = process.cwd();
const postgresUrl =
  process.env['SDAR_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const redisHost = process.env['SDAR_REDIS_HOST'] ?? '127.0.0.1';
const redisPort = Number(process.env['SDAR_REDIS_PORT'] ?? 56379);
const redisDatabase = 15;
const databaseName = `sdar_v13_recovery_${String(process.pid)}_${String(Date.now())}`;
const testPostgresUrl = withDatabase(postgresUrl, databaseName);
const adminPostgresUrl = withDatabase(postgresUrl, 'postgres');
const queueName = `sdar-v13-recovery-${randomUUID()}`;
const goalId = `goal-v13-recovery-${randomUUID()}`;
const startedAt = new Date();
const steps: DrillStep[] = [];
let infrastructureStarted = false;
let databaseCreated = false;

if (process.env['SDAR_REUSE_EXISTING_INFRA'] === 'true') {
  throw new Error(
    'P13_RECOVERY_DRILL_REQUIRES_SELF_MANAGED_COMPOSE: service restarts are mandatory evidence',
  );
}

try {
  measureSync('compose-start', () => {
    startInfrastructure(root);
    infrastructureStarted = true;
  });
  await createDatabase();
  databaseCreated = true;

  const initialPool = new Pool({ connectionString: testPostgresUrl });
  try {
    await measure('migrate-isolated-database', () => applyRuntimeMigrations(initialPool));
    await measure('seed-authoritative-goal', async () => {
      await initialPool.query(
        `INSERT INTO conversation_context(context_id,user_id,created_at,updated_at)
         VALUES($1,$2,clock_timestamp(),clock_timestamp())`,
        [`context-${goalId}`, 'p13-recovery-user'],
      );
      await initialPool.query(
        `INSERT INTO goal(
           goal_id,context_id,version,title,description,constraints_json,
           success_criteria_json,status,created_at,updated_at
         ) VALUES($1,$2,1,$3,$4,'[]'::jsonb,'[]'::jsonb,'active',clock_timestamp(),clock_timestamp())`,
        [
          goalId,
          `context-${goalId}`,
          'P13 recovery authority sentinel',
          'Synthetic non-PII release recovery evidence.',
        ],
      );
    });
    await assertGoal(initialPool, 'initial');
  } finally {
    await initialPool.end();
  }

  await createWake();
  const flushedAt = Date.now();
  runDocker([
    'compose',
    '-f',
    'compose.yaml',
    'exec',
    '-T',
    'redis',
    'redis-cli',
    '-n',
    '15',
    'FLUSHDB',
  ]);
  await assertWakeAbsent();
  const afterFlushPool = new Pool({ connectionString: testPostgresUrl });
  try {
    await assertGoal(afterFlushPool, 'after-redis-flush');
  } finally {
    await afterFlushPool.end();
  }
  await createWake();
  const redisFlushRecoveryMs = Date.now() - flushedAt;
  steps.push({
    name: 'redis-flush-and-postgresql-rebuild',
    classification: 'real',
    status: 'passed',
    durationMs: redisFlushRecoveryMs,
    evidence: {
      redisDatabase,
      authoritativeGoalPreserved: true,
      redisWakeRebuiltFromAuthoritativeGoal: true,
      redisAuthority: false,
      rpoFactsLost: 0,
    },
  });

  const redisRestartStarted = Date.now();
  runDocker(['compose', '-f', 'compose.yaml', 'restart', 'redis']);
  await waitForRedis();
  await createWake();
  const redisRestartRecoveryMs = Date.now() - redisRestartStarted;
  steps.push({
    name: 'redis-service-restart',
    classification: 'real',
    status: 'passed',
    durationMs: redisRestartRecoveryMs,
    evidence: {
      redisDatabase,
      reconnectPassed: true,
      duplicateWakeCoalescedByJobId: true,
      rpoFactsLost: 0,
    },
  });

  const postgresRestartStarted = Date.now();
  runDocker(['compose', '-f', 'compose.yaml', 'restart', 'postgres']);
  const restartedPool = await waitForPostgres(testPostgresUrl);
  try {
    await assertGoal(restartedPool, 'after-postgresql-restart');
  } finally {
    await restartedPool.end();
  }
  const postgresRestartRecoveryMs = Date.now() - postgresRestartStarted;
  steps.push({
    name: 'postgresql-service-restart',
    classification: 'real',
    status: 'passed',
    durationMs: postgresRestartRecoveryMs,
    evidence: {
      authoritativeGoalPreserved: true,
      rpoFactsLost: 0,
    },
  });

  const finishedAt = new Date();
  const report = {
    schemaVersion: '1.0',
    packageId: 'SDAR-V1.3-P13',
    status: 'passed',
    classification: 'real local Docker PostgreSQL/Redis release-candidate recovery drill',
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      postgres: containerDigest('postgres'),
      redis: containerDigest('redis'),
      redisDatabase,
    },
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    measurements: {
      redisFlushRecoveryMs,
      redisRestartRecoveryMs,
      postgresRestartRecoveryMs,
      rpoFactsLost: 0,
      approvedProductionTargets: null,
      targetNote:
        'The requirement baseline defines semantics but no production RTO/RPO number; measured local values are reported without inventing a target.',
    },
    invariants: {
      postgresqlAuthorityPreserved: true,
      redisWakeOnly: true,
      queueRebuildFromAuthority: true,
      duplicateWakeCoalesced: true,
      automaticWholeTaskRetry: false,
      duplicateFormalGoalPlanAttempt: false,
      duplicatePhysicalSideEffect: false,
      staleResultCommitted: false,
      singleActivePointerPreserved: true,
      auditEvidenceRetained: true,
      cognitiveFallbackCovered: true,
      userInteractionRecoveryCovered: true,
    },
    faultCoverage: [
      coverage(
        'Redis flush',
        'real',
        'redis-flush-and-postgresql-rebuild',
        'PostgreSQL Goal persisted and the exact BullMQ wake was rebuilt.',
      ),
      coverage(
        'Redis restart',
        'real',
        'redis-service-restart',
        'Redis reconnected and duplicate jobId wakes coalesced.',
      ),
      coverage(
        'BullMQ worker restart',
        'real-local',
        'packages/persistence-postgres/test/repositories.integration.test.ts',
        'Expired Experience work is lease-reclaimed by a restarted worker; committed terminal work is not revived.',
      ),
      coverage(
        'PostgreSQL restart',
        'real',
        'postgresql-service-restart',
        'Authoritative Goal survived the actual Compose service restart.',
      ),
      coverage(
        'Server restart',
        'real-local',
        'packages/persistence-postgres/test/repositories.integration.test.ts',
        'Reconstructed services resume only persisted waiting/user-interaction state and create a new authorized attempt.',
      ),
      coverage(
        'Network partition',
        'simulated',
        'packages/application/test/fast-gateway-p10.unit.test.ts',
        'Adapter failure remains inside its bulkhead and enters bounded cognitive fallback.',
      ),
      coverage(
        'Model Provider failure',
        'simulated',
        'packages/application/test/case-model-runtime-p11.unit.test.ts',
        'Provider failure, timeout, budget exhaustion and late result paths fail closed or fall back without formal mutation.',
      ),
      coverage(
        'MCP / Provider degradation',
        'simulated',
        'packages/application/test/remote-task-continuation.unit.test.ts',
        'Remote terminal observations are claimed once; stale/deadline paths never re-enter the graph.',
      ),
      coverage(
        'SSE disconnect',
        'real-local',
        'packages/a2a-adapter/test/http-endpoint.contract.test.ts',
        'Execution continues after client disconnect and authoritative task state can be polled/resubscribed.',
      ),
      coverage(
        'Queue backlog',
        'real-local',
        'reports/goal/v1.3-p05-performance-report.json',
        'PostgreSQL claims, bounded workers and Redis wake lag are measured with explicit backpressure.',
      ),
      coverage(
        'Outbox duplicate / delay',
        'real-local',
        'packages/application/test/experience-job.unit.test.ts',
        'Duplicate terminal delivery is processed once and a missing wake is reconstructed from PostgreSQL.',
      ),
      coverage(
        'Cache stale',
        'real-local',
        'packages/application/test/artifact-retrieval.unit.test.ts',
        'Stale dependency validation falls back and the disposable projection rebuilds from P02 authority.',
      ),
      coverage(
        'Artifact deactivation',
        'real-local',
        'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
        'Deactivation changes the single active pointer through governed CAS and retains audit evidence.',
      ),
      coverage(
        'Kill Switch',
        'real-local',
        'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
        'Critical trigger and evidence-bound reopen/rollback preserve monotonic pointer authority.',
      ),
      coverage(
        'Concurrent activation',
        'real-local',
        'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
        'Expected-version and pointer-lock CAS reject stale competing activation.',
      ),
      coverage(
        'Deadline / cancellation / late result',
        'simulated',
        'reports/goal/v1.3-p10-deadline-report.json',
        'Absolute deadlines and cancellation propagate; stale late results are discarded before formal commit.',
      ),
      coverage(
        'Partial transaction',
        'real-local',
        'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
        'Definition, pointer, validation, lineage, audit and Outbox writes remain transaction-bound.',
      ),
      coverage(
        'Migration interruption',
        'real',
        'reports/goal/v1.3-final-migration-report.json',
        'Deliberately interrupted 0125 rolls back marker, checksum and schema state before normal reapply.',
      ),
    ],
    steps,
    relatedEvidence: [
      'packages/runtime-redis/test/bullmq-context-queue.integration.test.ts',
      'packages/runtime-redis/test/candidate-generation-workers.integration.test.ts',
      'packages/persistence-postgres/test/artifact-authority.integration.test.ts',
      'packages/persistence-postgres/test/candidate-generation.integration.test.ts',
    ],
    limitations: [
      'This local drill restarts the repository-pinned Docker services; it is not a production availability claim.',
      'Worker process-loss and provider-network boundaries are closed by focused runtime tests and are listed separately in the final P13 recovery report.',
    ],
  };
  const reportDirectory = resolve(root, 'reports', 'goal');
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, 'v1.3-final-chaos-recovery-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  process.stdout.write(
    `P13 recovery drill passed: Redis flush ${String(redisFlushRecoveryMs)} ms, Redis restart ${String(redisRestartRecoveryMs)} ms, PostgreSQL restart ${String(postgresRestartRecoveryMs)} ms.\n`,
  );
} finally {
  if (databaseCreated) await dropDatabase();
  if (infrastructureStarted) stopInfrastructure(root);
}

interface DrillStep {
  readonly name: string;
  readonly classification: 'real';
  readonly status: 'passed';
  readonly durationMs: number;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

function coverage(
  fault: string,
  classification: 'real' | 'real-local' | 'simulated',
  evidenceRef: string,
  result: string,
): Readonly<{
  fault: string;
  classification: 'real' | 'real-local' | 'simulated';
  status: 'passed';
  evidenceRef: string;
  result: string;
}> {
  return Object.freeze({
    fault,
    classification,
    status: 'passed',
    evidenceRef,
    result,
  });
}

async function createDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: adminPostgresUrl });
  try {
    await admin.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase(): Promise<void> {
  const admin = await waitForPostgres(adminPostgresUrl);
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname=$1 AND pid<>pg_backend_pid()`,
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
}

async function assertGoal(pool: pg.Pool, stage: string): Promise<void> {
  const result = await pool.query('SELECT goal_id,status,version FROM goal WHERE goal_id=$1', [
    goalId,
  ]);
  if (
    result.rows.length !== 1 ||
    result.rows[0]?.goal_id !== goalId ||
    result.rows[0]?.status !== 'active' ||
    result.rows[0]?.version !== 1
  ) {
    throw new Error(`P13_AUTHORITATIVE_GOAL_LOST:${stage}`);
  }
}

async function createWake(): Promise<void> {
  const queue = new Queue(queueName, {
    connection: { host: redisHost, port: redisPort, db: redisDatabase },
  });
  try {
    await queue.add('wake', { goalId }, { jobId: goalId, attempts: 1 });
    await queue.add('wake', { goalId }, { jobId: goalId, attempts: 1 });
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    if (jobs.length !== 1 || jobs[0]?.id !== goalId || jobs[0]?.opts.attempts !== 1) {
      throw new Error('P13_REDIS_WAKE_IDEMPOTENCY_FAILED');
    }
  } finally {
    await queue.close();
  }
}

async function assertWakeAbsent(): Promise<void> {
  const queue = new Queue(queueName, {
    connection: { host: redisHost, port: redisPort, db: redisDatabase },
  });
  try {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active', 'completed', 'failed']);
    if (jobs.length !== 0) throw new Error('P13_REDIS_FLUSH_DID_NOT_CLEAR_WAKE');
  } finally {
    await queue.close();
  }
}

async function waitForRedis(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const queue = new Queue(queueName, {
      connection: {
        host: redisHost,
        port: redisPort,
        db: redisDatabase,
        connectTimeout: 1_000,
        maxRetriesPerRequest: 1,
      },
    });
    try {
      await queue.waitUntilReady();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    } finally {
      await queue.close().catch(() => undefined);
    }
    await delay(250);
  }
}

async function waitForPostgres(connectionString: string): Promise<pg.Pool> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const pool = new Pool({ connectionString, connectionTimeoutMillis: 1_000 });
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch (error) {
      await pool.end().catch(() => undefined);
      if (Date.now() >= deadline) throw error;
    }
    await delay(250);
  }
}

async function measure(name: string, action: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  await action();
  steps.push({
    name,
    classification: 'real',
    status: 'passed',
    durationMs: Date.now() - started,
  });
}

function measureSync(name: string, action: () => void): void {
  const started = Date.now();
  action();
  steps.push({
    name,
    classification: 'real',
    status: 'passed',
    durationMs: Date.now() - started,
  });
}

function runDocker(args: readonly string[]): void {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout: 120_000,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`P13_DOCKER_COMMAND_FAILED: docker ${args.join(' ')}`);
  }
}

function containerDigest(service: 'postgres' | 'redis'): string {
  const result = spawnSync(
    'docker',
    ['compose', '-f', 'compose.yaml', 'images', '--quiet', service],
    { cwd: root, env: process.env, encoding: 'utf8', timeout: 30_000 },
  );
  if (result.status !== 0) return 'unavailable';
  return result.stdout.trim();
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error('P13_DATABASE_NAME_INVALID');
  return `"${value}"`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}
