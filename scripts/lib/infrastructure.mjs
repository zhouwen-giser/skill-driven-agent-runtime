import { spawnSync } from 'node:child_process';
import process from 'node:process';

loadLocalEnvironment();

export const reuseExistingInfrastructure = process.env.SDAR_REUSE_EXISTING_INFRA === 'true';

export function startInfrastructure(root = process.cwd()) {
  if (reuseExistingInfrastructure) {
    process.stdout.write(
      'Reusing operator-managed PostgreSQL and Redis; Docker lifecycle commands are disabled.\n',
    );
    return;
  }
  buildInfrastructureImages(root);
  runDocker(
    [
      'compose',
      '-f',
      'compose.yaml',
      'up',
      '-d',
      '--wait',
      '--force-recreate',
      'postgres',
      'redis',
    ],
    180_000,
    root,
  );
  waitForStablePostgres(root);
}

export function buildInfrastructureImages(root = process.cwd()) {
  if (reuseExistingInfrastructure) return;
  runDocker(
    [
      'compose',
      '--project-name',
      'sdar',
      '-f',
      'compose.yaml',
      'build',
      '--provenance=false',
      '--sbom=false',
      'postgres',
    ],
    300_000,
    root,
  );
}

export function stopInfrastructure(root = process.cwd()) {
  if (reuseExistingInfrastructure) return;
  runDocker(['compose', '-f', 'compose.yaml', 'stop', 'postgres', 'redis'], 60_000, root, true);
}

export function validateComposeWithDocker(root = process.cwd()) {
  if (reuseExistingInfrastructure) {
    process.stdout.write(
      'Compose daemon/config validation deferred in operator-managed infrastructure mode; static Compose policy validation passed.\n',
    );
    return;
  }
  runDocker(['compose', '-f', 'compose.yaml', 'config', '--quiet'], 60_000, root);
}

function waitForStablePostgres(root) {
  const deadline = Date.now() + 60_000;
  let lastDiagnostics = {
    initializationMarker: false,
    finalReady: false,
    containerProbe: false,
    hostPostgres: false,
    hostRedis: false,
  };
  while (Date.now() < deadline) {
    const logs = runDockerCaptured(
      ['compose', '-f', 'compose.yaml', 'logs', '--no-color', 'postgres'],
      30_000,
      root,
    );
    const initializationMarker = Math.max(
      logs.lastIndexOf('PostgreSQL init process complete; ready for start up.'),
      logs.lastIndexOf('Skipping initialization'),
    );
    const finalReady =
      initializationMarker < 0
        ? -1
        : logs.indexOf('database system is ready to accept connections', initializationMarker);
    if (finalReady > initializationMarker) {
      const probe = spawnSync(
        'docker',
        [
          'compose',
          '-f',
          'compose.yaml',
          'exec',
          '-T',
          'postgres',
          'sh',
          '-ec',
          'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --tuples-only --no-align --command "SELECT 1"',
        ],
        {
          cwd: root,
          env: process.env,
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      lastDiagnostics = {
        initializationMarker: true,
        finalReady: true,
        containerProbe: probe.status === 0 && probe.stdout.trim() === '1',
        hostPostgres: hostPostgresIsReady(root),
        hostRedis: hostRedisIsReady(root),
      };
      if (
        lastDiagnostics.containerProbe &&
        lastDiagnostics.hostPostgres &&
        lastDiagnostics.hostRedis
      )
        return;
    } else {
      lastDiagnostics = {
        ...lastDiagnostics,
        initializationMarker: initializationMarker >= 0,
        finalReady: finalReady > initializationMarker,
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  throw new Error(`INFRASTRUCTURE_POSTGRES_NOT_STABLY_READY:${JSON.stringify(lastDiagnostics)}`);
}

function hostPostgresIsReady(root) {
  const readyUrl =
    process.env.SDAR_TEST_POSTGRES_URL ??
    process.env.SDAR_POSTGRES_URL ??
    'postgresql://sdar:sdar_local_only@127.0.0.1:55432/sdar';
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "import pg from 'pg';",
        'const pool = new pg.Pool({',
        '  connectionString: process.env.SDAR_INFRA_READY_URL,',
        '  connectionTimeoutMillis: 1_000,',
        '});',
        'let ready = false;',
        'try {',
        "  const result = await pool.query('SELECT 1::integer AS ready');",
        '  ready = result.rows[0]?.ready === 1;',
        '} catch {}',
        'await pool.end().catch(() => undefined);',
        'if (!ready) process.exitCode = 1;',
      ].join('\n'),
    ],
    {
      cwd: root,
      env: { ...process.env, SDAR_INFRA_READY_URL: readyUrl },
      stdio: 'ignore',
      timeout: 5_000,
    },
  );
  return probe.status === 0;
}

function hostRedisIsReady(root) {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "import net from 'node:net';",
        'const port = Number(process.env.SDAR_INFRA_REDIS_PORT);',
        'let ready = false;',
        'await new Promise((resolve) => {',
        "  const socket = net.createConnection({ host: '127.0.0.1', port }, () => {",
        "    socket.write('*1\\r\\n$4\\r\\nPING\\r\\n');",
        '  });',
        '  socket.setTimeout(1_000);',
        "  socket.on('data', (data) => {",
        "    ready = data.toString('utf8').startsWith('+PONG');",
        '    socket.end();',
        '  });',
        "  socket.once('close', resolve);",
        "  socket.once('error', resolve);",
        "  socket.once('timeout', () => socket.destroy());",
        '});',
        'if (!ready) process.exitCode = 1;',
      ].join('\n'),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        SDAR_INFRA_REDIS_PORT: process.env.SDAR_REDIS_PORT ?? '56379',
      },
      stdio: 'ignore',
      timeout: 5_000,
    },
  );
  return probe.status === 0;
}

function runDocker(args, timeout, root, ignoreFailure = false) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined && !ignoreFailure) throw result.error;
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(`INFRASTRUCTURE_COMMAND_FAILED: docker ${args.join(' ')}`);
  }
}

function runDockerCaptured(args, timeout, root) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`INFRASTRUCTURE_COMMAND_FAILED: docker ${args.join(' ')}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function loadLocalEnvironment() {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') throw error;
  }
}

function isNodeError(error) {
  return error instanceof Error && 'code' in error;
}
