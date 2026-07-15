import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const root = process.cwd();
const databases = ['sdar_verify_empty', 'sdar_verify_upgrade'];

try {
  startInfrastructure(root);
  const { applyRuntimeMigrations } = await import(
    `../dist/apps/server/src/runtime.js?migration-check=${String(Date.now())}`
  );
  const admin = new Pool({
    connectionString: 'postgresql://sdar:sdar_local_only@127.0.0.1:54329/sdar',
  });
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

  const bootstrap = await readFile(
    resolve(root, 'infra', 'postgres', 'init', '0001_sdar_bootstrap.up.sql'),
    'utf8',
  );
  const emptyPool = databasePool(databases[0]);
  try {
    await emptyPool.query(bootstrap);
    await applyRuntimeMigrations(emptyPool);
    await verifyCurrentSchema(emptyPool, 'empty');
  } finally {
    await emptyPool.end();
  }

  const upgradePool = databasePool(databases[1]);
  try {
    await upgradePool.query(bootstrap);
    const migrationDirectory = resolve(root, 'infra', 'postgres', 'migrations');
    const historical = (await readdir(migrationDirectory))
      .filter((name) => /^\d{4}_.+\.up\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 49)
      .sort();
    for (const name of historical) {
      await upgradePool.query(await readFile(resolve(migrationDirectory, name), 'utf8'));
    }
    await applyRuntimeMigrations(upgradePool);
    await verifyCurrentSchema(upgradePool, 'upgrade-from-0049');
  } finally {
    await upgradePool.end();
  }
  process.stdout.write(
    'Migration path verified from empty database and historical 0049 baseline.\n',
  );
} finally {
  const admin = databasePool('sdar');
  try {
    for (const database of databases) {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    }
  } catch {
    // The primary failure remains authoritative when infrastructure never became reachable.
  } finally {
    await admin.end().catch(() => undefined);
    stopInfrastructure(root);
  }
}

function databasePool(database) {
  return new Pool({
    connectionString: `postgresql://sdar:sdar_local_only@127.0.0.1:54329/${database}`,
  });
}

async function verifyCurrentSchema(pool, label) {
  const latest = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version='0053_mcp_tool_enhancement_stage') AS applied",
  );
  if (latest.rows[0]?.applied !== true) throw new Error(`MIGRATION_0053_MISSING:${label}`);
  const constraint = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='stage_model_route_stage_check'",
  );
  const definition = constraint.rows[0]?.definition;
  if (typeof definition !== 'string' || !definition.includes('tool_enhancement')) {
    throw new Error(`MIGRATION_STAGE_CONSTRAINT_STALE:${label}`);
  }
}
