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
  'sdar_v11_verify_guard',
  'sdar_v11_verify_gap',
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
    await assertMigration(upgrade, '0064_memory_production_hardening', true, 'upgrade-released');
    await assertMigration(upgrade, '0100_remote_mcp_task_tracking', false, 'upgrade-released');
    await assertMigration(upgrade, '0101_task_execution_readiness', false, 'upgrade-released');
    await applyRuntimeMigrations(upgrade, {
      profile: 'v1.1-isolated',
      isolationAcknowledged: true,
    });
    await verifyV11Schema(upgrade, 'upgrade-from-0064');
    for (const name of [
      '0101_task_execution_readiness.down.sql',
      '0100_remote_mcp_task_tracking.down.sql',
    ]) {
      const rollback = await readFile(
        resolve(root, 'infra', 'postgres', 'migrations', name),
        'utf8',
      );
      await upgrade.query(rollback);
    }
    await assertMigration(upgrade, '0064_memory_production_hardening', true, 'rollback');
    await assertMigration(upgrade, '0100_remote_mcp_task_tracking', false, 'rollback');
    await assertMigration(upgrade, '0101_task_execution_readiness', false, 'rollback');
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
    await assertMigration(guard, '0064_memory_production_hardening', true, 'default-profile');
    await assertMigration(guard, '0100_remote_mcp_task_tracking', false, 'default-profile');
    await assertMigration(guard, '0101_task_execution_readiness', false, 'default-profile');
    await expectRejection(
      () =>
        applyRuntimeMigrations(guard, {
          profile: 'v1.1-isolated',
        }),
      'V11_MIGRATION_ISOLATION_REQUIRED',
    );
    const v11Migration = await readFile(
      resolve(root, 'infra', 'postgres', 'migrations', '0100_remote_mcp_task_tracking.up.sql'),
      'utf8',
    );
    await guard.query(v11Migration);
    await expectRejection(() => applyRuntimeMigrations(guard), 'V11_MIGRATION_PROFILE_REQUIRED');
    await assertMigration(guard, '0101_task_execution_readiness', false, 'profile-guard');
  } finally {
    await guard.end();
  }

  const gap = databasePool(databases[3]);
  try {
    await gap.query(bootstrap);
    await applyRuntimeMigrations(gap);
    const outOfOrder = await readFile(
      resolve(root, 'infra', 'postgres', 'migrations', '0101_task_execution_readiness.up.sql'),
      'utf8',
    );
    await gap.query(outOfOrder);
    await expectRejection(
      () =>
        applyRuntimeMigrations(gap, {
          profile: 'v1.1-isolated',
          isolationAcknowledged: true,
        }),
      'V11_MIGRATION_LEDGER_GAP',
    );
    await assertMigration(gap, '0100_remote_mcp_task_tracking', false, 'ledger-gap');
    await assertMigration(gap, '0101_task_execution_readiness', true, 'ledger-gap');
  } finally {
    await gap.end();
  }

  process.stdout.write(
    'Isolated v1.1 migration path verified: empty, 0064 upgrade, rollback/reapply, profile guards, and ledger-gap fail-closed.\n',
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
    connectionString: `postgresql://sdar:sdar_local_only@127.0.0.1:55432/${database}`,
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
  await assertMigration(pool, '0064_memory_production_hardening', true, label);
  await assertMigration(pool, '0100_remote_mcp_task_tracking', true, label);
  await assertMigration(pool, '0101_task_execution_readiness', true, label);
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
  const readinessTables = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('task_execution_readiness','task_availability_snapshot') AND relkind='r'",
  );
  if (readinessTables.rows[0]?.count !== 2) {
    throw new Error(`V11_TASK_READINESS_TABLES_MISSING:${label}`);
  }
  const metadataColumn = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='mcp_tool' AND column_name='task_execution_json'",
  );
  if (metadataColumn.rows[0]?.count !== 1) {
    throw new Error(`V11_TASK_METADATA_COLUMN_MISSING:${label}`);
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
