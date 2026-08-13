import {
  MODEL_STAGES,
  type ModelProviderConfiguration,
  type ModelStage,
} from '../../domain/src/index.js';

import type { Clock, ModelRuntimeBootstrapRepository, SecretCipher } from './ports.js';

export interface InitialModelProviderSeed {
  readonly providerId: string;
  readonly name: string;
  readonly kind: ModelProviderConfiguration['kind'];
  readonly apiStyle: ModelProviderConfiguration['apiStyle'];
  readonly baseUrl: string;
  readonly model: string;
  readonly enabled: true;
  readonly timeoutMs: number;
  readonly credentialHeaders: Readonly<Record<string, string>>;
}

export interface InitialModelProviderConfiguration extends InitialModelProviderSeed {
  /** Explicit, independently routable embedding model. Absence means embeddings stay unconfigured. */
  readonly embeddingProvider?: InitialModelProviderSeed;
}

export interface ModelRuntimeBootstrapReport {
  readonly providerId: string;
  readonly providerRegistered: boolean;
  readonly routesCreated: readonly Readonly<{
    stage: ModelStage;
    operation: 'structured_generation' | 'embedding';
  }>[];
}

/**
 * Reconciles only missing Model Runtime authority into PostgreSQL during startup.
 * Existing Providers, current Prompts, and stage routes are never overwritten.
 */
export class ModelRuntimeBootstrapService {
  readonly #repository: ModelRuntimeBootstrapRepository;
  readonly #cipher: SecretCipher;
  readonly #clock: Clock;

  constructor(
    dependencies: Readonly<{
      repository: ModelRuntimeBootstrapRepository;
      cipher: SecretCipher;
      clock: Clock;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#cipher = dependencies.cipher;
    this.#clock = dependencies.clock;
  }

  async reconcile(
    initialProvider: InitialModelProviderConfiguration,
    stages: readonly ModelStage[] = MODEL_STAGES,
  ): Promise<ModelRuntimeBootstrapReport> {
    const timestamp = this.#clock.now();
    const uniqueRouteStages = uniqueStages(stages);
    const embeddingProvider = initialProvider.embeddingProvider;
    if (embeddingProvider?.providerId === initialProvider.providerId)
      throw new Error('MODEL_BOOTSTRAP_PROVIDER_ID_CONFLICT');
    const routes = Object.freeze([
      ...uniqueRouteStages.map((stage) =>
        Object.freeze({
          stage,
          operation: 'structured_generation' as const,
          providerId: initialProvider.providerId,
        }),
      ),
      ...(embeddingProvider === undefined
        ? []
        : uniqueRouteStages.map((stage) =>
            Object.freeze({
              stage,
              operation: 'embedding' as const,
              providerId: embeddingProvider.providerId,
            }),
          )),
    ]);
    const providers = Object.freeze([
      this.#toRecord(initialProvider, timestamp),
      ...(embeddingProvider === undefined ? [] : [this.#toRecord(embeddingProvider, timestamp)]),
    ]);
    const providerRegistered = await this.#repository.createProvidersAndRoutesIfEmpty({
      providers,
      routes,
      routedAt: timestamp,
    });

    return Object.freeze({
      providerId: initialProvider.providerId,
      providerRegistered,
      routesCreated: providerRegistered
        ? Object.freeze(routes.map(({ stage, operation }) => Object.freeze({ stage, operation })))
        : Object.freeze([]),
    });
  }

  #toRecord(provider: InitialModelProviderSeed, timestamp: string) {
    return Object.freeze({
      configuration: Object.freeze({
        providerId: provider.providerId,
        name: provider.name,
        kind: provider.kind,
        apiStyle: provider.apiStyle,
        baseUrl: provider.baseUrl,
        model: provider.model,
        enabled: true as const,
        timeoutMs: provider.timeoutMs,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      encryptedCredential: this.#cipher.encrypt(provider.credentialHeaders),
    });
  }
}

function uniqueStages(stages: readonly ModelStage[]): readonly ModelStage[] {
  return Object.freeze([...new Set(stages)]);
}
