import { z } from 'zod';

import type { ManagementOperation } from '../../node-control-domain/src/index.js';
import type {
  NodeControlRuntimeTaskControlClient,
  NodeControlTaskAction,
  RuntimeTaskControlCommand,
} from '../../node-control-application/src/index.js';

const ManagementOperationSchema = z
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

const actionPath: Readonly<Record<NodeControlTaskAction, string>> = Object.freeze({
  pause: 'pause',
  resume: 'resume',
  cancel: 'cancel',
  goal_patch: 'goal-patches',
});

export class HttpRuntimeTaskControlClient implements NodeControlRuntimeTaskControlClient {
  readonly #baseUrl: string;
  readonly #serviceToken: string;

  constructor(configuration: Readonly<{ baseUrl: string; serviceToken: string }>) {
    this.#baseUrl = configuration.baseUrl.replace(/\/+$/u, '');
    this.#serviceToken = configuration.serviceToken;
  }

  async execute(
    action: NodeControlTaskAction,
    taskId: string,
    command: RuntimeTaskControlCommand,
  ): Promise<ManagementOperation> {
    const response = await globalThis.fetch(
      `${this.#baseUrl}/internal/v1/tasks/${encodeURIComponent(taskId)}/${actionPath[action]}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#serviceToken}`,
          'content-type': 'application/json',
          'idempotency-key': command.idempotencyKey,
          'x-correlation-id': command.correlationId,
        },
        body: JSON.stringify({
          reason: command.reason,
          ...(command.payload === undefined ? {} : { payload: command.payload }),
          ...(command.expectedRevision === undefined
            ? {}
            : { expectedRevision: command.expectedRevision }),
        }),
        redirect: 'manual',
      },
    );
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok)
      throw new RuntimeTaskControlHttpError(
        runtimeErrorCode(body) ?? `RUNTIME_TASK_CONTROL_HTTP_${String(response.status)}`,
        response.status,
      );
    return projectManagementOperation(ManagementOperationSchema.parse(body));
  }
}

function projectManagementOperation(
  input: z.infer<typeof ManagementOperationSchema>,
): ManagementOperation {
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

function runtimeErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  if ('code' in body && typeof body.code === 'string') return body.code;
  return undefined;
}

export class RuntimeTaskControlHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`Runtime Task control request failed with ${code}.`);
    this.name = 'RuntimeTaskControlHttpError';
    this.code = code;
    this.status = status;
  }
}
