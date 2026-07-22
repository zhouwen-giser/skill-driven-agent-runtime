import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const databaseName = 'sdar_v122_e2e_gate';
const adminUrl =
  process.env.SDAR_TEST_POSTGRES_URL ??
  'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';

try {
  startInfrastructure();
  await recreateDatabase();
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project', 'e2e'], 120_000, {
    ...process.env,
    SDAR_TEST_POSTGRES_URL: databaseUrl(databaseName),
  });
} finally {
  await dropDatabase().catch(() => undefined);
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
  if (result.status !== 0) throw new Error(`E2E_COMMAND_FAILED: ${command} ${args.join(' ')}`);
}

function databaseUrl(database) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function recreateDatabase() {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }
}

async function dropDatabase() {
  const admin = new Pool({ connectionString: adminUrl });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  } finally {
    await admin.end();
  }
}
