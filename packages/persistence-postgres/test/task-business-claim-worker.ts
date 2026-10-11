import { appendFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { parseTaskBusinessCommandRecord } from '../../domain/src/task-business-command.js';
import { PostgresTaskBusinessCommandRepository } from '../src/task-business-command-repository.js';

// Static test worker, never imported by the Server. Only a freshly owned loopback test DB is valid.
const raw = process.env['SDAR_TEST_POSTGRES_URL'];
const path = process.env['SDAR_TEST_SEND_JOURNAL'];
if (raw === undefined || path === undefined)
  throw new Error('ISOLATED_WORKER_CONFIGURATION_REQUIRED');
const url = new URL(raw);
if (
  url.hostname !== '127.0.0.1' ||
  !/^\/sdar_smpp_commands_[a-f0-9]+$/u.test(url.pathname) ||
  !/^\/tmp\/sdar-smpp-two-process-[^/]+\/sent.jsonl$/u.test(path)
)
  throw new Error('ISOLATED_WORKER_SCOPE_DENIED');
const pool = new Pool({ connectionString: raw, max: 1 });
try {
  const record = parseTaskBusinessCommandRecord(
    JSON.parse(process.env['SDAR_TEST_COMMAND_RECORD'] ?? 'null'),
  );
  const repo = new PostgresTaskBusinessCommandRepository(pool, undefined, { dispatchLeaseMs: 100 });
  const claim = await repo.claim(record, record.intent.authority);
  if (claim === undefined) {
    process.stdout.write(JSON.stringify({ state: 'not_claimed' }) + '\n');
  } else {
    await appendFile(
      path,
      JSON.stringify({ intentId: claim.intent.intentId, hash: claim.intent.contentHash }) + '\n',
    );
    process.stdout.write(
      JSON.stringify({ state: 'claimed', intentId: claim.intent.intentId }) + '\n',
    );
    // Parent kills this process after the durable send seam, before any response can be recorded.
    await new Promise<void>(() => {
      setInterval(() => undefined, 1000);
    });
  }
} catch (error: unknown) {
  process.stdout.write(
    JSON.stringify({
      state: 'failed',
      code: error instanceof Error && 'code' in error ? String(error.code) : 'WORKER_FAILED',
    }) + '\n',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
