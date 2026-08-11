import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY,
  HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
  HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
  homeLabA2AModelDecision,
  type HomeLabA2AModelFixtureMode,
} from './home-lab-a2a-model-contract.js';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const FixtureModeSchema = z.enum([
  'valid',
  'workflow_wrong_resource_ref',
  'workflow_unreachable',
  'workflow_wrong_result_mapping',
]);
const ChatRequestSchema = z
  .object({
    model: z.literal(HOME_LAB_A2A_MODEL_FIXTURE_MODEL),
    messages: z
      .array(
        z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() }).strict(),
      )
      .min(2),
    response_format: z
      .object({
        type: z.literal('json_schema'),
        json_schema: z
          .object({
            name: z.string().min(1),
            strict: z.literal(true),
            schema: z.record(z.string(), z.unknown()),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const EmbeddingRequestSchema = z
  .object({
    model: z.literal(HOME_LAB_A2A_MODEL_FIXTURE_MODEL),
    input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  })
  .strict();

export interface HomeLabA2AModelFixtureOptions {
  readonly host?: '127.0.0.1' | '::1';
  readonly port?: number;
  readonly token: string;
  readonly mode?: HomeLabA2AModelFixtureMode;
}

export interface HomeLabA2AModelFixtureHandle {
  readonly baseUrl: string;
  readonly healthUrl: string;
  close(): Promise<void>;
}

export async function startHomeLabA2AModelFixture(
  options: HomeLabA2AModelFixtureOptions,
): Promise<HomeLabA2AModelFixtureHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const token = localToken(options.token);
  const mode = parseHomeLabA2AModelFixtureMode(options.mode ?? 'valid');
  if (!['127.0.0.1', '::1'].includes(host))
    throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_LOOPBACK_REQUIRED');
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
    throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_PORT_INVALID');
  const server = createServer((request, response) => {
    void handleRequest(request, response, token, mode);
  });
  server.listen(port, host);
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_ADDRESS_UNAVAILABLE');
  }
  const authority =
    host === '::1' ? `[::1]:${String(address.port)}` : `${host}:${String(address.port)}`;
  return Object.freeze({
    baseUrl: `http://${authority}/v1`,
    healthUrl: `http://${authority}/health`,
    close: () => closeServer(server),
  });
}

export function parseHomeLabA2AModelFixtureMode(value: unknown): HomeLabA2AModelFixtureMode {
  const parsed = FixtureModeSchema.safeParse(value);
  if (!parsed.success) throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_MODE_INVALID');
  return parsed.data;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  mode: HomeLabA2AModelFixtureMode,
): Promise<void> {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, {
        ready: true,
        providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID,
        model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
        modelBoundary: HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY,
        mode,
      });
      return;
    }
    if (
      request.method !== 'POST' ||
      !['/v1/chat/completions', '/v1/embeddings'].includes(request.url ?? '')
    ) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      sendJson(response, 401, { error: { code: 'AUTHORIZATION_REQUIRED' } });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '')) {
      sendJson(response, 415, { error: { code: 'CONTENT_TYPE_JSON_REQUIRED' } });
      return;
    }
    const body = await readJsonBody(request);
    if (request.url === '/v1/embeddings') {
      const parsed = EmbeddingRequestSchema.parse(body);
      const text = Array.isArray(parsed.input) ? parsed.input.join('\n') : parsed.input;
      sendJson(response, 200, {
        model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
        data: [{ embedding: deterministicEmbedding(text) }],
        usage: { prompt_tokens: boundedTokenEstimate(text) },
      });
      return;
    }
    const parsed = ChatRequestSchema.parse(body);
    const instruction = [...parsed.messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'user' &&
          !message.content.startsWith('Correct these validation errors:'),
      )?.content;
    if (instruction === undefined)
      throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_INSTRUCTION_REQUIRED');
    const decision = homeLabA2AModelDecision(instruction, mode);
    sendJson(response, 200, {
      id: `home-lab-${decision.stage}`,
      model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL,
      choices: [
        { message: { role: 'assistant', content: JSON.stringify(decision.structuredResult) } },
      ],
      usage: {
        prompt_tokens: boundedTokenEstimate(instruction),
        completion_tokens: boundedTokenEstimate(JSON.stringify(decision.structuredResult)),
      },
    });
  } catch (error: unknown) {
    sendJson(response, error instanceof z.ZodError ? 400 : 422, {
      error: {
        code: error instanceof z.ZodError ? 'REQUEST_SCHEMA_INVALID' : errorCode(error),
      },
    });
  }
}

function deterministicEmbedding(text: string): readonly number[] {
  let a = 0;
  let b = 0;
  let c = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = (a + code * (index + 1)) % 997;
    b = (b + code * ((index % 7) + 1)) % 991;
    c = (c + code) % 983;
  }
  const vector = [a / 997, b / 991, c / 983, 1];
  return Object.freeze(vector.map((value) => (Number.isFinite(value) ? value : 0)));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value: unknown = chunk;
    const buffer =
      typeof value === 'string'
        ? Buffer.from(value)
        : value instanceof Uint8Array
          ? Buffer.from(value)
          : undefined;
    if (buffer === undefined) throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_BODY_INVALID');
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_BODY_REQUIRED');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(body));
}

function localToken(value: string): string {
  if (typeof value !== 'string' || value.length < 32 || value.trim() !== value || /\s/u.test(value))
    throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_TOKEN_INVALID');
  return value;
}

function boundedTokenEstimate(value: string): number {
  return Math.max(1, Math.min(1_000_000, Math.ceil(value.length / 4)));
}

function errorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
    ? error.message
    : 'FIXTURE_REQUEST_REJECTED';
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

async function main(): Promise<void> {
  const token = process.env['HOME_LAB_A2A_MODEL_FIXTURE_TOKEN'];
  if (token === undefined) throw new Error('HOME_LAB_A2A_MODEL_FIXTURE_TOKEN_REQUIRED');
  const portText = process.env['HOME_LAB_A2A_MODEL_FIXTURE_PORT'] ?? '18461';
  const port = Number(portText);
  const mode = parseHomeLabA2AModelFixtureMode(
    process.env['HOME_LAB_A2A_MODEL_FIXTURE_MODE'] ?? 'valid',
  );
  const handle = await startHomeLabA2AModelFixture({ token, port, mode });
  process.stdout.write(
    `${JSON.stringify({ ready: true, providerId: HOME_LAB_A2A_MODEL_FIXTURE_PROVIDER_ID, model: HOME_LAB_A2A_MODEL_FIXTURE_MODEL, modelBoundary: HOME_LAB_A2A_MODEL_FIXTURE_BOUNDARY })}\n`,
  );
  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isEntrypoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntrypoint) await main();
