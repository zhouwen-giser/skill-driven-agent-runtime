import type {
  ModelInvocationRecord,
  ModelProviderConfiguration,
  ModelStage,
  PromptVersion,
  StageModelRoute,
} from '../../domain/src/index.js';

import type {
  Clock,
  ControlledModelFallbackReason,
  ControlledModelRouteResolver,
  ModelProviderRecord,
  ModelRuntimeRepository,
  ModelTransportAdapter,
  SecretCipher,
} from './ports.js';

export class ModelRuntimeService {
  readonly #repository: ModelRuntimeRepository;
  readonly #transport: ModelTransportAdapter;
  readonly #cipher: SecretCipher;
  readonly #clock: Clock;
  readonly #ids: Readonly<{ nextInvocationId(): string }>;
  readonly #controlledRoutes: ControlledModelRouteResolver | undefined;
  readonly #providerFailovers:
    | Readonly<{
        record(
          input: Readonly<{
            taskId: string;
            failedProviderId: string;
            nextProviderId: string;
          }>,
        ): Promise<void>;
      }>
    | undefined;

  constructor(
    dependencies: Readonly<{
      repository: ModelRuntimeRepository;
      transport: ModelTransportAdapter;
      cipher: SecretCipher;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string }>;
      controlledRoutes?: ControlledModelRouteResolver;
      providerFailovers?: Readonly<{
        record(
          input: Readonly<{
            taskId: string;
            failedProviderId: string;
            nextProviderId: string;
          }>,
        ): Promise<void>;
      }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#transport = dependencies.transport;
    this.#cipher = dependencies.cipher;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#controlledRoutes = dependencies.controlledRoutes;
    this.#providerFailovers = dependencies.providerFailovers;
  }

