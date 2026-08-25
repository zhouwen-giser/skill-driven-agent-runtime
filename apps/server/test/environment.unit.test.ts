import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadServerEnvironment, parseServerEnvironment } from '../src/environment.js';

describe('server environment', () => {
  const isolatedEnvironmentKeys = [
    'SDAR_MASTER_KEY_BASE64',
    'SDAR_REDIS_PORT',
    'SDAR_A2A_PORT',
    'SDAR_A2A_WAIT_TIMEOUT_MS',
    'SDAR_MANAGEMENT_PORT',
  ] as const;
  const originalEnvironment = new Map(
    isolatedEnvironmentKeys.map((key) => [key, process.env[key]] as const),
  );
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const key of isolatedEnvironmentKeys) {
      const original = originalEnvironment.get(key);
      if (original === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = original;
    }

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
    for (const key of isolatedEnvironmentKeys) Reflect.deleteProperty(process.env, key);

    expect(loadServerEnvironment(envFilePath)).toMatchObject({
      SDAR_MASTER_KEY_BASE64: masterKey,
      SDAR_REDIS_PORT: 56379,
      SDAR_A2A_PORT: 9999,
      SDAR_A2A_WAIT_TIMEOUT_MS: 30_000,
      SDAR_MANAGEMENT_PORT: 9998,
      SDAR_TASK_UNDERSTANDING_PROFILE: 'off',
    });
  });

  it('accepts only explicit governed Task Understanding profiles', () => {
    const masterKey = randomBytes(32).toString('base64');
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_TASK_UNDERSTANDING_PROFILE: 'home_lab_read_only',
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
        SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
      }),
    ).toMatchObject({ SDAR_TASK_UNDERSTANDING_PROFILE: 'home_lab_read_only' });
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_TASK_UNDERSTANDING_PROFILE: 'managed_capability',
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
        SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
      }),
    ).toMatchObject({ SDAR_TASK_UNDERSTANDING_PROFILE: 'managed_capability' });
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_TASK_UNDERSTANDING_PROFILE: 'home_lab_read_only',
      }),
    ).toThrow('requires authenticated Node Control');
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_TASK_UNDERSTANDING_PROFILE: 'managed_capability',
      }),
    ).toThrow('requires authenticated Node Control');
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_TASK_UNDERSTANDING_PROFILE: 'always_on',
      }),
    ).toThrow();
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

  it('requires a complete trusted-human governed-control identity', () => {
    const masterKey = randomBytes(32).toString('base64');
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_GOVERNED_CONTROL_BEARER_TOKEN: 'g'.repeat(32),
        SDAR_GOVERNED_CONTROL_ACTOR_ID: 'human:operator-1',
        SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm,physical_control.revoke',
      }),
    ).toMatchObject({
      SDAR_GOVERNED_CONTROL_ACTOR_ID: 'human:operator-1',
      SDAR_GOVERNED_CONTROL_PERMISSIONS: ['physical_control.confirm', 'physical_control.revoke'],
    });
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_GOVERNED_CONTROL_BEARER_TOKEN: 'g'.repeat(32),
      }),
    ).toThrow('requires a human actor ID');
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_GOVERNED_CONTROL_ACTOR_ID: 'human:operator-1',
        SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm',
      }),
    ).toThrow('requires a bearer token');
  });

  it('allows an explicit trusted-intranet governed-control identity without a bearer token', () => {
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE: 'trusted_intranet',
        SDAR_GOVERNED_CONTROL_ACTOR_ID: 'human:local-operator',
        SDAR_GOVERNED_CONTROL_PERMISSIONS: 'physical_control.confirm',
      }),
    ).toMatchObject({
      SDAR_GOVERNED_CONTROL_AUTHENTICATION_MODE: 'trusted_intranet',
      SDAR_GOVERNED_CONTROL_ACTOR_ID: 'human:local-operator',
      SDAR_GOVERNED_CONTROL_PERMISSIONS: ['physical_control.confirm'],
    });
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

  it('requires a paired authenticated Node Control Capability Evidence reader', () => {
    const masterKey = randomBytes(32).toString('base64');
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
      }),
    ).toThrow('requires both base URL and service token');
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
        SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
      }),
    ).toMatchObject({
      SDAR_NODE_CONTROL_BASE_URL: 'http://127.0.0.1:9997',
      SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
    });
  });

  it('opens the Node Control outbound endpoint only under the explicit dual non-production gate', () => {
    const base = {
      SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
      SDAR_NODE_CONTROL_BASE_URL: 'http://192.168.1.7:10080',
      SDAR_NODE_CONTROL_EVIDENCE_SERVICE_TOKEN: 'n'.repeat(32),
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
    };
    expect(parseServerEnvironment({ ...base, NODE_ENV: 'test' })).toMatchObject({
      SDAR_CONTROL_OUTBOUND_ENDPOINT_POLICY: 'unsafe_test_open',
      SDAR_NODE_CONTROL_BASE_URL: 'http://192.168.1.7:10080',
    });
    expect(() => parseServerEnvironment(base)).toThrow('forbidden outside');
    expect(() => parseServerEnvironment({ ...base, NODE_ENV: 'production' })).toThrow(
      'forbidden outside',
    );
    expect(() =>
      parseServerEnvironment({ ...base, NODE_ENV: 'test', SDAR_CONTROL_ENVIRONMENT: 'production' }),
    ).toThrow('forbidden outside');
    expect(() =>
      parseServerEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_NODE_CONTROL_BASE_URL: 'file:///tmp/node-control.sock',
      }),
    ).toThrow('credential-free HTTP(S)');
    expect(() =>
      parseServerEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_NODE_CONTROL_BASE_URL: 'http://user:secret@192.168.1.7:10080',
      }),
    ).toThrow('credential-free HTTP(S)');
  });

  it('allows live MCP header omission only under an explicit non-production environment', () => {
    const base = {
      SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
      SDAR_MCP_LIVE_EXECUTION_MODE_HEADER: 'omit',
      SDAR_CONTROL_ENVIRONMENT: 'integration',
    } as const;
    expect(parseServerEnvironment({ ...base, NODE_ENV: 'test' })).toMatchObject({
      SDAR_MCP_LIVE_EXECUTION_MODE_HEADER: 'omit',
    });
    expect(() => parseServerEnvironment(base)).toThrow('explicit non-production');
    expect(() => parseServerEnvironment({ ...base, NODE_ENV: 'production' })).toThrow(
      'explicit non-production',
    );
    expect(() =>
      parseServerEnvironment({
        ...base,
        NODE_ENV: 'test',
        SDAR_CONTROL_ENVIRONMENT: 'production',
      }),
    ).toThrow('explicit non-production');
  });

  it('accepts only a bounded whitespace-free dedicated cognitive bearer', () => {
    const masterKey = randomBytes(32).toString('base64');
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN: 'c'.repeat(32),
      }),
    ).toMatchObject({ SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN: 'c'.repeat(32) });
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: masterKey,
        SDAR_COGNITIVE_MANAGEMENT_BEARER_TOKEN: `${'c'.repeat(32)} `,
      }),
    ).toThrow('must not contain whitespace');
  });

  it('accepts a complete real-model bootstrap environment', () => {
    expect(
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
        SDAR_UGV_MODEL_PROVIDER_ID: 'provider-real',
        SDAR_UGV_MODEL_BASE_URL: 'https://models.example.test/v1',
        SDAR_UGV_MODEL_NAME: 'model-real',
        SDAR_UGV_MODEL_EMBEDDING_NAME: 'embedding-real',
        SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
        SDAR_UGV_MODEL_API_KEY: 'model-secret',
      }),
    ).toMatchObject({
      SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
      SDAR_UGV_MODEL_PROVIDER_ID: 'provider-real',
      SDAR_UGV_MODEL_BASE_URL: 'https://models.example.test/v1',
      SDAR_UGV_MODEL_NAME: 'model-real',
      SDAR_UGV_MODEL_EMBEDDING_NAME: 'embedding-real',
      SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
      SDAR_UGV_MODEL_API_KEY: 'model-secret',
      SDAR_UGV_MODEL_TIMEOUT_MS: 30_000,
    });
  });

  it('rejects an incomplete enabled real-model bootstrap environment', () => {
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
        SDAR_UGV_MODEL_API_KEY: 'model-secret',
      }),
    ).toThrow('is required when real-model bootstrap is enabled');
  });

  it('requires exactly one real-model API key source', () => {
    const completeEnvironment = {
      SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
      SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
      SDAR_UGV_MODEL_PROVIDER_ID: 'provider-real',
      SDAR_UGV_MODEL_BASE_URL: 'https://models.example.test/v1',
      SDAR_UGV_MODEL_NAME: 'model-real',
      SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
    } as const;

    expect(() => parseServerEnvironment(completeEnvironment)).toThrow(
      'Exactly one of SDAR_UGV_MODEL_API_KEY or SDAR_UGV_MODEL_API_KEY_FILE is required.',
    );
    expect(() =>
      parseServerEnvironment({
        ...completeEnvironment,
        SDAR_UGV_MODEL_API_KEY: 'inline-secret',
        SDAR_UGV_MODEL_API_KEY_FILE: '/run/secrets/model-api-key',
      }),
    ).toThrow('Exactly one of SDAR_UGV_MODEL_API_KEY or SDAR_UGV_MODEL_API_KEY_FILE is required.');
  });

  it('rejects embedding bootstrap for an Anthropic Provider', () => {
    expect(() =>
      parseServerEnvironment({
        SDAR_MASTER_KEY_BASE64: randomBytes(32).toString('base64'),
        SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
        SDAR_UGV_MODEL_PROVIDER_ID: 'provider-real',
        SDAR_UGV_MODEL_BASE_URL: 'https://models.example.test/v1',
        SDAR_UGV_MODEL_NAME: 'model-real',
        SDAR_UGV_MODEL_EMBEDDING_NAME: 'embedding-real',
        SDAR_UGV_MODEL_API_STYLE: 'anthropic_messages',
        SDAR_UGV_MODEL_API_KEY: 'model-secret',
      }),
    ).toThrow('Embedding bootstrap requires an OpenAI-compatible Provider.');
  });
});
