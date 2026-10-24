import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { verificationProjects } from './verification-projects.mjs';
import { withVerificationNetwork } from './verification-network.mjs';

const file = 'compose.verification-performance.yaml';

/** Real, owned PostgreSQL/Redis for the unchanged relative performance test. */
export async function startIsolatedPerformanceInfrastructure() {
  if (process.env.SDAR_VERIFY_ISOLATED !== 'true')
    throw new Error('PERFORMANCE_INFRASTRUCTURE_ISOLATION_REQUIRED');
  const runId = process.env.SDAR_VERIFY_COMPOSE_PROJECT;
  const project = verificationProjects(runId).find((entry) => entry.file === file);
  if (project === undefined) throw new Error('PERFORMANCE_INFRASTRUCTURE_PROJECT_REQUIRED');
  const [postgresPort, redisPort] = await availablePorts();
  const temporary = await mkdtemp(join(tmpdir(), `${project.name}-`));
  const emptyEnvironment = join(temporary, 'empty.env');
  await writeFile(emptyEnvironment, '');
  const environment = {
    ...process.env,
    SDAR_POSTGRES_PORT: String(postgresPort),
    SDAR_POSTGRES_DB: 'sdar',
    SDAR_POSTGRES_USER: 'sdar',
    SDAR_POSTGRES_PASSWORD: 'sdar_local_only',
    SDAR_REDIS_PORT: String(redisPort),
  };
  const record = {
    project: project.name,
    composeFile: file,
    scope: 'owned_loopback_performance_fixture',
    postgresStorage: 'tmpfs_2_GiB',
    durabilityVerification: 'separate persistent-volume migration/integration/functional gates',
    postgresPort,
    redisPort,
    testLogicChanged: false,
    thresholdsChanged: false,
    commands: [],
    containers: [],
  };
  const command = (args) => {
    const argv = withVerificationNetwork(
      [
        'compose',
        '--env-file',
        emptyEnvironment,
        '--project-name',
        project.name,
        '-f',
        file,
        ...args,
      ],
      environment,
    );
    const result = spawnSync('docker', argv, {
      env: environment,
      encoding: 'utf8',
      timeout: 180_000,
    });
    record.commands.push({ args: ['docker', ...argv], exitCode: result.status });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0)
      throw new Error(`PERFORMANCE_INFRASTRUCTURE_COMMAND_FAILED:${args[0]}`, {
        cause: result.error,
      });
    return result.stdout;
  };
  const save = async () => {
    await mkdir('reports/verification', { recursive: true });
    await writeFile(
      'reports/verification/performance-fixture.json',
      JSON.stringify(record, null, 2) + '\n',
    );
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      command(['down', '--volumes', '--remove-orphans']);
      record.cleanupExitCode = 0;
    } catch (error) {
      record.cleanupExitCode = 1;
      throw error;
    } finally {
      await save();
      await rm(temporary, { recursive: true, force: true });
    }
  };
  try {
    const config = command(['config']);
    record.resolvedComposeSha256 = createHash('sha256').update(config).digest('hex');
    command(['up', '-d', '--wait', 'postgres', 'redis']);
    for (const service of ['postgres', 'redis']) {
      const id = command(['ps', '-q', service]).trim();
      assert.match(id, /^[a-f0-9]{12,64}$/u);
      const inspected = spawnSync('docker', ['inspect', id], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(inspected.status, 0);
      const item = JSON.parse(inspected.stdout)[0];
      assert.equal(item.Config.Labels['com.docker.compose.project'], project.name);
      if (service === 'postgres')
        assert.ok(
          item.Mounts.some(
            (mount) => mount.Type === 'tmpfs' && mount.Destination === '/var/lib/postgresql/data',
          ),
        );
      record.containers.push({ service, id, imageId: item.Image, ownershipChecked: true });
    }
    const postgresUrl = `postgresql://sdar:sdar_local_only@127.0.0.1:${postgresPort}/sdar`;
    const probe = new pg.Pool({ connectionString: postgresUrl, connectionTimeoutMillis: 1000 });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          record.postgresVersion = (
            await probe.query('SELECT version() AS version')
          ).rows[0].version;
          break;
        } catch (error) {
          if (attempt >= 60) throw error;
          await delay(1000);
        }
      }
    } finally {
      await probe.end();
    }
    await save();
    return {
      postgresUrl,
      redisPort,
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'PERFORMANCE_INFRASTRUCTURE_START_AND_CLEANUP_FAILED',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

async function availablePorts() {
  const servers = [net.createServer(), net.createServer()];
  try {
    return await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
              const address = server.address();
              if (address === null || typeof address === 'string')
                reject(new Error('PERFORMANCE_PORT_UNAVAILABLE'));
              else resolve(address.port);
            });
          }),
      ),
    );
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}
