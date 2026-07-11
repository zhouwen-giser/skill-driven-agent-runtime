import { randomBytes, randomUUID } from 'node:crypto';
import { get } from 'node:http';
import { SendMessageRequest, TaskState } from '@a2a-js/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startServerRuntime, type ServerRuntimeHandle } from '../../../apps/server/src/runtime.js';
import type { RegisterSkillVersionInput } from '../../application/src/index.js';
import { startMcpLoopbackServer } from '../../mcp-adapter/src/index.js';

const postgresUrl =
  process.env['SDAR_TEST_POSTGRES_URL'] ?? 'postgresql://sdar:sdar_local_only@127.0.0.1:54329/sdar';
const redis = { host: '127.0.0.1', port: 56379 };
const queueName = `a2a-lifecycle-${randomUUID()}`;
let runtime: ServerRuntimeHandle;

beforeAll(async () => {
  runtime = await startServerRuntime({
    postgresUrl,
    redis,
    mcpMasterKeyBase64: randomBytes(32).toString('base64'),
    queueName,
    applyMigrations: true,
  });
});

afterAll(async () => {
  await runtime.close();
});

describe('A2A TaskService endpoint with real PostgreSQL and Redis', () => {
  it('registers, persists, discovers, and calls a remote MCP Tool without restart', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.devices.${randomUUID()}`;
    try {
      const registration = await runtime.registerMcpServer({
        serverId,
        name: 'Device MCP',
        endpoint: mockMcp.endpoint.toString(),
        credentialHeaders: { Authorization: 'Bearer local-test-only' },
      });
      expect(registration.tools.map((tool) => tool.toolName)).toEqual([
        'device_status',
        'slow_probe',
      ]);
      await expect(
        runtime.callMcpTool(serverId, 'device_status', { deviceId: 'device-42' }, undefined, {
          taskId: 'task-audit-1',
          contextId: 'context-audit-1',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          structuredContent: { deviceId: 'device-42', status: 'online' },
        }),
      );
      await expect(runtime.callMcpTool(serverId, 'device_status', {})).rejects.toMatchObject({
        code: 'MCP_ARGUMENT_SCHEMA_MISMATCH',
      });
      await expect(runtime.listMcpInvocations(serverId)).resolves.toEqual([
        expect.objectContaining({
          taskId: 'task-audit-1',
          contextId: 'context-audit-1',
          status: 'succeeded',
          arguments: { deviceId: 'device-42' },
        }),
      ]);
      await runtime.deleteMcpServer(serverId);
    } finally {
      await mockMcp.close();
    }
  });

  it('refreshes the public Agent Card when enabled skills change', async () => {
    const skillId = `skill.updated.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Updated skill'));

    const refreshed = await readAgentCard();
    expect(refreshed.skills).toContainEqual(
      expect.objectContaining({ id: skillId, name: 'Updated skill' }),
    );
    await runtime.setSkillEnabled(skillId, false);
    expect((await readAgentCard()).skills.map((skill) => skill.id)).not.toContain(skillId);
  });

  it('submits, streams, persists, lists, and cancels at the plan-confirmation boundary', async () => {
    const request = SendMessageRequest.fromJSON({
      message: {
        messageId: `message-${randomUUID()}`,
        role: 'ROLE_USER',
        parts: [{ text: 'Prepare a device inspection plan.', mediaType: 'text/plain' }],
        metadata: { user_id: 'operator-1' },
      },
      configuration: { returnImmediately: false },
    });
    const states: TaskState[] = [];
    const statusMessages: string[] = [];
    let taskId = '';
    let contextId = '';
    for await (const event of runtime.a2a.client.sendMessageStream(request)) {
      if (event.payload?.$case === 'task') {
        taskId = event.payload.value.id;
        contextId = event.payload.value.contextId;
      }
      if (event.payload?.$case === 'statusUpdate') {
        const state = event.payload.value.status?.state;
        if (state !== undefined) states.push(state);
        const part = event.payload.value.status?.message?.parts[0];
        if (part?.content?.$case === 'text') statusMessages.push(part.content.value);
      }
    }

    expect(states).toContain(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(statusMessages).toContain('Plan confirmation required.');
    const stored = await runtime.a2a.client.getTask({ tenant: '', id: taskId });
    expect(stored.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(stored.history[0]?.parts[0]?.content?.$case).toBe('text');

    const listed = await runtime.a2a.client.listTasks({
      tenant: '',
      contextId,
      status: TaskState.TASK_STATE_INPUT_REQUIRED,
      pageToken: '',
      statusTimestampAfter: undefined,
      includeArtifacts: true,
    });
    expect(listed.tasks.map((task) => task.id)).toContain(taskId);

    const revised = await sendFollowUp(taskId, contextId, 'revise_plan', 'Add a safety check.');
    expectTaskState(revised, TaskState.TASK_STATE_INPUT_REQUIRED);
    const confirmed = await sendFollowUp(taskId, contextId, 'confirm_plan', 'Confirm the plan.');
    expectTaskState(confirmed, TaskState.TASK_STATE_WORKING);
    const paused = await sendFollowUp(taskId, contextId, 'pause', 'Pause execution.');
    expectTaskState(paused, TaskState.TASK_STATE_INPUT_REQUIRED);
    const resumed = await sendFollowUp(taskId, contextId, 'resume', 'Resume execution.');
    expectTaskState(resumed, TaskState.TASK_STATE_WORKING);
    await runtime.requestInput(taskId, 'Provide the target device identifier.');
    const supplemented = await sendFollowUp(
      taskId,
      contextId,
      'provide_input',
      'The target device is device-17.',
    );
    expectTaskState(supplemented, TaskState.TASK_STATE_WORKING);

    const canceled = await runtime.a2a.client.cancelTask({
      tenant: '',
      id: taskId,
      metadata: {},
    });
    expect(canceled.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
    await expect(runtime.a2a.client.getTask({ tenant: '', id: taskId })).resolves.toMatchObject({
      id: taskId,
      status: { state: TaskState.TASK_STATE_CANCELED },
    });
  });

  it('stores create/update Skill requests as drafts without exposing them in Agent Card', async () => {
    const skillId = `skill.enabled.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Enabled skill'));
    const result = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Create a read-only device Skill.', mediaType: 'text/plain' }],
          metadata: { sdar_action: 'create_skill_draft' },
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in result)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const drafts = await runtime.listSkillDrafts(result.contextId);

    expect(drafts).toEqual([
      expect.objectContaining({
        draftId: `draft-${result.id}`,
        status: 'draft',
        intent: 'create',
      }),
    ]);
    expect((await readAgentCard()).skills.map((skill) => skill.id)).toContain(skillId);
  });

  it('returns schema-validated natural-language and structured final output', async () => {
    const skillId = `skill.result.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Result skill'));
    const submitted = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Inspect device status.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    await sendFollowUp(submitted.id, submitted.contextId, 'confirm_plan', 'Confirm.');
    await runtime.recordResultForSkill(submitted.id, skillId, {
      text: 'Device is online.',
      structured: { status: 'online' },
    });

    const completed = await runtime.a2a.client.getTask({ tenant: '', id: submitted.id });
    expect(completed.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(completed.artifacts[0]?.parts.map((part) => part.content?.$case)).toEqual([
      'text',
      'data',
    ]);
    expect(completed.artifacts[0]?.parts[0]?.content).toMatchObject({
      $case: 'text',
      value: 'Device is online.',
    });
    expect(completed.artifacts[0]?.parts[1]?.content).toMatchObject({
      $case: 'data',
      value: { status: 'online' },
    });
  });

  it('continues after stream disconnect and supports polling plus standard resubscribe', async () => {
    const stream = runtime.a2a.client.sendMessageStream(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Prepare a disconnect-safe plan.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    const first = await stream.next();
    if (first.value?.payload?.$case !== 'task') throw new Error('A2A_EXPECTED_INITIAL_TASK');
    const taskId = first.value.payload.value.id;
    await stream.return(undefined);

    const deadline = Date.now() + 5_000;
    let polledState: TaskState | undefined;
    do {
      polledState = (await runtime.a2a.client.getTask({ tenant: '', id: taskId })).status?.state;
      if (polledState === TaskState.TASK_STATE_INPUT_REQUIRED) break;
      await new Promise<void>((resolvePromise) => {
        setTimeout(resolvePromise, 20);
      });
    } while (Date.now() < deadline);
    expect(polledState).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);

    const resumed = runtime.a2a.client.resubscribeTask({ tenant: '', id: taskId });
    const snapshot = await resumed.next();
    expect(snapshot.value?.payload?.$case).toBe('task');
    await resumed.return(undefined);
  });
});

function skillInput(skillId: string, name: string): RegisterSkillVersionInput {
  return {
    skillId,
    name,
    summary: `${name} published capability.`,
    description: `${name} complete description.`,
    capabilities: ['inspection'],
    workflowGuidance: 'Use the registered tool policy.',
    outputInstruction: 'Return device status.',
    inputSchema: { type: 'object' },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['online', 'offline'] } },
    },
    toolPolicy: { required: [], optional: [], forbidden: [] },
    runtimePolicy: { autoConfirmPlan: false },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
  };
}

