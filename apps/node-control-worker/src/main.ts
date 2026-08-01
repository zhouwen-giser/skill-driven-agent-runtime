import process from 'node:process';

import { Pool } from 'pg';

import { NodeControlFoundationWorker } from '../../../packages/node-control-application/src/index.js';
import { PostgresNodeControlFoundationRepository } from '../../../packages/node-control-persistence-postgres/src/index.js';
import { loadNodeControlWorkerEnvironment } from './environment.js';

const environment = loadNodeControlWorkerEnvironment();
const pool = new Pool({ connectionString: environment.SDAR_CONTROL_DATABASE_URL, max: 4 });
const repository = new PostgresNodeControlFoundationRepository(pool);
await repository.migrate();
const worker = new NodeControlFoundationWorker({
  repository,
  clock: { now: () => new Date().toISOString() },
});

if (environment.SDAR_CONTROL_WORKER_ONCE === 'true') {
  const cycle = await worker.runOnce();
  process.stdout.write(`${JSON.stringify({ event: 'node_control.worker.ready', ...cycle })}\n`);
  await pool.end();
} else {
  process.stdout.write(`${JSON.stringify({ event: 'node_control.worker.ready' })}\n`);
  const timer = setInterval(() => {
    void worker.runOnce().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ event: 'node_control.worker.cycle_failed', error: summarize(error) })}\n`,
      );
    });
  }, environment.SDAR_CONTROL_WORKER_POLL_MS);
  timer.unref();
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await pool.end();
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
}

function summarize(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_WORKER_ERROR';
}
