import { NodeControlDomainError } from './errors.js';
import type { JsonObject } from './configuration-revision.js';

export type LlmProviderStatus = 'draft' | 'active' | 'degraded' | 'suspended' | 'retired';
export type LlmSecretStatus = 'unknown' | 'available' | 'unavailable' | 'invalid';
export type LlmModelCapability = 'structured_output' | 'tool_calling' | 'embedding' | 'vision';

export interface LlmModelDefinition {
  readonly modelId: string;
  readonly capabilities: readonly LlmModelCapability[];
  readonly contextWindow: number;
  readonly enabled: boolean;
}

export interface LlmHealthPolicy extends JsonObject {
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly failureThreshold: number;
  readonly recoverySeconds: number;
}

export interface LlmRateLimitPolicy extends JsonObject {
  readonly requestsPerMinute: number;
  readonly tokensPerMinute: number;
  readonly maxConcurrent: number;
}

export interface LlmProviderDefinition {
  readonly providerId: string;
  readonly providerType: 'openai_compatible' | 'anthropic' | 'local';
  readonly baseUrl: string;
  readonly credentialRef: string;
  readonly models: readonly LlmModelDefinition[];
  readonly healthPolicy: LlmHealthPolicy;
  readonly rateLimitPolicy: LlmRateLimitPolicy;
  readonly status: LlmProviderStatus;
  readonly secretStatus: LlmSecretStatus;
  readonly lastValidatedAt?: string;
  readonly revision: number;
}

export type ModelRouteStage =
  'understanding' | 'planning' | 'execution' | 'evaluation' | 'summary' | 'embedding';
export type ModelRouteScope = 'stage' | 'task' | 'case';

export interface ModelRouteCandidate {
  readonly providerId: string;
  readonly modelId: string;
}

export interface ModelRouteBudgetPolicy extends JsonObject {
  readonly selector: Readonly<{ scope: ModelRouteScope; key?: string }> & JsonObject;
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxCostUsd: number;
  readonly fallbackOn: readonly ('unavailable' | 'timeout' | 'rate_limited' | 'upstream_error')[];
}

export interface ModelRouteDefinition {
  readonly routeId: string;
  readonly stage: ModelRouteStage;
  readonly primary: ModelRouteCandidate;
  readonly fallbacks: readonly ModelRouteCandidate[];
  readonly budgetPolicy: ModelRouteBudgetPolicy;
  readonly status: 'draft' | 'active' | 'suspended' | 'retired';
  readonly revision: number;
}

const CAPABILITIES = new Set<LlmModelCapability>([
  'structured_output',
  'tool_calling',
  'embedding',
  'vision',
]);
const FALLBACK_REASONS = new Set<ModelRouteBudgetPolicy['fallbackOn'][number]>([
  'unavailable',
  'timeout',
  'rate_limited',
  'upstream_error',
]);

export function createLlmProviderDefinition(input: LlmProviderDefinition): LlmProviderDefinition {
  const providerId = required(input.providerId, 'providerId');
  if (!['openai_compatible', 'anthropic', 'local'].includes(input.providerType))
    providerInvalid('providerType is not supported.');
  const baseUrl = safeHttpUrl(input.baseUrl);
  const credentialRef = secretReference(input.credentialRef);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    providerInvalid('revision must be a positive safe integer.');
  if (input.status !== 'draft') providerInvalid('new Provider Definition must be draft.');
  if (input.secretStatus !== 'unknown')
    providerInvalid('draft Provider Definition secretStatus must be unknown.');
  const models = normalizeModels(input.models);
  return Object.freeze({
    providerId,
    providerType: input.providerType,
    baseUrl,
    credentialRef,
    models,
    healthPolicy: normalizeHealthPolicy(input.healthPolicy),
    rateLimitPolicy: normalizeRateLimitPolicy(input.rateLimitPolicy),
    status: 'draft',
    secretStatus: 'unknown',
    revision: input.revision,
  });
}

export function rehydrateLlmProviderDefinition(
  input: LlmProviderDefinition,
): LlmProviderDefinition {
  const base = createLlmProviderDefinition({ ...input, status: 'draft', secretStatus: 'unknown' });
  if (!['draft', 'active', 'degraded', 'suspended', 'retired'].includes(input.status))
    providerInvalid('status is not supported.');
  if (!['unknown', 'available', 'unavailable', 'invalid'].includes(input.secretStatus))
    providerInvalid('secretStatus is not supported.');
  if (input.lastValidatedAt !== undefined) timestamp(input.lastValidatedAt, 'lastValidatedAt');
  return Object.freeze({
    ...base,
    status: input.status,
    secretStatus: input.secretStatus,
    ...(input.lastValidatedAt === undefined ? {} : { lastValidatedAt: input.lastValidatedAt }),
  });
}

