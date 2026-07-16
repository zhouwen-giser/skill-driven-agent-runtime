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
    "SELECT EXISTS(SELECT 1 FROM schema_migration WHERE version='0063_mcp_tool_execution_semantics') AS applied",
  );
  if (latest.rows[0]?.applied !== true)
    throw new Error(`MIGRATION_0063_MISSING:${label}`);
  const semanticsColumns = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE (table_name='mcp_tool' AND column_name IN ('declared_execution_semantics_json','admin_execution_semantics_override_json','execution_semantics_json')) OR (table_name='mcp_invocation' AND column_name='execution_semantics_json') OR (table_name IN ('workflow_plan','workflow_plan_attempt') AND column_name='tool_execution_semantics_json')",
  );
  if (semanticsColumns.rows[0]?.count !== 6)
    throw new Error(`MIGRATION_MCP_TOOL_EXECUTION_SEMANTICS_MISSING:${label}`);
  const semanticsOperationConstraint = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='mcp_management_operation'::regclass AND conname='mcp_management_operation_operation_type_check'",
  );
  if (!semanticsOperationConstraint.rows[0]?.definition?.includes('tool_semantics_override'))
    throw new Error(`MIGRATION_MCP_TOOL_SEMANTICS_OPERATION_MISSING:${label}`);
  const compositionColumns = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE column_name IN ('composition_context_json','capability_gap_skill_ids_json') AND table_name IN ('workflow_plan','workflow_plan_attempt')",
  );
  if (compositionColumns.rows[0]?.count !== 4)
    throw new Error(`MIGRATION_SKILL_COMPOSITION_CONTEXT_MISSING:${label}`);
  const goalContractColumns = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE column_name='goal_contract_json' AND table_name IN ('workflow_plan','workflow_plan_attempt','skill_selection_record','skill_replacement_plan')",
  );
  if (goalContractColumns.rows[0]?.count !== 4)
    throw new Error(`MIGRATION_GOAL_EXECUTION_CONTRACT_MISSING:${label}`);
  const inputResolutionTable = await pool.query(
    "SELECT to_regclass('public.skill_input_resolution') IS NOT NULL AS exists",
  );
  if (inputResolutionTable.rows[0]?.exists !== true)
    throw new Error(`MIGRATION_SKILL_INPUT_RESOLUTION_MISSING:${label}`);
  const taskBinding = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='agent_task' AND column_name='skill_input_resolution_id') AS exists",
  );
  if (taskBinding.rows[0]?.exists !== true)
    throw new Error(`MIGRATION_TASK_SKILL_INPUT_BINDING_MISSING:${label}`);
  const terminalOutcomeTables = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE (table_name='runtime_terminal_outcome' AND column_name='outcome_id') OR (table_name IN ('workflow_control','workflow_control_round') AND column_name='terminal_outcome_id')",
  );
  if (terminalOutcomeTables.rows[0]?.count !== 3)
    throw new Error(`MIGRATION_RUNTIME_TERMINAL_OUTCOME_MISSING:${label}`);
  const continuationTables = await pool.query(
    "SELECT count(*)::integer AS count FROM pg_class WHERE relname IN ('task_input_request','task_input_response','task_execution_attempt') AND relkind='r'",
  );
  if (continuationTables.rows[0]?.count !== 3)
    throw new Error(`MIGRATION_TASK_INPUT_TABLES_MISSING:${label}`);
  const executionColumns = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='mcp_invocation' AND column_name IN ('execution_mode','simulation_id')",
  );
  if (executionColumns.rows[0]?.count !== 2)
    throw new Error(`MIGRATION_MCP_EXECUTION_CONTEXT_MISSING:${label}`);
  const historyKey = await pool.query(
    "SELECT string_agg(a.attname,',' ORDER BY key_position.ordinality) AS columns FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key_position(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key_position.attnum WHERE c.conname='skill_call_workflow_pkey' GROUP BY c.oid",
  );
  if (historyKey.rows[0]?.columns !== 'call_id') {
    throw new Error(`MIGRATION_SKILL_CALL_HISTORY_KEY_STALE:${label}`);
  }
  const nestedConfirmationColumns = await pool.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name='skill_call_workflow' AND column_name IN ('parent_plan_id','confirmation_status')",
  );
  if (nestedConfirmationColumns.rows[0]?.count !== 2)
    throw new Error(`MIGRATION_NESTED_CONFIRMATION_COLUMNS_MISSING:${label}`);
  const childInstanceForeignKey = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='skill_call_workflow'::regclass AND conname='skill_call_workflow_child_instance_id_fkey') AS exists",
  );
  if (childInstanceForeignKey.rows[0]?.exists !== true)
    throw new Error(`MIGRATION_NESTED_CONFIRMATION_CHILD_FK_MISSING:${label}`);
  const constraint = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='stage_model_route_stage_check'",
  );
  const definition = constraint.rows[0]?.definition;
  if (
    typeof definition !== 'string' ||
    !definition.includes('tool_enhancement') ||
    !definition.includes('skill_input_resolution')
  ) {
    throw new Error(`MIGRATION_STAGE_CONSTRAINT_STALE:${label}`);
  }
  const inputSourceConstraint = await pool.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='task_input_request'::regclass AND conname='task_input_request_source_check'",
  );
  if (!inputSourceConstraint.rows[0]?.definition?.includes('skill_input_resolution'))
    throw new Error(`MIGRATION_TASK_INPUT_SOURCE_STALE:${label}`);
}
