#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { access, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const debugStateRoot = `/tmp/sdar-uap-p3-b01-${String(process.getuid?.() ?? 0)}/debug`;
export const debugPorts = Object.freeze({
  a2a: 10999,
  management: 10998,
  control: 10091,
  mcp: 19131,
  pms: 18092,
  adapter: 17031,
  otlpGrpc: 4317,
  otlpHttp: 4318,
  query: 8088,
  processor: 8443,
  collectorHealth: 13133,
  collectorMetrics: 8888,
  metrics: 9464,
  evidenceGateway: 8080,
  unifiedQuery: 8081,
  telemetryAdmin: 8082,
  domainWorker: 8083,
  benchmark: 18090,
});

export function validatePublicHost(value) {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/u.test(value) ||
    ['0.0.0.0', 'localhost'].includes(value) ||
    value.startsWith('127.')
  )
    throw new Error('UGV_DEBUG_PUBLIC_HOST_INVALID');
  return value;
}

export async function choosePublicHost(
  override = process.env.UGV_DEBUG_PUBLIC_HOST,
  interfaces,
  physical = async (name) => {
    try {
      await access(`/sys/class/net/${name}/device`);
      return true;
    } catch {
      return false;
    }
  },
) {
  if (override !== undefined && override !== '') return validatePublicHost(override);
  const availableInterfaces = interfaces ?? networkInterfaces();
  for (const name of Object.keys(availableInterfaces).sort()) {
    if (!(await physical(name))) continue;
    for (const address of availableInterfaces[name] ?? [])
      if (address.family === 'IPv4' && !address.internal)
        return validatePublicHost(address.address);
  }
  throw new Error('UGV_DEBUG_PUBLIC_HOST_REQUIRED');
}

export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('UGV_DEBUG_STATE_INVALID');
}

