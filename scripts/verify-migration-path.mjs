import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const root = process.cwd();
const databases = ['sdar_v122_verify_empty', 'sdar_v122_verify_existing'];
const adminUrl =
  process.env.SDAR_POSTGRES_ADMIN_URL ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';

try {
  startInfrastructure(root);
  const { applyRuntimeMigrations } = await import(
    `../dist/apps/server/src/runtime.js?baseline-check=${String(Date.now())}`
  );
  await recreateDatabases();

  const emptyPool = databasePool(databases[0]);
  try {
    await applyRuntimeMigrations(emptyPool);
    await verifyBaseline(emptyPool);
    await applyRuntimeMigrations(emptyPool);
    await verifyBaseline(emptyPool);
  } finally {
    await emptyPool.end();
  }

  const existingPool = databasePool(databases[1]);
  try {
    await existingPool.query('CREATE TABLE operator_data(id text PRIMARY KEY)');
    await expectCleanDatabaseRejection(applyRuntimeMigrations, existingPool, 'existing-table');
    const preserved = await existingPool.query(
      "SELECT to_regclass('public.operator_data') IS NOT NULL AS preserved",
    );
    if (preserved.rows[0]?.preserved !== true)
      throw new Error('CLEAN_DATABASE_REJECTION_DESTROYED_EXISTING_DATA');
    verifyResetRejected({
      SDAR_ENV: 'production',
      SDAR_ALLOW_DESTRUCTIVE_RESET: 'v1.2.2',
      SDAR_POSTGRES_URL: databaseUrl(databases[1]),
    }, 'V122_RESET_ENVIRONMENT_REJECTED');
    verifyResetRejected({
      SDAR_ENV: 'test',
      SDAR_ALLOW_DESTRUCTIVE_RESET: 'v1.2.2',
      SDAR_POSTGRES_URL: databaseUrl('sdar'),
    }, 'V122_RESET_DATABASE_NAME_REJECTED');
    runReset(databaseUrl(databases[1]));
    await verifyBaseline(existingPool);
    const seed = await existingPool.query(
      `SELECT
         EXISTS(SELECT 1 FROM evolution_policy WHERE singleton=true) AS evolution,
         EXISTS(SELECT 1 FROM memory_retention_policy WHERE singleton=true) AS memory`,
    );
    if (seed.rows[0]?.evolution !== true || seed.rows[0]?.memory !== true)
      throw new Error('V122_MINIMAL_SEED_MISSING');
  } finally {
    await existingPool.end();
  }

  process.stdout.write(
    'SDAR v1.2.2 clean baseline verified: empty apply, idempotency, schema contract, and existing-database rejection.\n',
  );
} finally {
  await dropDatabases().catch(() => undefined);
  stopInfrastructure(root);
}

function databasePool(database) {
  return new Pool({ connectionString: databaseUrl(database) });
}

function databaseUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function recreateDatabases() {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    for (const database of databases) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      await admin.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await admin.end();
  }
}

async function dropDatabases() {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    for (const database of databases) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    }
  } finally {
    await admin.end();
  }
}

async function verifyBaseline(pool) {
  const identity = await pool.query(
    "SELECT current_database() AS database_name, to_regclass('public.schema_migration')::text AS marker_table",
  );
  if (!['public.schema_migration', 'schema_migration'].includes(identity.rows[0]?.marker_table))
    throw new Error(
      `V122_BASELINE_TABLE_MISSING:${String(identity.rows[0]?.database_name)}:${String(identity.rows[0]?.marker_table)}`,
    );
  const marker = await pool.query(
    'SELECT array_agg(version ORDER BY version) AS versions FROM public.schema_migration',
  );
  if (JSON.stringify(marker.rows[0]?.versions) !== '["v1.2.2_clean_slate_baseline"]')
    throw new Error('V122_BASELINE_MARKER_INVALID');

  const requiredTables = [
    'goal',
    'skill',
    'workflow_plan',
    'remote_task_binding',
    'user_goal_plan',
    'skill_goal',
    'skill_attempt',
    'business_event_inbox',
  ];
  const tables = await pool.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema='public' AND table_name=ANY($1::text[])
     ORDER BY table_name`,
    [requiredTables],
  );
  if (tables.rows.length !== requiredTables.length)
    throw new Error('V122_BASELINE_REQUIRED_TABLES_MISSING');

  const modes = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conname='mcp_server_protocol_mode_check'`,
  );
  const definition = modes.rows[0]?.definition;
  if (typeof definition !== 'string' || !definition.includes('frozen_v1'))
    throw new Error('V122_FROZEN_PROTOCOL_CONSTRAINT_MISSING');
}

async function expectCleanDatabaseRejection(applyRuntimeMigrations, pool, label) {
  try {
    await applyRuntimeMigrations(pool);
  } catch (error) {
    if (error instanceof Error && error.message === 'SDAR_V122_CLEAN_DATABASE_REQUIRED') return;
    throw error;
  }
  throw new Error(`V122_EXISTING_DATABASE_ACCEPTED:${label}`);
}

function verifyResetRejected(environment, expectedCode) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/reset-v122-database.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
  if (result.status === 0 || !`${result.stdout}${result.stderr}`.includes(expectedCode))
    throw new Error(`V122_RESET_GUARD_NOT_ENFORCED:${expectedCode}`);
}

function runReset(connectionString) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/reset-v122-database.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SDAR_ENV: 'test',
      SDAR_ALLOW_DESTRUCTIVE_RESET: 'v1.2.2',
      SDAR_POSTGRES_URL: connectionString,
    },
  });
  if (result.status !== 0)
    throw new Error(`V122_RESET_FAILED:${result.stdout}${result.stderr}`);
}
