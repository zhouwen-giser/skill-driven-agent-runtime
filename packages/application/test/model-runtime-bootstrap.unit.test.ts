import { describe, expect, it, vi } from 'vitest';

import { MODEL_STAGES } from '../../domain/src/index.js';
import {
  ModelRuntimeBootstrapService,
  type InitialModelProviderConfiguration,
  type ModelRuntimeBootstrapRepository,
} from '../src/index.js';

describe('ModelRuntimeBootstrapService', () => {
  it('registers the first Provider and routes every fixed Model stage in one reconciliation', async () => {
    const repository = new MemoryModelRuntimeBootstrapRepository(false);
    const encrypt = vi.fn(() => 'encrypted-credential');
    const service = new ModelRuntimeBootstrapService({
      repository,
      cipher: {
        encrypt,
        decrypt: () => ({ Authorization: 'Bearer decrypted' }),
      },
      clock: { now: () => '2026-08-12T03:00:00.000Z' },
    });

    const routesCreated = MODEL_STAGES.map((stage) => ({
      stage,
      operation: 'structured_generation',
    }));
    await expect(service.reconcile(initialProvider())).resolves.toEqual({
      providerId: 'provider-real',
      providerRegistered: true,
      routesCreated,
    });
    expect(MODEL_STAGES).toHaveLength(21);
    expect(new Set(MODEL_STAGES).size).toBe(21);
    expect(encrypt).toHaveBeenCalledOnce();
    expect(encrypt).toHaveBeenCalledWith({ Authorization: 'Bearer model-secret' });
    expect(repository.inputs).toEqual([
      {
        providers: [
          {
            configuration: {
              providerId: 'provider-real',
              name: 'provider-real',
              kind: 'openai_compatible',
              apiStyle: 'openai_chat_completions',
              baseUrl: 'https://models.example.test/v1',
              model: 'model-real',
              enabled: true,
              timeoutMs: 30_000,
              createdAt: '2026-08-12T03:00:00.000Z',
              updatedAt: '2026-08-12T03:00:00.000Z',
            },
            encryptedCredential: 'encrypted-credential',
          },
        ],
        routes: MODEL_STAGES.map((stage) => ({
          stage,
          operation: 'structured_generation',
          providerId: 'provider-real',
        })),
        routedAt: '2026-08-12T03:00:00.000Z',
      },
    ]);
  });

  it('is a no-op when a Provider already exists and reports no newly created routes', async () => {
    const repository = new MemoryModelRuntimeBootstrapRepository(true);
    const service = new ModelRuntimeBootstrapService({
      repository,
      cipher: {
        encrypt: () => 'encrypted-credential',
        decrypt: () => ({}),
      },
      clock: { now: () => '2026-08-12T03:00:00.000Z' },
    });

    await expect(service.reconcile(initialProvider())).resolves.toEqual({
      providerId: 'provider-real',
      providerRegistered: false,
      routesCreated: [],
    });
    expect(repository.providerCreated).toBe(false);
    expect(repository.inputs).toHaveLength(1);
  });

  it('registers an explicit embedding Provider and operation-specific routes atomically', async () => {
    const repository = new MemoryModelRuntimeBootstrapRepository(false);
    const encrypt = vi
      .fn()
      .mockReturnValueOnce('encrypted-structured')
      .mockReturnValueOnce('encrypted-embedding');
    const service = new ModelRuntimeBootstrapService({
      repository,
      cipher: { encrypt, decrypt: () => ({}) },
      clock: { now: () => '2026-08-12T03:00:00.000Z' },
    });

    const provider = initialProvider();
    const report = await service.reconcile({
      ...provider,
      embeddingProvider: {
        ...provider,
        providerId: 'provider-real-embedding',
        name: 'provider-real-embedding',
        model: 'embedding-model-real',
      },
    });

    expect(report.routesCreated).toHaveLength(MODEL_STAGES.length * 2);
    expect(repository.inputs[0]?.providers).toEqual([
      expect.objectContaining({ encryptedCredential: 'encrypted-structured' }),
      expect.objectContaining({
        configuration: expect.objectContaining({
          providerId: 'provider-real-embedding',
          model: 'embedding-model-real',
        }),
        encryptedCredential: 'encrypted-embedding',
      }),
    ]);
    expect(
      repository.inputs[0]?.routes.filter(({ operation }) => operation === 'embedding'),
    ).toEqual(
      MODEL_STAGES.map((stage) => ({
        stage,
        operation: 'embedding',
        providerId: 'provider-real-embedding',
      })),
    );
  });
});

function initialProvider(): InitialModelProviderConfiguration {
  return {
    providerId: 'provider-real',
    name: 'provider-real',
    kind: 'openai_compatible',
    apiStyle: 'openai_chat_completions',
    baseUrl: 'https://models.example.test/v1',
    model: 'model-real',
    enabled: true,
    timeoutMs: 30_000,
    credentialHeaders: { Authorization: 'Bearer model-secret' },
  };
}

class MemoryModelRuntimeBootstrapRepository implements ModelRuntimeBootstrapRepository {
  readonly inputs: Parameters<
    ModelRuntimeBootstrapRepository['createProvidersAndRoutesIfEmpty']
  >[0][] = [];
  providerCreated = false;
  #providerExists: boolean;

  constructor(providerExists: boolean) {
    this.#providerExists = providerExists;
  }

  createProvidersAndRoutesIfEmpty(
    input: Parameters<ModelRuntimeBootstrapRepository['createProvidersAndRoutesIfEmpty']>[0],
  ): Promise<boolean> {
    this.inputs.push(input);
    if (this.#providerExists) return Promise.resolve(false);
    this.#providerExists = true;
    this.providerCreated = true;
    return Promise.resolve(true);
  }
}
