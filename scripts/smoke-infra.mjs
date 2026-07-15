import { Buffer } from 'node:buffer';
import { createConnection } from 'node:net';
import process from 'node:process';

import pg from 'pg';

import { startInfrastructure, stopInfrastructure } from './lib/infrastructure.mjs';

const { Pool } = pg;
const postgresUrl =
  process.env.SDAR_POSTGRES_URL ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:54329/sdar';
const redisHost = process.env.SDAR_REDIS_HOST ?? '127.0.0.1';
const redisPort = Number(process.env.SDAR_REDIS_PORT ?? 56379);

startInfrastructure();
const pool = new Pool({ connectionString: postgresUrl });
try {
  const extension = await pool.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  const postgresVersion = extension.rows[0]?.extversion;
  if (typeof postgresVersion !== 'string' || !/^0\.8\./u.test(postgresVersion)) {
    throw new Error(`INFRA_SMOKE_VECTOR_VERSION_INVALID: ${String(postgresVersion)}`);
  }

  const migrationResult = await pool.query(
    "SELECT version FROM schema_migration WHERE version = '0001_sdar_bootstrap'",
  );
  const migration = migrationResult.rows[0]?.version;
  if (migration !== '0001_sdar_bootstrap') {
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
  stopInfrastructure();
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
