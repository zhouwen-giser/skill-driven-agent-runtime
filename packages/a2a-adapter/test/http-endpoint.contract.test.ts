import { SendMessageRequest, TaskState } from '@a2a-js/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createProbeRequest,
  startA2aHttpSpike,
  streamPayloadCase,
  type A2aHttpSpikeHandle,
} from '../src/http-endpoint-spike.js';
import { buildAgentCard } from '../src/compatibility.js';

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

  it('projects only the frozen safe P12 Artifact extension without changing formal Task states', async () => {
    handle = await startA2aHttpSpike({
      artifactProjectionProvider: {
        projectPublic: () =>
          Promise.resolve({
            publicCapabilitySummary: ['validated-planning-templates'],
            inputRequired: true,
            confirmation: true,
            formalTaskState: 'unchanged',
            safeEvidence: { artifactEnhancement: true },
            redactionPolicyVersion: 'artifact-exposure/1.1',
          }),
      },
    });
    const response = await fetch(`${handle.baseUrl}/.well-known/agent-card.json`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('urn:sdar:artifact-evidence:v1.1');
    expect(text).toContain('validated-planning-templates');
    expect(text).not.toMatch(/credential|model_route|candidate/iu);

    const result = await handle.client.sendMessage(createProbeRequest());
    expect(result).toHaveProperty('status.state', TaskState.TASK_STATE_COMPLETED);
  });

  it('uses a Runtime-active Capability Agent Card instead of directly exposing internal Skills', async () => {
    handle = await startA2aHttpSpike({
      agentCardProvider: {
        findActive: () =>
          Promise.resolve(
            buildAgentCard([
              {
                id: 'capability.device.inspect',
                name: 'Inspect a device',
                description: 'Capability-governed inspection.',
                tags: ['capability:device.inspect'],
              },
            ]),
          ),
      },
    });
    const response = await fetch(`${handle.baseUrl}/.well-known/agent-card.json`);
    const card = (await response.json()) as { skills?: readonly { id?: string }[] };

    expect(response.status).toBe(200);
    expect(card.skills).toEqual([expect.objectContaining({ id: 'capability.device.inspect' })]);
    expect(card.skills?.map((skill) => skill.id)).not.toContain('skill.echo');
  });

  it('preserves the A2A 1.0.1 media type when the client requests it', async () => {
    handle = await startA2aHttpSpike();
    const response = await fetch(`${handle.baseUrl}/a2a/v1/message:send`, {
      method: 'POST',
      headers: {
        'A2A-Version': '1.0',
        'content-type': 'application/a2a+json',
      },
      body: JSON.stringify(SendMessageRequest.toJSON(createProbeRequest())),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/a2a\+json\b/u);
    await expect(response.json()).resolves.toHaveProperty('task.id');
  });

  it('retains application/json compatibility for the pinned HTTP+JSON TCK', async () => {
    handle = await startA2aHttpSpike();
    const response = await fetch(`${handle.baseUrl}/a2a/v1/message:send`, {
      method: 'POST',
      headers: {
        'A2A-Version': '1.0',
        'content-type': 'application/json',
      },
      body: JSON.stringify(SendMessageRequest.toJSON(createProbeRequest())),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/u);
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
