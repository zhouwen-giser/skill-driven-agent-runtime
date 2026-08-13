import { z } from 'zod';

import {
  rehydrateConfigurationRevision,
  type ConfigurationRevision,
  type RuntimeRevisionAck,
} from '../../node-control-domain/src/index.js';
import type {
  RuntimeConfigurationSource,
  RuntimeConfigurationTarget,
} from '../../runtime-control-application/src/index.js';

const RevisionSchema = z
  .object({
    configurationId: z.string().min(1),
    targetType: z.enum([
      'node',
      'llm_provider',
      'model_route',
      'smpp_source',
      'mcp_provider_binding',
      'telemetry_link',
      'runtime_policy',
    ]),
    targetId: z.string().min(1),
    revision: z.number().int().positive(),
    status: z.enum([
      'draft',
      'validated',
      'published',
      'applying',
      'applied',
      'partially_applied',
      'rejected',
      'rolled_back',
    ]),
    applyMode: z.enum([
      'hot_reload',
      'new_task_only',
      'reconnect_required',
      'restart_required',
      'immutable',
    ]),
    content: z.json(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    createdBy: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    publishedAt: z.iso.datetime({ offset: true }).optional(),
    state: z.unknown().optional(),
  })
  .strict();

export interface RuntimeRevisionHint {
  readonly eventId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly revision: number;
  readonly checksum: string;
}

export class HttpRuntimeConfigurationSource implements RuntimeConfigurationSource {
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(configuration: Readonly<{ baseUrl: string; serviceToken: string }>) {
    this.#baseUrl = configuration.baseUrl.replace(/\/+$/u, '');
    this.#serviceToken = configuration.serviceToken;
  }

  async latest(
    target: RuntimeConfigurationTarget,
    currentRevision?: number,
  ): Promise<ConfigurationRevision | undefined> {
    const url = new URL(`${this.#baseUrl}/internal/v1/revisions/latest`);
    url.searchParams.set('targetType', target.targetType);
    url.searchParams.set('targetId', target.targetId);
    if (currentRevision !== undefined)
      url.searchParams.set('currentRevision', String(currentRevision));
    const response = await globalThis.fetch(url, { headers: this.headers(), redirect: 'manual' });
    if (response.status === 304 || response.status === 404) return undefined;
    if (!response.ok) throw new Error(`RUNTIME_CONTROL_LATEST_FAILED:${String(response.status)}`);
    return parseRevision(await response.json());
  }

  async acknowledge(acknowledgement: RuntimeRevisionAck): Promise<void> {
    const response = await globalThis.fetch(`${this.#baseUrl}/internal/v1/acks`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(acknowledgement),
      redirect: 'manual',
    });
    if (response.status !== 202)
      throw new Error(`RUNTIME_CONTROL_ACK_FAILED:${String(response.status)}`);
  }

  async bootstrap(): Promise<unknown> {
    const response = await globalThis.fetch(`${this.#baseUrl}/internal/v1/bootstrap`, {
      headers: this.headers(),
      redirect: 'manual',
    });
    if (!response.ok)
      throw new Error(`RUNTIME_CONTROL_BOOTSTRAP_FAILED:${String(response.status)}`);
    return response.json();
  }

  async watch(
    onHint: (hint: RuntimeRevisionHint) => void,
    signal: AbortSignal,
    lastEventId?: string,
  ): Promise<void> {
    const response = await globalThis.fetch(`${this.#baseUrl}/internal/v1/revisions/watch`, {
      headers: {
        ...this.headers(),
        accept: 'text/event-stream',
        ...(lastEventId === undefined ? {} : { 'last-event-id': lastEventId }),
      },
      signal,
      redirect: 'manual',
    });
    if (!response.ok || response.body === null)
      throw new Error(`RUNTIME_CONTROL_WATCH_FAILED:${String(response.status)}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value as Uint8Array, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
          .trim();
        if (data !== undefined && data !== '') onHint(parseHint(JSON.parse(data) as unknown));
        boundary = buffer.indexOf('\n\n');
      }
    }
  }

  private headers(): Readonly<Record<string, string>> {
    return Object.freeze({ authorization: `Bearer ${this.#serviceToken}` });
  }
}

function parseRevision(value: unknown): ConfigurationRevision {
  const parsed = RevisionSchema.parse(value);
  return rehydrateConfigurationRevision({
    configurationId: parsed.configurationId,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    revision: parsed.revision,
    status: parsed.status,
    applyMode: parsed.applyMode,
    content: parsed.content,
    checksum: parsed.checksum,
    createdBy: parsed.createdBy,
    createdAt: parsed.createdAt,
    ...(parsed.publishedAt === undefined ? {} : { publishedAt: parsed.publishedAt }),
  });
}

function parseHint(value: unknown): RuntimeRevisionHint {
  return z
    .object({
      eventId: z.string().min(1),
      targetType: z.string().min(1),
      targetId: z.string().min(1),
      revision: z.number().int().positive(),
      checksum: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict()
    .parse(value);
}
