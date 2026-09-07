import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadEnvironmentFile } from '../src/index.js';

describe('environment file loading', () => {
  it('preserves existing process/CLI overrides and parses secrets as literal data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdar-env-test-'));
    try {
      const path = join(dir, '.env');
      writeFileSync(path, `PORT=100\nEMPTY=\nSECRET='a$HOME#b=c'\nSCOPE='{"tenantId":"a"}'\n`);
      const target: NodeJS.ProcessEnv = { PORT: '200' };
      loadEnvironmentFile(path, target);
      expect(target).toEqual({
        PORT: '200',
        EMPTY: '',
        SECRET: 'a$HOME#b=c',
        SCOPE: '{"tenantId":"a"}',
      });
      expect(() => {
        loadEnvironmentFile(join(dir, 'absent'), {});
      }).toThrow('SDAR_ENV_FILE_UNREADABLE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
