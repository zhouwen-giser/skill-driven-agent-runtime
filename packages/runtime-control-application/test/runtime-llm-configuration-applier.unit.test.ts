import { describe, expect, it } from 'vitest';

import { createConfigurationRevision } from '../../node-control-domain/src/index.js';
import { RuntimeLlmConfigurationApplier, type RuntimeModelControlPort } from '../src/index.js';

describe('P03 Runtime LLM configuration applier', () => {
  it('applies provider reconnect and route new-task-only revisions through the Runtime port', async () => {
    const models = new MemoryModelControl();
    const applier = new RuntimeLlmConfigurationApplier(models);
    await expect(applier.apply(providerRevision())).resolves.toMatchObject({
      status: 'applied',
      detail: { providerId: 'provider-primary', modelCount: 1 },
    });
    await expect(applier.apply(routeRevision())).resolves.toMatchObject({
      status: 'applied',
      detail: { routeId: 'planning-route', candidateCount: 2 },
    });
    expect(models.applied).toEqual(['provider:provider-primary:1', 'route:planning-route:1']);
  });

  it('rejects unsafe apply modes and never returns thrown credential details', async () => {
    const applier = new RuntimeLlmConfigurationApplier({
      applyProvider: () =>
        Promise.reject(Object.assign(new Error('credential-value'), { code: 'CREDENTIAL_VALUE' })),
      applyRoute: () => Promise.reject(new Error('unused')),
    });
    const invalidMode = createConfigurationRevision(
      {
        configurationId: 'provider-primary-config',
        targetType: 'llm_provider',
        targetId: 'provider-primary',
        revision: 1,
        applyMode: 'new_task_only',
        content: providerContent(),
        createdBy: 'operator',
      },
      '2026-08-02T00:00:00.000Z',
    );
    await expect(applier.apply(invalidMode)).resolves.toEqual({
      status: 'rejected',
      reasonCode: 'LLM_PROVIDER_APPLY_MODE_INVALID',
    });
    const result = await applier.apply(providerRevision());
    expect(result).toEqual({ status: 'rejected', reasonCode: 'LLM_CONFIGURATION_APPLY_FAILED' });
    expect(JSON.stringify(result)).not.toContain('credential-value');
  });
});

class MemoryModelControl implements RuntimeModelControlPort {
  readonly applied: string[] = [];
  applyProvider(
    definition: Parameters<RuntimeModelControlPort['applyProvider']>[0],
    configuration: Parameters<RuntimeModelControlPort['applyProvider']>[1],
  ) {
    this.applied.push(`provider:${definition.providerId}:${String(configuration.revision)}`);
    return Promise.resolve({
      providerId: definition.providerId,
      modelCount: definition.models.length,
    });
  }
  applyRoute(
    definition: Parameters<RuntimeModelControlPort['applyRoute']>[0],
    configuration: Parameters<RuntimeModelControlPort['applyRoute']>[1],
  ) {
    this.applied.push(`route:${definition.routeId}:${String(configuration.revision)}`);
    return Promise.resolve({
      routeId: definition.routeId,
      candidateCount: 1 + definition.fallbacks.length,
    });
  }
}

function providerRevision() {
  return createConfigurationRevision(
    {
      configurationId: 'provider-primary-config',
      targetType: 'llm_provider',
      targetId: 'provider-primary',
      revision: 1,
      applyMode: 'reconnect_required',
      content: providerContent(),
      createdBy: 'operator',
    },
    '2026-08-02T00:00:00.000Z',
  );
}

function routeRevision() {
  return createConfigurationRevision(
    {
      configurationId: 'planning-route-config',
      targetType: 'model_route',
      targetId: 'planning-route',
      revision: 1,
      applyMode: 'new_task_only',
      content: {
        routeId: 'planning-route',
        stage: 'planning',
        primary: { providerId: 'provider-primary', modelId: 'model-a' },
        fallbacks: [{ providerId: 'provider-fallback', modelId: 'model-b' }],
        budgetPolicy: {
          selector: { scope: 'stage' },
          timeoutMs: 10_000,
          maxAttempts: 2,
          maxInputTokens: 20_000,
          maxOutputTokens: 4_000,
          maxCostUsd: 2,
          fallbackOn: ['upstream_error'],
        },
        status: 'draft',
        revision: 1,
      },
      createdBy: 'operator',
    },
    '2026-08-02T00:00:00.000Z',
  );
}

function providerContent() {
  return {
    providerId: 'provider-primary',
    providerType: 'openai_compatible',
    baseUrl: 'https://models.example.test/v1',
    credentialRef: 'runtime-model-provider://bootstrap-primary',
    models: [
      {
        modelId: 'model-a',
        capabilities: ['structured_output'],
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
    rateLimitPolicy: { requestsPerMinute: 60, tokensPerMinute: 100_000, maxConcurrent: 4 },
    status: 'draft',
    secretStatus: 'unknown',
    revision: 1,
  } as const;
}
