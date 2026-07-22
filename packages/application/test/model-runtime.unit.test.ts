import { describe, expect, it } from 'vitest';

import type {
  ModelInvocationRecord,
  ModelProviderConfiguration,
  ModelStage,
} from '../../domain/src/index.js';
import {
  ModelRuntimeService,
  type ModelProviderRecord,
  type ModelRuntimeRepository,
  type ModelTransportAdapter,
} from '../src/index.js';

describe('ModelRuntimeService', () => {
  it('uses the single fixed stage route and audits displayable structured output', async () => {
    const repository = new MemoryModelRepository();
    const transport = new FakeTransport();
    const service = createService(repository, transport);
    await service.configureProvider(configuration('provider-primary'), { Authorization: 'secret' });
    await service.route('skill_authoring', 'provider-primary');

    await expect(
      service.generateStructured({
        stage: 'skill_authoring',
        instruction: 'Create a Skill.',
        responseSchema: { type: 'object' },
        correctionErrors: [],
        context: { taskId: 'task-1' },
        taskId: 'task-1',
      }),
    ).resolves.toEqual({ schema: 'valid' });
    expect(transport.providerIds).toEqual(['provider-primary']);
    expect(repository.invocations[0]).toMatchObject({
      stage: 'skill_authoring',
      taskId: 'task-1',
      providerId: 'provider-primary',
      model: 'model-a',
      status: 'succeeded',
      promptId: 'prompt-skill_authoring',
      promptVersion: 1,
      request: {
        instruction: 'System policy. Create a Skill.',
        responseSchema: { type: 'object' },
        correctionErrors: [],
      },
      rawResponse: { visible: 'raw response' },
      structuredResult: { schema: 'valid' },
      inputTokens: 7,
      outputTokens: 3,
    });
    expect(JSON.stringify(repository.invocations[0])).not.toContain('secret');
    await expect(service.listInvocationsByTask('task-1')).resolves.toEqual([
      expect.objectContaining({ invocationId: 'model-invocation-1', taskId: 'task-1' }),
    ]);
  });

  it('records failure and never falls back to another configured provider', async () => {
    const repository = new MemoryModelRepository();
    const transport = new FakeTransport(true);
    const service = createService(repository, transport);
    await service.configureProvider(configuration('provider-primary'), {});
    await service.configureProvider(configuration('provider-unused'), {});
    await service.route('workflow_planning', 'provider-primary');

    await expect(
      service.generateStructured({
        stage: 'workflow_planning',
        instruction: 'Plan.',
        responseSchema: {},
        correctionErrors: [],
      }),
    ).rejects.toMatchObject({ code: 'MODEL_INVOCATION_FAILED' });
    expect(transport.providerIds).toEqual(['provider-primary']);
    expect(repository.invocations).toHaveLength(1);
    expect(repository.invocations[0]).toMatchObject({
      status: 'failed',
      errorCode: 'UPSTREAM_FAILED',
    });
  });

  it('returns the persisted invocation identity for cognitive structured stages', async () => {
    const repository = new MemoryModelRepository();
    const service = createService(repository, new FakeTransport());
    await service.configureProvider(configuration('provider-primary'), {});
    await service.route('task_understanding', 'provider-primary');

    await expect(
      service.generateStructuredWithAudit({
        stage: 'task_understanding',
        instruction: 'Understand this untrusted task request.',
        responseSchema: { type: 'object' },
        correctionErrors: [],
        taskId: 'task-understanding-1',
      }),
    ).resolves.toEqual({
      structuredResult: { schema: 'valid' },
      invocationId: 'model-invocation-1',
    });
    expect(repository.invocations[0]).toMatchObject({
      invocationId: 'model-invocation-1',
      stage: 'task_understanding',
      taskId: 'task-understanding-1',
    });
  });

  it('fails before transport when a stage has no route', async () => {
    const transport = new FakeTransport();
    await expect(
      createService(new MemoryModelRepository(), transport).embed('evaluation', 'text'),
    ).rejects.toMatchObject({ code: 'MODEL_STAGE_NOT_CONFIGURED' });
    expect(transport.providerIds).toHaveLength(0);
  });
});

