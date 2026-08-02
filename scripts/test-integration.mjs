import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const databaseName = 'sdar_v122_integration_gate';
const controlDatabaseName = 'sdar_control_v14_integration_gate';
const adminUrl =
  process.env.SDAR_TEST_POSTGRES_URL ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';

try {
  startInfrastructure();
  await recreateDatabases();
  run(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', '--project', 'integration'],
    240_000,
    {
      ...process.env,
      SDAR_TEST_POSTGRES_URL: databaseUrl(databaseName),
      SDAR_CONTROL_TEST_POSTGRES_URL: databaseUrl(controlDatabaseName),
    },
  );
} finally {
  await dropDatabases().catch(() => undefined);
  stopInfrastructure();
}

function run(command, args, timeout, environment) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: environment,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`INTEGRATION_COMMAND_FAILED: ${command} ${args.join(' ')}`);
}

function databaseUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function recreateDatabases() {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    for (const database of [databaseName, controlDatabaseName]) {
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
    for (const database of [databaseName, controlDatabaseName]) {
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