export function createModelRouteDefinition(input: ModelRouteDefinition): ModelRouteDefinition {
  const routeId = required(input.routeId, 'routeId');
  if (
    !['understanding', 'planning', 'execution', 'evaluation', 'summary', 'embedding'].includes(
      input.stage,
    )
  )
    routeInvalid('stage is not supported.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1)
    routeInvalid('revision must be a positive safe integer.');
  if (input.status !== 'draft') routeInvalid('new Model Route must be draft.');
  const primary = candidate(input.primary, 'primary');
  const fallbacks = Object.freeze(
    input.fallbacks.map((value, index) => candidate(value, `fallbacks[${String(index)}]`)),
  );
  const identities = [primary, ...fallbacks].map(candidateIdentity);
  if (new Set(identities).size !== identities.length)
    routeInvalid('primary and fallback provider/model pairs must be unique.');
  const budgetPolicy = normalizeBudgetPolicy(input.budgetPolicy);
  if (budgetPolicy.maxAttempts > identities.length)
    routeInvalid('maxAttempts cannot exceed the number of route candidates.');
  if (input.stage === 'embedding') {
    // Capability availability is checked against the Provider Catalog by the application service.
  }
  return Object.freeze({
    routeId,
    stage: input.stage,
    primary,
    fallbacks,
    budgetPolicy,
    status: 'draft',
    revision: input.revision,
  });
}

export function rehydrateModelRouteDefinition(input: ModelRouteDefinition): ModelRouteDefinition {
  const base = createModelRouteDefinition({ ...input, status: 'draft' });
  if (!['draft', 'active', 'suspended', 'retired'].includes(input.status))
    routeInvalid('status is not supported.');
  return Object.freeze({ ...base, status: input.status });
}

export function routeScopeIdentity(route: ModelRouteDefinition): string {
  const selector = route.budgetPolicy.selector;
  return `${route.stage}:${selector.scope}:${selector.key ?? ''}`;
}

export function requiredModelCapability(route: ModelRouteDefinition): LlmModelCapability {
  return route.stage === 'embedding' ? 'embedding' : 'structured_output';
}

function normalizeModels(values: readonly LlmModelDefinition[]): readonly LlmModelDefinition[] {
  if (values.length < 1 || values.length > 128)
    providerInvalid('models must contain between 1 and 128 entries.');
  const models = values.map((model) => {
    const modelId = required(model.modelId, 'modelId');
    if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 1)
      providerInvalid('contextWindow must be a positive safe integer.');
    const capabilities = [...model.capabilities];
    if (capabilities.length < 1 || capabilities.some((value) => !CAPABILITIES.has(value)))
      providerInvalid('model capabilities contain an unsupported value.');
    if (new Set(capabilities).size !== capabilities.length)
      providerInvalid('model capabilities must be unique.');
    return Object.freeze({
      modelId,
      capabilities: Object.freeze(capabilities),
      contextWindow: model.contextWindow,
      enabled: model.enabled,
    });
  });
  if (new Set(models.map((model) => model.modelId)).size !== models.length)
    providerInvalid('modelId values must be unique within a Provider Definition.');
  return Object.freeze(models);
}

function normalizeHealthPolicy(value: LlmHealthPolicy): LlmHealthPolicy {
  boundedInteger(value.timeoutMs, 100, 300_000, 'healthPolicy.timeoutMs', providerInvalid);
  boundedInteger(value.retryAttempts, 0, 5, 'healthPolicy.retryAttempts', providerInvalid);
  boundedInteger(value.failureThreshold, 1, 100, 'healthPolicy.failureThreshold', providerInvalid);
  boundedInteger(value.recoverySeconds, 1, 86_400, 'healthPolicy.recoverySeconds', providerInvalid);
  return Object.freeze({
    timeoutMs: value.timeoutMs,
    retryAttempts: value.retryAttempts,
    failureThreshold: value.failureThreshold,
    recoverySeconds: value.recoverySeconds,
  });
}

