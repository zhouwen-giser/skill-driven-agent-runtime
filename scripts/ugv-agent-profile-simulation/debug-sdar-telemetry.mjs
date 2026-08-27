#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseEnv } from 'node:util';
import process from 'node:process';
import { debugStateRoot, privateDirectory, privateFile } from './debug-profile.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PROVIDER_CLOSURE_MIGRATION_SHA256 =
  'dba7693c2ee3fe52bc4ea61182cce87244c6f83dbf2f5a94048da9fb9ed9740a';
const failure = (code) => new Error(code);
async function readPrivate(path) {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw failure('UGV_DEBUG_TELEMETRY_SECRET_INVALID');
  return (await readFile(path, 'utf8')).trim();
}
async function secret(path) {
  try {
    await writeFile(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const value = await readPrivate(path);
  if (!/^[a-f0-9]{64}$/u.test(value)) throw failure('UGV_DEBUG_TELEMETRY_SECRET_INVALID');
  return value;
}
export function warehouseConfiguration(env) {
  const result = {};
  for (const prefix of ['CLICKHOUSE', 'CLICKHOUSE_QUERY']) {
    const url = new URL(env[`${prefix}_URL`] ?? '');
    if (
      url.origin !== 'http://192.168.1.7:8123' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw failure('UGV_DEBUG_WAREHOUSE_ENDPOINT_INVALID');
    const user = env[`${prefix}_USER`];
    if (typeof user !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(user))
      throw failure('UGV_DEBUG_WAREHOUSE_USER_INVALID');
    result[`${prefix}_URL`] = url.origin;
    result[`${prefix}_USER`] = user;
    result[`${prefix}_SECURE`] = 'false';
  }
  return result;
}
export async function configureSdarTelemetry({
  stateRoot = debugStateRoot,
  telemetryRoot = resolve(repo, '../sdar-telemetry-platform'),
  smppTelemetryRoot = resolve(repo, '../smpp-telemetry-platform'),
  sourceFile = process.env.UGV_DEBUG_DOMAIN_PRODUCERS_FILE,
  environmentFile = join(telemetryRoot, '.env'),
} = {}) {
  await privateDirectory(stateRoot);
  const directory = join(stateRoot, 'sdar-telemetry');
  await privateDirectory(directory);
  // Read the existing warehouse settings without modifying the project's deployment .env.
  const env = parseEnv(await readFile(environmentFile, 'utf8'));
  const warehouse = warehouseConfiguration(env);
  for (const [prefix, name] of [
    ['CLICKHOUSE', 'warehouse-password'],
    ['CLICKHOUSE_QUERY', 'warehouse-query-password'],
  ]) {
    const file = env[`${prefix}_PASSWORD_FILE`];
    const value = file
      ? (await readFile(resolve(telemetryRoot, file), 'utf8')).trim()
      : env[`${prefix}_PASSWORD`];
    if (!value || /[\r\n]/u.test(value)) throw failure('UGV_DEBUG_WAREHOUSE_CREDENTIAL_REQUIRED');
    await privateFile(join(directory, name), value);
  }
  for (const name of ['evidence-token', 'domain-token', 'query-token', 'admin-token'])
    await secret(join(directory, name));
  const password = await secret(join(directory, 'postgres-password'));
  await privateFile(
    join(directory, 'postgres-url'),
    `postgresql://sdar_telemetry:${password}@control-postgres:5432/sdar_telemetry_control`,
  );
  if (sourceFile !== undefined) {
    const value = JSON.parse(await readFile(sourceFile, 'utf8'));
    validateProducerConfiguration(value);
    await privateFile(join(directory, 'producers.json'), JSON.stringify(value, null, 2) + '\n');
  } else {
    try {
      await lstat(join(directory, 'producers.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // No fabricated producers. The bootstrap may reuse real registrations in Control PG.
      await privateFile(
        join(directory, 'producers.json'),
        JSON.stringify({ tenantId: 'tenant-local', projectId: 'ugv-debug', producers: [] }) + '\n',
      );
    }
  }
  const sources = JSON.parse(await readPrivate(join(directory, 'producers.json')));
  validateProducerConfiguration(sources);
  const providerMigrationHash = createHash('sha256')
    .update(
      await readFile(join(telemetryRoot, 'migrations/clickhouse/015_provider_closure_v2.sql')),
    )
    .digest('hex');
  if (providerMigrationHash !== PROVIDER_CLOSURE_MIGRATION_SHA256)
    throw failure('UGV_DEBUG_PROVIDER_MIGRATION_REVIEW_HASH_MISMATCH');
  await privateFile(
    join(directory, 'compose.env'),
    Object.entries({
      ...warehouse,
      DOMAIN_TENANT_ID: sources.tenantId,
      DOMAIN_PROJECT_ID: sources.projectId,
      PROVIDER_CLOSURE_MIGRATION_SHA256,
    })
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
  const targets = JSON.parse(
    await readFile(join(smppTelemetryRoot, 'config/projection-targets.example.json'), 'utf8'),
  );
  const target = targets.targets.find((item) => item.targetId === 'sdar-warehouse-shadow');
  if (!target) throw failure('UGV_DEBUG_WAREHOUSE_TARGET_MISSING');
  target.enabled = true;
  target.required = false;
  target.acceptAllMappings = false;
  target.routeIds = ['sdar-warehouse-shadow'];
  target.connection = {
    url: warehouse.CLICKHOUSE_URL,
    user: warehouse.CLICKHOUSE_USER,
    passwordFile: '/run/secrets/sdar_warehouse_password',
  };
  await privateFile(
    join(stateRoot, 'projection-targets.json'),
    JSON.stringify(targets, null, 2) + '\n',
  );
  const mapping = JSON.parse(await readFile(join(stateRoot, 'source-mappings.json'), 'utf8'));
  // v4 is the frozen source-mapping wire schema; only routing policy changes.
  mapping.version = 4;
  for (const entry of mapping.mappings) {
    entry.mappingVersion = 4;
    entry.policyVersion = 3;
    entry.tenantId = sources.tenantId;
    entry.projectId = sources.projectId;
    entry.projectionRouteIds = ['standalone-smpp', 'sdar-warehouse-shadow'];
  }
  // Existing WAL entries retain their old route snapshot. Only subsequently accepted entries gain this target.
  await privateFile(
    join(stateRoot, 'source-mappings.json'),
    JSON.stringify(mapping, null, 2) + '\n',
  );
  return {
    status: 'configured',
    tenantId: sources.tenantId,
    projectId: sources.projectId,
    configuredProducers: sources.producers.length,
    domainProjectionEnabled: true,
    domainProjectionMaxMode: 'active',
    historyBackfill: false,
  };
}
export function validateProducerConfiguration(value) {
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'producers,projectId,tenantId' ||
    !/^[a-zA-Z0-9._-]{1,128}$/u.test(value.tenantId) ||
    !/^[a-zA-Z0-9._-]{1,128}$/u.test(value.projectId) ||
    !Array.isArray(value.producers) ||
    value.producers.length > 2
  )
    throw failure('UGV_DEBUG_DOMAIN_CONFIGURATION_INVALID');
  const applications = new Set();
  for (const producer of value.producers) {
    if (
      !producer ||
      !['commander', 'npc'].includes(producer.application) ||
      applications.has(producer.application) ||
      producer.tenantId !== value.tenantId ||
      producer.projectId !== value.projectId ||
      producer.contractVersion !== 'sdar.domain-source/v1' ||
      typeof producer.producerId !== 'string' ||
      !producer.producerId.trim() ||
      typeof producer.credentialRef !== 'string' ||
      !producer.credentialRef.trim() ||
      typeof producer.metadata !== 'object' ||
      producer.metadata === null ||
      Array.isArray(producer.metadata)
    )
      throw failure('UGV_DEBUG_DOMAIN_CONFIGURATION_INVALID');
    applications.add(producer.application);
  }
}
export async function configureEvidence(request = globalThis.fetch) {
  const base = 'http://127.0.0.1:10091/api/v1/evidence-export';
  const call = async (path, body, headers = {}) => {
    const response = await request(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: globalThis.AbortSignal.timeout(30000),
    });
    const value = await response.json();
    if (!response.ok && response.status !== 404)
      throw failure(`UGV_DEBUG_EVIDENCE_HTTP_${response.status}`);
    return { status: response.status, body: value, etag: response.headers.get('etag') };
  };
  let current = await call('');
  if (current.status === 404)
    current = await call(
      '/revisions',
      {
        exportId: 'ugv-debug-incremental-evidence',
        deliveryStart: 'from_activation',
        revision: 1,
        status: 'draft',
        endpointRef: 'http://127.0.0.1:8080/v1/evidence/batches',
        sourceId: 'ugv-debug-sdar',
        credentialRef: 'env:SDAR_DEBUG_EVIDENCE_TOKEN',
        includedFamilies: [
          'runtime',
          'skill',
          'mcp_task',
          'capability',
          'experience',
          'replay',
          'artifact',
          'node_control',
          'evidence',
        ],
        batchPolicy: { maxRecords: 100, maxBytes: 1048576, flushIntervalMs: 1000 },
        retryPolicy: { baseDelayMs: 1000, maxDelayMs: 30000 },
        outboxPolicy: { maxPendingRecords: 100000, retentionDays: 30 },
        redactionProfile: 'strict_internal_v1',
        artifactMode: 'reference',
        applyMode: 'hot_reload',
      },
      { 'idempotency-key': 'ugv-debug-evidence-create-v1' },
    );
  if (
    current.body.exportId !== 'ugv-debug-incremental-evidence' ||
    current.body.deliveryStart !== 'from_activation' ||
    current.body.endpointRef !== 'http://127.0.0.1:8080/v1/evidence/batches' ||
    current.body.credentialRef !== 'env:SDAR_DEBUG_EVIDENCE_TOKEN'
  )
    throw failure('UGV_DEBUG_EVIDENCE_CONFIGURATION_CONFLICT');
  const revision = current.body.revision;
  if (current.body.status !== 'active') {
    current = await call(
      `/revisions/${revision}/validate`,
      { reason: 'UGV debug incremental telemetry' },
      { 'if-match': current.etag, 'idempotency-key': `ugv-debug-evidence-validate-${revision}` },
    );
    const published = await call(
      `/revisions/${revision}/publish`,
      { reason: 'UGV debug incremental telemetry' },
      { 'if-match': current.etag, 'idempotency-key': `ugv-debug-evidence-publish-${revision}` },
    );
    if (published.body.status === 'failed' || published.body.status === 'rejected')
      throw failure('UGV_DEBUG_EVIDENCE_APPLY_FAILED');
  }
  const status = await call('/status');
  if (
    status.body.activeRevision !== revision ||
    !['healthy', 'degraded'].includes(status.body.status)
  )
    throw failure('UGV_DEBUG_EVIDENCE_NOT_ACTIVE');
  return status.body;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  try {
    if (process.argv.length !== 3 || !['configure', 'evidence'].includes(action))
      throw failure('UGV_DEBUG_TELEMETRY_ARGUMENT_INVALID');
    process.stdout.write(
      JSON.stringify(
        action === 'configure' ? await configureSdarTelemetry() : await configureEvidence(),
      ) + '\n',
    );
  } catch (error) {
    process.stderr.write(
      `${/^[A-Z0-9_]+$/u.test(error.message) ? error.message : 'UGV_DEBUG_TELEMETRY_FAILED'}\n`,
    );
    process.exitCode = 1;
  }
}
