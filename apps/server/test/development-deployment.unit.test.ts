import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseServerEnvironment } from '../src/environment.js';
import { parseNodeControlApiEnvironment } from '../../node-control-api/src/environment.js';
import { parseNodeControlWorkerEnvironment } from '../../node-control-worker/src/environment.js';
// Deployment modules are intentionally JS so init works before application compilation.
import {
  initialize,
  writeConfiguration,
  readConfiguration,
  render,
  serviceEnvironment,
} from '../../../deploy/development/config.mjs';
import { missingEnvironmentExamples } from '../../../scripts/environment-inventory.mjs';

describe('development deployment configuration', () => {
  it('covers runtime environment reads in the canonical template', () => {
    expect(missingEnvironmentExamples(resolve('.'))).toEqual([]);
  });
  it('round-trips JSON device scopes and literal dollars through private dotenv files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-dotenv-regression-'));
    try {
      const path = join(directory, '.env');
      const c = {
        SDAR_ALLOWED_DEVICE_IDS: '["ugv:ugv"]',
        GOWM_DATABASE_URL: 'postgresql://user:literal$dollar@postgres/gowm',
      };
      writeConfiguration(path, c);
      expect(readConfiguration(path, {}, {})).toMatchObject(c);
      expect(() => {
        writeConfiguration(path, { BAD: "can't quote" });
      }).toThrow('DEVELOPMENT_DOTENV_VALUE_UNSUPPORTED');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('packages source without enumerating an oversized historical report inventory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-package-regression-'));
    try {
      mkdirSync(join(directory, 'deploy/development'), { recursive: true });
      mkdirSync(join(directory, 'bin'));
      for (const name of ['config.mjs', 'package.mjs'])
        copyFileSync(
          resolve('deploy/development', name),
          join(directory, 'deploy/development', name),
        );
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      const git = join(directory, 'bin/git');
      writeFileSync(
        git,
        `#!${process.execPath}
if(process.argv[2]==='ls-files'){process.stdout.write(process.argv.includes(':!:reports')?'package.json\\0':('reports/'+ 'x'.repeat(200)+'\\0').repeat(10000))}else{process.stdout.write('a'.repeat(40))}`,
        { mode: 0o755 },
      );
      const output: unknown = JSON.parse(
        execFileSync(process.execPath, [join(directory, 'deploy/development/package.mjs')], {
          cwd: directory,
          encoding: 'utf8',
          env: { ...process.env, PATH: join(directory, 'bin') + ':' + (process.env['PATH'] ?? '') },
        }),
      );
      expect(output).toMatchObject({ fileCount: 1, secretsIncluded: false });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('uses existing GOWM and separate control databases without creating PostgreSQL services', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-shared-deploy-'));
    try {
      const path = join(directory, '.env');
      initialize(path);
      const config = readConfiguration(
        path,
        {
          SDAR_STORAGE_MODE: 'gowm-shared',
          GOWM_DATABASE_URL: 'postgresql://ugv_sdar_app:private@postgres:5432/gowm',
          SDAR_CONTROL_DATABASE_URL: 'postgresql://sdar_control:private@postgres:5432/sdar_control',
          SDAR_DEPLOY_EXTERNAL_NETWORK: 'existing-gowm',
        },
        {},
      );
      const output = render(config, path);
      expect(output.services.sort()).toEqual(['control-api', 'control-worker', 'redis', 'runtime']);
      const compose = readFileSync(output.composePath, 'utf8');
      expect(compose).not.toContain('private');
      expect(compose).not.toContain('runtime-data');
      expect(JSON.parse(compose)).toMatchObject({
        networks: { gowm: { external: true, name: 'existing-gowm' } },
      });
      const effective = serviceEnvironment(config);
      expect(effective['SDAR_POSTGRES_URL']).toBe(config['GOWM_DATABASE_URL']);
      expect(effective['SDAR_CONTROL_RUNTIME_DATABASE_URL']).toBe(config['GOWM_DATABASE_URL']);
      expect(effective['SDAR_CONTROL_DATABASE_URL']).toBe(config['SDAR_CONTROL_DATABASE_URL']);
      expect(() =>
        render(
          {
            ...config,
            SDAR_CONTROL_DATABASE_URL: 'postgresql://ugv_sdar_app:private@postgres:5432/gowm',
          },
          path,
        ),
      ).toThrow('DEVELOPMENT_CONTROL_DATABASE_MUST_BE_SEPARATE');
      expect(() =>
        render(
          {
            ...config,
            GOWM_DATABASE_URL: 'postgresql://ugv_sdar_app:private@postgres:5432/gowm?options=bad',
          },
          path,
        ),
      ).toThrow('DEVELOPMENT_SHARED_DATABASE_INVALID');
      expect(() =>
        render(
          { ...config, GOWM_DATABASE_URL: 'postgresql://other:private@postgres:5432/gowm' },
          path,
        ),
      ).toThrow('DEVELOPMENT_DATABASE_IDENTITY_CHANGE_REQUIRES_MIGRATION');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