  async configureProvider(
    configuration: ModelProviderConfiguration,
    credentialHeaders: Readonly<Record<string, string>>,
  ): Promise<void> {
    validateConfiguration(configuration);
    await this.#repository.saveProvider({
      configuration,
      encryptedCredential: this.#cipher.encrypt(credentialHeaders),
    });
  }

  async route(
    stage: ModelStage,
    providerId: string,
    operation: ModelInvocationRecord['operation'] = 'structured_generation',
  ): Promise<void> {
    const provider = await this.#repository.findProvider(providerId);
    if (provider?.configuration.enabled !== true) {
      throw new ModelRuntimeError(
        'MODEL_PROVIDER_NOT_AVAILABLE',
        'Enabled provider was not found.',
      );
    }
    await this.#repository.saveStageRoute(stage, operation, providerId, this.#clock.now());
  }

  listProviders(): Promise<readonly ModelProviderConfiguration[]> {
    return this.#repository.listProviders();
  }

  listStageRoutes(): Promise<readonly StageModelRoute[]> {
    return this.#repository.listStageRoutes();
  }

  async generateStructured(
    input: Readonly<{
      stage: ModelStage;
      instruction: string;
      responseSchema: unknown;
      correctionErrors: readonly string[];
      context?: unknown;
      taskId?: string;
      timeoutMs?: number;
      routeContext?: Readonly<{ taskType?: string; caseType?: string }>;
    }>,
  ): Promise<unknown> {
    return (await this.#invokeStructured(input)).structuredResult;
  }

  generateStructuredWithAudit(
    input: Readonly<{
      stage: ModelStage;
      instruction: string;
      responseSchema: unknown;
      correctionErrors: readonly string[];
      context?: unknown;
      taskId?: string;
      timeoutMs?: number;
      routeContext?: Readonly<{ taskType?: string; caseType?: string }>;
    }>,
  ): Promise<Readonly<{ structuredResult: unknown; invocationId: string }>> {
    return this.#invokeStructured(input);
  }

  embed(
    stage: ModelStage,
    text: string,
    context?: unknown,
    taskId?: string,
    routeContext?: Readonly<{ taskType?: string; caseType?: string }>,
  ): Promise<Readonly<{ providerId: string; vector: readonly number[] }>> {
    return this.#invokeEmbedding(stage, text, context, taskId, routeContext);
  }

  listInvocations(stage?: ModelStage): Promise<readonly ModelInvocationRecord[]> {
    return this.#repository.listInvocations(stage);
  }

  listInvocationsByTask(taskId: string): Promise<readonly ModelInvocationRecord[]> {
    return this.#repository.listInvocationsByTask(taskId);
  }

  async #invokeStructured(
    input: Readonly<{
      stage: ModelStage;
      instruction: string;
      responseSchema: unknown;
      correctionErrors: readonly string[];
      context?: unknown;
      taskId?: string;
      timeoutMs?: number;
      routeContext?: Readonly<{ taskType?: string; caseType?: string }>;
    }>,
  ): Promise<Readonly<{ structuredResult: unknown; invocationId: string }>> {
    const prompt = await this.#repository.findActivePromptForStage(input.stage);
    if (prompt?.status !== 'enabled') {
      throw new ModelRuntimeError(
        'MODEL_PROMPT_NOT_CONFIGURED',
        `No enabled Prompt is configured for stage ${input.stage}.`,
      );
    }
    const renderedInstruction = prompt.content.replaceAll('{{instruction}}', input.instruction);
    const request = {
      instruction: renderedInstruction,
      responseSchema: input.responseSchema,
      correctionErrors: input.correctionErrors,
    };
    const route = await this.#resolveProviders(
      input.stage,
      'structured_generation',
      input.taskId,
      input.routeContext,
    );
    for (const [index, provider] of route.providers.entries()) {
      const started = Date.now();
      try {
        const result = await this.#transport.generateStructured({
          configuration: provider.configuration,
          credentialHeaders: this.#cipher.decrypt(provider.encryptedCredential),
          instruction: renderedInstruction,
          responseSchema: input.responseSchema,
          correctionErrors: input.correctionErrors,
          signal: AbortSignal.timeout(
            Math.min(
              provider.configuration.timeoutMs,
              route.timeoutMs,
              input.timeoutMs ?? Number.MAX_SAFE_INTEGER,
            ),
          ),
        });
        const invocationId = await this.#audit(
          provider.configuration,
          input.stage,
          'structured_generation',
          request,
          input.context,
          started,
          'succeeded',
          result,
          prompt,
          input.taskId,
        );
        return { structuredResult: result.structuredResult, invocationId };
      } catch (error: unknown) {
        await this.#auditFailure(
          provider.configuration,
          input.stage,
          'structured_generation',
          request,
          input.context,
          started,
          error,
          prompt,
          input.taskId,
        );
        if (
          index === route.providers.length - 1 ||
          !route.fallbackOn.includes(fallbackReason(error))
        )
          break;
        await this.#recordProviderFailover(input.taskId, provider, route.providers[index + 1]);
      }
    }
    throw new ModelRuntimeError(
      'MODEL_INVOCATION_FAILED',
      'Configured stage model invocation failed.',
    );
  }

  async #invokeEmbedding(
    stage: ModelStage,
    text: string,
    context?: unknown,
    taskId?: string,
    routeContext?: Readonly<{ taskType?: string; caseType?: string }>,
  ): Promise<Readonly<{ providerId: string; vector: readonly number[] }>> {
    const route = await this.#resolveProviders(stage, 'embedding', taskId, routeContext);
    for (const [index, provider] of route.providers.entries()) {
      const started = Date.now();
      try {
        const result = await this.#transport.embed({
          configuration: provider.configuration,
          credentialHeaders: this.#cipher.decrypt(provider.encryptedCredential),
          text,
          signal: AbortSignal.timeout(Math.min(provider.configuration.timeoutMs, route.timeoutMs)),
        });
        await this.#audit(
          provider.configuration,
          stage,
          'embedding',
          { text },
          context,
          started,
          'succeeded',
          { ...result, structuredResult: result.vector },
          undefined,
          taskId,
        );
        return { providerId: provider.configuration.providerId, vector: result.vector };
      } catch (error: unknown) {
        await this.#auditFailure(
          provider.configuration,
          stage,
          'embedding',
          { text },
          context,
          started,
          error,
          undefined,
          taskId,
        );
        if (
          index === route.providers.length - 1 ||
          !route.fallbackOn.includes(fallbackReason(error))
        )
          break;
        await this.#recordProviderFailover(taskId, provider, route.providers[index + 1]);
      }
    }
    throw new ModelRuntimeError(
      'MODEL_INVOCATION_FAILED',
      'Configured stage embedding invocation failed.',
    );
  }

  async #recordProviderFailover(
    taskId: string | undefined,
    failed: ModelProviderRecord,
    next: ModelProviderRecord | undefined,
  ): Promise<void> {
    if (taskId === undefined || next === undefined || this.#providerFailovers === undefined) return;
    await this.#providerFailovers.record({
      taskId,
      failedProviderId: failed.configuration.providerId,
      nextProviderId: next.configuration.providerId,
    });
  }

  async #resolveProviders(
    stage: ModelStage,
    operation: ModelInvocationRecord['operation'],
    taskId?: string,
    routeContext?: Readonly<{ taskType?: string; caseType?: string }>,
  ): Promise<
    Readonly<{
      providers: readonly ModelProviderRecord[];
      timeoutMs: number;
      fallbackOn: readonly ControlledModelFallbackReason[];
    }>
  > {
    const controlled = await this.#controlledRoutes?.resolve({
      stage,
      operation,
      ...(taskId === undefined ? {} : { taskId }),
      ...(routeContext === undefined ? {} : { routeContext }),
      boundAt: this.#clock.now(),
    });
    if (controlled !== undefined) {
      const providers = controlled.candidates.slice(0, controlled.maxAttempts);
      if (providers.length === 0)
        throw new ModelRuntimeError(
          'MODEL_PROVIDER_NOT_AVAILABLE',
          'No controlled route candidate is available.',
        );
      return Object.freeze({
        providers,
        timeoutMs: controlled.timeoutMs,
        fallbackOn: controlled.fallbackOn,
      });
    }
    const provider = await this.#requiredProvider(stage, operation);
    return Object.freeze({
      providers: Object.freeze([provider]),
      timeoutMs: provider.configuration.timeoutMs,
      fallbackOn: Object.freeze([]),
    });
  }

  async #requiredProvider(stage: ModelStage, operation: ModelInvocationRecord['operation']) {
    const provider = await this.#repository.findProviderForStage(stage, operation);
    if (provider?.configuration.enabled !== true) {
      throw new ModelRuntimeError(
        'MODEL_STAGE_NOT_CONFIGURED',
        `No enabled model is configured for stage ${stage}.`,
      );
    }
    return provider;
  }

  async #audit(
    configuration: ModelProviderConfiguration,
    stage: ModelStage,
    operation: ModelInvocationRecord['operation'],
    request: unknown,
    context: unknown,
    started: number,
    status: 'succeeded',
    result: Readonly<{
      rawResponse: unknown;
      structuredResult?: unknown;
      inputTokens?: number;
      outputTokens?: number;
    }>,
    prompt?: PromptVersion,
    taskId?: string,
  ): Promise<string> {
    const invocationId = this.#ids.nextInvocationId();
    await this.#repository.saveInvocation({
      invocationId,
      ...(taskId === undefined ? {} : { taskId }),
      stage,
      providerId: configuration.providerId,
      model: configuration.model,
      operation,
      ...(prompt === undefined ? {} : { promptId: prompt.promptId, promptVersion: prompt.version }),
      request,
      context: context ?? {},
      rawResponse: result.rawResponse,
      structuredResult: result.structuredResult,
      ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
      ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
      durationMs: Math.max(0, Date.now() - started),
      status,
      createdAt: this.#clock.now(),
    });
    return invocationId;
  }

  async #auditFailure(
    configuration: ModelProviderConfiguration,
    stage: ModelStage,
    operation: ModelInvocationRecord['operation'],
    request: unknown,
    context: unknown,
    started: number,
    error: unknown,
    prompt?: PromptVersion,
    taskId?: string,
  ): Promise<void> {
    await this.#repository.saveInvocation({
      invocationId: this.#ids.nextInvocationId(),
      ...(taskId === undefined ? {} : { taskId }),
      stage,
      providerId: configuration.providerId,
      model: configuration.model,
      operation,
      ...(prompt === undefined ? {} : { promptId: prompt.promptId, promptVersion: prompt.version }),
      request,
      context: context ?? {},
      durationMs: Math.max(0, Date.now() - started),
      status: 'failed',
      errorCode: errorCode(error),
      errorMessage: 'Model transport failed.',
      createdAt: this.#clock.now(),
    });
  }
}

