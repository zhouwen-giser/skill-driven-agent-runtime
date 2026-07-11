import { TaskState } from '@a2a-js/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createProbeRequest,
  startA2aHttpSpike,
  streamPayloadCase,
  type A2aHttpSpikeHandle,
} from '../src/http-endpoint-spike.js';

describe('A2A 1.0 HTTP endpoint compatibility', () => {
  let handle: A2aHttpSpikeHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('discovers the Agent Card and completes a task through the official REST client', async () => {
    handle = await startA2aHttpSpike();
    const result = await handle.client.sendMessage(createProbeRequest());

    expect(result).toHaveProperty('id');
    if (!('id' in result)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(result.contextId).not.toBe('');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const queried = await handle.client.getTask({ tenant: '', id: result.id });
    expect(queried.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  });

  it('streams the standard task lifecycle without custom states', async () => {
    handle = await startA2aHttpSpike();
    const cases: string[] = [];
    const states: TaskState[] = [];

    for await (const event of handle.client.sendMessageStream(createProbeRequest())) {
      const payloadCase = streamPayloadCase(event);
      if (payloadCase !== undefined) cases.push(payloadCase);
      if (event.payload?.$case === 'statusUpdate' && event.payload.value.status !== undefined) {
        states.push(event.payload.value.status.state);
      }
    }

    expect(cases).toEqual(['task', 'statusUpdate', 'statusUpdate']);
    expect(states).toEqual([TaskState.TASK_STATE_WORKING, TaskState.TASK_STATE_COMPLETED]);
  });

  it('continues task execution after the streaming client disconnects', async () => {
    handle = await startA2aHttpSpike({ completionDelayMs: 80 });
    const stream = handle.client.sendMessageStream(createProbeRequest());
    const initial = await stream.next();
    expect(initial.done).toBe(false);
    expect(initial.value === undefined ? undefined : streamPayloadCase(initial.value)).toBe('task');
    if (initial.value?.payload?.$case !== 'task') throw new Error('A2A_EXPECTED_INITIAL_TASK');
    const taskId = initial.value.payload.value.id;

    await stream.return(undefined);
    const deadline = Date.now() + 2_000;
    let state: TaskState | undefined;
    do {
      const task = await handle.client.getTask({ tenant: '', id: taskId });
      state = task.status?.state;
      if (state === TaskState.TASK_STATE_COMPLETED) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    } while (Date.now() < deadline);

    expect(state).toBe(TaskState.TASK_STATE_COMPLETED);
  });
});
