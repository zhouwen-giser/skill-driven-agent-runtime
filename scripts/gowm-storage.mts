import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Pool } from 'pg';
import { z } from 'zod';

import {
  gowmSharedPoolConfiguration,
  verifyGowmStorageContract,
} from '../packages/persistence-postgres/src/gowm-storage-contract.js';

const mode = process.argv[2] ?? 'help';
const directory = resolve(
  process.env['SDAR_GOWM_CONTRACT_DIR'] ?? 'contracts/gowm-shared-storage/current',
);
const FileSchema = z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/u) });
const SourceSchema = z.object({
  commit: z.string().regex(/^[a-f0-9]{40}$/u),
  files: z.array(FileSchema),
  derivedFiles: z.array(FileSchema),
  nativeSources: z.array(FileSchema),
});

try {
  if (mode === 'help' || process.argv.includes('--help')) {
    process.stdout.write(
      'GOWM shared storage: check (offline), verify (read-only database).\nverify requires GOWM_BUSINESS_TEST_DATABASE_URL and GOWM_BUSINESS_SMOKE_ENABLE=true.\nNo Docker, migrations, device operations, or running-instance switch.\n',
    );
  } else if (mode === 'check') {
    const source = SourceSchema.parse(
      JSON.parse(await readFile(resolve(directory, 'source.json'), 'utf8')) as unknown,
    );
    let checked = 0;
    for (const [root, files] of [
      [directory, [...source.files, ...source.derivedFiles]],
      [process.cwd(), source.nativeSources],
    ] as const) {
      for (const file of files) {
        const actual = createHash('sha256')
          .update(await readFile(resolve(root, file.path)))
          .digest('hex');
        if (actual !== file.sha256) throw new Error(`GOWM_CONTRACT_SOURCE_DRIFT:${file.path}`);
        checked++;
      }
    }
    process.stdout.write(
      `${JSON.stringify({ status: 'PASS', scope: 'offline-contract-integrity-only', upstreamCommit: source.commit, checked })}\n`,
    );
  } else if (mode === 'verify') {
    const url = process.env['GOWM_BUSINESS_TEST_DATABASE_URL'];
    if (!url || process.env['GOWM_BUSINESS_SMOKE_ENABLE'] !== 'true') {
      process.stdout.write('NOT_RUN: explicit isolated test database and smoke enable required.\n');
      process.exitCode = 2;
    } else {
      const pool = new Pool(gowmSharedPoolConfiguration(url));
      try {
        const client = await pool.connect();
        try {
          await verifyGowmStorageContract(client, directory);
        } finally {
          client.release();
        }
        process.stdout.write('PASS: read-only SDAR storage consumption check.\n');
      } finally {
        await pool.end();
      }
    }
  } else {
    throw new Error('GOWM_STORAGE_COMMAND_UNKNOWN');
  }
} catch (error: unknown) {
  // SQL/connection errors may contain connection details; emit only stable diagnostics.
  const code =
    error instanceof Error && error.message.startsWith('GOWM_')
      ? error.message
      : 'GOWM_STORAGE_CHECK_FAILED';
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
