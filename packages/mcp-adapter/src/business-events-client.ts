import { z } from 'zod';

import { FROZEN_MCP_PROTOCOL_VERSION } from './frozen-v1-mcp-client.js';
import { parseBoundedSseJson } from './bounded-sse-json.js';

export const BUSINESS_EVENTS_EXTENSION = 'io.sdar/businessEvents' as const;
export const BUSINESS_EVENTS_PROFILE_VERSION = '1.0' as const;
export const BUSINESS_EVENTS_LISTEN_METHOD = 'io.sdar/businessEvents/listen' as const;
export const BUSINESS_EVENTS_RELATION_METHOD = 'io.sdar/businessEvents/relatedTasks/list' as const;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const eventId = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const sequence = z.string().regex(/^(0|[1-9][0-9]{0,18})$/u);
const positiveSequence = z.string().regex(/^[1-9][0-9]{0,18}$/u);
const subscriptionId = z.union([z.string(), z.number().int()]);
const subscriptionMeta = z
  .object({ 'io.modelcontextprotocol/subscriptionId': subscriptionId })
  .catchall(z.unknown());

const discoveryExtensionSchema = z
  .object({
    profileVersion: z.literal(BUSINESS_EVENTS_PROFILE_VERSION),
    delivery: z.literal('post_sse'),
    scopes: z.tuple([z.literal('task'), z.literal('resource')]),
    resumeMode: z.literal('stream_sequence'),
    maxRelatedTaskIds: z.literal(256),
    retentionMs: z.number().int().min(60_000).max(7_776_000_000),
    authorizationModel: z.literal('subscription_snapshot_projection'),
    relationOverflow: z.literal('paged_query'),
    streamCancellation: z.literal('connection_close'),
    continuityClass: z.enum(['all_durable', 'mixed', 'best_effort_only']),
    sources: z
      .array(
        z
          .object({
            sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
            deliverySemantics: z.enum(['durable_at_least_once', 'best_effort_live']),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

const ackSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.literal('notifications/io.sdar/businessEvents/acknowledged'),
    params: z
      .object({
        profileVersion: z.literal(BUSINESS_EVENTS_PROFILE_VERSION),
        streamId: uuid,
        generationStatus: z.enum(['current', 'replayable_closed']),
        acceptedAfterSequence: sequence,
        earliestAvailableSequence: positiveSequence,
        currentSequence: sequence,
        sourceContinuity: z
          .object({
            continuityClass: z.enum(['all_durable', 'mixed', 'best_effort_only']),
            status: z.enum(['continuous', 'best_effort']),
            continuousSinceSequence: positiveSequence.optional(),
            degradedSourceIds: z.array(z.string()).max(16),
          })
          .strict(),
        _meta: subscriptionMeta,
      })
      .strict(),
  })
  .strict();

const commonEvent = z.object({
  streamId: uuid,
  eventId,
  sequence: positiveSequence,
  sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
  eventType: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/u),
  occurredAt: z.iso.datetime({ offset: true }),
  description: z.string().min(1).max(4096),
  reasonCode: z.string().optional(),
  severityHint: z.enum(['info', 'warning', 'critical']).optional(),
  rawPayload: z.unknown().optional(),
  _meta: subscriptionMeta,
});
const taskEventSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.literal('notifications/io.sdar/businessEvents'),
    params: commonEvent.extend({ scope: z.literal('task'), taskId: z.string().min(1) }).strict(),
  })
  .strict();
const resourceEventSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.literal('notifications/io.sdar/businessEvents'),
    params: commonEvent
      .extend({
        scope: z.literal('resource'),
        resourceRef: z.string().min(1).max(512),
        relatedTaskIds: z.array(z.string().min(1)).max(256),
        relatedTaskCount: z.number().int().nonnegative(),
        relationTruncated: z.boolean(),
      })
      .strict(),
  })
  .strict();
const continuitySchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.literal('notifications/io.sdar/businessEvents/continuity'),
    params: z
      .object({
        profileVersion: z.literal(BUSINESS_EVENTS_PROFILE_VERSION),
        previousStreamId: uuid,
        newStreamId: uuid,
        reasonCode: z.enum([
          'SOURCE_CURSOR_EXPIRED',
          'SOURCE_STREAM_RESET',
          'SOURCE_DATA_LOSS',
          'SOURCE_SEQUENCE_REGRESSION',
          'SOURCE_IDENTITY_CONFLICT',
          'SOURCE_POISON_EVENT',
          'TASK_MAPPING_FAILED',
          'SOURCE_ROSTER_CHANGED',
          'OPERATOR_ROTATION',
        ]),
        affectedSourceIds: z.array(z.string()).min(1).max(16),
        gapDetectedAt: z.iso.datetime({ offset: true }),
        lastReplayableSequence: sequence,
        lastContinuousSequence: sequence.optional(),
        _meta: subscriptionMeta,
      })
      .strict(),
  })
  .strict();
const relationSchema = z
  .object({
    resultType: z.literal('complete'),
    streamId: uuid,
    eventId,
    projectionToken: z
      .string()
      .min(22)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/u),
    items: z.array(z.string().min(1)).max(256),
    total: z.number().int().nonnegative(),
    nextAfterTaskId: z.string().min(1).optional(),
  })
  .strict();
const rpcEnvelope = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string(),
        data: z
          .object({
            reasonCode: z.string().regex(/^BUSINESS_EVENT_[A-Z0-9_]+$/u),
            retryable: z.boolean(),
            recoveryAction: z.string().min(1),
          })
          .catchall(z.unknown())
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => (value.result === undefined) !== (value.error === undefined));

export type BusinessEventsDiscovery = z.output<typeof discoveryExtensionSchema>;
export type BusinessEventAck = z.output<typeof ackSchema>['params'];
export type BusinessEventNotification =
  z.output<typeof taskEventSchema> | z.output<typeof resourceEventSchema>;
export type BusinessEventContinuity = z.output<typeof continuitySchema>;
export type BusinessEventRelationPage = z.output<typeof relationSchema>;

type FrozenFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class FrozenBusinessEventsClient {
  readonly #fetch: FrozenFetch;
  #requestSequence = 0;

  constructor(fetchImplementation: FrozenFetch = globalThis.fetch) {
    this.#fetch = fetchImplementation;
  }

  async discover(input: BusinessEventsEndpointInput): Promise<BusinessEventsDiscovery> {
    const result = await this.#request(input, 'server/discover', {});
    const extension = record(record(record(result)['capabilities'])['extensions'])[
      BUSINESS_EVENTS_EXTENSION
    ];
    const parsed = discoveryExtensionSchema.safeParse(extension);
    if (!parsed.success)
      throw businessEventsError(
        'BUSINESS_EVENTS_DISCOVERY_INVALID',
        'Provider discovery is missing the exact Business Events Profile 1.0 capability.',
      );
    return parsed.data;
  }

  async listen(
    input: BusinessEventsEndpointInput &
      (
        | Readonly<{ cursor: Readonly<{ streamId: string; afterSequence: string }> }>
        | Readonly<{ startPosition: 'latest' | 'earliest_available' }>
      ),
  ): Promise<
    Readonly<{
      requestId: number;
      ack: BusinessEventAck;
      messages: AsyncIterable<BusinessEventNotification | BusinessEventContinuity>;
    }>
  > {
    const requestId = ++this.#requestSequence;
    const params = {
      ...('cursor' in input ? { cursor: input.cursor } : { startPosition: input.startPosition }),
      _meta: clientMeta(),
    };
    const response = await this.#post(input, BUSINESS_EVENTS_LISTEN_METHOD, requestId, params);
    if (response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      const envelope = rpcEnvelope.safeParse(await response.json());
      if (!envelope.success || envelope.data.id !== requestId || envelope.data.error === undefined)
        throw businessEventsError(
          'BUSINESS_EVENTS_RESPONSE_INVALID',
          'Business Events listen returned a malformed JSON response.',
        );
      throw protocolRpcError(envelope.data.error);
    }
    if (
      !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') ||
      response.body === null
    )
      throw businessEventsError(
        'BUSINESS_EVENTS_RESPONSE_INVALID',
        'Business Events listen must return a successful SSE stream.',
      );
    const iterator = parseBoundedSseJson(response.body)[Symbol.asyncIterator]();
    const first = await iterator.next();
    const ack = ackSchema.safeParse(first.value);
    if (first.done || !ack.success)
      throw businessEventsError(
        'BUSINESS_EVENTS_ACK_MISSING',
        'The first Business Events SSE message must be the frozen acknowledgement.',
      );
    const remoteSubscriptionId = ack.data.params._meta['io.modelcontextprotocol/subscriptionId'];
    const messages = this.#validatedMessages(
      iterator,
      remoteSubscriptionId,
      ack.data.params.streamId,
    );
    return Object.freeze({ requestId, ack: ack.data.params, messages });
  }

  async relatedTasks(
    input: BusinessEventsEndpointInput &
      Readonly<{
        streamId: string;
        eventId: string;
        limit: number;
        projectionToken?: string;
        afterTaskId?: string;
      }>,
  ): Promise<BusinessEventRelationPage> {
    if ((input.projectionToken === undefined) !== (input.afterTaskId === undefined))
      throw businessEventsError(
        'BUSINESS_EVENTS_PARAMS_INVALID',
        'projectionToken and afterTaskId must be supplied together.',
      );
    const result = await this.#request(
      input,
      BUSINESS_EVENTS_RELATION_METHOD,
      {
        streamId: input.streamId,
        eventId: input.eventId,
        limit: input.limit,
        ...(input.projectionToken === undefined ? {} : { projectionToken: input.projectionToken }),
        ...(input.afterTaskId === undefined ? {} : { afterTaskId: input.afterTaskId }),
      },
      input.eventId,
    );
    const parsed = relationSchema.safeParse(result);
    if (
      !parsed.success ||
      parsed.data.streamId !== input.streamId ||
      parsed.data.eventId !== input.eventId
    )
      throw businessEventsError(
        'BUSINESS_EVENTS_RELATION_INVALID',
        'Provider returned a malformed or mismatched relation page.',
      );
    return parsed.data;
  }

  async #request(
    input: BusinessEventsEndpointInput,
    method: 'server/discover' | typeof BUSINESS_EVENTS_RELATION_METHOD,
    params: Readonly<Record<string, unknown>>,
    routingName?: string,
  ): Promise<unknown> {
    const requestId = ++this.#requestSequence;
    const response = await this.#post(
      input,
      method,
      requestId,
      { ...params, _meta: clientMeta() },
      routingName,
    );
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
      throw businessEventsError(
        'BUSINESS_EVENTS_RESPONSE_INVALID',
        'Business Events unary response must be JSON.',
      );
    const envelope = rpcEnvelope.safeParse(await response.json());
    if (!envelope.success || envelope.data.id !== requestId)
      throw businessEventsError(
        'BUSINESS_EVENTS_RESPONSE_INVALID',
        'Business Events JSON-RPC response is malformed or mismatched.',
      );
    if (envelope.data.error !== undefined) {
      throw protocolRpcError(envelope.data.error);
    }
    return envelope.data.result;
  }

  async #post(
    input: BusinessEventsEndpointInput,
    method: string,
    requestId: number,
    params: Readonly<Record<string, unknown>>,
    routingName?: string,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(input.endpoint, {
        method: 'POST',
        headers: {
          ...input.headers,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': FROZEN_MCP_PROTOCOL_VERSION,
          'Mcp-Method': method,
          ...(routingName === undefined ? {} : { 'Mcp-Name': routingName }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        redirect: 'manual',
      });
    } catch (error: unknown) {
      throw new BusinessEventsProtocolError(
        'BUSINESS_EVENTS_TRANSPORT_FAILED',
        'Business Events transport failed before a protocol response was received.',
        { cause: error, retryable: true },
      );
    }
    if (
      !response.ok &&
      !response.headers.get('content-type')?.toLowerCase().includes('application/json')
    )
      throw businessEventsError(
        'BUSINESS_EVENTS_HTTP_STATUS_INVALID',
        `Business Events endpoint returned HTTP ${String(response.status)}.`,
      );
    return response;
  }

  async *#validatedMessages(
    iterator: AsyncIterator<unknown>,
    remoteSubscriptionId: string | number,
    acknowledgedStreamId: string,
  ): AsyncIterable<BusinessEventNotification | BusinessEventContinuity> {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      const event = taskEventSchema.safeParse(next.value);
      const resource = resourceEventSchema.safeParse(next.value);
      const continuity = continuitySchema.safeParse(next.value);
      const parsed = event.success
        ? event.data
        : resource.success
          ? resource.data
          : continuity.success
            ? continuity.data
            : undefined;
      if (parsed === undefined)
        throw businessEventsError(
          'BUSINESS_EVENTS_NOTIFICATION_INVALID',
          'Business Events SSE contains an unrecognized or malformed notification.',
        );
      if (parsed.params._meta['io.modelcontextprotocol/subscriptionId'] !== remoteSubscriptionId)
        throw businessEventsError(
          'BUSINESS_EVENTS_SUBSCRIPTION_MISMATCH',
          'Business Event notification is outside the acknowledged subscription.',
        );
      if ('streamId' in parsed.params && parsed.params.streamId !== acknowledgedStreamId)
        throw businessEventsError(
          'BUSINESS_EVENTS_STREAM_MISMATCH',
          'Business Event belongs to a stream other than the acknowledged generation.',
        );
      if (
        'previousStreamId' in parsed.params &&
        parsed.params.previousStreamId !== acknowledgedStreamId
      )
        throw businessEventsError(
          'BUSINESS_EVENTS_STREAM_MISMATCH',
          'Continuity control does not close the acknowledged generation.',
        );
      yield parsed;
    }
  }
}

