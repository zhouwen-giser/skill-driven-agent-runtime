import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { startFrozenBusinessEventsMockProvider } from '../../../packages/mcp-adapter/src/index.js';
import { startServerRuntime, type ServerRuntimeHandle } from '../src/runtime.js';

/** Normal Server event ingress and impact worker, with isolated protocol/PG fixtures. */
export async function verifyGowmBusinessEventExecution() {
  const admin = process.env['GOWM_RUNTIME_TEST_DATABASE_URL'];
  const consumer = process.env['GOWM_RUNTIME_CONSUMER_TEST_DATABASE_URL'];
  assert.ok(admin && consumer);
  for (const connection of [admin, consumer]) {
    const url = new URL(connection);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '55490');
    assert.equal(url.pathname, '/sdar_gowm_runtime_test');
  }
  const pool = new Pool({ connectionString: admin });
  const provider = await startFrozenBusinessEventsMockProvider({ scenario: 'duplicate_event' });
  const run = `gowm-events-${randomUUID()}`;
  const devices = [`${run}-a`, `${run}-b`];
  const serverId = `${run}-server`;
  const dataScope = `TEST:${run}`;
  const report: Record<string, unknown> = {
    run,
    status: 'INCOMPLETE',
    scope: 'Normal Server event protocol fixture; no model or device execution',
  };
  const cleanupErrors: string[] = [];
  let runtime: ServerRuntimeHandle | undefined;
  try {
    await pool.query(
      "INSERT INTO public.data_scope(scope_key,operational_domain,description) VALUES($1,'TEST','Event ingress fixture')",
      [dataScope],
    );
    for (const device of devices) {
      await pool.query(
        "INSERT INTO public.world_object(id,object_type,data_scope_key) VALUES($1,'VEHICLE',$2)",
        [device, dataScope],
      );
      await pool.query(
        "INSERT INTO gowm_device.device(device_id,data_scope_key,identifier_namespace,device_identifier,device_name,device_type) VALUES($1,$2,$3,$1,'Synthetic event fixture','UGV')",
        [device, dataScope, run],
      );
      await pool.query(
        'INSERT INTO gowm_device.device_service_binding(binding_id,data_scope_key,device_id,smpp_service_key,provider_id,resource_id,sdar_service_key,sdar_mcp_server_id) VALUES($1,$2,$3,$4,$5,$3,$6,$7)',
        [randomUUID(), dataScope, device, run, 'synthetic-peer', 'sdar-test', serverId],
      );
    }
    runtime = await startServerRuntime({
      postgresUrl: 'postgresql://unused.invalid/forbidden-fallback',
      gowmStorage: {
        databaseUrl: consumer,
        serviceKey: 'sdar-test',
        allowedDeviceIds: devices,
        dataScopeKey: dataScope,
        includeNonDevice: false,
        contractDirectory: 'contracts/gowm-shared-storage/current',
      },
      redis: { host: '127.0.0.1', port: 56490 },
      masterKeyBase64: await readFile('.state/gowm-storage/runtime-master-key', 'utf8'),
      queueName: run,
      applyMigrations: true,
      a2aHost: '127.0.0.1',
      a2aPort: 0,
      managementHost: '127.0.0.1',
      managementPort: 0,
      frozenMcpTasks: {
        isolationAcknowledged: true,
        queueName: `${run}-remote`,
        reconcileIntervalMs: 1000,
      },
      businessEvents: { enabled: true, processingIntervalMs: 50, reconnectDelayMs: 1000 },
      outboundEndpointPolicy: {
        unsafeTestOpen: false,
        mcpAllowedAuthorities: [provider.endpoint.host],
        providerAllowedAuthorities: [],
      },
    });
    await runtime.registerMcpServer({
      serverId,
      name: serverId,
      endpoint: provider.endpoint.href,
      credentialHeaders: {},
    });
    const deadline = Date.now() + 15000;
    let rows: Record<string, unknown>[] = [];
    while (Date.now() < deadline) {
      rows = (
        await pool.query<Record<string, unknown>>(
          `SELECT s.subscription_id,s.device_id,s.smpp_service_key,
        s.last_durably_admitted_sequence::text,s.last_processed_sequence::text,
        count(DISTINCT i.inbox_id)::integer AS inbox_count,
        count(DISTINCT a.assessment_id)::integer AS assessment_count
        FROM ugv_sdar.business_event_subscription s
        LEFT JOIN ugv_sdar.business_event_inbox i ON i.subscription_id=s.subscription_id
        LEFT JOIN ugv_sdar.event_impact_assessment a ON a.inbox_id=i.inbox_id
        WHERE s.provider_id=$1 GROUP BY s.subscription_id ORDER BY s.device_id`,
          [serverId],
        )
      ).rows;
      if (rows.length === 2 && rows.every((row) => row['last_processed_sequence'] === '1')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.deepEqual(
      rows.map((row) => row['device_id']),
      devices,
    );
    for (const row of rows) {
      assert.equal(row['smpp_service_key'], run);
      assert.equal(row['last_durably_admitted_sequence'], '1');
      assert.equal(row['last_processed_sequence'], '1', JSON.stringify(rows));
      assert.equal(row['inbox_count'], 1);
      assert.equal(row['assessment_count'], 1);
    }
    assert.ok(
      provider.requests.filter((request) => request.method === 'io.sdar/businessEvents/listen')
        .length >= 2,
    );
    report['subscriptions'] = rows;
    report['status'] = 'PASS';
  } catch (error) {
    report['status'] = 'FAIL';
    report['error'] = error instanceof Error ? error.message : 'UNKNOWN';
    throw error;
  } finally {
    for (const close of [async () => runtime?.close(), () => provider.close(), () => pool.end()]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : 'UNKNOWN');
      }
    }
    report['cleanupErrors'] = cleanupErrors;
    if (cleanupErrors.length > 0) report['status'] = 'FAIL';
    await writeFile(
      `reports/sdar-gowm-shared-storage-integration-v0.1/${run}.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  assert.deepEqual(cleanupErrors, []);
  return report;
}
