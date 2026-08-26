import { z } from 'zod';

import type { FrozenDetailedRemoteTask } from '../../domain/src/index.js';

import type { FrozenV1McpClient } from './frozen-v1-mcp-client.js';
import type {
  FrozenTaskLifecycleClient,
  FrozenToolOutputValidation,
} from './frozen-v1-task-lifecycle.js';

const taskIdSchema = z.string().min(1).max(512);
const ackSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.literal('notifications/subscriptions/acknowledged'),
    params: z
      .object({
        _meta: z
          .object({ 'io.modelcontextprotocol/subscriptionId': z.union([z.string(), z.number()]) })
          .catchall(z.unknown()),
        notifications: z.object({ taskIds: z.array(taskIdSchema).max(256) }).strict(),
      })
      .strict(),
  })
  .strict();
const notificationSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    method: z.literal('notifications/tasks'),
    params: z
      .object({
        taskId: taskIdSchema,
        _meta: z
          .object({ 'io.modelcontextprotocol/subscriptionId': z.union([z.string(), z.number()]) })
          .catchall(z.unknown()),
      })
      .catchall(z.unknown()),
  })
  .strict();

export type FrozenTaskObservationSource = 'create' | 'poll' | 'notification' | 'reconciliation';

export interface FrozenTaskSubscriptionRunResult {
  readonly subscriptionId: number;
  readonly acceptedTaskIds: readonly string[];
  readonly notifications: number;
  readonly reconciled: number;
}

export class FrozenRemoteTaskSubscriptionManager {
  readonly #transport: FrozenV1McpClient;
  readonly #lifecycle: Pick<FrozenTaskLifecycleClient, 'getTaskAdmission' | 'admitNotification'>;
  readonly #endpoint: string;
  readonly #headers: Readonly<Record<string, string>>;

  constructor(
    input: Readonly<{
      transport: FrozenV1McpClient;
      lifecycle: Pick<FrozenTaskLifecycleClient, 'getTaskAdmission' | 'admitNotification'>;
      endpoint: string;
      headers: Readonly<Record<string, string>>;
    }>,
  ) {
    this.#transport = input.transport;
    this.#lifecycle = input.lifecycle;
    this.#endpoint = input.endpoint;
    this.#headers = input.headers;
  }

  async run(
    input: Readonly<{
      taskIds: readonly string[];
      reconnecting: boolean;
      outputValidationByTaskId?: ReadonlyMap<string, FrozenToolOutputValidation>;
      signal?: AbortSignal;
      onObservation(
        task: FrozenDetailedRemoteTask,
        source: FrozenTaskObservationSource,
        subscriptionId: number,
      ): Promise<void>;
    }>,
  ): Promise<FrozenTaskSubscriptionRunResult> {
    const requested = [...new Set(input.taskIds)].sort();
    if (requested.length > 256 || requested.some((value) => !taskIdSchema.safeParse(value).success))
      throw subscriptionError(
        'FROZEN_TASK_SUBSCRIPTION_REQUEST_INVALID',
        'Task subscription requires at most 256 unique bounded Task IDs.',
      );
    const stream = await this.#transport.listenToTaskNotifications({
      endpoint: this.#endpoint,
      headers: this.#headers,
      taskIds: requested,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    let first = true;
    let acceptedTaskIds: readonly string[] = [];
    let notifications = 0;
    let reconciled = 0;
    const notifiedTaskIds = new Set<string>();
    for await (const message of stream.messages) {
      if (first) {
        first = false;
        acceptedTaskIds = parseAck(message, stream.requestId, requested);
        continue;
      }
      const parsed = notificationSchema.safeParse(message);
      if (!parsed.success)
        throw subscriptionError(
          'FROZEN_TASK_NOTIFICATION_INVALID',
          'Task subscription stream contains a non-Task or malformed Notification.',
        );
      const subscriptionId = parsed.data.params._meta['io.modelcontextprotocol/subscriptionId'];
      if (
        subscriptionId !== stream.requestId ||
        !acceptedTaskIds.includes(parsed.data.params.taskId)
      )
        throw subscriptionError(
          'FROZEN_TASK_NOTIFICATION_UNAUTHORIZED',
          'Task Notification is outside the acknowledged subscription.',
        );
      notifiedTaskIds.add(parsed.data.params.taskId);
      const admission = this.#lifecycle.admitNotification(
        parsed.data.params,
        input.outputValidationByTaskId?.get(parsed.data.params.taskId),
      );
      if (admission.accepted) {
        await input.onObservation(admission.task, 'notification', stream.requestId);
        notifications += 1;
      }
    }
    if (first)
      throw subscriptionError(
        'FROZEN_TASK_SUBSCRIPTION_ACK_MISSING',
        'Task subscription stream ended before the required first Ack.',
      );
    if (input.reconnecting)
      for (const taskId of acceptedTaskIds) {
        if (notifiedTaskIds.has(taskId)) continue;
        const admission = await this.#lifecycle.getTaskAdmission(
          taskId,
          input.outputValidationByTaskId?.get(taskId),
        );
        if (admission.accepted)
          await input.onObservation(admission.task, 'reconciliation', stream.requestId);
        reconciled += 1;
      }
    return { subscriptionId: stream.requestId, acceptedTaskIds, notifications, reconciled };
  }
}

function parseAck(
  value: unknown,
  requestId: number,
  requested: readonly string[],
): readonly string[] {
  const parsed = ackSchema.safeParse(value);
  if (!parsed.success)
    throw subscriptionError(
      'FROZEN_TASK_SUBSCRIPTION_ACK_MISSING',
      'The first Task subscription message must be an Ack.',
    );
  if (parsed.data.params._meta['io.modelcontextprotocol/subscriptionId'] !== requestId)
    throw subscriptionError(
      'FROZEN_TASK_SUBSCRIPTION_ACK_INVALID',
      'Task subscription Ack ID does not match the listen request.',
    );
  const accepted = parsed.data.params.notifications.taskIds;
  if (
    new Set(accepted).size !== accepted.length ||
    accepted.some((taskId) => !requested.includes(taskId)) ||
    accepted.some((taskId, index) => index > 0 && taskId < (accepted[index - 1] ?? ''))
  )
    throw subscriptionError(
      'FROZEN_TASK_SUBSCRIPTION_ACK_INVALID',
      'Task subscription Ack must contain a stable unique subset of requested Task IDs.',
    );
  return Object.freeze([...accepted]);
}

export type FrozenTaskSubscriptionErrorCode =
  | 'FROZEN_TASK_SUBSCRIPTION_REQUEST_INVALID'
  | 'FROZEN_TASK_SUBSCRIPTION_ACK_MISSING'
  | 'FROZEN_TASK_SUBSCRIPTION_ACK_INVALID'
  | 'FROZEN_TASK_NOTIFICATION_INVALID'
  | 'FROZEN_TASK_NOTIFICATION_UNAUTHORIZED';

export class FrozenTaskSubscriptionError extends Error {
  readonly code: FrozenTaskSubscriptionErrorCode;
  constructor(code: FrozenTaskSubscriptionErrorCode, message: string) {
    super(message);
    this.name = 'FrozenTaskSubscriptionError';
    this.code = code;
  }
}

function subscriptionError(
  code: FrozenTaskSubscriptionErrorCode,
  message: string,
): FrozenTaskSubscriptionError {
  return new FrozenTaskSubscriptionError(code, message);
}