function createService(repository: ModelRuntimeRepository, transport: ModelTransportAdapter) {
  let ids = 0;
  return new ModelRuntimeService({
    repository,
    transport,
    cipher: {
      encrypt: (value) => JSON.stringify(value),
      decrypt: (value) => JSON.parse(value) as Readonly<Record<string, string>>,
    },
    clock: { now: () => '2026-07-11T10:00:00.000Z' },
    ids: { nextInvocationId: () => `model-invocation-${String(++ids)}` },
  });
}

function configuration(providerId: string): ModelProviderConfiguration {
  return {
    providerId,
    name: providerId,
    kind: 'openai_compatible',
    apiStyle: 'openai_chat_completions',
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'model-a',
    enabled: true,
    timeoutMs: 1000,
    createdAt: '2026-07-11T10:00:00.000Z',
    updatedAt: '2026-07-11T10:00:00.000Z',
  };
}

class FakeTransport implements ModelTransportAdapter {
  readonly providerIds: string[] = [];
  readonly #fail: boolean;
  constructor(fail = false) {
    this.#fail = fail;
  }
  generateStructured(input: Parameters<ModelTransportAdapter['generateStructured']>[0]) {
    this.providerIds.push(input.configuration.providerId);
    if (this.#fail)
      return Promise.reject(
        Object.assign(new Error('upstream unavailable'), { code: 'UPSTREAM_FAILED' }),
      );
    return Promise.resolve({
      rawResponse: { visible: 'raw response' },
      structuredResult: { schema: 'valid' },
      inputTokens: 7,
      outputTokens: 3,
    });
  }
  embed(input: Parameters<ModelTransportAdapter['embed']>[0]) {
    this.providerIds.push(input.configuration.providerId);
    return Promise.resolve({ rawResponse: { data: 'visible' }, vector: [1, 0], inputTokens: 2 });
  }
}

class MemoryModelRepository implements ModelRuntimeRepository {
  readonly providers = new Map<string, ModelProviderRecord>();
  readonly routes = new Map<ModelStage, string>();
  invocations: readonly ModelInvocationRecord[] = [];
  findProvider(providerId: string) {
    return Promise.resolve(this.providers.get(providerId));
  }
  findProviderForStage(stage: ModelStage) {
    const id = this.routes.get(stage);
    return Promise.resolve(id === undefined ? undefined : this.providers.get(id));
  }
  listProviders() {
    return Promise.resolve([...this.providers.values()].map((item) => item.configuration));
  }
  listStageRoutes() {
    return Promise.resolve(
      [...this.routes].map(([stage, providerId]) => ({
        stage,
        providerId,
        updatedAt: '2026-07-11T10:00:00.000Z',
      })),
    );
  }
  saveProvider(record: ModelProviderRecord) {
    this.providers.set(record.configuration.providerId, record);
    return Promise.resolve();
  }
  saveStageRoute(stage: ModelStage, providerId: string) {
    this.routes.set(stage, providerId);
    return Promise.resolve();
  }
  saveInvocation(invocation: ModelInvocationRecord) {
    this.invocations = [...this.invocations, invocation];
    return Promise.resolve();
  }
  listInvocations(stage?: ModelStage) {
    return Promise.resolve(
      stage === undefined
        ? this.invocations
        : this.invocations.filter((item) => item.stage === stage),
    );
  }
  listInvocationsByTask(taskId: string) {
    return Promise.resolve(this.invocations.filter((item) => item.taskId === taskId));
  }
  findActivePromptForStage(stage: ModelStage) {
    return Promise.resolve({
      promptId: `prompt-${stage}`,
      stage,
      version: 1,
      content: 'System policy. {{instruction}}',
      status: 'enabled' as const,
      source: 'admin' as const,
      createdAt: '2026-07-11T10:00:00.000Z',
    });
  }
}
