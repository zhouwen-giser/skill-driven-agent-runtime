import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

import {
  reuseExistingInfrastructure,
  startInfrastructure,
  stopInfrastructure,
} from './lib/infrastructure.mjs';

const { Pool } = pg;
const root = process.cwd();
const configuredConnectionString = process.env['TEST_DATABASE_URL'];
if (reuseExistingInfrastructure && configuredConnectionString === undefined)
  throw new Error('TEST_DATABASE_URL_REQUIRED_FOR_FROZEN_MIGRATION_VERIFICATION');
const connectionString =
  configuredConnectionString ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';

const baseUrl = new URL(connectionString);
const admin = new Pool({ connectionString });
const databases = ['sdar_frozen_empty', 'sdar_frozen_upgrade', 'sdar_frozen_gap'];
const bootstrap = await readFile(
  resolve(root, 'infra', 'postgres', 'init', '0001_sdar_bootstrap.up.sql'),
  'utf8',
);
const migrationDirectory = resolve(root, 'infra', 'postgres', 'migrations');

try {
  startInfrastructure(root);
  for (const database of databases) {
    await dropDatabase(admin, database);
    await admin.query(`CREATE DATABASE ${database}`);
  }

  const { applyRuntimeMigrations } = await import(
    `../dist/apps/server/src/runtime.js?frozen-migration-check=${String(Date.now())}`
  );

  const empty = poolFor(databases[0]);
  try {
    await empty.query(bootstrap);
    await applyRuntimeMigrations(empty);
    await applyRuntimeMigrations(empty);
    await verifyFrozenSchema(empty, 'empty-idempotent');
  } finally {
    await empty.end();
  }

  const upgrade = poolFor(databases[1]);
  try {
    await upgrade.query(bootstrap);
    await applyThrough0106(upgrade);
    await assertMigration(upgrade, '0106_skill_execution_record', true, 'upgrade-0106');
    await assertMigration(upgrade, '0107_frozen_mcp_tasks_protocol', false, 'upgrade-0106');
    await applyRuntimeMigrations(upgrade);
    await verifyFrozenSchema(upgrade, 'upgrade-0107');
    const legacy = await upgrade.query(
      `SELECT protocol_mode FROM mcp_server
       UNION ALL SELECT mcp_protocol_contract_json->>'mode' FROM workflow_plan
       UNION ALL SELECT mcp_protocol_contract_json->>'mode' FROM workflow_plan_attempt`,
    );
    if (legacy.rows.some((row) => row.protocol_mode !== 'legacy_v11'))
      throw new Error('FROZEN_MCP_LEGACY_BACKFILL_INVALID');

    const rollback = await readFile(
      resolve(migrationDirectory, '0107_frozen_mcp_tasks_protocol.down.sql'),
      'utf8',
    );
    await upgrade.query(
      `INSERT INTO mcp_server
         (server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
          created_at,updated_at,protocol_mode)
       VALUES ('frozen-rollback','Frozen rollback','https://provider.invalid/mcp',
          'streamable_http','enabled',1,'encrypted',now(),now(),'frozen_v1')`,
    );
    await expectRejection(() => upgrade.query(rollback), 'FROZEN_MCP_TASKS_UNSAFE_ROLLBACK');
    await assertMigration(upgrade, '0107_frozen_mcp_tasks_protocol', true, 'unsafe-rollback');
    await upgrade.query(
      "UPDATE mcp_server SET protocol_mode='legacy_v11' WHERE server_id='frozen-rollback'",
    );
    await upgrade.query(rollback);
    await assertMigration(upgrade, '0107_frozen_mcp_tasks_protocol', false, 'safe-rollback');
    await applyRuntimeMigrations(upgrade);
    await verifyFrozenSchema(upgrade, 'rollback-reapply');
  } finally {
    await upgrade.end();
  }

  const gap = poolFor(databases[2]);
  try {
    await gap.query(bootstrap);
    const names = await migrationNamesThrough(106);
    for (const name of names.filter((name) => !name.startsWith('0106_')))
      await gap.query(await readFile(resolve(migrationDirectory, name), 'utf8'));
    await gap.query(
      await readFile(resolve(migrationDirectory, '0107_frozen_mcp_tasks_protocol.up.sql'), 'utf8'),
    );
    await expectRejection(
      () => applyRuntimeMigrations(gap),
      'FROZEN_MCP_MIGRATION_LEDGER_GAP',
    );
  } finally {
    await gap.end();
  }

  process.stdout.write(
    'Frozen migration 0107 verified: empty, 0106 upgrade, idempotent, rollback/reapply, Legacy backfill, unsafe rollback and ledger-gap fail-closed.\n',
  );
} finally {
  try {
    for (const database of databases) await dropDatabase(admin, database).catch(() => undefined);
  } finally {
    await admin.end().catch(() => undefined);
    stopInfrastructure(root);
  }
}

async function applyThrough0106(pool) {
  for (const name of await migrationNamesThrough(106))
    await pool.query(await readFile(resolve(migrationDirectory, name), 'utf8'));
}

async function migrationNamesThrough(sequence) {
  return (await readdir(migrationDirectory))
    .filter(
      (name) =>
        /^\d{4}_.+\.up\.sql$/u.test(name) && Number.parseInt(name.slice(0, 4), 10) <= sequence,
    )
    .sort();
}

function poolFor(database) {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return new Pool({ connectionString: url.toString() });
}

async function dropDatabase(pool, database) {
  await pool.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
    [database],
  );
  await pool.query(`DROP DATABASE IF EXISTS ${database}`);
}

async function assertMigration(pool, version, expected, label) {
  const result = await pool.query(
    'SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version=$1) AS applied',
    [version],
  );
  if (result.rows[0]?.applied !== expected)
    throw new Error(`FROZEN_MIGRATION_STATE_INVALID:${label}:${version}`);
}

async function verifyFrozenSchema(pool, label) {
  await assertMigration(pool, '0107_frozen_mcp_tasks_protocol', true, label);
  const columns = await pool.query(
    `SELECT count(*)::integer AS count FROM information_schema.columns
     WHERE (table_name='mcp_server' AND column_name IN ('protocol_mode','current_protocol_snapshot_id'))
        OR (table_name='mcp_tool' AND column_name='output_schema_json')
        OR (table_name IN ('workflow_plan','workflow_plan_attempt') AND column_name='mcp_protocol_contract_json')
        OR (table_name='remote_task_binding' AND column_name IN
          ('protocol_contract_json','task_behavior','runtime_revision','provider_revision','task_ttl_ms','task_expires_at'))
        OR (table_name='remote_task_observation' AND column_name IN
          ('observation_source','runtime_revision','provider_revision','subscription_id'))
        OR (table_name='remote_task_control_event' AND column_name='runtime_revision')`,
  );
  if (columns.rows[0]?.count !== 16)
    throw new Error(`FROZEN_MCP_PROTOCOL_COLUMNS_MISSING:${label}`);
  const indexes = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('remote_task_observation_frozen_revision_idx','remote_task_control_frozen_revision_idx') AND relkind='i'",
  );
  if (indexes.rows[0]?.count !== 2)
    throw new Error(`FROZEN_MCP_REVISION_UNIQUENESS_MISSING:${label}`);
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
