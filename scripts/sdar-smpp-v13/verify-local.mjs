import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import process from 'node:process';

// Separate disposable services; never load .env, inherit GOWM credentials, or reuse a running site.
const project = `sdar-verify-smpp-v13-${randomUUID()}`;
const postgresPort = await freePort();
const redisPort = await freePort();
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  SDAR_VERIFY_ISOLATED: 'true',
  SDAR_VERIFY_COMPOSE_PROJECT: project,
  SDAR_POSTGRES_PORT: String(postgresPort),
  SDAR_REDIS_PORT: String(redisPort),
  SDAR_REDIS_HOST: '127.0.0.1',
  SDAR_POSTGRES_URL: `postgresql://sdar:sdar_local_only@127.0.0.1:${String(postgresPort)}/sdar`,
  SDAR_TEST_POSTGRES_URL: `postgresql://sdar:sdar_local_only@127.0.0.1:${String(postgresPort)}/sdar`,
};
process.stdout.write(
  `${JSON.stringify({ scope: 'isolated_loopback', project, postgresPort, redisPort, site: 'NOT_RUN' })}\n`,
);
let result;
try {
  result = spawnSync(
    process.execPath,
    [
      process.argv[2] === '--e2e' ? 'scripts/test-e2e.mjs' : 'scripts/test-integration.mjs',
      ...process.argv.slice(process.argv[2] === '--e2e' ? 3 : 2),
    ],
    {
      env: environment,
      stdio: 'inherit',
      timeout: 600_000,
    },
  );
} finally {
  const cleanup = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      project,
      '-f',
      'compose.yaml',
      'down',
      '--volumes',
      '--remove-orphans',
    ],
    { env: environment, stdio: 'inherit', timeout: 60_000 },
  );
  process.stdout.write(
    `${JSON.stringify({ project, cleanupExitCode: cleanup.status, signal: cleanup.signal })}\n`,
  );
  if (cleanup.status !== 0) process.exitCode = 1;
}
if (result?.error !== undefined) throw result.error;
if (result?.status !== 0) process.exitCode = 1;

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('LOCAL_PORT_ALLOCATION_FAILED');
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return address.port;
}
