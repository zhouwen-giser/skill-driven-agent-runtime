import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';

interface TelemetryModule {
  configureSdarTelemetry(options: { stateRoot: string; environmentFile: string }): Promise<unknown>;
  configureEvidence(request: typeof fetch): Promise<unknown>;
  validateProducerConfiguration(value: unknown): void;
}
const telemetry = (await import(
  pathToFileURL(resolve('scripts/ugv-agent-profile-simulation/debug-sdar-telemetry.mjs')).href
)) as TelemetryModule;
const profile = (await import(
  pathToFileURL(resolve('scripts/ugv-agent-profile-simulation/debug-profile.mjs')).href
)) as {
  configureDebugProfile(options: { stateRoot: string; publicHost: string }): Promise<unknown>;
};
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('keeps credentials/config private, leaves real producers absent, and activates only new SMPP routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdar-telemetry-debug-config-'));
  roots.push(root);
  const environmentFile = join(root, 'warehouse.env');
  const env =
    'CLICKHOUSE_URL=http://192.168.1.7:8123\nCLICKHOUSE_USER=writer\nCLICKHOUSE_PASSWORD=test-writer\nCLICKHOUSE_QUERY_URL=http://192.168.1.7:8123\nCLICKHOUSE_QUERY_USER=reader\nCLICKHOUSE_QUERY_PASSWORD=test-reader\n';
  await writeFile(environmentFile, env, { mode: 0o600 });
  await profile.configureDebugProfile({ stateRoot: root, publicHost: '192.168.6.7' });
  const options = { stateRoot: root, environmentFile };
  expect(await telemetry.configureSdarTelemetry(options)).toMatchObject({
    domainProjectionEnabled: true,
    domainProjectionMaxMode: 'active',
    configuredProducers: 0,
    historyBackfill: false,
  });
  const secret = await readFile(join(root, 'sdar-telemetry/evidence-token'), 'utf8');
  await telemetry.configureSdarTelemetry(options);
  expect(await readFile(join(root, 'sdar-telemetry/evidence-token'), 'utf8')).toBe(secret);
  expect(await readFile(environmentFile, 'utf8')).toBe(env);
  expect((await lstat(join(root, 'sdar-telemetry/postgres-url'))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(root, 'source-mappings.json'), 'utf8'))).toMatchObject({
    version: 4,
    mappings: [{ projectionRouteIds: ['standalone-smpp', 'sdar-warehouse-shadow'] }],
  });
  expect(JSON.parse(await readFile(join(root, 'projection-targets.json'), 'utf8'))).toMatchObject({
    targets: [
      { targetId: 'standalone-smpp', enabled: true, required: true },
      {
        targetId: 'sdar-warehouse-shadow',
        enabled: true,
        required: false,
        acceptAllMappings: false,
        routeIds: ['sdar-warehouse-shadow'],
      },
    ],
  });
  expect(await readFile(join(root, 'sdar-telemetry/compose.env'), 'utf8')).not.toContain(secret);
});
it('refuses invented application aliases and cross-project producer registration', () => {
  expect(() => {
    telemetry.validateProducerConfiguration({
      tenantId: 't',
      projectId: 'p',
      producers: [{ application: 'sdar-evidence' }],
    });
  }).toThrow('CONFIGURATION_INVALID');
  expect(() => {
    telemetry.validateProducerConfiguration({
      tenantId: 't',
      projectId: 'p',
      producers: [{ application: 'npc', tenantId: 't', projectId: 'other' }],
    });
  }).toThrow('CONFIGURATION_INVALID');
});
it('reuses an active Evidence config with no POST or revision change', async () => {
  const calls: string[] = [];
  const request: typeof fetch = (url, options) => {
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push(`${options?.method ?? 'GET'}:${address}`);
    return Promise.resolve(
      Response.json(
        address.endsWith('/status')
          ? { status: 'healthy', activeRevision: 1, pendingRecords: 0 }
          : {
              exportId: 'ugv-debug-incremental-evidence',
              deliveryStart: 'from_activation',
              revision: 1,
              status: 'active',
              endpointRef: 'http://127.0.0.1:8080/v1/evidence/batches',
              credentialRef: 'env:SDAR_DEBUG_EVIDENCE_TOKEN',
            },
      ),
    );
  };
  expect(await telemetry.configureEvidence(request)).toMatchObject({ status: 'healthy' });
  expect(calls).toHaveLength(2);
  expect(calls.every((call) => call.startsWith('GET:'))).toBe(true);
});
it('never changes an unrelated or historical Evidence export', async () => {
  let writes = 0;
  await expect(
    telemetry.configureEvidence((_url, options) => {
      if (options?.method === 'POST') writes++;
      return Promise.resolve(
        Response.json({ exportId: 'existing-production-export', deliveryStart: 'retained' }),
      );
    }),
  ).rejects.toThrow('CONFIGURATION_CONFLICT');
  expect(writes).toBe(0);
});
it('creates, validates and publishes incremental Evidence through the formal API exactly once', async () => {
  const calls: string[] = [];
  let created: Record<string, unknown> = {};
  const request: typeof fetch = (url, options) => {
    const address = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push(`${options?.method ?? 'GET'}:${address}`);
    if (address.endsWith('/status'))
      return Promise.resolve(Response.json({ status: 'healthy', activeRevision: 1 }));
    if (options?.method !== 'POST')
      return Promise.resolve(Response.json({ code: 'EVIDENCE_EXPORT_NOT_FOUND' }, { status: 404 }));
    const headers = new Headers(options.headers);
    if (address.endsWith('/revisions')) {
      if (typeof options.body !== 'string') throw new Error('Expected a JSON request body.');
      created = JSON.parse(options.body) as Record<string, unknown>;
      expect(created).toMatchObject({
        deliveryStart: 'from_activation',
        revision: 1,
        status: 'draft',
      });
      expect(headers.get('idempotency-key')).toBe('ugv-debug-evidence-create-v1');
      return Promise.resolve(Response.json(created, { status: 201, headers: { etag: '"draft"' } }));
    }
    if (address.endsWith('/validate')) {
      expect(headers.get('if-match')).toBe('"draft"');
      return Promise.resolve(
        Response.json({ ...created, status: 'validated' }, { headers: { etag: '"validated"' } }),
      );
    }
    expect(address).toBe('http://127.0.0.1:10091/api/v1/evidence-export/revisions/1/publish');
    expect(headers.get('if-match')).toBe('"validated"');
    return Promise.resolve(Response.json({ status: 'succeeded' }, { status: 202 }));
  };
  expect(await telemetry.configureEvidence(request)).toMatchObject({ status: 'healthy' });
  expect(calls.filter((value) => value.startsWith('POST:'))).toHaveLength(3);
  expect(calls).toHaveLength(5);
});
