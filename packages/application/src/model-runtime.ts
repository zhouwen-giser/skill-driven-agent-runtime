import type {
  ModelInvocationRecord,
  ModelProviderConfiguration,
  ModelStage,
  PromptVersion,
  StageModelRoute,
} from '../../domain/src/index.js';

import type {
  Clock,
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

  constructor(
    dependencies: Readonly<{
      repository: ModelRuntimeRepository;
      transport: ModelTransportAdapter;
      cipher: SecretCipher;
      clock: Clock;
      ids: Readonly<{ nextInvocationId(): string }>;
    }>,
  ) {
    this.#repository = dependencies.repository;
    this.#transport = dependencies.transport;
    this.#cipher = dependencies.cipher;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
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

  async route(stage: ModelStage, providerId: string): Promise<void> {
    const provider = await this.#repository.findProvider(providerId);
    if (provider?.configuration.enabled !== true) {
      throw new ModelRuntimeError(
        'MODEL_PROVIDER_NOT_AVAILABLE',
        'Enabled provider was not found.',
      );
    }
    await this.#repository.saveStageRoute(stage, providerId, this.#clock.now());
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
    }>,
  ): Promise<Readonly<{ structuredResult: unknown; invocationId: string }>> {
    return this.#invokeStructured(input);
  }

  embed(
    stage: ModelStage,
    text: string,
    context?: unknown,
  ): Promise<Readonly<{ providerId: string; vector: readonly number[] }>> {
    return this.#invokeEmbedding(stage, text, context);
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
    }>,
  ): Promise<Readonly<{ structuredResult: unknown; invocationId: string }>> {
    const provider = await this.#requiredProvider(input.stage);
    const prompt = await this.#repository.findActivePromptForStage(input.stage);
    if (prompt?.status !== 'enabled') {
      throw new ModelRuntimeError(
        'MODEL_PROMPT_NOT_CONFIGURED',
        `No enabled Prompt is configured for stage ${input.stage}.`,
      );
    }
    const started = Date.now();
    const renderedInstruction = prompt.content.replaceAll('{{instruction}}', input.instruction);
    const request = {
      instruction: renderedInstruction,
      responseSchema: input.responseSchema,
      correctionErrors: input.correctionErrors,
    };
    try {
      const result = await this.#transport.generateStructured({
        configuration: provider.configuration,
        credentialHeaders: this.#cipher.decrypt(provider.encryptedCredential),
        instruction: renderedInstruction,
        responseSchema: input.responseSchema,
        correctionErrors: input.correctionErrors,
        signal: AbortSignal.timeout(
          input.timeoutMs === undefined
            ? provider.configuration.timeoutMs
            : Math.min(provider.configuration.timeoutMs, input.timeoutMs),
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
      throw new ModelRuntimeError(
        'MODEL_INVOCATION_FAILED',
        'Configured stage model invocation failed.',
      );
    }
  }

  async #invokeEmbedding(
    stage: ModelStage,
    text: string,
    context?: unknown,
  ): Promise<Readonly<{ providerId: string; vector: readonly number[] }>> {
    const provider = await this.#requiredProvider(stage);
    const started = Date.now();
    try {
      const result = await this.#transport.embed({
        configuration: provider.configuration,
        credentialHeaders: this.#cipher.decrypt(provider.encryptedCredential),
        text,
        signal: AbortSignal.timeout(provider.configuration.timeoutMs),
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
      );
      throw new ModelRuntimeError(
        'MODEL_INVOCATION_FAILED',
        'Configured stage embedding invocation failed.',
      );
    }
  }

  async #requiredProvider(stage: ModelStage) {
    const provider = await this.#repository.findProviderForStage(stage);
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
      errorMessage: error instanceof Error ? error.message : 'Model transport failed.',
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
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'MODEL_TRANSPORT_ERROR';
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