function validateConfiguration(configuration: ModelProviderConfiguration): void {
  if (
    configuration.providerId.trim() === '' ||
    configuration.model.trim() === '' ||
    configuration.timeoutMs <= 0
  ) {
    throw new ModelRuntimeError(
      'MODEL_PROVIDER_CONFIGURATION_INVALID',
      'Provider ID, model, and positive timeout are required.',
    );
  }
  const url = new URL(configuration.baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('MODEL_PROVIDER_URL_INVALID');
}

function errorCode(error: unknown): string {
  const reason = fallbackReason(error);
  if (reason === 'timeout') return 'MODEL_TRANSPORT_TIMEOUT';
  if (reason === 'rate_limited') return 'MODEL_TRANSPORT_RATE_LIMITED';
  if (reason === 'unavailable') return 'MODEL_TRANSPORT_UNAVAILABLE';
  return 'MODEL_TRANSPORT_UPSTREAM_ERROR';
}

function fallbackReason(error: unknown): ControlledModelFallbackReason {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code.toUpperCase()
      : '';
  if (
    code.includes('TIMEOUT') ||
    (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
  )
    return 'timeout';
  if (code.includes('RATE') || code === '429') return 'rate_limited';
  if (code.includes('UNAVAILABLE') || code.includes('CIRCUIT')) return 'unavailable';
  return 'upstream_error';
}

export type ModelRuntimeErrorCode =
  | 'MODEL_INVOCATION_FAILED'
  | 'MODEL_PROMPT_NOT_CONFIGURED'
  | 'MODEL_PROVIDER_CONFIGURATION_INVALID'
  | 'MODEL_PROVIDER_NOT_AVAILABLE'
  | 'MODEL_STAGE_NOT_CONFIGURED';
export class ModelRuntimeError extends Error {
  readonly code: ModelRuntimeErrorCode;
  constructor(code: ModelRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'ModelRuntimeError';
    this.code = code;
  }
}
