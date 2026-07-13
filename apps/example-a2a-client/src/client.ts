import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { SendMessageRequest, TaskState } from '@a2a-js/sdk';
import { ClientFactory } from '@a2a-js/sdk/client';

export interface ExampleA2AClientOptions {
  readonly baseUrl: string;
  readonly text: string;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export interface ExampleA2AClientResult {
  readonly taskId: string;
  readonly contextId: string;
  readonly states: readonly TaskState[];
  readonly finalState: TaskState;
}

export async function runExampleA2AClient(
  options: ExampleA2AClientOptions,
): Promise<ExampleA2AClientResult> {
  const client = await new ClientFactory().createFromUrl(options.baseUrl);
  const states: TaskState[] = [];
  let taskId = '';
  let contextId = '';
  for await (const event of client.sendMessageStream(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `example-${randomUUID()}`,
        role: 'ROLE_USER',
        parts: [{ text: options.text, mediaType: 'text/plain' }],
        metadata: { user_id: 'local-example' },
      },
      configuration: { returnImmediately: false },
    }),
  )) {
    if (event.payload?.$case === 'task') {
      taskId = event.payload.value.id;
      contextId = event.payload.value.contextId;
      if (event.payload.value.status?.state !== undefined) {
        states.push(event.payload.value.status.state);
      }
    }
    if (
      event.payload?.$case === 'statusUpdate' &&
      event.payload.value.status?.state !== undefined
    ) {
      states.push(event.payload.value.status.state);
    }
  }
  if (taskId === '' || contextId === '') throw new Error('EXAMPLE_A2A_TASK_IDENTITY_MISSING');

  let task = await client.getTask({ tenant: '', id: taskId });
  if (task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED) {
    const confirmation = await client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `example-confirm-${randomUUID()}`,
          taskId,
          contextId,
          role: 'ROLE_USER',
          parts: [{ text: 'Confirm the generated plan.', mediaType: 'text/plain' }],
          metadata: { user_id: 'local-example', sdar_action: 'confirm_plan' },
        },
        configuration: { returnImmediately: true },
      }),
    );
    if ('id' in confirmation && confirmation.status?.state !== undefined) {
      states.push(confirmation.status.state);
    }
  }

  const terminal = new Set([
    TaskState.TASK_STATE_COMPLETED,
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_CANCELED,
    TaskState.TASK_STATE_REJECTED,
  ]);
  for (let attempt = 0; attempt < (options.maxPolls ?? 100); attempt += 1) {
    task = await client.getTask({ tenant: '', id: taskId });
    const state = task.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED;
    states.push(state);
    if (terminal.has(state)) {
      return { taskId, contextId, states, finalState: state };
    }
    await setTimeout(options.pollIntervalMs ?? 50);
  }
  throw new Error(`EXAMPLE_A2A_TASK_NOT_TERMINAL:${taskId}`);
}
