import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';

// One-time isolated fixture provisioning. Never imported by the Server.
const source = process.env['GOWM_BUSINESS_TEST_DATABASE_URL'];
assert.equal(process.env['GOWM_BUSINESS_SMOKE_ENABLE'], 'true');
assert.ok(source);
const url = new URL(source);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '55490');
assert.equal(url.pathname, '/sdar_gowm_integration_test');
const targetName = 'sdar_gowm_runtime_test';
const admin = new Pool({ connectionString: source });
try {
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [targetName]);
  assert.equal(
    existing.rowCount,
    0,
    'Retain existing fixture DB; do not overwrite or reinitialize',
  );
  await admin.query('CREATE DATABASE sdar_gowm_runtime_test');
} finally {
  await admin.end();
}
url.pathname = `/${targetName}`;
const snapshot = '/tmp/sdar-gowm-contract-a1a86186';
for (const args of [
  ['scripts/business-storage/bootstrap-test.ts'],
  ['scripts/business-storage/cli.ts', 'install', '--domain', 'all'],
]) {
  const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), ...args], {
    cwd: snapshot,
    env: {
      ...process.env,
      GOWM_BUSINESS_TEST_DATABASE_URL: url.href,
      GOWM_DATABASE_URL: url.href,
    },
    timeout: 300000,
    encoding: 'utf8',
  });
  if (child.status !== 0) {
    // Do not print transport errors that might contain credentials.
    throw new Error(`PINNED_FIXTURE_INSTALL_FAILED:${args[0]}:${String(child.status)}`);
  }
  process.stdout.write(child.stdout);
}
const fixture = new Pool({ connectionString: url.href });
try {
  await fixture.query(`
    GRANT CONNECT ON DATABASE sdar_gowm_runtime_test TO sdar_gowm_consumer_test,sdar_gowm_peer_test;
    GRANT USAGE ON SCHEMA public,ugv_sdar,ugv_smpp,gowm_device,gowm_task,gowm_business_v1 TO sdar_gowm_consumer_test;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ugv_sdar TO sdar_gowm_consumer_test;
    GRANT SELECT ON ALL TABLES IN SCHEMA public,gowm_device,gowm_business_v1 TO sdar_gowm_consumer_test;
    GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA gowm_task TO sdar_gowm_consumer_test;
    GRANT SELECT ON ugv_smpp.provider_task TO sdar_gowm_consumer_test;
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ugv_sdar,gowm_task TO sdar_gowm_consumer_test;
    GRANT USAGE ON SCHEMA public,ugv_smpp,gowm_device TO sdar_gowm_peer_test;
    GRANT SELECT ON ALL TABLES IN SCHEMA gowm_device TO sdar_gowm_peer_test;
    GRANT SELECT,INSERT ON ugv_smpp.operation_snapshot TO sdar_gowm_peer_test;
    GRANT SELECT,INSERT,UPDATE ON ugv_smpp.provider_task TO sdar_gowm_peer_test;
  `);
} finally {
  await fixture.end();
}
const values = ['GOWM_BUSINESS_SMOKE_ENABLE=true'];
for (const [from, to] of [
  ['GOWM_BUSINESS_TEST_DATABASE_URL', 'GOWM_RUNTIME_TEST_DATABASE_URL'],
  ['GOWM_BUSINESS_CONSUMER_TEST_DATABASE_URL', 'GOWM_RUNTIME_CONSUMER_TEST_DATABASE_URL'],
  ['GOWM_BUSINESS_PEER_TEST_DATABASE_URL', 'GOWM_RUNTIME_PEER_TEST_DATABASE_URL'],
]) {
  const original = process.env[from!];
  assert.ok(original);
  const target = new URL(original);
  target.pathname = `/${targetName}`;
  values.push(`${to}=${target.href}`);
}
const path = '.state/gowm-storage/runtime-test.env';
await writeFile(path, values.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
await chmod(path, 0o600);
process.stdout.write(
  'PASS: clean pinned-contract runtime fixture database; private configuration saved.\n',
);
