import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadServerEnvironment } from '../src/environment.js';

describe('server environment', () => {
  const originalMasterKey = process.env['SDAR_MASTER_KEY_BASE64'];
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    if (originalMasterKey === undefined) delete process.env['SDAR_MASTER_KEY_BASE64'];
    else process.env['SDAR_MASTER_KEY_BASE64'] = originalMasterKey;

    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('loads the master key from a local env file before validation', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-server-env-'));
    temporaryDirectories.push(directory);
    const masterKey = randomBytes(32).toString('base64');
    const envFilePath = join(directory, '.env');
    writeFileSync(envFilePath, `SDAR_MASTER_KEY_BASE64=${masterKey}\n`, 'utf8');
    delete process.env['SDAR_MASTER_KEY_BASE64'];

    expect(loadServerEnvironment(envFilePath)).toMatchObject({
      SDAR_MASTER_KEY_BASE64: masterKey,
      SDAR_REDIS_PORT: 56379,
      SDAR_A2A_PORT: 9999,
      SDAR_MANAGEMENT_PORT: 9998,
    });
  });
});
