import { createServer, type IncomingMessage, type Server } from 'node:http';
import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import { CompositeModelTransportAdapter } from '../src/index.js';

describe('non-OpenAI Messages model adapter contract', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening === true) {
      server.close();
      await once(server, 'close');
    }
    server = undefined;
  });

  it('uses the Messages wire format and normalizes structured output and token usage', async () => {
    let observed:
      Readonly<{ url?: string; headers: IncomingMessage['headers']; body: unknown }> | undefined;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        observed = {
          ...(request.url === undefined ? {} : { url: request.url }),
          headers: request.headers,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        };
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            id: 'message-vendor-1',
            model: 'vendor-model',
            content: [{ type: 'text', text: '{"decision":"accepted"}' }],
            usage: { input_tokens: 13, output_tokens: 4 },
          }),
        );
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('ADDRESS_UNAVAILABLE');

    const result = await new CompositeModelTransportAdapter().generateStructured({
      configuration: {
        providerId: 'vendor-1',
        name: 'Vendor Messages',
        kind: 'other_vendor',
        apiStyle: 'anthropic_messages',
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
        model: 'vendor-model',
        enabled: true,
        timeoutMs: 1000,
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
      credentialHeaders: { 'x-api-key': 'contract-only' },
      instruction: 'Choose safely.',
      responseSchema: {
        type: 'object',
        required: ['decision'],
        properties: { decision: { type: 'string' } },
      },
      correctionErrors: [],
      signal: AbortSignal.timeout(1000),
    });

    expect(result).toMatchObject({
      structuredResult: { decision: 'accepted' },
      inputTokens: 13,
      outputTokens: 4,
    });
    expect(observed).toMatchObject({
      url: '/v1/messages',
      headers: {
        'x-api-key': 'contract-only',
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: 'vendor-model',
        max_tokens: 4096,
        messages: [expect.objectContaining({ role: 'user' })],
      },
    });
  });

  it('fails explicitly when embeddings are requested from a Messages-only provider', async () => {
    await expect(
      new CompositeModelTransportAdapter().embed({
        configuration: {
          providerId: 'vendor-1',
          name: 'Vendor Messages',
          kind: 'other_vendor',
          apiStyle: 'anthropic_messages',
          baseUrl: 'http://127.0.0.1:1/v1',
          model: 'vendor-model',
          enabled: true,
          timeoutMs: 1000,
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
        credentialHeaders: {},
        text: 'embed this',
        signal: AbortSignal.timeout(1000),
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OPERATION_UNSUPPORTED' });
  });
});
