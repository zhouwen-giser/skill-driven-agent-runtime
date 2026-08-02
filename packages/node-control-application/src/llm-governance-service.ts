import { createHash } from 'node:crypto';

import {
  createLlmProviderDefinition,
  createManagementOperation,
  createModelRouteDefinition,
  hashConfigurationRequest,
  requiredModelCapability,
  type JsonObject,
  type LlmProviderDefinition,
  type ManagementOperation,
  type ModelRouteDefinition,
} from '../../node-control-domain/src/index.js';
import type {
  ConfigurationMutationContext,
  NodeControlClock,
  NodeControlIdGenerator,
  NodeControlLlmGovernanceRepository,
} from './ports.js';

export type NodeControlLlmGovernanceErrorCode =
  | 'LLM_PROVIDER_NOT_FOUND'
  | 'MODEL_ROUTE_NOT_FOUND'
  | 'MODEL_ROUTE_PROVIDER_UNAVAILABLE'
  | 'MODEL_ROUTE_CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED';

export class NodeControlLlmGovernanceError extends Error {
  readonly code: NodeControlLlmGovernanceErrorCode;

  constructor(code: NodeControlLlmGovernanceErrorCode, message: string) {
    super(message);
    this.name = 'NodeControlLlmGovernanceError';
    this.code = code;
  }
}

export class NodeControlLlmGovernanceService {
  readonly #repository: NodeControlLlmGovernanceRepository;
  readonly #clock: NodeControlClock;
  readonly #ids: NodeControlIdGenerator;

  constructor(
    dependencies: Readonly<{
      repository: NodeControlLlmGovernanceRepository;
      clock: NodeControlClock;
      ids: NodeControlIdGenerator;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  createProvider(definition: LlmProviderDefinition, idempotencyKey: string) {
    const normalized = createLlmProviderDefinition(definition);
    return this.#repository.createProvider(
      normalized,
      this.context(
        'deployment-operator',
        'Create LLM Provider draft.',
        idempotencyKey,
        providerRequest(normalized),
      ),
    );
  }

  async getProvider(providerId: string): Promise<LlmProviderDefinition> {
    const provider = await this.#repository.findProvider(providerId);
    if (provider === undefined)
      throw new NodeControlLlmGovernanceError(
        'LLM_PROVIDER_NOT_FOUND',
        'LLM Provider was not found.',
      );
    return provider;
  }

  listProviders(limit = 100) {
    return this.#repository.listProviders(boundedLimit(limit));
  }

  async validateProvider(
    providerId: string,
    idempotencyKey: string,
    reason: string,
  ): Promise<ManagementOperation> {
    const provider = await this.getProvider(providerId);
    const context = this.context(
      'deployment-operator',
      reason,
      idempotencyKey,
      Object.freeze({ providerId, revision: provider.revision }),
    );
    const operation = createManagementOperation(
      {
        operationId: this.#ids.next(),
        operationType: 'llm_provider.validate',
        target: { type: 'llm_provider', id: providerId, revision: provider.revision },
        actorId: context.actorId,
        reason: context.reason,
        idempotencyKeyHash: context.idempotencyKeyHash,
        inputHash: context.requestHash,
      },
      context.occurredAt,
    );
    return this.#repository.validateProvider(providerId, operation, context);
  }

  async createRoute(
    definition: ModelRouteDefinition,
    idempotencyKey: string,
  ): Promise<ModelRouteDefinition> {
    const normalized = createModelRouteDefinition(definition);
    const requiredCapability = requiredModelCapability(normalized);
    for (const candidate of [normalized.primary, ...normalized.fallbacks]) {
      const provider = await this.#repository.findProvider(candidate.providerId);
      const model = provider?.models.find((item) => item.modelId === candidate.modelId);
      if (
        provider === undefined ||
        provider.status === 'suspended' ||
        provider.status === 'retired' ||
        model?.enabled !== true ||
        !model.capabilities.includes(requiredCapability)
      ) {
        throw new NodeControlLlmGovernanceError(
          'MODEL_ROUTE_PROVIDER_UNAVAILABLE',
          `Route candidate ${candidate.providerId}/${candidate.modelId} is unavailable for ${requiredCapability}.`,
        );
      }
    }
    return this.#repository.createRoute(
      normalized,
      this.context(
        'deployment-operator',
        'Create Model Route draft.',
        idempotencyKey,
        routeRequest(normalized),
      ),
    );
  }

  async getRoute(routeId: string): Promise<ModelRouteDefinition> {
    const route = await this.#repository.findRoute(routeId);
    if (route === undefined)
      throw new NodeControlLlmGovernanceError(
        'MODEL_ROUTE_NOT_FOUND',
        'Model Route was not found.',
      );
    return route;
  }

  listRoutes(limit = 100) {
    return this.#repository.listRoutes(boundedLimit(limit));
  }

  private context(
    actorId: string,
    reason: string,
    idempotencyKey: string,
    request: JsonObject,
  ): ConfigurationMutationContext {
    const cleanReason = reason.trim();
    if (cleanReason === '' || cleanReason.length > 1024)
      throw new NodeControlLlmGovernanceError(
        'MODEL_ROUTE_CONFLICT',
        'A bounded non-empty command reason is required.',
      );
    const cleanKey = idempotencyKey.trim();
    if (cleanKey.length < 8 || cleanKey.length > 128)
      throw new NodeControlLlmGovernanceError(
        'MODEL_ROUTE_CONFLICT',
        'Idempotency-Key must contain between 8 and 128 characters.',
      );
    return Object.freeze({
      actorId,
      reason: cleanReason,
      idempotencyKeyHash: createHash('sha256').update(cleanKey).digest('hex'),
      requestHash: hashConfigurationRequest(request),
      occurredAt: this.#clock.now(),
    });
  }
}

function providerRequest(value: LlmProviderDefinition): JsonObject {
  return Object.freeze({
    providerId: value.providerId,
    providerType: value.providerType,
    baseUrl: value.baseUrl,
    credentialRef: value.credentialRef,
    models: Object.freeze(
      value.models.map((model) =>
        Object.freeze({
          modelId: model.modelId,
          capabilities: model.capabilities,
          contextWindow: model.contextWindow,
          enabled: model.enabled,
        }),
      ),
    ),
    healthPolicy: value.healthPolicy,
    rateLimitPolicy: value.rateLimitPolicy,
    status: value.status,
    secretStatus: value.secretStatus,
    revision: value.revision,
  });
}

function routeRequest(value: ModelRouteDefinition): JsonObject {
  return Object.freeze({
    routeId: value.routeId,
    stage: value.stage,
    primary: Object.freeze({
      providerId: value.primary.providerId,
      modelId: value.primary.modelId,
    }),
    fallbacks: Object.freeze(
      value.fallbacks.map((candidate) =>
        Object.freeze({ providerId: candidate.providerId, modelId: candidate.modelId }),
      ),
    ),
    budgetPolicy: value.budgetPolicy,
    status: value.status,
    revision: value.revision,
  });
}

function boundedLimit(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 && value <= 200 ? value : 100;
}