function normalizeRateLimitPolicy(value: LlmRateLimitPolicy): LlmRateLimitPolicy {
  boundedInteger(
    value.requestsPerMinute,
    1,
    1_000_000,
    'rateLimitPolicy.requestsPerMinute',
    providerInvalid,
  );
  boundedInteger(
    value.tokensPerMinute,
    1,
    1_000_000_000,
    'rateLimitPolicy.tokensPerMinute',
    providerInvalid,
  );
  boundedInteger(value.maxConcurrent, 1, 10_000, 'rateLimitPolicy.maxConcurrent', providerInvalid);
  return Object.freeze({
    requestsPerMinute: value.requestsPerMinute,
    tokensPerMinute: value.tokensPerMinute,
    maxConcurrent: value.maxConcurrent,
  });
}

function normalizeBudgetPolicy(value: ModelRouteBudgetPolicy): ModelRouteBudgetPolicy {
  if (!['stage', 'task', 'case'].includes(value.selector.scope))
    routeInvalid('budgetPolicy.selector.scope is not supported.');
  const key = value.selector.key?.trim();
  if (value.selector.scope !== 'stage' && (key === undefined || key === ''))
    routeInvalid('task and case selectors require a bounded key.');
  if (value.selector.scope === 'stage' && key !== undefined && key !== '')
    routeInvalid('stage selector cannot include a key.');
  boundedInteger(value.timeoutMs, 100, 300_000, 'budgetPolicy.timeoutMs', routeInvalid);
  boundedInteger(value.maxAttempts, 1, 16, 'budgetPolicy.maxAttempts', routeInvalid);
  boundedInteger(value.maxInputTokens, 1, 10_000_000, 'budgetPolicy.maxInputTokens', routeInvalid);
  boundedInteger(
    value.maxOutputTokens,
    1,
    10_000_000,
    'budgetPolicy.maxOutputTokens',
    routeInvalid,
  );
  if (!Number.isFinite(value.maxCostUsd) || value.maxCostUsd < 0 || value.maxCostUsd > 1_000_000)
    routeInvalid('budgetPolicy.maxCostUsd is outside the supported range.');
  const fallbackOn = [...value.fallbackOn];
  if (fallbackOn.length < 1 || fallbackOn.some((reason) => !FALLBACK_REASONS.has(reason)))
    routeInvalid('budgetPolicy.fallbackOn contains an unsupported reason.');
  if (new Set(fallbackOn).size !== fallbackOn.length)
    routeInvalid('budgetPolicy.fallbackOn must be unique.');
  return Object.freeze({
    selector: Object.freeze({
      scope: value.selector.scope,
      ...(key === undefined || key === '' ? {} : { key }),
    }),
    timeoutMs: value.timeoutMs,
    maxAttempts: value.maxAttempts,
    maxInputTokens: value.maxInputTokens,
    maxOutputTokens: value.maxOutputTokens,
    maxCostUsd: value.maxCostUsd,
    fallbackOn: Object.freeze(fallbackOn),
  });
}

function candidate(value: ModelRouteCandidate, field: string): ModelRouteCandidate {
  return Object.freeze({
    providerId: required(value.providerId, `${field}.providerId`),
    modelId: required(value.modelId, `${field}.modelId`),
  });
}

function candidateIdentity(value: ModelRouteCandidate): string {
  return `${value.providerId}\u0000${value.modelId}`;
}

function safeHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return providerInvalid('baseUrl must be an absolute URL.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== ''
  )
    providerInvalid('baseUrl must be HTTP(S) and cannot contain credentials.');
  parsed.hash = '';
  return parsed.toString().replace(/\/$/u, '');
}

function secretReference(value: string): string {
  const normalized = required(value, 'credentialRef');
  if (!/^(?:secret|runtime-model-provider):\/\/[A-Za-z0-9._~:/-]+$/u.test(normalized))
    providerInvalid('credentialRef must be an opaque SecretRef, not credential material.');
  return normalized;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === '' || normalized.length > 256)
    providerInvalid(`${field} must contain between 1 and 256 characters.`);
  return normalized;
}

function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value)))
    providerInvalid(`${field} must be an ISO 8601 timestamp.`);
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
  fail: (message: string) => never,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail(`${field} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
}

function providerInvalid(message: string): never {
  throw new NodeControlDomainError('LLM_PROVIDER_INVALID', message);
}

function routeInvalid(message: string): never {
  throw new NodeControlDomainError('MODEL_ROUTE_INVALID', message);
}
