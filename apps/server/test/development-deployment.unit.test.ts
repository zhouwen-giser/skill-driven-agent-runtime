import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseServerEnvironment } from '../src/environment.js';
import { parseNodeControlApiEnvironment } from '../../node-control-api/src/environment.js';
import { parseNodeControlWorkerEnvironment } from '../../node-control-worker/src/environment.js';
// Deployment modules are intentionally JS so init works before application compilation.
import {
  initialize,
  readConfiguration,
  render,
  serviceEnvironment,
} from '../../../deploy/development/config.mjs';
import { missingEnvironmentExamples } from '../../../scripts/environment-inventory.mjs';

describe('development deployment configuration', () => {
  it('covers runtime environment reads in the canonical template', () => {
    expect(missingEnvironmentExamples(resolve('.'))).toEqual([]);
  });
  it('generates secrets once, retains them and routes containers without exposing secret values in compose', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-deploy-test-'));
    try {
      const path = join(directory, '.env');
      initialize(path);
      const before = readFileSync(path, 'utf8');
      expect(initialize(path).status).toBe('preserved');
      expect(readFileSync(path, 'utf8')).toBe(before);
      const config = readConfiguration(
        path,
        { SDAR_A2A_PORT: '11999' },
        { SDAR_A2A_PORT: '12000' },
      );
      expect(config['SDAR_A2A_PORT']).toBe('11999');
      const effective = serviceEnvironment(config);
      expect(parseServerEnvironment(effective).SDAR_DEVELOPMENT_CONFIRMATION_POLICY).toBe(
        'auto_non_weapon',
      );
      expect(parseNodeControlApiEnvironment(effective).SDAR_DEVELOPMENT_PUBLIC_ACCESS).toBe('open');
      expect(parseNodeControlWorkerEnvironment(effective).SDAR_CONTROL_WORKER_ONCE).toBe('false');
      expect(effective['SDAR_REDIS_PASSWORD']).toBe(config['SDAR_REDIS_PASSWORD']);
      expect(effective['SDAR_A2A_PUBLIC_BASE_URL']).toBe('http://localhost:11999');
      const output = render(config, path, 'test');
      const compose = readFileSync(output.composePath, 'utf8');
      expect(compose).not.toContain(config['SDAR_REDIS_PASSWORD']);
      expect(compose).not.toContain(config['SDAR_MASTER_KEY_BASE64']);
      const parsedCompose: unknown = JSON.parse(compose);
      expect(parsedCompose).toMatchObject({
        services: { runtime: { ports: expect.arrayContaining(['0.0.0.0:11999:10999']) } },
      });
      expect(() =>
        render({ ...config, SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 1).toString('base64') }, path),
      ).toThrow('DEVELOPMENT_MASTER_KEY_ROTATION_REQUIRES_MIGRATION');
      expect(() => render({ ...config, SDAR_REDIS_PASSWORD: 'changed' }, path)).toThrow(
        'DEVELOPMENT_DATABASE_IDENTITY_CHANGE_REQUIRES_MIGRATION:SDAR_REDIS_PASSWORD',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
