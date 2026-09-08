import { randomBytes } from 'node:crypto';
import { appendFile, chmod } from 'node:fs/promises';
import { Pool } from 'pg';

// Explicit one-time fixture provisioning, never imported by Server or smoke.
const raw = process.env['GOWM_BUSINESS_TEST_DATABASE_URL'];
if (!raw || process.env['GOWM_BUSINESS_SMOKE_ENABLE'] !== 'true')
  throw new Error('ISOLATED_TEST_CONFIGURATION_REQUIRED');
const url = new URL(raw);
if (
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.port !== '55490' ||
  url.pathname !== '/sdar_gowm_integration_test'
)
  throw new Error('OWNED_GOWM_TEST_DATABASE_REQUIRED');
const admin = new Pool({ connectionString: raw });
const client = await admin.connect();
try {
  if (
    (await client.query('SELECT current_database() name')).rows[0]?.name !==
    'sdar_gowm_integration_test'
  )
    throw new Error('TEST_DATABASE_IDENTITY_MISMATCH');
  await client.query('BEGIN');
  const urls: string[] = [];
  for (const [role, variable] of [
    ['sdar_gowm_consumer_test', 'GOWM_BUSINESS_CONSUMER_TEST_DATABASE_URL'],
    ['sdar_gowm_peer_test', 'GOWM_BUSINESS_PEER_TEST_DATABASE_URL'],
  ]) {
    const password = randomBytes(32).toString('hex');
    // Role names and password alphabet are generated locally, not request data.
    const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
    if (exists.rowCount === 0)
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    else throw new Error('TEST_ROLE_ALREADY_EXISTS_USE_SAVED_CONFIGURATION');
    await client.query(`GRANT CONNECT ON DATABASE sdar_gowm_integration_test TO ${role}`);
    const target = new URL(raw);
    target.username = role!;
    target.password = password;
    urls.push(`${variable}=${target.href}`);
  }
  await client.query(
    'GRANT USAGE ON SCHEMA public,ugv_sdar,ugv_smpp,gowm_device,gowm_task,gowm_business_v1 TO sdar_gowm_consumer_test',
  );
  await client.query(
    'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ugv_sdar TO sdar_gowm_consumer_test',
  );
  await client.query(
    'GRANT SELECT ON ALL TABLES IN SCHEMA public,gowm_device,gowm_business_v1 TO sdar_gowm_consumer_test',
  );
  await client.query(
    'GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA gowm_task TO sdar_gowm_consumer_test',
  );
  await client.query('GRANT SELECT ON ugv_smpp.provider_task TO sdar_gowm_consumer_test');
  await client.query(
    'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ugv_sdar,gowm_task TO sdar_gowm_consumer_test',
  );
  await client.query('GRANT USAGE ON SCHEMA public,ugv_smpp,gowm_device TO sdar_gowm_peer_test');
  await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA gowm_device TO sdar_gowm_peer_test');
  await client.query('GRANT SELECT,INSERT ON ugv_smpp.operation_snapshot TO sdar_gowm_peer_test');
  await client.query('GRANT SELECT,INSERT,UPDATE ON ugv_smpp.provider_task TO sdar_gowm_peer_test');
  await client.query('COMMIT');
  const path = '.state/gowm-storage/test.env';
  await appendFile(path, `\n${urls.join('\n')}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  process.stdout.write(
    'PASS: isolated consumer and synthetic peer roles created; credentials saved only in ignored private test configuration.\n',
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await admin.end();
}