export async function privateFile(path, contents) {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      throw new Error('UGV_DEBUG_CONFIG_INVALID');
    if ((await readFile(path, 'utf8')) === contents) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export async function configureDebugProfile({
  stateRoot = debugStateRoot,
  telemetryRoot = resolve(repositoryRoot, '../smpp-telemetry-platform'),
  publicHost,
} = {}) {
  const host = validatePublicHost(publicHost ?? (await choosePublicHost()));
  await privateDirectory(stateRoot);
  const passwordPath = join(stateRoot, 'clickhouse-password');
  try {
    await writeFile(passwordPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const passwordStat = await lstat(passwordPath);
  if (
    passwordStat.isSymbolicLink() ||
    !passwordStat.isFile() ||
    passwordStat.uid !== process.getuid?.() ||
    (passwordStat.mode & 0o777) !== 0o600
  )
    throw new Error('UGV_DEBUG_SECRET_INVALID');
  const password = (await readFile(passwordPath, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/u.test(password)) throw new Error('UGV_DEBUG_SECRET_INVALID');
  const template = await readFile(
    join(telemetryRoot, 'deploy/ugv-debug/collector.template.yaml'),
    'utf8',
  );
  if (template.split('__UGV_DEBUG_CLICKHOUSE_PASSWORD__').length !== 2)
    throw new Error('UGV_DEBUG_TEMPLATE_INVALID');
  await privateFile(
    join(stateRoot, 'collector.yaml'),
    template.replace('__UGV_DEBUG_CLICKHOUSE_PASSWORD__', JSON.stringify(password)),
  );
  const mapping = {
    version: 4,
    mappings: [
      {
        collectorId: 'ugv-debug-collector',
        trustDomain: 'local-development',
        deploymentId: 'uap-p3-b01-runtime',
        providerId: 'isr.vehicle.ugv.ugv1',
        instanceId: 'uap-p3-b01-runtime-1',
        smppSourceId: 'smpp-source-ugv1-uap-p3-b01',
        tenantId: 'tenant-local',
        projectId: 'ugv-debug',
        environment: 'integration',
        sourceProduct: 'sdar-mcp-provider-platform',
        mappingVersion: 4,
        policyVersion: 1,
        projectionRouteIds: ['standalone-smpp'],
        status: 'active',
        validFrom: '2026-01-01T00:00:00Z',
        validTo: null,
      },
    ],
  };
  await privateFile(
    join(stateRoot, 'source-mappings.json'),
    JSON.stringify(mapping, null, 2) + '\n',
  );
  await privateFile(
    join(stateRoot, 'profile.json'),
    JSON.stringify(
      {
        publicHost: host,
        ports: debugPorts,
        telemetryProject: 'sdar-ugv-debug-telemetry',
        grafana: false,
      },
      null,
      2,
    ) + '\n',
  );
  return { publicHost: host, stateRoot };
}

async function get(url) {
  try {
    const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(3000) });
    return {
      status: response.status,
      body: response.headers.get('content-type')?.includes('json')
        ? await response.json()
        : await response.text(),
    };
  } catch {
    return { status: 0 };
  }
}

export async function telemetryStatus(request = get) {
  const signalPaths = {
    events: '/api/v1/events?limit=1',
    traces: '/api/v1/traces?limit=1',
    gauge: '/api/v1/metrics?type=gauge&limit=1',
    sum: '/api/v1/metrics?type=sum&limit=1',
    histogram: '/api/v1/metrics?type=histogram&limit=1',
    exponentialHistogram: '/api/v1/metrics?type=exponential_histogram&limit=1',
    summary: '/api/v1/metrics?type=summary&limit=1',
  };
  const observations = await Promise.all(
    Object.entries(signalPaths).map(async ([name, path]) => {
      const result = await request(`http://127.0.0.1:8088${path}`);
      return [
        name,
        result.status !== 200
          ? 'unavailable'
          : Array.isArray(result.body?.data) && result.body.data.length > 0
            ? 'stored'
            : 'waiting_for_source',
      ];
    }),
  );
  const processor = await request('http://127.0.0.1:8443/health/ready');
  const domain = await request('http://127.0.0.1:8083/status');
  const evidence = await request('http://127.0.0.1:10091/api/v1/evidence-export/status');
  const gateway = await request('http://127.0.0.1:8080/health');
  const [collector, queue] = await Promise.all([
    request('http://127.0.0.1:13133/'),
    request('http://127.0.0.1:8888/metrics'),
  ]);
  const queueValues =
    queue.status === 200 && typeof queue.body === 'string'
      ? [
          ...queue.body.matchAll(/^otelcol_exporter_queue_size\{[^\n]*\}\s+(\d+(?:\.\d+)?)$/gmu),
        ].map((match) => Number(match[1]))
      : undefined;
  return {
    sdarEvidence: evidence.status === 200 ? evidence.body : { status: 'unavailable' },
    gateway: gateway.status === 200 ? 'ready' : 'degraded_or_stopped',
    domainProjection: domain.status === 200 ? domain.body : { status: 'unavailable' },
    signals: Object.fromEntries(observations),
    processor: processor.status === 200 ? 'ready' : 'degraded_or_stopped',
    collector: collector.status === 200 ? 'ready' : 'degraded_or_stopped',
    diagnosticQueueItems: queueValues?.reduce((sum, count) => sum + count, 0) ?? null,
    walPendingWrites: processor.body?.wal?.pendingWrites ?? null,
    walBytes: processor.body?.wal?.totalBytes ?? null,
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (rest.length !== 0) throw new Error('UGV_DEBUG_ARGUMENT_INVALID');
  if (command === 'public-host') return process.stdout.write(`${await choosePublicHost()}\n`);
  if (command === 'configure')
    return process.stdout.write(`${JSON.stringify(await configureDebugProfile())}\n`);
  if (command === 'status') {
    let profile;
    try {
      profile = JSON.parse(await readFile(join(debugStateRoot, 'profile.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const publicHost = profile?.publicHost ?? (await choosePublicHost());
    return process.stdout.write(
      `${JSON.stringify(
        {
          access: 'trusted_intranet_no_login',
          grafana: false,
          addresses: Object.fromEntries(
            Object.entries(debugPorts).map(([name, port]) => [
              name,
              `${name === 'otlpGrpc' || name === 'adapter' ? 'grpc' : 'http'}://${publicHost}:${port}`,
            ]),
          ),
          telemetry: await telemetryStatus(),
        },
        null,
        2,
      )}\n`,
    );
  }
  if (command === 'wait-card') {
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await get('http://127.0.0.1:10999/.well-known/agent-card.json');
      if (
        result.status === 200 &&
        result.body?.skills?.some((skill) => skill.id === 'embodied.move_to') &&
        result.body?.capabilities?.extensions?.some(
          (extension) => extension.uri === 'io.sdar/naturalLanguageCapabilityAdmission',
        )
      )
        return;
      await new Promise((done) => globalThis.setTimeout(done, 1000));
    }
    throw new Error('UGV_DEBUG_PUBLIC_CARD_NOT_REGISTERED');
  }
  throw new Error('UGV_DEBUG_ARGUMENT_INVALID');
}
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url))
  main().catch((error) => {
    const code = /^UGV_DEBUG_[A-Z_]+$/u.test(error.message)
      ? error.message
      : 'UGV_DEBUG_PROFILE_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
