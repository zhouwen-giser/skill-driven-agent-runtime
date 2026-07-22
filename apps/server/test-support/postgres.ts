import { readFile } from 'node:fs/promises';

import { Pool } from 'pg';

export function isolatedDatabaseUrl(adminConnection: string, databaseName: string): string {
  const url = new URL(adminConnection);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export async function createIsolatedRuntimeDatabase(
  adminConnection: string,
  databaseName: string,
): Promise<string> {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
  const databaseConnection = isolatedDatabaseUrl(adminConnection, databaseName);
  const database = new Pool({ connectionString: databaseConnection });
  try {
    const bootstrap = await readFile(
      new URL('../../../infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql', import.meta.url),
      'utf8',
    );
    await database.query(bootstrap);
    const seed = await readFile(
      new URL('../../../infra/postgres/seed/0001_sdar_v1_2_2_minimal_seed.sql', import.meta.url),
      'utf8',
    );
    await database.query(seed);
  } finally {
    await database.end();
  }
  return databaseConnection;
}

export async function dropIsolatedRuntimeDatabase(
  adminConnection: string,
  databaseName: string,
): Promise<void> {
  const admin = new Pool({ connectionString: adminConnection });
  try {
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) throw new Error('TEST_DATABASE_NAME_INVALID');
  return `"${value}"`;
}
