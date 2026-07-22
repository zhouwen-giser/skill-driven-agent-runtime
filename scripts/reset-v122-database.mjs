import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

const { Pool } = pg;
const environment = process.env.SDAR_ENV;
const confirmation = process.env.SDAR_ALLOW_DESTRUCTIVE_RESET;
const connectionString = process.env.SDAR_POSTGRES_URL;

if (environment !== 'development' && environment !== 'test')
  throw new Error('V122_RESET_ENVIRONMENT_REJECTED');
if (confirmation !== 'v1.2.2') throw new Error('V122_RESET_CONFIRMATION_REQUIRED');
if (connectionString === undefined) throw new Error('V122_RESET_DATABASE_URL_REQUIRED');

const url = new URL(connectionString);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!/^(sdar_dev_|sdar_test_|sdar_v122_)[a-z0-9_]+$/u.test(databaseName))
  throw new Error('V122_RESET_DATABASE_NAME_REJECTED');

const baseline = await readFile(
  new URL('../infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql', import.meta.url),
  'utf8',
);
const seed = await readFile(
  new URL('../infra/postgres/seed/0001_sdar_v1_2_2_minimal_seed.sql', import.meta.url),
  'utf8',
);
const pool = new Pool({ connectionString });
try {
  const identity = await pool.query(
    'SELECT current_database() AS database_name, pg_is_in_recovery() AS recovery',
  );
  if (identity.rows[0]?.database_name !== databaseName || identity.rows[0]?.recovery !== false)
    throw new Error('V122_RESET_DATABASE_IDENTITY_REJECTED');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await pool.query(baseline);
  await pool.query(seed);
  process.stdout.write(`SDAR v1.2.2 reset and seed complete for ${databaseName}.\n`);
} finally {
  await pool.end();
}
