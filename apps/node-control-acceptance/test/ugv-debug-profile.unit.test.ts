import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

interface ProfileModule {
  choosePublicHost(
    override?: string,
    interfaces?: unknown,
    physical?: (name: string) => Promise<boolean>,
  ): Promise<string>;
  configureDebugProfile(options: { stateRoot: string; publicHost: string }): Promise<unknown>;
  telemetryStatus(request: (url: string) => Promise<unknown>): Promise<unknown>;
}
const script = pathToFileURL(
  resolve('scripts/ugv-agent-profile-simulation/debug-profile.mjs'),
).href;
const profile = (await import(script)) as ProfileModule;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('joint development profile', () => {
  it('announces a physical LAN interface, ignores proxy/tunnel addresses and accepts explicit override', async () => {
    const interfaces = {
      CordC: [{ family: 'IPv4', address: '198.18.0.1', internal: false }],
      wlo1: [{ family: 'IPv4', address: '192.168.6.7', internal: false }],
    };
    expect(
      await profile.choosePublicHost('', interfaces, (name) => Promise.resolve(name === 'wlo1')),
    ).toBe('192.168.6.7');
    expect(await profile.choosePublicHost('debug.example.test', {})).toBe('debug.example.test');
    await expect(profile.choosePublicHost('0.0.0.0')).rejects.toThrow(
      'UGV_DEBUG_PUBLIC_HOST_INVALID',
    );
    await expect(profile.choosePublicHost('http://host:10999')).rejects.toThrow(
      'UGV_DEBUG_PUBLIC_HOST_INVALID',
    );
    await expect(profile.choosePublicHost('', {}, () => Promise.resolve(false))).rejects.toThrow(
      'UGV_DEBUG_PUBLIC_HOST_REQUIRED',
    );
  });
  it('isolates generated configuration and reuses the private ClickHouse secret on repeated start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sdar-debug-profile-'));
    roots.push(root);
    const options = { stateRoot: root, publicHost: '192.168.6.7' };
    await profile.configureDebugProfile(options);
    const password = await readFile(join(root, 'clickhouse-password'), 'utf8');
    const before = await readFile(join(root, 'source-mappings.json'), 'utf8');
    await profile.configureDebugProfile(options);
    expect(await readFile(join(root, 'clickhouse-password'), 'utf8')).toBe(password);
    expect(await readFile(join(root, 'source-mappings.json'), 'utf8')).toBe(before);
    expect(before).toContain('uap-p3-b01-runtime-1');
    expect(before).not.toContain(password);
    expect((await lstat(join(root, 'collector.yaml'))).mode & 0o777).toBe(0o600);
    const collector = await readFile(join(root, 'collector.yaml'), 'utf8');
    expect(collector).toContain('ugv-agent-profile-runtime:8080');
    expect(collector).toContain('storage: file_storage/diagnostics');
    expect(collector).not.toContain('19100');
    const compose = await readFile(
      resolve('../smpp-telemetry-platform/deploy/ugv-debug/compose.yaml'),
      'utf8',
    );
    expect(compose).not.toMatch(/^\s*grafana:|3000|arm64/u);
    expect(compose).toContain('clickhouse/clickhouse-server:25.3.14.14');
    expect(compose).toContain('127.0.0.1:8123:8123');
    expect(compose).toContain('0.0.0.0:4318:4318');
  });
  it('reports absent real signals as waiting and faults as degraded, never fabricates success', async () => {
    const empty = await profile.telemetryStatus(() =>
      Promise.resolve({ status: 200, body: { data: [] } }),
    );
    expect(empty).toMatchObject({
      signals: { events: 'waiting_for_source', traces: 'waiting_for_source' },
    });
    const failed = await profile.telemetryStatus(() => Promise.resolve({ status: 503 }));
    expect(failed).toMatchObject({
      signals: { events: 'unavailable' },
      processor: 'degraded_or_stopped',
      collector: 'degraded_or_stopped',
      diagnosticQueueItems: null,
    });
  });
  it('reports an offline Collector and its backlog independently of previously stored data', async () => {
    const state = await profile.telemetryStatus((url) =>
      Promise.resolve(
        url.includes(':13133')
          ? { status: 0 }
          : url.includes(':8888')
            ? {
                status: 200,
                body: 'otelcol_exporter_queue_size{exporter="clickhouse/diagnostics",signal="metrics"} 3\notelcol_exporter_queue_size{exporter="clickhouse/diagnostics",signal="traces"} 2\n',
              }
            : { status: 200, body: { data: [{ source: 'existing' }] } },
      ),
    );
    expect(state).toMatchObject({
      signals: { events: 'stored', traces: 'stored' },
      collector: 'degraded_or_stopped',
      diagnosticQueueItems: 5,
    });
  });
});
