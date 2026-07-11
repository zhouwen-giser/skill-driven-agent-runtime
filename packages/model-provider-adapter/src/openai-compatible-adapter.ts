import { z } from 'zod';

import type { ModelTransportAdapter } from '../../application/src/index.js';

const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(),
});
const ChatResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: UsageSchema.optional(),
});
const EmbeddingResponseSchema = z.object({
  model: z.string().optional(),
  data: z.array(z.object({ embedding: z.array(z.number()) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional() }).optional(),
});

export class OpenAiCompatibleModelAdapter implements ModelTransportAdapter {
  async generateStructured(input: Parameters<ModelTransportAdapter['generateStructured']>[0]) {
    const response = await requestJson(
      endpoint(input.configuration.baseUrl, 'chat/completions'),
      input.credentialHeaders,
      {
        model: input.configuration.model,
        messages: [
          {
            role: 'system',
            content:
              'Return only JSON matching the supplied JSON Schema. Do not include private reasoning.',
          },
          { role: 'user', content: input.instruction },
          ...(input.correctionErrors.length === 0
            ? []
            : [
                {
                  role: 'user',
                  content: `Correct these validation errors: ${input.correctionErrors.join('; ')}`,
                },
              ]),
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'sdar_structured_response',
            strict: true,
            schema: input.responseSchema,
          },
        },
      },
      input.signal,
    );
    const parsed = ChatResponseSchema.safeParse(response);
    if (!parsed.success)
      throw new ModelAdapterError('MODEL_RESPONSE_INVALID', 'Chat response shape is invalid.');
    const content = parsed.data.choices[0]?.message.content;
    if (content === null || content === undefined)
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
      ...(parsed.data.usage?.prompt_tokens === undefined
        ? {}
        : { inputTokens: parsed.data.usage.prompt_tokens }),
      ...(parsed.data.usage?.completion_tokens === undefined
        ? {}
        : { outputTokens: parsed.data.usage.completion_tokens }),
    };
  }

  async embed(input: Parameters<ModelTransportAdapter['embed']>[0]) {
    const response = await requestJson(
      endpoint(input.configuration.baseUrl, 'embeddings'),
      input.credentialHeaders,
      { model: input.configuration.model, input: input.text },
      input.signal,
    );
    const parsed = EmbeddingResponseSchema.safeParse(response);
    if (!parsed.success)
      throw new ModelAdapterError('MODEL_RESPONSE_INVALID', 'Embedding response shape is invalid.');
    const vector = parsed.data.data[0]?.embedding;
    if (
      vector === undefined ||
      vector.length === 0 ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new ModelAdapterError('MODEL_RESPONSE_INVALID', 'Embedding vector is invalid.');
    }
    return {
      rawResponse: {
        model: parsed.data.model,
        dimensions: vector.length,
        usage: parsed.data.usage,
      },
      vector,
      ...(parsed.data.usage?.prompt_tokens === undefined
        ? {}
        : { inputTokens: parsed.data.usage.prompt_tokens }),
    };
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
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
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

function endpoint(baseUrl: string, path: string): URL {
  return new URL(`${baseUrl.replace(/\/$/u, '')}/${path}`);
}

export type ModelAdapterErrorCode =
  'MODEL_RESPONSE_INVALID' | 'MODEL_TRANSPORT_FAILED' | 'MODEL_UPSTREAM_ERROR';
export class ModelAdapterError extends Error {
  readonly code: ModelAdapterErrorCode;
  constructor(code: ModelAdapterErrorCode, message: string) {
    super(message);
    this.name = 'ModelAdapterError';
    this.code = code;
  }
}
