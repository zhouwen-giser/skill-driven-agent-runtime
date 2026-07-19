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
  'sdar_v11_verify_frozen_rollback',
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
    await assertMigration(upgrade, '0100_remote_mcp_task_tracking', true, 'upgrade-released');
    await assertMigration(upgrade, '0101_task_execution_readiness', true, 'upgrade-released');
    await assertMigration(upgrade, '0102_remote_task_continuation', true, 'upgrade-released');
    await assertMigration(
      upgrade,
      '0103_remote_task_input_and_cancellation',
      true,
      'upgrade-released',
    );
    await assertMigration(upgrade, '0104_workflow_external_wait_event', true, 'upgrade-released');
    await assertMigration(upgrade, '0105_skill_usage_specification', true, 'upgrade-released');
    await assertMigration(upgrade, '0106_skill_execution_record', true, 'upgrade-released');
    await assertMigration(upgrade, '0107_frozen_mcp_tasks_protocol', true, 'upgrade-released');
    await verifyFrozenSchema(upgrade, 'upgrade-released');
    await applyRuntimeMigrations(upgrade, {
      profile: 'v1.1-isolated',
      isolationAcknowledged: true,
    });
    await verifyV11Schema(upgrade, 'upgrade-from-0064');
    for (const name of [
      '0107_frozen_mcp_tasks_protocol.down.sql',
      '0106_skill_execution_record.down.sql',
      '0105_skill_usage_specification.down.sql',
      '0104_workflow_external_wait_event.down.sql',
      '0103_remote_task_input_and_cancellation.down.sql',
      '0102_remote_task_continuation.down.sql',
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
    await assertMigration(upgrade, '0102_remote_task_continuation', false, 'rollback');
    await assertMigration(upgrade, '0103_remote_task_input_and_cancellation', false, 'rollback');
    await assertMigration(upgrade, '0104_workflow_external_wait_event', false, 'rollback');
    await assertMigration(upgrade, '0105_skill_usage_specification', false, 'rollback');
    await assertMigration(upgrade, '0106_skill_execution_record', false, 'rollback');
    await assertMigration(upgrade, '0107_frozen_mcp_tasks_protocol', false, 'rollback');
    await applyRuntimeMigrations(upgrade, {
      profile: 'v1.1-isolated',
      isolationAcknowledged: true,
    });
    await verifyV11Schema(upgrade, 'reapply-after-rollback');
    await applyRuntimeMigrations(upgrade);
    await verifyFrozenSchema(upgrade, 'released-reapply-after-rollback');
  } finally {
    await upgrade.end();
  }

  const guard = databasePool(databases[2]);
  try {
    await guard.query(bootstrap);
    await applyRuntimeMigrations(guard);
    await verifyV11Schema(guard, 'released-profile');
    await verifyFrozenSchema(guard, 'released-profile');
    await expectRejection(
      () =>
        applyRuntimeMigrations(guard, {
          profile: 'v1.1-isolated',
        }),
      'V11_MIGRATION_ISOLATION_REQUIRED',
    );
    await applyRuntimeMigrations(guard);
    await verifyV11Schema(guard, 'released-profile-idempotent');
  } finally {
    await guard.end();
  }

  const gap = databasePool(databases[3]);
  try {
    await gap.query(bootstrap);
    await applyRuntimeMigrations(gap);
    for (const name of [
      '0107_frozen_mcp_tasks_protocol.down.sql',
      '0106_skill_execution_record.down.sql',
      '0105_skill_usage_specification.down.sql',
      '0104_workflow_external_wait_event.down.sql',
      '0103_remote_task_input_and_cancellation.down.sql',
      '0102_remote_task_continuation.down.sql',
      '0101_task_execution_readiness.down.sql',
      '0100_remote_mcp_task_tracking.down.sql',
    ]) {
      await gap.query(
        await readFile(resolve(root, 'infra', 'postgres', 'migrations', name), 'utf8'),
      );
    }
    const outOfOrder = await readFile(
      resolve(root, 'infra', 'postgres', 'migrations', '0101_task_execution_readiness.up.sql'),
      'utf8',
    );
    await gap.query(outOfOrder);
    await expectRejection(() => applyRuntimeMigrations(gap), 'V11_MIGRATION_LEDGER_GAP');
    await assertMigration(gap, '0100_remote_mcp_task_tracking', false, 'ledger-gap');
    await assertMigration(gap, '0101_task_execution_readiness', true, 'ledger-gap');
    await assertMigration(gap, '0102_remote_task_continuation', false, 'ledger-gap');
    await assertMigration(gap, '0103_remote_task_input_and_cancellation', false, 'ledger-gap');
    await assertMigration(gap, '0104_workflow_external_wait_event', false, 'ledger-gap');
    await assertMigration(gap, '0105_skill_usage_specification', false, 'ledger-gap');
    await assertMigration(gap, '0106_skill_execution_record', false, 'ledger-gap');
    await assertMigration(gap, '0107_frozen_mcp_tasks_protocol', false, 'ledger-gap');
  } finally {
    await gap.end();
  }

  const frozenRollback = databasePool(databases[4]);
  try {
    await frozenRollback.query(bootstrap);
    await applyRuntimeMigrations(frozenRollback);
    await frozenRollback.query(
      `INSERT INTO mcp_server
         (server_id,name,endpoint,transport,status,tool_revision,encrypted_credential,
          created_at,updated_at,protocol_mode)
       VALUES ('frozen-rollback','Frozen rollback','https://provider.invalid/mcp',
          'streamable_http','enabled',1,'encrypted','2026-07-18T00:00:00Z',
          '2026-07-18T00:00:00Z','frozen_v1')`,
    );
    const rollback = await readFile(
      resolve(
        root,
        'infra',
        'postgres',
        'migrations',
        '0107_frozen_mcp_tasks_protocol.down.sql',
      ),
      'utf8',
    );
    await expectRejection(
      () => frozenRollback.query(rollback),
      'FROZEN_MCP_TASKS_UNSAFE_ROLLBACK',
    );
    await assertMigration(
      frozenRollback,
      '0107_frozen_mcp_tasks_protocol',
      true,
      'unsafe-rollback-rejected',
    );
    await frozenRollback.query(
      "UPDATE mcp_server SET protocol_mode='legacy_v11' WHERE server_id='frozen-rollback'",
    );
    await frozenRollback.query(rollback);
    await assertMigration(
      frozenRollback,
      '0107_frozen_mcp_tasks_protocol',
      false,
      'safe-rollback',
    );
    await applyRuntimeMigrations(frozenRollback);
    await verifyFrozenSchema(frozenRollback, 'safe-rollback-reapply');
  } finally {
    await frozenRollback.end();
  }

  process.stdout.write(
    'Post-main migration path verified through 0107: released/isolated upgrade, rollback/reapply, unsafe Frozen rollback rejection, isolation guards, and ledger-gap fail-closed.\n',
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
  await assertMigration(pool, '0102_remote_task_continuation', true, label);
  await assertMigration(pool, '0103_remote_task_input_and_cancellation', true, label);
  await assertMigration(pool, '0104_workflow_external_wait_event', true, label);
  await assertMigration(pool, '0105_skill_usage_specification', true, label);
  await assertMigration(pool, '0106_skill_execution_record', true, label);
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
  const continuationTables = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('workflow_continuation_snapshot','workflow_continuation_wait_binding','workflow_continuation_attempt') AND relkind='r'",
  );
  if (continuationTables.rows[0]?.count !== 3) {
    throw new Error(`V11_CONTINUATION_TABLES_MISSING:${label}`);
  }
  const lifecycleTables = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('remote_task_input_link','remote_task_input_attempt','remote_task_cancel_request','remote_task_cancel_attempt') AND relkind='r'",
  );
  if (lifecycleTables.rows[0]?.count !== 4) {
    throw new Error(`V11_REMOTE_TASK_LIFECYCLE_TABLES_MISSING:${label}`);
  }
  const controlClaimColumns = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='remote_task_control_event' AND column_name IN ('continuation_claim_token','continuation_claim_expires_at','continuation_claim_attempt')",
  );
  if (controlClaimColumns.rows[0]?.count !== 3) {
    throw new Error(`V11_CONTINUATION_CONTROL_COLUMNS_MISSING:${label}`);
  }
  const workflowStatus = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='workflow_instance'::regclass AND conname='workflow_instance_status_check'",
  );
  if (!workflowStatus.rows[0]?.definition?.includes('waiting_external')) {
    throw new Error(`V11_WAITING_EXTERNAL_STATUS_MISSING:${label}`);
  }
  const workflowEventType = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='workflow_node_event'::regclass AND conname='workflow_node_event_event_type_check'",
  );
  if (!workflowEventType.rows[0]?.definition?.includes('node_waiting_external')) {
    throw new Error(`V11_WAITING_EXTERNAL_EVENT_TYPE_MISSING:${label}`);
  }
  const skillCallStatus = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='skill_call_workflow'::regclass AND conname='skill_call_workflow_status_check'",
  );
  if (!skillCallStatus.rows[0]?.definition?.includes('waiting_external')) {
    throw new Error(`V11_CHILD_WORKFLOW_WAITING_STATUS_MISSING:${label}`);
  }
  const childLookupIndex = await pool.query(
    "SELECT to_regclass('public.skill_call_workflow_child_instance_continuation_idx') IS NOT NULL AS present",
  );
  if (childLookupIndex.rows[0]?.present !== true) {
    throw new Error(`V11_CHILD_WORKFLOW_LOOKUP_INDEX_MISSING:${label}`);
  }
  const activeAttemptIndex = await pool.query(
    "SELECT pg_get_expr(indpred,indrelid) AS predicate FROM pg_index WHERE indexrelid='workflow_continuation_attempt_status_idx'::regclass",
  );
  const activeAttemptPredicate = activeAttemptIndex.rows[0]?.predicate ?? '';
  if (
    !activeAttemptPredicate.includes('claimed') ||
    !activeAttemptPredicate.includes('running') ||
    activeAttemptPredicate.includes('waiting_external')
  ) {
    throw new Error(`V11_CONTINUATION_ACTIVE_ATTEMPT_INDEX_INVALID:${label}`);
  }
  const usageColumn = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='skill_version' AND column_name='usage_specification_json' AND data_type='jsonb'",
  );
  if (usageColumn.rows[0]?.count !== 1) {
    throw new Error(`V12_SKILL_USAGE_COLUMN_MISSING:${label}`);
  }
  const packageAudit = await pool.query(
    "SELECT to_regclass('public.skill_package_import_audit') IS NOT NULL AS present",
  );
  if (packageAudit.rows[0]?.present !== true) {
    throw new Error(`V12_SKILL_PACKAGE_IMPORT_AUDIT_MISSING:${label}`);
  }
  const executionTables = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('skill_execution_record','skill_execution_event','skill_execution_reference') AND relkind='r'",
  );
  if (executionTables.rows[0]?.count !== 3) {
    throw new Error(`V12_SKILL_EXECUTION_TABLES_MISSING:${label}`);
  }
}

async function verifyFrozenSchema(pool, label) {
  await assertMigration(pool, '0107_frozen_mcp_tasks_protocol', true, label);
  const snapshotTable = await pool.query(
    "SELECT to_regclass('public.mcp_protocol_snapshot') IS NOT NULL AS present",
  );
  if (snapshotTable.rows[0]?.present !== true)
    throw new Error(`FROZEN_MCP_PROTOCOL_SNAPSHOT_MISSING:${label}`);
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
