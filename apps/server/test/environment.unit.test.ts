import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadServerEnvironment, parseServerEnvironment } from '../src/environment.js';

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

  it('rejects accidental non-loopback unauthenticated bindings', () => {
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_A2A_HOST: '0.0.0.0',
        SDAR_MANAGEMENT_HOST: '10.10.0.5',
      }),
    ).toThrow('requires explicit trusted-network acknowledgement');
  });

  it('allows a non-loopback trusted-network binding only after explicit acknowledgement', () => {
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_A2A_HOST: '0.0.0.0',
        SDAR_MANAGEMENT_HOST: '10.10.0.5',
        SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: 'true',
      }),
    ).toMatchObject({
      SDAR_A2A_HOST: '0.0.0.0',
      SDAR_MANAGEMENT_HOST: '10.10.0.5',
      SDAR_ACKNOWLEDGE_NO_AUTH_NETWORK_EXPOSURE: 'true',
    });
  });

  it('parses a complete Artifact management bearer identity', () => {
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: 'a'.repeat(32),
        SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
        SDAR_ARTIFACT_MANAGEMENT_TENANT_ID: 'tenant-1',
        SDAR_ARTIFACT_MANAGEMENT_KIND: 'service',
        SDAR_ARTIFACT_MANAGEMENT_ROLES: 'viewer,operator',
      }),
    ).toMatchObject({
      SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
      SDAR_ARTIFACT_MANAGEMENT_TENANT_ID: 'tenant-1',
      SDAR_ARTIFACT_MANAGEMENT_KIND: 'service',
      SDAR_ARTIFACT_MANAGEMENT_ROLES: ['viewer', 'operator'],
    });
  });

  it('requires actor and roles whenever Artifact management bearer authentication is enabled', () => {
    const base = {
      SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
      SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: 'a'.repeat(32),
    };

    expect(() => parseServerEnvironment(base)).toThrow(
      'Artifact management bearer authentication requires an actor ID.',
    );
    expect(() =>
      parseServerEnvironment({
        ...base,
        SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
      }),
    ).toThrow('Artifact management bearer authentication requires at least one role.');
  });

  it('maps a distinct Runtime Control service token onto the configured Artifact identity', () => {
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: 'r'.repeat(32),
        SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: 'a'.repeat(32),
        SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
        SDAR_ARTIFACT_MANAGEMENT_ROLES: 'administrator',
      }),
    ).toMatchObject({
      SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: 'r'.repeat(32),
      SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: 'a'.repeat(32),
    });

    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_RUNTIME_CONTROL_SERVICE_TOKEN: 'r'.repeat(32),
      }),
    ).toThrow('requires the existing Artifact management identity');
  });

  it('rejects malformed or incomplete Artifact management identity configuration', () => {
    const masterKey = randomBytes(32).toString('base64');

    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: `${'a'.repeat(32)} `,
        SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
        SDAR_ARTIFACT_MANAGEMENT_ROLES: 'operator',
      }),
    ).toThrow('must not contain whitespace');
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
        SDAR_ARTIFACT_MANAGEMENT_ROLES: 'administrator',
      }),
    ).toThrow('requires a bearer token');
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_ARTIFACT_MANAGEMENT_BEARER_TOKEN: 'a'.repeat(32),
        SDAR_ARTIFACT_MANAGEMENT_ACTOR_ID: 'operator-1',
        SDAR_ARTIFACT_MANAGEMENT_ROLES: 'root',
      }),
    ).toThrow();
  });
});
