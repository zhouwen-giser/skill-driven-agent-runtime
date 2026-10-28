import process from 'node:process';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import { pathToFileURL, URL } from 'node:url';

export function validateIsolatedCandidate(c) {
  for (const [prefix, port] of [
    ['SDAR_MANAGEMENT', '11098'],
    ['SDAR_A2A', '11099'],
    ['SDAR_CONTROL_API', '10191'],
  ]) {
    if (c[prefix + '_HOST'] !== '127.0.0.1' || c[prefix + '_PORT'] !== port)
      throw Error('ZMQ_CANDIDATE_LOOPBACK_PORT_REQUIRED');
  }
  if (
    c.SDAR_STORAGE_MODE !== 'standalone' ||
    c.SDAR_DEVELOPMENT_CONFIRMATION_POLICY !== 'manual' ||
    c.SDAR_UGV_BOOTSTRAP_ENABLED !== 'NO' ||
    !/^sdar-zmq-candidate-[a-z0-9-]+$/.test(c.SDAR_CONTROL_NODE_ID ?? '')
  )
    throw Error('ZMQ_CANDIDATE_ISOLATION_REQUIRED');
  for (const field of [
    'SDAR_POSTGRES_URL',
    'SDAR_CONTROL_DATABASE_URL',
    'SDAR_CONTROL_RUNTIME_DATABASE_URL',
  ]) {
    const url = new URL(c[field]);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      !/^\/sdar_zmq_candidate_[a-z0-9_]+$/.test(url.pathname)
    )
      throw Error('ZMQ_CANDIDATE_DATABASE_ISOLATION_REQUIRED');
  }
  return [11098, 11099, 10191];
}
export async function requireFreePorts(ports) {
  const reserved = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once('error', () => reject(Error('ZMQ_CANDIDATE_PORT_OCCUPIED:' + String(port))));
        server.listen(port, '127.0.0.1', resolve);
      });
      reserved.push(server);
    }
  } finally {
    await Promise.all(reserved.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || process.argv.length !== 3) throw Error('ZMQ_CANDIDATE_CONFIGURATION_REQUIRED');
  if ((await stat(file)).mode & 0o077) throw Error('ZMQ_SITE_PRIVATE_CONFIGURATION_REQUIRED');
  const ports = validateIsolatedCandidate(JSON.parse(await readFile(file, 'utf8')));
  await requireFreePorts(ports);
  process.stdout.write(
    JSON.stringify({
      status: 'preflight_passed',
      ports,
      storage: 'isolated',
      physicalToolInvocationCount: 0,
    }) + '\n',
  );
}
