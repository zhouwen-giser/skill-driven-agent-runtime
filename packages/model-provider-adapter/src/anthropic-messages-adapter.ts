import { z } from 'zod';

import type { ModelTransportAdapter } from '../../application/src/index.js';
import {
  assertModelOutboundEndpoint,
  ModelAdapterError,
  type ModelOutboundEndpointPolicy,
} from './openai-compatible-adapter.js';

const MessagesResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  content: z.array(z.unknown()).min(1),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
const DisplayableTextBlockSchema = z.object({ type: z.literal('text'), text: z.string() });

export class AnthropicMessagesModelAdapter implements ModelTransportAdapter {
  readonly #endpointPolicy: ModelOutboundEndpointPolicy;

  constructor(endpointPolicy: ModelOutboundEndpointPolicy = {}) {
    this.#endpointPolicy = endpointPolicy;
  }

  async generateStructured(input: Parameters<ModelTransportAdapter['generateStructured']>[0]) {
    const response = await requestJson(
      assertModelOutboundEndpoint(
        `${input.configuration.baseUrl.replace(/\/$/u, '')}/messages`,
        this.#endpointPolicy,
      ),
      input.credentialHeaders,
      {
        model: input.configuration.model,
        max_tokens: 4096,
        system:
          'Return only JSON matching the supplied JSON Schema. Do not include private reasoning.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  instruction: input.instruction,
                  responseSchema: input.responseSchema,
                  correctionErrors: input.correctionErrors,
                }),
              },
            ],
          },
        ],
      },
      input.signal,
    );
    const parsed = MessagesResponseSchema.safeParse(response);
    if (!parsed.success)
      throw new ModelAdapterError('MODEL_RESPONSE_INVALID', 'Messages response shape is invalid.');
    const content = parsed.data.content
      .map((block) => DisplayableTextBlockSchema.safeParse(block))
      .find((block) => block.success)?.data.text;
    if (content === undefined)
      throw new ModelAdapterError('MODEL_RESPONSE_INVALID', 'Structured content is missing.');
    let structuredResult: unknown;
    try {
      structuredResult = JSON.parse(content) as unknown;
    } catch {
      throw new ModelAdapterError(
        'MODEL_RESPONSE_INVALID',
        'Structured content is not valid JSON.',
      );
    }
    return {
      rawResponse: {
        id: parsed.data.id,
        model: parsed.data.model,
        content,
        usage: parsed.data.usage,
      },
      structuredResult,
      ...(parsed.data.usage?.input_tokens === undefined
        ? {}
        : { inputTokens: parsed.data.usage.input_tokens }),
      ...(parsed.data.usage?.output_tokens === undefined
        ? {}
        : { outputTokens: parsed.data.usage.output_tokens }),
    };
  }

  embed(): Promise<never> {
    return Promise.reject(
      new ModelAdapterError(
        'MODEL_OPERATION_UNSUPPORTED',
        'The Anthropic Messages API does not provide embeddings.',
      ),
    );
  }
}

async function requestJson(
  url: URL,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
      redirect: 'manual',
    });
  } catch (error: unknown) {
    throw new ModelAdapterError(
      'MODEL_TRANSPORT_FAILED',
      error instanceof Error ? error.message : 'Model request failed.',
    );
  }
  if (!response.ok)
    throw new ModelAdapterError(
      'MODEL_UPSTREAM_ERROR',
      `Model endpoint returned HTTP ${String(response.status)}.`,
    );
  try {
    return await response.json();
  } catch {
    throw new ModelAdapterError('MODEL_RESPONSE_INVALID', 'Model endpoint did not return JSON.');
  }
}
