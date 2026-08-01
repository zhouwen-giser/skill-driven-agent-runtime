import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';

const root = process.cwd();
const runId = `${String(process.pid)}-${Date.now().toString(36)}`;
const composeProject = `sdar-node-control-smoke-${runId}`;
const runtimeComposeProject = `sdar-runtime-after-control-${runId}`;
const postgresPort = await reservePort();
const apiPort = await reservePort();
const runtimePostgresPort = await reservePort();
const runtimeRedisPort = await reservePort();
const token = `p01-smoke-${'a'.repeat(48)}`;
const databaseUrl = `postgresql://sdar_control:sdar_control_local_only@127.0.0.1:${String(postgresPort)}/sdar_control`;
const baseUrl = `http://127.0.0.1:${String(apiPort)}`;
const composeEnvironment = {
  ...process.env,
  SDAR_CONTROL_POSTGRES_PORT: String(postgresPort),
};
let api;

try {
  runDocker(['compose', '-p', composeProject, '-f', 'compose.node-control.yaml', 'build', '--provenance=false', '--sbom=false', 'control-postgres'], 300_000, composeEnvironment);
  runDocker(['compose', '-p', composeProject, '-f', 'compose.node-control.yaml', 'up', '-d', '--wait', 'control-postgres'], 120_000, composeEnvironment);

  const applicationEnvironment = {
    ...process.env,
    SDAR_CONTROL_DATABASE_URL: databaseUrl,
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: String(apiPort),
    SDAR_CONTROL_API_TOKEN: token,
    SDAR_CONTROL_NODE_ID: 'node-control-smoke',
    SDAR_CONTROL_NODE_TYPE: 'sdar-runtime',
    SDAR_CONTROL_NODE_DISPLAY_NAME: 'Node Control Smoke',
    SDAR_CONTROL_ENVIRONMENT: 'smoke',
    SDAR_CONTROL_RUNTIME_ENDPOINT_REF: 'http://127.0.0.1:9998',
    SDAR_CONTROL_PUBLIC_URL: baseUrl,
    SDAR_CONTROL_NODE_EVENTS_URL: `${baseUrl}/api/v1/events`,
    SDAR_CONTROL_A2A_AGENT_CARD_URL: 'http://127.0.0.1:9999/.well-known/agent-card.json',
  };
  api = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'apps/node-control-api/src/main.ts'],
    { cwd: root, env: applicationEnvironment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await waitForReady(api, 'node_control.api.ready', 30_000);
  await expectJson(`${baseUrl}/health/live`, undefined, 200, { status: 'live' });
  await expectJson(`${baseUrl}/health/ready`, undefined, 200, { status: 'ready' });
  await expectJson(`${baseUrl}/.well-known/sdar-node`, undefined, 200, {
    schemaVersion: '1.0',
    nodeId: 'node-control-smoke',
  });
  await expectJson(`${baseUrl}/api/v1/node`, token, 200, { nodeId: 'node-control-smoke' });
  await expectJson(`${baseUrl}/api/v1/audit-events`, token, 200, { totalEstimate: 1 });
  await expectJson(`${baseUrl}/api/v1/node`, undefined, 401, { code: 'AUTHENTICATION_REQUIRED' });

  const worker = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'apps/node-control-worker/src/main.ts'],
    {
      cwd: root,
      env: { ...applicationEnvironment, SDAR_CONTROL_WORKER_ONCE: 'true' },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  if (worker.error !== undefined) throw worker.error;
  if (worker.status !== 0 || !worker.stdout.includes('node_control.worker.ready')) {
    throw new Error(`NODE_CONTROL_WORKER_SMOKE_FAILED: ${worker.stdout}${worker.stderr}`);
  }

  await terminate(api);
  api = undefined;
  await expectUnavailable(`${baseUrl}/health/live`);

  const npmExecPath = process.env['npm_execpath'];
  if (npmExecPath === undefined) throw new Error('NPM_EXECPATH_REQUIRED');
  const runtimeEnvironment = {
    ...process.env,
    COMPOSE_PROJECT_NAME: runtimeComposeProject,
    SDAR_POSTGRES_PORT: String(runtimePostgresPort),
    SDAR_POSTGRES_URL: `postgresql://sdar:sdar_local_only@127.0.0.1:${String(runtimePostgresPort)}/sdar`,
    SDAR_REDIS_PORT: String(runtimeRedisPort),
  };
  const runtimeSmoke = spawnSync(process.execPath, [npmExecPath, 'smoke:server'], {
    cwd: root,
    env: runtimeEnvironment,
    encoding: 'utf8',
    timeout: 300_000,
  });
  process.stdout.write(runtimeSmoke.stdout ?? '');
  process.stderr.write(runtimeSmoke.stderr ?? '');
  if (runtimeSmoke.error !== undefined) throw runtimeSmoke.error;
  if (runtimeSmoke.status !== 0) throw new Error('RUNTIME_AFTER_CONTROL_STOP_SMOKE_FAILED');

  process.stdout.write(
    'Node Control smoke passed: independent PostgreSQL, API, Worker, authenticated projections, shutdown, and Runtime-after-Control-stop.\n',
  );
} finally {
  if (api !== undefined) await terminate(api).catch(() => undefined);
  runDocker(
    [
      'compose',
      '-p',
      runtimeComposeProject,
      '-f',
      'compose.yaml',
      'down',
      '--volumes',
      '--remove-orphans',
    ],
    120_000,
    {
      ...process.env,
      SDAR_POSTGRES_PORT: String(runtimePostgresPort),
      SDAR_REDIS_PORT: String(runtimeRedisPort),
    },
    true,
  );
  runDocker(
    ['compose', '-p', composeProject, '-f', 'compose.node-control.yaml', 'down', '--volumes', '--remove-orphans'],
    120_000,
    composeEnvironment,
    true,
  );
}

