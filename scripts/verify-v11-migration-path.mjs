import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const root = process.cwd();
const databases = [
  'sdar_v11_verify_empty',
  'sdar_v11_verify_upgrade',
  'sdar_verify_v11_guard',
];

try {
  startInfrastructure(root);
  const { applyRuntimeMigrations } = await import(
    `../dist/apps/server/src/runtime.js?v11-migration-check=${String(Date.now())}`
  );
  const admin = databasePool('sdar');
  try {
    for (const database of databases) {
      await dropDatabase(admin, database);
      await admin.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await admin.end();
  }

  const bootstrap = await readFile(
    resolve(root, 'infra', 'postgres', 'init', '0001_sdar_bootstrap.up.sql'),
    'utf8',
  );

  const empty = databasePool(databases[0]);
  try {
    await empty.query(bootstrap);
    await applyRuntimeMigrations(empty, {
      profile: 'v1.1-isolated',
      isolationAcknowledged: true,
    });
    await verifyV11Schema(empty, 'empty');
  } finally {
    await empty.end();
  }

  const upgrade = databasePool(databases[1]);
  try {
    await upgrade.query(bootstrap);
    await applyRuntimeMigrations(upgrade);
    await assertMigration(upgrade, '0056_mcp_execution_mode', true, 'upgrade-released');
    await assertMigration(upgrade, '0100_remote_mcp_task_tracking', false, 'upgrade-released');
    await applyRuntimeMigrations(upgrade, {
      profile: 'v1.1-isolated',
      isolationAcknowledged: true,
    });
    await verifyV11Schema(upgrade, 'upgrade-from-0056');
    const rollback = await readFile(
      resolve(
        root,
        'infra',
        'postgres',
        'migrations',
        '0100_remote_mcp_task_tracking.down.sql',
      ),
      'utf8',
    );
    await upgrade.query(rollback);
    await assertMigration(upgrade, '0056_mcp_execution_mode', true, 'rollback');
    await assertMigration(upgrade, '0100_remote_mcp_task_tracking', false, 'rollback');
    await applyRuntimeMigrations(upgrade, {
      profile: 'v1.1-isolated',
      isolationAcknowledged: true,
    });
    await verifyV11Schema(upgrade, 'reapply-after-rollback');
  } finally {
    await upgrade.end();
  }

  const guard = databasePool(databases[2]);
  try {
    await guard.query(bootstrap);
    await applyRuntimeMigrations(guard);
    await assertMigration(guard, '0100_remote_mcp_task_tracking', false, 'default-profile');
    await expectRejection(
      () =>
        applyRuntimeMigrations(guard, {
          profile: 'v1.1-isolated',
          isolationAcknowledged: true,
        }),
      'V11_MIGRATION_ISOLATION_REQUIRED',
    );
  } finally {
    await guard.end();
  }

  process.stdout.write(
    'Isolated v1.1 migration path verified: empty, 0056 upgrade, rollback/reapply, and default fail-closed.\n',
  );
} finally {
  const admin = databasePool('sdar');
  try {
    for (const database of databases) await dropDatabase(admin, database);
  } catch {
    // Preserve the primary verification failure when infrastructure never became reachable.
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

async function dropDatabase(admin, database) {
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
    [database],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);
}

async function assertMigration(pool, version, expected, label) {
  const result = await pool.query(
    'SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=$1) AS applied',
    [version],
  );
  if (result.rows[0]?.applied !== expected) {
    throw new Error(`MIGRATION_STATE_INVALID:${label}:${version}`);
  }
}

async function verifyV11Schema(pool, label) {
  await assertMigration(pool, '0056_mcp_execution_mode', true, label);
  await assertMigration(pool, '0100_remote_mcp_task_tracking', true, label);
  const tables = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('remote_task_binding','remote_task_observation','remote_task_control_event','remote_task_protocol_attempt') AND relkind='r'",
  );
  if (tables.rows[0]?.count !== 4) throw new Error(`V11_REMOTE_TASK_TABLES_MISSING:${label}`);
  const constraints = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_constraint WHERE conrelid='remote_task_binding'::regclass AND contype='u'",
  );
  if ((constraints.rows[0]?.count ?? 0) < 3) {
    throw new Error(`V11_REMOTE_TASK_UNIQUENESS_MISSING:${label}`);
  }
}

async function expectRejection(operation, code) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error && error.message.includes(code)) return;
    throw error;
  }
  throw new Error(`EXPECTED_REJECTION_MISSING:${code}`);
}
