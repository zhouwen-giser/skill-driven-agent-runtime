import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';

/** Explicit isolated smoke of the normal composition root; never imports deployment secrets. */
export async function verifyGowmRuntimeStartup(): Promise<number> {
  const databaseUrl = process.env['GOWM_RUNTIME_CONSUMER_TEST_DATABASE_URL'];
  if (process.env['GOWM_BUSINESS_SMOKE_ENABLE'] !== 'true' || databaseUrl === undefined)
    throw new Error('GOWM_ISOLATED_SMOKE_NOT_ENABLED');
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55490');
  assert.equal(url.pathname, '/sdar_gowm_runtime_test');
  assert.equal(url.username, 'sdar_gowm_consumer_test');
  const run = `sdar-runtime-${randomUUID()}`;
  const started = Date.now();
  let runtime: ServerRuntimeHandle | undefined;
  const report: Record<string, unknown> = {
    run,
    status: 'INCOMPLETE',
    scope: 'Normal Server startup only; no Task or MCP execution',
    redis: 'owned local Redis on 127.0.0.1:56490',
  };
  try {
    runtime = await startServerRuntime({
      postgresUrl: 'postgresql://unused.invalid/forbidden-fallback',
      gowmStorage: {
        databaseUrl,
        serviceKey: 'sdar-test',
        allowedDeviceIds: [],
        dataScopeKey: 'TEST:runtime-startup',
        includeNonDevice: false,
        contractDirectory: 'contracts/gowm-shared-storage/current',
      },
      redis: { host: '127.0.0.1', port: 56490 },
      masterKeyBase64: randomBytes(32).toString('base64'),
      queueName: run,
      applyMigrations: true, // Shared mode must suppress this standalone flag.
      a2aHost: '127.0.0.1',
      a2aPort: 0,
      managementHost: '127.0.0.1',
      managementPort: 0,
      frozenMcpTasks: {
        isolationAcknowledged: true,
        queueName: `${run}-remote`,
        reconcileIntervalMs: 1000,
      },
      outboundEndpointPolicy: {
        unsafeTestOpen: false,
        mcpAllowedAuthorities: [],
        providerAllowedAuthorities: [],
      },
    });
    const health = await fetch(`${runtime.management.baseUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(10000),
    });
    const card = await fetch(`${runtime.a2a.baseUrl}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(health.status, 200);
    assert.equal(card.status, 200);
    report['healthStatus'] = health.status;
    report['agentCardStatus'] = card.status;
    report['status'] = 'PASS';
  } catch (error) {
    report['status'] = 'FAIL';
    report['error'] =
      error instanceof Error
        ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[redacted database URL]')
        : 'UNKNOWN_STARTUP_FAILURE';
  } finally {
    if (runtime !== undefined) {
      try {
        await runtime.close();
        report['cleanup'] = 'runtime_handle_closed';
      } catch (error) {
        report['status'] = 'FAIL';
        report['cleanup'] = 'runtime_close_failed';
        report['cleanupError'] = error instanceof Error ? error.message : 'UNKNOWN';
      }
    } else report['cleanup'] = 'startup_handle_not_created_process_exit_required';
    // Check only this smoke role, excluding this observation connection itself.
    const check = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      report['remainingConsumerConnections'] = Number(
        (
          await check.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM pg_stat_activity WHERE usename=current_user AND pid<>pg_backend_pid() AND datname=current_database()',
          )
        ).rows[0]?.count ?? '0',
      );
      if (report['remainingConsumerConnections'] !== 0) {
        report['status'] = 'FAIL';
        report['cleanup'] = 'consumer_connections_remain';
      }
    } finally {
      await check.end();
    }
    report['elapsedMs'] = Date.now() - started;
    const directory = 'reports/sdar-gowm-shared-storage-integration-v0.1';
    await mkdir(directory, { recursive: true });
    await writeFile(
      `${directory}/runtime-startup-${run}.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    process.stdout.write(JSON.stringify(report) + '\n');
  }
  return report['status'] === 'PASS' ? 0 : 1;
}
