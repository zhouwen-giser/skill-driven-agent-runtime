import { SendMessageRequest, TaskState } from '@a2a-js/sdk';

import type { A2AHttpEndpointHandle } from '../src/http-endpoint.js';

export type A2ATestTaskState = 'working' | 'input_required' | 'completed' | 'failed' | 'canceled';

export interface A2ATestTaskSnapshot {
  readonly id: string;
  readonly contextId: string;
  readonly state: A2ATestTaskState;
}

export async function submitA2ATestTask(
  client: A2AHttpEndpointHandle['client'],
  text: string,
): Promise<A2ATestTaskSnapshot> {
  return snapshot(
    await client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `test-message-${crypto.randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text, mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    ),
  );
}

export async function confirmA2ATestPlan(
  client: A2AHttpEndpointHandle['client'],
  task: Readonly<{ id: string; contextId: string }>,
  text: string,
): Promise<A2ATestTaskSnapshot> {
  return snapshot(
    await client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `test-message-${crypto.randomUUID()}`,
          taskId: task.id,
          contextId: task.contextId,
          role: 'ROLE_USER',
          parts: [{ text, mediaType: 'text/plain' }],
          metadata: { sdar_action: 'confirm_plan' },
        },
        configuration: { returnImmediately: false },
      }),
    ),
  );
}

export async function getA2ATestTask(
  client: A2AHttpEndpointHandle['client'],
  id: string,
): Promise<A2ATestTaskSnapshot> {
  return snapshot(await client.getTask({ tenant: '', id }));
}

function snapshot(
  result:
    | Awaited<ReturnType<A2AHttpEndpointHandle['client']['getTask']>>
    | Awaited<ReturnType<A2AHttpEndpointHandle['client']['sendMessage']>>,
): A2ATestTaskSnapshot {
  if (!('id' in result)) throw new Error('A2A_TEST_EXPECTED_TASK');
  if (result.status === undefined) throw new Error('A2A_TEST_TASK_STATUS_MISSING');
  return { id: result.id, contextId: result.contextId, state: mapState(result.status.state) };
}

function mapState(state: TaskState): A2ATestTaskState {
  switch (state) {
    case TaskState.TASK_STATE_WORKING:
      return 'working';
    case TaskState.TASK_STATE_INPUT_REQUIRED:
      return 'input_required';
    case TaskState.TASK_STATE_COMPLETED:
      return 'completed';
    case TaskState.TASK_STATE_FAILED:
      return 'failed';
    case TaskState.TASK_STATE_CANCELED:
      return 'canceled';
    default:
      throw new Error(`A2A_TEST_TASK_STATE_UNEXPECTED:${String(state)}`);
  }
}
