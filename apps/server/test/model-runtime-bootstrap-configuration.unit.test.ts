import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseServerEnvironment } from '../src/environment.js';
import { modelRuntimeBootstrapConfiguration } from '../src/model-runtime-bootstrap-configuration.js';

describe('modelRuntimeBootstrapConfiguration', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('maps an inline OpenAI-compatible key to a bearer credential header', async () => {
    const environment = parseServerEnvironment({
      SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
      SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
      SDAR_UGV_MODEL_PROVIDER_ID: 'openai-real',
      SDAR_UGV_MODEL_BASE_URL: 'https://models.example.test/v1',
      SDAR_UGV_MODEL_NAME: 'model-real',
      SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
      SDAR_UGV_MODEL_API_KEY: 'inline-model-secret',
      SDAR_UGV_MODEL_TIMEOUT_MS: '45000',
    });

    await expect(modelRuntimeBootstrapConfiguration(environment)).resolves.toEqual({
      providerId: 'openai-real',
      name: 'openai-real',
      kind: 'openai_compatible',
      apiStyle: 'openai_chat_completions',
      baseUrl: 'https://models.example.test/v1',
      model: 'model-real',
      enabled: true,
      timeoutMs: 45_000,
      credentialHeaders: { Authorization: 'Bearer inline-model-secret' },
    });
  });

  it('reads an Anthropic key from the configured file and maps it to x-api-key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'sdar-model-key-'));
    temporaryDirectories.push(directory);
    const apiKeyFile = join(directory, 'model-api-key');
    writeFileSync(apiKeyFile, 'file-model-secret\n', { encoding: 'utf8', mode: 0o600 });
    const environment = parseServerEnvironment({
      SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 2).toString('base64'),
      SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
      SDAR_UGV_MODEL_PROVIDER_ID: 'anthropic-real',
      SDAR_UGV_MODEL_BASE_URL: 'https://api.anthropic.example.test',
      SDAR_UGV_MODEL_NAME: 'claude-real',
      SDAR_UGV_MODEL_API_STYLE: 'anthropic_messages',
      SDAR_UGV_MODEL_API_KEY_FILE: apiKeyFile,
    });

    await expect(modelRuntimeBootstrapConfiguration(environment)).resolves.toEqual({
      providerId: 'anthropic-real',
      name: 'anthropic-real',
      kind: 'other_vendor',
      apiStyle: 'anthropic_messages',
      baseUrl: 'https://api.anthropic.example.test',
      model: 'claude-real',
      enabled: true,
      timeoutMs: 30_000,
      credentialHeaders: { 'x-api-key': 'file-model-secret' },
    });
  });

  it('derives an explicit embedding Provider with the shared OpenAI-compatible transport', async () => {
    const environment = parseServerEnvironment({
      SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 4).toString('base64'),
      SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
      SDAR_UGV_MODEL_PROVIDER_ID: 'openai-real',
      SDAR_UGV_MODEL_BASE_URL: 'https://models.example.test/v1',
      SDAR_UGV_MODEL_NAME: 'structured-real',
      SDAR_UGV_MODEL_EMBEDDING_NAME: 'embedding-real',
      SDAR_UGV_MODEL_EMBEDDING_BASE_URL: 'https://embeddings.example.test/v1',
      SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
      SDAR_UGV_MODEL_API_KEY: 'inline-model-secret',
    });

    await expect(modelRuntimeBootstrapConfiguration(environment)).resolves.toMatchObject({
      providerId: 'openai-real',
      model: 'structured-real',
      embeddingProvider: {
        providerId: 'openai-real-embedding',
        name: 'openai-real-embedding',
        kind: 'openai_compatible',
        apiStyle: 'openai_chat_completions',
        baseUrl: 'https://embeddings.example.test/v1',
        model: 'embedding-real',
        enabled: true,
        timeoutMs: 30_000,
        credentialHeaders: { Authorization: 'Bearer inline-model-secret' },
      },
    });
  });

  it('disables bootstrap without reading Provider credentials', async () => {
    const environment = parseServerEnvironment({
      SDAR_MASTER_KEY_BASE64: Buffer.alloc(32, 3).toString('base64'),
      SDAR_UGV_REAL_MODEL_ENABLED: 'NO',
    });

    await expect(modelRuntimeBootstrapConfiguration(environment)).resolves.toBeUndefined();
  });
});
