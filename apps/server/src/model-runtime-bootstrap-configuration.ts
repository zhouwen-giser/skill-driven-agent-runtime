import { readFile, stat } from 'node:fs/promises';

import type { InitialModelProviderConfiguration } from '../../../packages/application/src/index.js';

import type { ServerEnvironment } from './environment.js';

const MAX_MODEL_API_KEY_FILE_BYTES = 64 * 1024;

export async function modelRuntimeBootstrapConfiguration(
  environment: ServerEnvironment,
): Promise<InitialModelProviderConfiguration | undefined> {
  if (environment.SDAR_UGV_REAL_MODEL_ENABLED !== 'YES') return undefined;
  const providerId = environment.SDAR_UGV_MODEL_PROVIDER_ID;
  const baseUrl = environment.SDAR_UGV_MODEL_BASE_URL;
  const model = environment.SDAR_UGV_MODEL_NAME;
  const apiStyle = environment.SDAR_UGV_MODEL_API_STYLE;
  if (
    providerId === undefined ||
    baseUrl === undefined ||
    model === undefined ||
    apiStyle === undefined
  )
    throw new Error('MODEL_BOOTSTRAP_ENVIRONMENT_INVALID');

  const apiKey =
    environment.SDAR_UGV_MODEL_API_KEY ??
    (await readModelApiKeyFile(environment.SDAR_UGV_MODEL_API_KEY_FILE));
  const credentialHeaders = Object.freeze(
    apiStyle === 'openai_chat_completions'
      ? { Authorization: `Bearer ${apiKey}` }
      : { 'x-api-key': apiKey },
  );
  const embeddingModel = environment.SDAR_UGV_MODEL_EMBEDDING_NAME;
  if (embeddingModel !== undefined && apiStyle !== 'openai_chat_completions')
    throw new Error('MODEL_BOOTSTRAP_EMBEDDING_API_STYLE_UNSUPPORTED');
  return Object.freeze({
    providerId,
    name: providerId,
    kind: apiStyle === 'openai_chat_completions' ? 'openai_compatible' : 'other_vendor',
    apiStyle,
    baseUrl,
    model,
    enabled: true,
    timeoutMs: environment.SDAR_UGV_MODEL_TIMEOUT_MS,
    credentialHeaders,
    ...(embeddingModel === undefined
      ? {}
      : {
          embeddingProvider: Object.freeze({
            providerId:
              environment.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID ?? `${providerId}-embedding`,
            name: environment.SDAR_UGV_MODEL_EMBEDDING_PROVIDER_ID ?? `${providerId}-embedding`,
            kind: 'openai_compatible' as const,
            apiStyle: 'openai_chat_completions' as const,
            baseUrl: environment.SDAR_UGV_MODEL_EMBEDDING_BASE_URL ?? baseUrl,
            model: embeddingModel,
            enabled: true as const,
            timeoutMs: environment.SDAR_UGV_MODEL_TIMEOUT_MS,
            credentialHeaders,
          }),
        }),
  });
}

async function readModelApiKeyFile(path: string | undefined): Promise<string> {
  if (path === undefined) throw new Error('MODEL_BOOTSTRAP_ENVIRONMENT_INVALID');
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > MAX_MODEL_API_KEY_FILE_BYTES)
      throw new Error('MODEL_BOOTSTRAP_API_KEY_FILE_INVALID');
    const apiKey = (await readFile(path, 'utf8')).trim();
    if (apiKey === '' || /\s/u.test(apiKey))
      throw new Error('MODEL_BOOTSTRAP_API_KEY_FILE_INVALID');
    return apiKey;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'MODEL_BOOTSTRAP_API_KEY_FILE_INVALID')
      throw error;
    throw new Error('MODEL_BOOTSTRAP_API_KEY_FILE_INVALID', { cause: error });
  }
}
