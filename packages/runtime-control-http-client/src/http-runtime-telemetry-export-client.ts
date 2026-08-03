import { z } from 'zod';

import type {
  ManagementOperation,
  TelemetryExportConfiguration,
  TelemetryExportStatus,
} from '../../node-control-domain/src/index.js';
import type { NodeControlRuntimeTelemetryExportClient } from '../../node-control-application/src/index.js';

const OperationSchema = z
  .object({
    operationId: z.string().min(1),
    operationType: z.string().min(1),
    target: z
      .object({
        type: z.string().min(1),
        id: z.string().min(1),
        version: z.string().optional(),
        revision: z.number().int().positive().optional(),
      })
      .strict(),
    status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'canceled']),
    actorId: z.string().min(1),
    reason: z.string().min(1),
    idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
    result: z.unknown().optional(),
    errorCode: z.string().optional(),
    createdAt: z.iso.datetime({ offset: true }),
    startedAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

const StatusSchema = z
  .object({
    exportId: z.string(),
    status: z.enum(['healthy', 'degraded', 'blocked', 'disabled', 'unavailable']),
    activeRevision: z.number().int().nonnegative().optional(),
    lastAcknowledgedSequence: z.number().int().nonnegative().optional(),
    pendingRecords: z.number().int().nonnegative(),
    oldestPendingAt: z.iso.datetime({ offset: true }).optional(),
    lastAcknowledgedAt: z.iso.datetime({ offset: true }).optional(),
    lastErrorCode: z.string().optional(),
    lastErrorAt: z.iso.datetime({ offset: true }).optional(),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export class HttpRuntimeTelemetryExportClient implements NodeControlRuntimeTelemetryExportClient {
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(configuration: Readonly<{ baseUrl: string; serviceToken: string }>) {
    this.#baseUrl = configuration.baseUrl.replace(/\/+$/u, '');
    this.#serviceToken = configuration.serviceToken;
  }

  async apply(configuration: TelemetryExportConfiguration): Promise<ManagementOperation> {
    const response = await globalThis.fetch(`${this.#baseUrl}/internal/v1/telemetry-export/apply`, {
      method: 'POST',
      headers: this.#headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(configuration),
    });
    const input = OperationSchema.parse(await responseJson(response));
    return Object.freeze({
      operationId: input.operationId,
      operationType: input.operationType,
      target: Object.freeze({
        type: input.target.type,
        id: input.target.id,
        ...(input.target.version === undefined ? {} : { version: input.target.version }),
        ...(input.target.revision === undefined ? {} : { revision: input.target.revision }),
      }),
      status: input.status,
      actorId: input.actorId,
      reason: input.reason,
      idempotencyKeyHash: input.idempotencyKeyHash,
      inputHash: input.inputHash,
      ...(input.result === undefined ? {} : { result: input.result }),
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      createdAt: input.createdAt,
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    });
  }

  async status(): Promise<TelemetryExportStatus> {
    const response = await globalThis.fetch(
      `${this.#baseUrl}/internal/v1/telemetry-export/status`,
      {
        headers: this.#headers(),
      },
    );
    const input = StatusSchema.parse(await responseJson(response));
    return Object.freeze({
      exportId: input.exportId,
      status: input.status,
      ...(input.activeRevision === undefined ? {} : { activeRevision: input.activeRevision }),
      ...(input.lastAcknowledgedSequence === undefined
        ? {}
        : { lastAcknowledgedSequence: input.lastAcknowledgedSequence }),
      pendingRecords: input.pendingRecords,
      ...(input.oldestPendingAt === undefined ? {} : { oldestPendingAt: input.oldestPendingAt }),
      ...(input.lastAcknowledgedAt === undefined
        ? {}
        : { lastAcknowledgedAt: input.lastAcknowledgedAt }),
      ...(input.lastErrorCode === undefined ? {} : { lastErrorCode: input.lastErrorCode }),
      ...(input.lastErrorAt === undefined ? {} : { lastErrorAt: input.lastErrorAt }),
      observedAt: input.observedAt,
    });
  }

  #headers(extra: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
    return Object.freeze({ authorization: `Bearer ${this.#serviceToken}`, ...extra });
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code =
      typeof value === 'object' &&
      value !== null &&
      'code' in value &&
      typeof value.code === 'string'
        ? value.code
        : `RUNTIME_TELEMETRY_HTTP_${String(response.status)}`;
    throw Object.assign(new Error('Runtime Telemetry Export request failed.'), {
      code,
      status: response.status,
    });
  }
  return value;
}
