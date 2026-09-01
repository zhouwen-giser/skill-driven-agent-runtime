import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Pool, PoolClient } from 'pg';

export interface ControlMigrationRecord {
  readonly version: string;
  readonly checksum: string;
}

export class ControlMigrationError extends Error {
  readonly code:
    | 'CONTROL_MIGRATION_CHECKSUM_DRIFT'
    | 'CONTROL_MIGRATION_GAP'
    | 'CONTROL_MIGRATION_ROGUE_LEDGER'
    | 'CONTROL_MIGRATION_DOWN_MISSING';

  constructor(code: ControlMigrationError['code'], message: string) {
    super(message);
    this.name = 'ControlMigrationError';
    this.code = code;
  }
}

export function resolveDefaultControlMigrationRoot(workingDirectory = process.cwd()): string {
  return resolve(workingDirectory, 'infra', 'postgres-control', 'migrations');
}

export async function applyControlMigrations(
  pool: Pool,
  migrationRoot = resolveDefaultControlMigrationRoot(),
): Promise<readonly ControlMigrationRecord[]> {
  const migrations = await loadMigrations(migrationRoot);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_control_migrations'))");
    await ensureLedger(client);
    const applied = await readLedger(client);
    assertLedger(applied, migrations);
    for (const migration of migrations.slice(applied.length)) {
      await client.query(migration.upSql);
      await client.query(
        `INSERT INTO sdar_control.control_schema_migration (version, checksum)
         VALUES ($1, $2)`,
        [migration.version, migration.checksum],
      );
    }
    await client.query('COMMIT');
    return migrations.map(({ version, checksum }) => ({ version, checksum }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackLatestControlMigration(
  pool: Pool,
  migrationRoot = resolveDefaultControlMigrationRoot(),
): Promise<string | undefined> {
  const migrations = await loadMigrations(migrationRoot);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sdar_control_migrations'))");
    await ensureLedger(client);
    const applied = await readLedger(client);
    assertLedger(applied, migrations);
    const latest = migrations[applied.length - 1];
    if (latest === undefined) {
      await client.query('COMMIT');
      return undefined;
    }
    if (latest.downSql === undefined) {
      throw new ControlMigrationError(
        'CONTROL_MIGRATION_DOWN_MISSING',
        `Down migration is missing for ${latest.version}.`,
      );
    }
    await client.query(latest.downSql);
    await client.query('DELETE FROM sdar_control.control_schema_migration WHERE version=$1', [
      latest.version,
    ]);
    await client.query('COMMIT');
    return latest.version;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS sdar_control');
  await client.query(`
    CREATE TABLE IF NOT EXISTS sdar_control.control_schema_migration (
      version text PRIMARY KEY,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `);
}

async function readLedger(client: PoolClient): Promise<readonly ControlMigrationRecord[]> {
  const result = await client.query<ControlMigrationRecord>(
    `SELECT version, checksum::text AS checksum
       FROM sdar_control.control_schema_migration
      ORDER BY version`,
  );
  return result.rows;
}

interface LoadedMigration extends ControlMigrationRecord {
  readonly upSql: string;
  readonly downSql?: string;
}

async function loadMigrations(root: string): Promise<readonly LoadedMigration[]> {
  const names = (await readdir(root))
    .filter((name) => name.endsWith('.up.sql'))
    .sort((left, right) => left.localeCompare(right));
  const result: LoadedMigration[] = [];
  for (const name of names) {
    const version = name.slice(0, -'.up.sql'.length);
    const upSql = await readFile(resolve(root, name), 'utf8');
    const downSql = await readOptional(resolve(root, `${version}.down.sql`));
    result.push({
      version,
      checksum: createHash('sha256').update(upSql).digest('hex'),
      upSql,
      ...(downSql === undefined ? {} : { downSql }),
    });
  }
  return result;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function assertLedger(
  applied: readonly ControlMigrationRecord[],
  known: readonly LoadedMigration[],
): void {
  for (const [index, row] of applied.entries()) {
    const expected = known[index];
    if (expected === undefined) {
      throw new ControlMigrationError(
        'CONTROL_MIGRATION_ROGUE_LEDGER',
        `Unknown applied Control migration ${row.version}.`,
      );
    }
    if (row.version !== expected.version) {
      const knownVersion = known.find((candidate) => candidate.version === row.version);
      throw new ControlMigrationError(
        knownVersion === undefined ? 'CONTROL_MIGRATION_ROGUE_LEDGER' : 'CONTROL_MIGRATION_GAP',
        `Control migration ledger expected ${expected.version} but found ${row.version}.`,
      );
    }
    if (row.checksum !== expected.checksum) {
      throw new ControlMigrationError(
        'CONTROL_MIGRATION_CHECKSUM_DRIFT',
        `Checksum drift detected for Control migration ${row.version}.`,
      );
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
