import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';

import { OpenAiCompatibleModelAdapter } from '../src/index.js';

describe('OpenAI-compatible Model adapter', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('requests strict structured JSON and returns only displayable audited fields', async () => {
    const requests: unknown[] = [];
    const server = await loopback((request) => {
      requests.push(request.body);
      expect(request.authorization).toBe('Bearer local-test');
      return Promise.resolve({
        id: 'chat-1',
        model: 'local-model',
        choices: [{ message: { content: '{"answer":"ok"}', reasoning: 'must not cross adapter' } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
        private_reasoning: 'must not cross adapter',
      });
    });
    close = server.close;
    const result = await new OpenAiCompatibleModelAdapter().generateStructured({
      configuration: configuration(server.baseUrl),
      credentialHeaders: { Authorization: 'Bearer local-test' },
      instruction: 'Return an answer.',
      responseSchema: { type: 'object' },
      correctionErrors: [],
      signal: AbortSignal.timeout(1000),
    });
    expect(requests[0]).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(result.structuredResult).toEqual({ answer: 'ok' });
    expect(JSON.stringify(result.rawResponse)).not.toContain('reasoning');
  });

  it('calls the embeddings endpoint and rejects invalid response shapes', async () => {
    const server = await loopback((request) =>
      Promise.resolve(
        request.path.endsWith('/embeddings')
          ? { model: 'embed', data: [{ embedding: [1, 0, 0] }], usage: { prompt_tokens: 3 } }
          : {},
      ),
    );
    close = server.close;
    await expect(
      new OpenAiCompatibleModelAdapter().embed({
        configuration: configuration(server.baseUrl),
        credentialHeaders: {},
        text: 'device',
        signal: AbortSignal.timeout(1000),
      }),
    ).resolves.toMatchObject({ vector: [1, 0, 0], inputTokens: 3 });
  });

  it('does not forward chat credentials across an upstream redirect', async () => {
    const server = await redirectingLoopback();
    close = server.close;
    await expect(
      new OpenAiCompatibleModelAdapter().generateStructured({
        configuration: configuration(server.baseUrl),
        credentialHeaders: { Authorization: 'Bearer local-test' },
        instruction: 'Return an answer.',
        responseSchema: { type: 'object' },
        correctionErrors: [],
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toMatchObject({
      code: 'MODEL_UPSTREAM_ERROR',
      message: 'Model endpoint returned HTTP 307.',
    });
    expect(server.forwardedRequests()).toBe(0);
  });

  it('does not forward embedding credentials across an upstream redirect', async () => {
    const server = await redirectingLoopback();
    close = server.close;
    await expect(
      new OpenAiCompatibleModelAdapter().embed({
        configuration: configuration(server.baseUrl),
        credentialHeaders: { Authorization: 'Bearer local-test' },
        text: 'device',
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toMatchObject({
      code: 'MODEL_UPSTREAM_ERROR',
      message: 'Model endpoint returned HTTP 307.',
    });
    expect(server.forwardedRequests()).toBe(0);
  });
});

function configuration(baseUrl: string) {
  return {
    providerId: 'provider.local',
    name: 'Local',
    kind: 'local' as const,
    apiStyle: 'openai_chat_completions' as const,
    baseUrl,
    model: 'local-model',
    enabled: true,
    timeoutMs: 1000,
    createdAt: '2026-07-11T10:00:00.000Z',
    updatedAt: '2026-07-11T10:00:00.000Z',
  };
}

async function loopback(
  handler: (request: { path: string; authorization?: string; body: unknown }) => Promise<unknown>,
) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on(
      'end',
      () =>
        void (async () => {
          const authorization = request.headers.authorization;
          const result = await handler({
            path: request.url ?? '',
            ...(authorization === undefined ? {} : { authorization }),
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
          });
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(result));
        })(),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('ADDRESS_UNAVAILABLE');
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

async function redirectingLoopback() {
  let forwardedRequests = 0;
  const target = createServer((_request, response) => {
    forwardedRequests += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [{ embedding: [1] }] }));
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const targetAddress = target.address();
  if (targetAddress === null || typeof targetAddress === 'string')
    throw new Error('REDIRECT_TARGET_ADDRESS_UNAVAILABLE');

  const source = createServer((_request, response) => {
    response.statusCode = 307;
    response.setHeader('location', `http://127.0.0.1:${String(targetAddress.port)}/redirected`);
    response.end();
  });
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  const sourceAddress = source.address();
  if (sourceAddress === null || typeof sourceAddress === 'string')
    throw new Error('REDIRECT_SOURCE_ADDRESS_UNAVAILABLE');

  return {
    baseUrl: `http://127.0.0.1:${String(sourceAddress.port)}/v1`,
    forwardedRequests: () => forwardedRequests,
    close: async () => {
      source.close();
      await once(source, 'close');
      target.close();
      await once(target, 'close');
    },
  };
}
