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
    skillAuthoringModel: {
      generateStructured: () => Promise.resolve(generatedSkillMetadata()),
    },
    skillSelection: {
      embeddings: {
        embed: (text) =>
          Promise.resolve({
            providerId: 'embedding.e2e.v1',
            vector: text.toLowerCase().includes('zebra') ? [1, 0, 0] : [0, 1, 0],
          }),
      },
      decider: {
        decide: (input) => {
          const selected = [...input.candidates].sort(
            (left, right) => right.semanticScore - left.semanticScore,
          )[0];
          if (selected === undefined) throw new Error('NO_SELECTION_CANDIDATE');
          return Promise.resolve({
            selectedSkillId: selected.skillId,
            decisionSummary: 'Selected from semantic relevance and the persisted metric snapshot.',
          });
        },
      },
    },
  });
});

afterAll(async () => {
  await runtime.close();
});

describe('A2A TaskService endpoint with real PostgreSQL and Redis', () => {
  it('registers, persists, discovers, and calls a remote MCP Tool without restart', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.devices.${randomUUID()}`;
    const encodedServerId = encodeURIComponent(serverId);
    try {
      const registrationResponse = await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverId,
          name: 'Device MCP',
          endpoint: mockMcp.endpoint.toString(),
          credentialHeaders: { Authorization: 'Bearer local-test-only' },
        }),
      });
      expect(registrationResponse.status).toBe(201);
      expect(registrationResponse.headers.get('x-sdar-security-warning')).toBe(
        'trusted-intranet-only-no-auth',
      );
      const registration = z
        .object({ tools: z.array(z.object({ toolName: z.string() })) })
        .parse(await registrationResponse.json());
      expect(registration.tools.map((tool) => tool.toolName)).toEqual([
        'device_status',
        'slow_probe',
      ]);
      const enhancementResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/mcp/servers/${encodedServerId}/tools/device_status/enhancement`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            purpose: 'Read device status',
            scenarios: ['inspection'],
            constraints: ['read-only'],
            returnDescription: 'Device state',
            commonErrors: ['offline'],
            tags: ['device'],
          }),
        },
      );
      expect(enhancementResponse.status).toBe(204);
      const toolsResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/mcp/servers/${encodedServerId}/tools`,
      );
      const tools = z
        .object({
          items: z.array(
            z.object({
              toolName: z.string(),
              enhancement: z.object({ purpose: z.string() }).optional(),
            }),
          ),
        })
        .parse(await toolsResponse.json());
      expect(tools.items[0]).toMatchObject({
        toolName: 'device_status',
        enhancement: { purpose: 'Read device status' },
      });
      const healthResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/mcp/servers/${encodedServerId}/health`,
        { method: 'POST' },
      );
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toMatchObject({ status: 'enabled' });
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
      const invocationsResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/mcp/servers/${encodedServerId}/invocations`,
      );
      const invocations = z
        .object({
          items: z.array(
            z.object({
              taskId: z.string().optional(),
              contextId: z.string().optional(),
              status: z.string(),
              arguments: z.record(z.string(), z.unknown()),
            }),
          ),
        })
        .parse(await invocationsResponse.json());
      expect(invocations.items).toEqual([
        expect.objectContaining({
          taskId: 'task-audit-1',
          contextId: 'context-audit-1',
          status: 'succeeded',
          arguments: { deviceId: 'device-42' },
        }),
      ]);
      const credentialResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/mcp/servers/${encodedServerId}/credentials`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            credentialHeaders: { Authorization: 'Bearer local-test-only' },
          }),
        },
      );
      expect(credentialResponse.status).toBe(204);
      const deleteResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/mcp/servers/${encodedServerId}`,
        { method: 'DELETE' },
      );
      expect(deleteResponse.status).toBe(204);
    } finally {
      await mockMcp.close();
    }
  });

  it('refreshes the public Agent Card when enabled skills change', async () => {
    const skillId = `skill.updated.${randomUUID()}`;
    const createResponse = await fetch(`${runtime.management.baseUrl}/api/v1/skills`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(skillInput(skillId, 'Updated skill')),
    });
    expect(createResponse.status).toBe(201);
    const listResponse = await fetch(`${runtime.management.baseUrl}/api/v1/skills`);
    const listedSkills = z
      .object({ items: z.array(z.object({ skillId: z.string(), status: z.string() })) })
      .parse(await listResponse.json());
    expect(listedSkills.items).toContainEqual(
      expect.objectContaining({ skillId, status: 'enabled' }),
    );

    const refreshed = await readAgentCard();
    expect(refreshed.skills).toContainEqual(
      expect.objectContaining({ id: skillId, name: 'Updated skill' }),
    );
    const disableResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/disable`,
      { method: 'POST' },
    );
    expect(disableResponse.status).toBe(200);
    expect((await readAgentCard()).skills.map((skill) => skill.id)).not.toContain(skillId);
    const versionsResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions`,
    );
    const versions = z
      .object({ items: z.array(z.object({ version: z.number(), status: z.string() })) })
      .parse(await versionsResponse.json());
    expect(versions.items).toEqual([
      expect.objectContaining({ version: 1, status: 'enabled' }),
      expect.objectContaining({ version: 2, status: 'disabled' }),
    ]);
    const diffResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/diff?from=1&to=2`,
    );
    await expect(diffResponse.json()).resolves.toMatchObject({
      fromVersion: 1,
      toVersion: 2,
      changedFields: expect.arrayContaining(['status']),
    });
    const rollbackResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/rollback/1`,
      { method: 'POST' },
    );
    expect(rollbackResponse.status).toBe(200);
    await expect(rollbackResponse.json()).resolves.toMatchObject({
      version: 3,
      previousVersion: 2,
      status: 'enabled',
    });
    expect((await readAgentCard()).skills.map((skill) => skill.id)).toContain(skillId);
  });

  it('registers model-authored valid Schemas through the management boundary', async () => {
    const skillId = `skill.authored.${randomUUID()}`;
    const response = await fetch(`${runtime.management.baseUrl}/api/v1/skills/author`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId,
        naturalLanguageDescription:
          'Inspect one device by identifier and return its current status plus a concise observation.',
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
        sourceKind: 'admin',
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      skillId,
      version: 1,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      validationPassed: true,
    });
    expect((await readAgentCard()).skills.map((skill) => skill.id)).toContain(skillId);
  });

  it('uses real pgvector scores as candidate context while the decider makes the final selection', async () => {
    const deviceSkillId = `skill.selection.device.${randomUUID()}`;
    const invoiceSkillId = `skill.selection.invoice.${randomUUID()}`;
    for (const [skillId, name] of [
      [deviceSkillId, 'Zebra diagnostics'],
      [invoiceSkillId, 'Invoice reconciliation'],
    ] as const) {
      const response = await fetch(`${runtime.management.baseUrl}/api/v1/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(skillInput(skillId, name)),
      });
      expect(response.status).toBe(201);
    }
    const response = await fetch(`${runtime.management.baseUrl}/api/v1/skill-selections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goalDescription: 'Run the zebra diagnostic capability.' }),
    });
    expect(response.status).toBe(201);
    const selection = z
      .object({
        selectedSkillId: z.string(),
        selectedSkillVersion: z.number(),
        decisionSummary: z.string(),
        candidates: z.array(
          z.object({
            skillId: z.string(),
            semanticScore: z.number(),
            metrics: z.object({ successRate: z.number(), stabilityScore: z.number() }),
          }),
        ),
      })
      .parse(await response.json());
    expect(selection.selectedSkillId).toBe(deviceSkillId);
    expect(selection.candidates.find((item) => item.skillId === deviceSkillId)?.semanticScore).toBe(
      1,
    );
    expect(selection.decisionSummary).toContain('metric snapshot');
  });

  it('creates, lists, and deletes persisted Skill Graph relations through management HTTP', async () => {
    const sourceSkillId = `skill.graph.source.${randomUUID()}`;
    const targetSkillId = `skill.graph.target.${randomUUID()}`;
    for (const [skillId, name] of [
      [sourceSkillId, 'Graph source'],
      [targetSkillId, 'Graph target'],
    ] as const) {
      const response = await fetch(`${runtime.management.baseUrl}/api/v1/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(skillInput(skillId, name)),
      });
      expect(response.status).toBe(201);
    }
    const createResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/skill-graph/relations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSkillId,
          targetSkillId,
          relationType: 'composition',
          metadata: { sequence: 1 },
        }),
      },
    );
    expect(createResponse.status).toBe(201);
    const created = z.object({ relationId: z.string() }).parse(await createResponse.json());
    const listResponse = await fetch(`${runtime.management.baseUrl}/api/v1/skill-graph`);
    const graph = z
      .object({
        items: z.array(
          z.object({
            relationId: z.string(),
            sourceSkillId: z.string(),
            targetSkillId: z.string(),
            relationType: z.string(),
            metadata: z.record(z.string(), z.unknown()),
          }),
        ),
      })
      .parse(await listResponse.json());
    expect(graph.items).toContainEqual(
      expect.objectContaining({
        relationId: created.relationId,
        sourceSkillId,
        targetSkillId,
        relationType: 'composition',
        metadata: { sequence: 1 },
      }),
    );
    const deleteResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/skill-graph/relations/${encodeURIComponent(created.relationId)}`,
      { method: 'DELETE' },
    );
    expect(deleteResponse.status).toBe(204);
  });

  it('expires task-scoped Temporary Skills and gates repeated success behind simulation', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.temporary.${randomUUID()}`;
    try {
      const registration = await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverId,
          name: 'Temporary Skill MCP',
          endpoint: mockMcp.endpoint.toString(),
          credentialHeaders: {},
        }),
      });
      expect(registration.status).toBe(201);
      const formalSkillsBefore = await readFormalSkillIds();
      const createAndComplete = async (taskId: string) => {
        const createdResponse = await fetch(
          `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/temporary-skills`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contextId: `context-${taskId}`,
              name: 'Inspect device temporarily',
              description: 'Read current device state for this task.',
              tools: [{ serverId, toolName: 'device_status' }],
              inputSchema: { type: 'object', properties: { deviceId: { type: 'string' } } },
              outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
            }),
          },
        );
        expect(createdResponse.status).toBe(201);
        const created = z
          .object({ temporarySkillId: z.string(), status: z.literal('active') })
          .parse(await createdResponse.json());
        const completedResponse = await fetch(
          `${runtime.management.baseUrl}/api/v1/temporary-skills/${encodeURIComponent(created.temporarySkillId)}/complete`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ successful: true, outcomeSummary: 'Device state read.' }),
          },
        );
        expect(completedResponse.status).toBe(200);
        return z
          .object({
            skill: z.object({ status: z.literal('expired') }),
            experience: z.object({ successful: z.literal(true) }),
            formalizationCandidate: z
              .object({
                status: z.literal('awaiting_simulation'),
                successfulExperienceCount: z.number(),
              })
              .optional(),
          })
          .parse(await completedResponse.json());
      };

      const first = await createAndComplete(`task-temp-${randomUUID()}`);
      expect(first.formalizationCandidate).toBeUndefined();
      const second = await createAndComplete(`task-temp-${randomUUID()}`);
      expect(second.formalizationCandidate).toMatchObject({
        status: 'awaiting_simulation',
        successfulExperienceCount: 2,
      });
      expect(await readFormalSkillIds()).toEqual(formalSkillsBefore);
    } finally {
      await mockMcp.close();
    }
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

async function readFormalSkillIds(): Promise<string[]> {
  const response = await fetch(`${runtime.management.baseUrl}/api/v1/skills`);
  return z
    .object({ items: z.array(z.object({ skillId: z.string() })) })
    .parse(await response.json())
    .items.map((item) => item.skillId)
    .sort();
}

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

function generatedSkillMetadata() {
  return {
    name: 'Model-authored device inspection',
    summary: 'Inspect a device.',
    description: 'Inspect one device and report current state.',
    capabilities: ['device-inspection'],
    workflowGuidance: 'Read the device and report the response.',
    outputInstruction: 'Return status and observation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['deviceId'],
      properties: { deviceId: { type: 'string', minLength: 1 } },
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string' }, observation: { type: 'string' } },
    },
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
