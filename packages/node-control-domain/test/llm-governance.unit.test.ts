import { describe, expect, it } from 'vitest';

import {
  createLlmProviderDefinition,
  createModelRouteDefinition,
  type LlmProviderDefinition,
  type ModelRouteDefinition,
} from '../src/index.js';

describe('P03 LLM governance domain', () => {
  it('accepts only secret references and a unique capable model catalog', () => {
    expect(createLlmProviderDefinition(provider())).toMatchObject({
      providerId: 'provider-primary',
      credentialRef: 'runtime-model-provider://bootstrap-primary',
      secretStatus: 'unknown',
    });
    expect(() =>
      createLlmProviderDefinition({ ...provider(), credentialRef: 'Bearer plaintext-value' }),
    ).toThrow('opaque SecretRef');
    const firstModel = provider().models[0];
    if (firstModel === undefined) throw new Error('P03_MODEL_FIXTURE_MISSING');
    expect(() =>
      createLlmProviderDefinition({
        ...provider(),
        models: [firstModel, firstModel],
      }),
    ).toThrow('modelId values must be unique');
  });

  it('normalizes stage/task/case selectors and rejects duplicate fallback candidates', () => {
    expect(createModelRouteDefinition(route())).toMatchObject({
      stage: 'planning',
      budgetPolicy: { selector: { scope: 'task', key: 'inspection' }, maxAttempts: 2 },
    });
    expect(() =>
      createModelRouteDefinition({
        ...route(),
        fallbacks: [route().primary],
      }),
    ).toThrow('provider/model pairs must be unique');
    expect(() =>
      createModelRouteDefinition({
        ...route(),
        budgetPolicy: { ...route().budgetPolicy, selector: { scope: 'case' } },
      }),
    ).toThrow('selectors require a bounded key');
  });
});

function provider(): LlmProviderDefinition {
  return {
    providerId: 'provider-primary',
    providerType: 'openai_compatible',
    baseUrl: 'https://models.example.test/v1',
    credentialRef: 'runtime-model-provider://bootstrap-primary',
    models: [
      {
        modelId: 'model-a',
        capabilities: ['structured_output', 'tool_calling'],
        contextWindow: 32_768,
        enabled: true,
      },
    ],
    healthPolicy: {
      timeoutMs: 10_000,
      retryAttempts: 1,
      failureThreshold: 3,
      recoverySeconds: 30,
    },
    rateLimitPolicy: {
      requestsPerMinute: 60,
      tokensPerMinute: 100_000,
      maxConcurrent: 4,
    },
    status: 'draft',
    secretStatus: 'unknown',
    revision: 1,
  };
}

function route(): ModelRouteDefinition {
  return {
    routeId: 'planning-inspection',
    stage: 'planning',
    primary: { providerId: 'provider-primary', modelId: 'model-a' },
    fallbacks: [{ providerId: 'provider-fallback', modelId: 'model-b' }],
    budgetPolicy: {
      selector: { scope: 'task', key: 'inspection' },
      timeoutMs: 15_000,
      maxAttempts: 2,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxCostUsd: 2,
      fallbackOn: ['timeout', 'upstream_error'],
    },
    status: 'draft',
    revision: 1,
  };
}