export interface BusinessEventsEndpointInput {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

function clientMeta(): Readonly<Record<string, unknown>> {
  return {
    'io.modelcontextprotocol/protocolVersion': FROZEN_MCP_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'sdar', version: '1.2.2' },
    'io.modelcontextprotocol/clientCapabilities': {
      extensions: {
        [BUSINESS_EVENTS_EXTENSION]: { profileVersion: BUSINESS_EVENTS_PROFILE_VERSION },
      },
    },
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

export type BusinessEventsProtocolErrorCode =
  | 'BUSINESS_EVENTS_TRANSPORT_FAILED'
  | 'BUSINESS_EVENTS_HTTP_STATUS_INVALID'
  | 'BUSINESS_EVENTS_RESPONSE_INVALID'
  | 'BUSINESS_EVENTS_DISCOVERY_INVALID'
  | 'BUSINESS_EVENTS_ACK_MISSING'
  | 'BUSINESS_EVENTS_NOTIFICATION_INVALID'
  | 'BUSINESS_EVENTS_SUBSCRIPTION_MISMATCH'
  | 'BUSINESS_EVENTS_STREAM_MISMATCH'
  | 'BUSINESS_EVENTS_RELATION_INVALID'
  | 'BUSINESS_EVENTS_PARAMS_INVALID'
  | 'BUSINESS_EVENTS_PROVIDER_ERROR'
  | `BUSINESS_EVENT_${string}`;

export class BusinessEventsProtocolError extends Error {
  readonly code: BusinessEventsProtocolErrorCode;
  readonly rpcCode: number | undefined;
  readonly retryable: boolean | undefined;

  constructor(
    code: BusinessEventsProtocolErrorCode,
    message: string,
    options: ErrorOptions & Readonly<{ rpcCode?: number; retryable?: boolean }> = {},
  ) {
    super(message, options);
    this.name = 'BusinessEventsProtocolError';
    this.code = code;
    this.rpcCode = options.rpcCode;
    this.retryable = options.retryable;
  }
}

function businessEventsError(
  code: BusinessEventsProtocolErrorCode,
  message: string,
): BusinessEventsProtocolError {
  return new BusinessEventsProtocolError(code, message);
}

function protocolRpcError(
  error: Readonly<{
    code: number;
    message: string;
    data?: Readonly<{ reasonCode: string; retryable: boolean }> | undefined;
  }>,
): BusinessEventsProtocolError {
  return new BusinessEventsProtocolError(
    (error.data?.reasonCode as BusinessEventsProtocolErrorCode | undefined) ??
      'BUSINESS_EVENTS_PROVIDER_ERROR',
    error.message,
    {
      rpcCode: error.code,
      ...(error.data?.retryable === undefined ? {} : { retryable: error.data.retryable }),
    },
  );
}
