import { Buffer } from 'node:buffer';
import { createConnection } from 'node:net';
import process from 'node:process';
import { URL } from 'node:url';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const postgresUrl =
  process.env.SDAR_POSTGRES_URL ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
const redisHost = process.env.SDAR_REDIS_HOST ?? '127.0.0.1';
const redisPort = Number(process.env.SDAR_REDIS_PORT ?? 56379);
const reuseDatabase = process.env.SDAR_SMOKE_REUSE_DATABASE === 'true';
const temporaryDatabase = `sdar_infra_smoke_${String(process.pid)}_${String(Date.now())}`;
const smokePostgresUrl = reuseDatabase ? postgresUrl : withDatabase(postgresUrl, temporaryDatabase);
const adminPostgresUrl = withDatabase(postgresUrl, 'postgres');

startInfrastructure();
const admin = reuseDatabase ? undefined : new Pool({ connectionString: adminPostgresUrl });
const pool = new Pool({ connectionString: smokePostgresUrl });
try {
  if (admin !== undefined) {
    await admin.query(`CREATE DATABASE ${quotedIdentifier(temporaryDatabase)}`);
    const { applyRuntimeMigrations } = await import(
      new URL('../dist/apps/server/src/runtime.js', import.meta.url).href
    );
    await applyRuntimeMigrations(pool);
  }
  const extension = await pool.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  const postgresVersion = extension.rows[0]?.extversion;
  if (typeof postgresVersion !== 'string' || !/^0\.8\./u.test(postgresVersion)) {
    throw new Error(`INFRA_SMOKE_VECTOR_VERSION_INVALID: ${String(postgresVersion)}`);
  }

  const migrationResult = await pool.query(
    "SELECT version FROM schema_migration WHERE version = 'v1.2.2_clean_slate_baseline'",
  );
  const migration = migrationResult.rows[0]?.version;
  if (migration !== 'v1.2.2_clean_slate_baseline') {
    throw new Error(`INFRA_SMOKE_MIGRATION_MISSING: ${String(migration)}`);
  }

  const distanceResult = await pool.query(
    "SELECT '[1,0,0]'::vector(3) <-> '[0,1,0]'::vector(3) AS distance",
  );
  const distance = Number(distanceResult.rows[0]?.distance);
  if (!Number.isFinite(distance) || Math.abs(distance - Math.SQRT2) > 1e-12) {
    throw new Error(`INFRA_SMOKE_VECTOR_DISTANCE_INVALID: ${String(distance)}`);
  }

  const redisPong = await redisCommand(['PING']);
  if (redisPong !== 'PONG') throw new Error(`INFRA_SMOKE_REDIS_PING_FAILED: ${redisPong}`);

  await redisCommand(['SET', 'sdar:smoke:queue-persistence', 'queued']);
  const redisValue = await redisCommand(['GET', 'sdar:smoke:queue-persistence']);
  if (redisValue !== 'queued') {
    throw new Error(`INFRA_SMOKE_REDIS_VALUE_INVALID: ${redisValue}`);
  }

  process.stdout.write(
    `Infrastructure smoke passed: pgvector ${postgresVersion}, migration ${migration}, Redis ${redisPong}.\n`,
  );
} finally {
  await pool.end();
  if (admin !== undefined) {
    await admin
      .query(`DROP DATABASE IF EXISTS ${quotedIdentifier(temporaryDatabase)}`)
      .finally(() => admin.end());
  }
  stopInfrastructure();
}

function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function quotedIdentifier(value) {
  if (!/^[a-z0-9_]+$/u.test(value)) throw new Error('INFRA_SMOKE_DATABASE_NAME_INVALID');
  return `"${value}"`;
}

function redisCommand(parts) {
  return new Promise((resolve, reject) => {
    const request = `*${String(parts.length)}\r\n${parts
      .map((part) => `$${String(Buffer.byteLength(part))}\r\n${part}\r\n`)
      .join('')}`;
    const socket = createConnection({ host: redisHost, port: redisPort });
    let response = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5_000);
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('INFRA_SMOKE_REDIS_TIMEOUT'));
    });
    socket.once('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      response += chunk;
      const parsed = parseRedisResponse(response);
      if (parsed === undefined) return;
      socket.end();
      resolve(parsed);
    });
  });
}

function parseRedisResponse(response) {
  if (response.startsWith('-')) {
    const end = response.indexOf('\r\n');
    if (end < 0) return undefined;
    throw new Error(`INFRA_SMOKE_REDIS_ERROR: ${response.slice(1, end)}`);
  }
  if (response.startsWith('+') || response.startsWith(':')) {
    const end = response.indexOf('\r\n');
    return end < 0 ? undefined : response.slice(1, end);
  }
  if (!response.startsWith('$')) return undefined;
  const headerEnd = response.indexOf('\r\n');
  if (headerEnd < 0) return undefined;
  const length = Number(response.slice(1, headerEnd));
  if (length === -1) return '';
  const bodyStart = headerEnd + 2;
  return Buffer.byteLength(response.slice(bodyStart)) < length + 2
    ? undefined
    : response.slice(bodyStart, bodyStart + length);
}
