import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { requireFreePorts, validateIsolatedCandidate } from './candidate-preflight.mjs';
test('candidate rejects occupied ports without selecting substitutes', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await assert.rejects(requireFreePorts([address.port]), /PORT_OCCUPIED/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('candidate requires loopback ports, isolated databases and manual confirmation', () => {
  const c = {
    SDAR_MANAGEMENT_HOST: '127.0.0.1',
    SDAR_MANAGEMENT_PORT: '11098',
    SDAR_A2A_HOST: '127.0.0.1',
    SDAR_A2A_PORT: '11099',
    SDAR_CONTROL_API_HOST: '127.0.0.1',
    SDAR_CONTROL_API_PORT: '10191',
    SDAR_STORAGE_MODE: 'standalone',
    SDAR_DEVELOPMENT_CONFIRMATION_POLICY: 'manual',
    SDAR_UGV_BOOTSTRAP_ENABLED: 'NO',
    SDAR_CONTROL_NODE_ID: 'sdar-zmq-candidate-test',
    SDAR_POSTGRES_URL: 'postgresql://127.0.0.1/sdar_zmq_candidate_runtime',
    SDAR_CONTROL_DATABASE_URL: 'postgresql://127.0.0.1/sdar_zmq_candidate_control',
    SDAR_CONTROL_RUNTIME_DATABASE_URL: 'postgresql://127.0.0.1/sdar_zmq_candidate_runtime',
  };
  assert.deepEqual(validateIsolatedCandidate(c), [11098, 11099, 10191]);
  assert.throws(() => validateIsolatedCandidate({ ...c, SDAR_A2A_HOST: '0.0.0.0' }), /LOOPBACK/);
  assert.throws(
    () => validateIsolatedCandidate({ ...c, SDAR_POSTGRES_URL: 'postgresql://127.0.0.1/sdar' }),
    /ISOLATION/,
  );
  assert.throws(
    () =>
      validateIsolatedCandidate({ ...c, SDAR_DEVELOPMENT_CONFIRMATION_POLICY: 'auto_non_weapon' }),
    /ISOLATION/,
  );
});
