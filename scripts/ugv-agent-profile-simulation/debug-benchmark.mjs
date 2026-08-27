#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { parseEnv } from 'node:util';
import {
  debugStateRoot,
  privateDirectory,
  privateFile,
  choosePublicHost,
} from './debug-profile.mjs';

async function readPrivate(path) {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error('UGV_DEBUG_BENCHMARK_PRIVATE_FILE_INVALID');
  return (await readFile(path, 'utf8')).trim();
}
async function secret(path) {
  try {
    await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const value = await readPrivate(path);
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('UGV_DEBUG_BENCHMARK_SECRET_INVALID');
  return value;
}
export async function configureBenchmark({ stateRoot = debugStateRoot, publicHost } = {}) {
  const directory = join(stateRoot, 'benchmark');
  await privateDirectory(directory);
  const telemetry = join(stateRoot, 'sdar-telemetry');
  const warehouse = parseEnv(await readPrivate(join(telemetry, 'compose.env')));
  if (warehouse.CLICKHOUSE_URL !== 'http://192.168.1.7:8123')
    throw new Error('UGV_DEBUG_WAREHOUSE_ENDPOINT_INVALID');
  const producers = JSON.parse(await readPrivate(join(telemetry, 'producers.json')));
  const postgres = await secret(join(directory, 'postgres-password'));
  const reader = await secret(join(directory, 'reader-password'));
  const projector = await secret(join(directory, 'projector-password'));
  const scope = {
    tenantId: producers.tenantId,
    projectId: producers.projectId,
    environment: 'integration',
    exportId: 'ugv-debug-incremental-evidence',
    sourceId: 'ugv-debug-sdar',
    nodeId: 'ugv-debug-sdar',
  };
  const common = {
    BENCHMARK_POSTGRES_URL: `postgresql://benchmark:${postgres}@postgres:5432/benchmark`,
    BENCHMARK_EXECUTION_MODE: 'passive',
    BENCHMARK_ARTIFACT_ROOT: '/var/lib/benchmark/artifacts',
    API_HOST: '0.0.0.0',
    API_PORT: '18090',
    CLICKHOUSE_PROTOCOL: 'http',
    CLICKHOUSE_HOST: '192.168.1.7',
    CLICKHOUSE_PORT: '8123',
    CLICKHOUSE_CONNECT_TIMEOUT_MS: '30000',
    CLICKHOUSE_QUERY_TIMEOUT_MS: '30000',
    CLICKHOUSE_MAX_OPEN_CONNECTIONS: '32',
    TELEMETRY_SOURCE_TENANT_ID: scope.tenantId,
    TELEMETRY_SOURCE_PROJECT_ID: scope.projectId,
    TELEMETRY_SOURCE_ENVIRONMENT: scope.environment,
    EVIDENCE_ORIGIN_ID: 'ugv-debug-canonical-v1',
    EVIDENCE_EXPORT_ID: scope.exportId,
    EVIDENCE_SOURCE_ID: scope.sourceId,
    EVIDENCE_NODE_ID: scope.nodeId,
    TELEMETRY_QUERY_API_BASE_URL: 'http://sdar-telemetry-query:8081',
    UGV_DEBUG_PUBLIC_HOST: publicHost ?? (await choosePublicHost()),
  };
  await privateFile(
    join(directory, 'reader.json'),
    JSON.stringify({
      ...common,
      CLICKHOUSE_USERNAME: 'ugv_debug_benchmark_reader',
      CLICKHOUSE_PASSWORD: reader,
    }),
  );
  await privateFile(
    join(directory, 'projector.json'),
    JSON.stringify({
      ...common,
      CLICKHOUSE_USERNAME: 'ugv_debug_benchmark_projector',
      CLICKHOUSE_PASSWORD: projector,
    }),
  );
  // Deployment-only credential is never mounted into any business role.
  await privateFile(
    join(directory, 'provision.json'),
    JSON.stringify({
      url: warehouse.CLICKHOUSE_URL,
      user: warehouse.CLICKHOUSE_USER,
      password: await readPrivate(join(telemetry, 'warehouse-password')),
      readerPassword: reader,
      projectorPassword: projector,
    }),
  );
  await privateFile(
    join(telemetry, 'provider-closure.json'),
    JSON.stringify({ originId: 'ugv-debug-provider-v2', ...scope }),
  );
  return { status: 'configured', mode: 'passive', apiPort: 18090, historyBackfill: false };
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export { repo as benchmarkDebugHostRepository };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'configure')
      throw new Error('UGV_DEBUG_BENCHMARK_ARGUMENT_INVALID');
    process.stdout.write(JSON.stringify(await configureBenchmark()) + '\n');
  } catch (error) {
    process.stderr.write(
      /^[A-Z0-9_]+$/u.test(error.message) ? `${error.message}\n` : 'UGV_DEBUG_BENCHMARK_FAILED\n',
    );
    process.exitCode = 1;
  }
}