async function sendFollowUp(taskId: string, contextId: string, action: string, text: string) {
  return runtime.a2a.client.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: `message-${randomUUID()}`,
        taskId,
        contextId,
        role: 'ROLE_USER',
        parts: [{ text, mediaType: 'text/plain' }],
        metadata: { sdar_action: action },
      },
      configuration: { returnImmediately: false },
    }),
  );
}

function expectTaskState(
  result: Awaited<ReturnType<typeof sendFollowUp>>,
  expected: TaskState,
): void {
  expect(result).toHaveProperty('id');
  if (!('id' in result)) throw new Error('A2A_EXPECTED_TASK_RESULT');
  expect(result.status?.state).toBe(expected);
}

async function readAgentCard(): Promise<
  Readonly<{ skills: readonly Readonly<{ id: string; name: string }>[] }>
> {
  const body = await new Promise<string>((resolvePromise, reject) => {
    const request = get(`${runtime.a2a.baseUrl}/.well-known/agent-card.json`, (response) => {
      response.setEncoding('utf8');
      let data = '';
      response.on('data', (chunk: string) => {
        data += chunk;
      });
      response.on('end', () => {
        resolvePromise(data);
      });
    });
    request.once('error', reject);
  });
  const parsed: unknown = JSON.parse(body);
  return z
    .object({ skills: z.array(z.object({ id: z.string(), name: z.string() })) })
    .parse(parsed);
}
