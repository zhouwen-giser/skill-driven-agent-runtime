import { spawnSync } from 'node:child_process';
import process from 'node:process';

const composeArgs = ['compose', '-f', 'compose.yaml'];
const startedServices = ['postgres', 'redis'];

try {
  runDocker([...composeArgs, 'up', '-d', '--wait', ...startedServices], 180_000);

  const postgresVersion = runDocker([
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    process.env.SDAR_POSTGRES_USER ?? 'sdar',
    '-d',
    process.env.SDAR_POSTGRES_DB ?? 'sdar',
    '-Atc',
    "SELECT extversion FROM pg_extension WHERE extname = 'vector';",
  ]).trim();
  if (!/^0\.8\./u.test(postgresVersion)) {
    throw new Error(`INFRA_SMOKE_VECTOR_VERSION_INVALID: ${postgresVersion}`);
  }

  const migration = runDocker([
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    process.env.SDAR_POSTGRES_USER ?? 'sdar',
    '-d',
    process.env.SDAR_POSTGRES_DB ?? 'sdar',
    '-Atc',
    "SELECT version FROM schema_migration WHERE version = '0001_sdar_bootstrap';",
  ]).trim();
  if (migration !== '0001_sdar_bootstrap') {
    throw new Error(`INFRA_SMOKE_MIGRATION_MISSING: ${migration}`);
  }

  const distance = runDocker([
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    process.env.SDAR_POSTGRES_USER ?? 'sdar',
    '-d',
    process.env.SDAR_POSTGRES_DB ?? 'sdar',
    '-Atc',
    "SELECT '[1,0,0]'::vector(3) <-> '[0,1,0]'::vector(3);",
  ]).trim();
  if (distance !== '1.4142135623730951') {
    throw new Error(`INFRA_SMOKE_VECTOR_DISTANCE_INVALID: ${distance}`);
  }

  const redisPong = runDocker([
    ...composeArgs,
    'exec',
    '-T',
    'redis',
    'redis-cli',
    'PING',
  ]).trim();
  if (redisPong !== 'PONG') throw new Error(`INFRA_SMOKE_REDIS_PING_FAILED: ${redisPong}`);

  runDocker([
    ...composeArgs,
    'exec',
    '-T',
    'redis',
    'redis-cli',
    'SET',
    'sdar:smoke:queue-persistence',
    'queued',
  ]);
  const redisValue = runDocker([
    ...composeArgs,
    'exec',
    '-T',
    'redis',
    'redis-cli',
    'GET',
    'sdar:smoke:queue-persistence',
  ]).trim();
  if (redisValue !== 'queued') {
    throw new Error(`INFRA_SMOKE_REDIS_VALUE_INVALID: ${redisValue}`);
  }

  process.stdout.write(
    `Infrastructure smoke passed: pgvector ${postgresVersion}, migration ${migration}, Redis ${redisPong}.\n`,
  );
} finally {
  runDocker([...composeArgs, 'stop', ...startedServices], 60_000, true);
}

function runDocker(args, timeout = 60_000, ignoreFailure = false) {
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout,
    env: process.env,
  });
  if (result.error !== undefined) {
    if (ignoreFailure) return '';
    throw new Error(`INFRA_SMOKE_DOCKER_UNAVAILABLE: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (ignoreFailure) return result.stdout ?? '';
    throw new Error(
      `INFRA_SMOKE_COMMAND_FAILED: docker ${args.join(' ')}\n${result.stderr ?? ''}`,
    );
  }
  return result.stdout ?? '';
}
