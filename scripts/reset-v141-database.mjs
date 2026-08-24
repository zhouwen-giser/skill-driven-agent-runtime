import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

const { Pool } = pg;
const environment = process.env.SDAR_ENV;
const confirmation = process.env.SDAR_ALLOW_DESTRUCTIVE_RESET;
const connectionString = process.env.SDAR_POSTGRES_URL;

if (environment !== 'development' && environment !== 'test')
  throw new Error('V141_RESET_ENVIRONMENT_REJECTED');
if (confirmation !== 'v1.4.1') throw new Error('V141_RESET_CONFIRMATION_REQUIRED');
if (connectionString === undefined) throw new Error('V141_RESET_DATABASE_URL_REQUIRED');

const url = new URL(connectionString);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!/^(sdar_dev_|sdar_test_|sdar_v141_)[a-z0-9_]+$/u.test(databaseName))
  throw new Error('V141_RESET_DATABASE_NAME_REJECTED');

const root = process.cwd();
const baseline = await readFile(
  resolve(root, 'infra', 'postgres', 'baseline', '0001_sdar_v1_2_2_baseline.sql'),
  'utf8',
);
const seedDirectory = resolve(root, 'infra', 'postgres', 'seed');
const seeds = await Promise.all(
  (await readdir(seedDirectory))
    .filter((file) => /^[0-9]{4}_[a-z0-9_]+\.sql$/u.test(file))
    .sort()
    .map((file) => readFile(resolve(seedDirectory, file), 'utf8')),
);
const migrationDirectory = resolve(root, 'infra', 'postgres', 'migrations');
const migrations = await Promise.all(
  (await readdir(migrationDirectory))
    .filter((file) =>
      /^(?:01[0-9]{2}_v(?:123|13|14)_[a-z0-9_]+|0173_remote_task_accepted_substate)\.up\.sql$/u.test(
        file,
      ),
    )
    .sort()
    .map((file) => readFile(resolve(migrationDirectory, file), 'utf8')),
);

const pool = new Pool({ connectionString });
try {
  const identity = await pool.query(
    'SELECT current_database() AS database_name, pg_is_in_recovery() AS recovery',
  );
  if (identity.rows[0]?.database_name !== databaseName || identity.rows[0]?.recovery !== false)
    throw new Error('V141_RESET_DATABASE_IDENTITY_REJECTED');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await pool.query(baseline);
  for (const seed of seeds) await pool.query(seed);
  for (const migration of migrations) await pool.query(migration);
  process.stdout.write(
    `SDAR v1.4.1 canonical Evidence reset complete for ${databaseName}; applied ${String(migrations.length)} post-baseline migrations.\n`,
  );
} finally {
  await pool.end();
}
