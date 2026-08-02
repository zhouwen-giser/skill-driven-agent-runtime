import {
  rehydrateLlmProviderDefinition,
  rehydrateModelRouteDefinition,
  type JsonObject,
  type LlmProviderDefinition,
  type ModelRouteDefinition,
} from '../../node-control-domain/src/index.js';
import type { RuntimeConfigurationApplier, RuntimeModelControlPort } from './ports.js';

const SAFE_RUNTIME_APPLY_CODES = new Set([
  'MODEL_CONFIGURATION_REPLAY_CONFLICT',
  'MODEL_CONFIGURATION_REVISION_STALE',
  'MODEL_CREDENTIAL_REF_UNAVAILABLE',
  'MODEL_ROUTE_CANDIDATE_UNAVAILABLE',
]);

export class RuntimeLlmConfigurationApplier implements RuntimeConfigurationApplier {
  readonly #models: RuntimeModelControlPort;

  constructor(models: RuntimeModelControlPort) {
    this.#models = models;
  }

  async apply(
    revision: Parameters<RuntimeConfigurationApplier['apply']>[0],
  ): ReturnType<RuntimeConfigurationApplier['apply']> {
    try {
      if (revision.targetType === 'llm_provider') {
        if (!['reconnect_required', 'hot_reload'].includes(revision.applyMode))
          return rejected('LLM_PROVIDER_APPLY_MODE_INVALID');
        const definition = rehydrateLlmProviderDefinition(asProviderDefinition(revision.content));
        if (
          definition.providerId !== revision.targetId ||
          definition.revision !== revision.revision
        )
          return rejected('LLM_PROVIDER_REVISION_IDENTITY_MISMATCH');
        const applied = await this.#models.applyProvider(
          definition,
          configurationIdentity(revision),
        );
        return Object.freeze({ status: 'applied', detail: jsonObject(applied) });
      }
      if (revision.targetType === 'model_route') {
        if (revision.applyMode !== 'new_task_only')
          return rejected('MODEL_ROUTE_APPLY_MODE_INVALID');
        const definition = rehydrateModelRouteDefinition(asModelRouteDefinition(revision.content));
        if (definition.routeId !== revision.targetId || definition.revision !== revision.revision)
          return rejected('MODEL_ROUTE_REVISION_IDENTITY_MISMATCH');
        const applied = await this.#models.applyRoute(definition, configurationIdentity(revision));
        return Object.freeze({ status: 'applied', detail: jsonObject(applied) });
      }
      return rejected('LLM_CONFIGURATION_TARGET_UNSUPPORTED');
    } catch (error: unknown) {
      return rejected(runtimeApplyCode(error));
    }
  }
}

function asProviderDefinition(value: unknown): LlmProviderDefinition {
  if (!isRecord(value)) throw new Error('LLM_PROVIDER_CONTENT_INVALID');
  return value as unknown as LlmProviderDefinition;
}

function asModelRouteDefinition(value: unknown): ModelRouteDefinition {
  if (!isRecord(value)) throw new Error('MODEL_ROUTE_CONTENT_INVALID');
  return value as unknown as ModelRouteDefinition;
}

function configurationIdentity(revision: Parameters<RuntimeConfigurationApplier['apply']>[0]) {
  return Object.freeze({
    configurationId: revision.configurationId,
    revision: revision.revision,
    checksum: revision.checksum,
  });
}

function rejected(reasonCode: string) {
  return Object.freeze({ status: 'rejected' as const, reasonCode });
}

function runtimeApplyCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    SAFE_RUNTIME_APPLY_CODES.has(error.code)
  )
    return error.code;
  return 'LLM_CONFIGURATION_APPLY_FAILED';
}

function jsonObject(value: Readonly<Record<string, string | number>>): JsonObject {
  return Object.freeze({ ...value });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