function runDocker(args, timeout, environment, ignoreFailure = false) {
  const result = spawnSync('docker', args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    timeout,
  });
  if (result.error !== undefined && !ignoreFailure) throw result.error;
  if (result.status !== 0 && !ignoreFailure)
    throw new Error(`NODE_CONTROL_DOCKER_FAILED: docker ${args.join(' ')}`);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('NODE_CONTROL_SMOKE_PORT_INVALID'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error === undefined) resolve(port);
        else reject(error);
      });
    });
  });
}

function waitForReady(child, marker, timeoutMs) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = globalThis.setTimeout(
      () => finish(new Error(`NODE_CONTROL_READY_TIMEOUT: ${output}`)),
      timeoutMs,
    );
    const finish = (error) => {
      globalThis.clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      error === undefined ? resolve() : reject(error);
    };
    const onData = (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-16_384);
      if (output.includes(marker)) finish();
    };
    const onExit = (code) => finish(new Error(`NODE_CONTROL_EXITED_BEFORE_READY: ${String(code)} ${output}`));
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

async function expectJson(url, bearerToken, status, expected) {
  const response = await globalThis.fetch(url, {
    ...(bearerToken === undefined ? {} : { headers: { authorization: `Bearer ${bearerToken}` } }),
  });
  const body = await response.json();
  if (response.status !== status || !matches(body, expected)) {
    throw new Error(`NODE_CONTROL_HTTP_SMOKE_FAILED: ${url} ${String(response.status)} ${JSON.stringify(body)}`);
  }
}

function matches(value, expected) {
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

async function expectUnavailable(url) {
  try {
    await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error('NODE_CONTROL_API_STILL_REACHABLE_AFTER_STOP');
}

function terminate(child) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = globalThis.setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('NODE_CONTROL_PROCESS_STOP_TIMEOUT'));
    }, 10_000);
    child.once('exit', () => {
      globalThis.clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
