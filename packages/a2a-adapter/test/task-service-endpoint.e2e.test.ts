import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, get, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
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
let modelServer: Server;
let initialPromptVersion = 0;
const failingProviderId = `provider.fail.${randomUUID()}`;
let workflowPlanningCalls = 0;
let controlEvaluationCalls = 0;
let mcpWorkflowTarget:
  | Readonly<{ serverId: string; workflowId: string; workflowVersion: number; goalId: string }>
  | undefined;
let taskWorkflowTarget:
  Readonly<{ workflowId: string; goalId: string; goalVersion: number }> | undefined;

beforeAll(async () => {
  modelServer = await startModelLoopback();
  const address = modelServer.address();
  if (address === null || typeof address === 'string') throw new Error('MODEL_ADDRESS_UNAVAILABLE');
  runtime = await startServerRuntime({
    postgresUrl,
    redis,
    mcpMasterKeyBase64: randomBytes(32).toString('base64'),
    queueName,
    applyMigrations: true,
    skillSelection: {
      embeddings: {
        embed: (text) =>
          Promise.resolve({
            providerId: 'embedding.e2e.v1',
            vector: text.toLowerCase().includes('zebra') ? [1, 0, 0] : [0, 1, 0],
          }),
      },
    },
  });
  const providerResponse = await fetch(
    `${runtime.management.baseUrl}/api/v1/models/providers/provider.e2e`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E model',
        kind: 'openai_compatible',
        apiStyle: 'openai_chat_completions',
        baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
        model: 'model-e2e',
        enabled: true,
        timeoutMs: 2000,
        credentialHeaders: { Authorization: 'Bearer e2e-only' },
      }),
    },
  );
  if (providerResponse.status !== 204) throw new Error('MODEL_PROVIDER_SETUP_FAILED');
  const routeResponse = await fetch(
    `${runtime.management.baseUrl}/api/v1/models/routes/skill_authoring`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider.e2e' }),
    },
  );
  if (routeResponse.status !== 204) throw new Error('MODEL_ROUTE_SETUP_FAILED');
  const promptResponse = await fetch(`${runtime.management.baseUrl}/api/v1/prompts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      promptId: 'prompt.skill-authoring.e2e',
      stage: 'skill_authoring',
      content: 'Author a validated Skill. {{instruction}}',
      source: 'admin',
      publish: true,
    }),
  });
  if (promptResponse.status !== 201) throw new Error('MODEL_PROMPT_SETUP_FAILED');
  initialPromptVersion = z
    .object({ version: z.number().int().positive() })
    .parse(await promptResponse.json()).version;
  const workflowRoute = await fetch(
    `${runtime.management.baseUrl}/api/v1/models/routes/workflow_planning`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider.e2e' }),
    },
  );
  if (workflowRoute.status !== 204) throw new Error('WORKFLOW_MODEL_ROUTE_SETUP_FAILED');
  const workflowPrompt = await fetch(`${runtime.management.baseUrl}/api/v1/prompts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      promptId: 'prompt.workflow-planning.e2e',
      stage: 'workflow_planning',
      content: 'Workflow planning policy. {{instruction}}',
      source: 'admin',
      publish: true,
    }),
  });
  if (workflowPrompt.status !== 201) throw new Error('WORKFLOW_PROMPT_SETUP_FAILED');
  const evaluationRoute = await fetch(
    `${runtime.management.baseUrl}/api/v1/models/routes/goal_evaluation`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider.e2e' }),
    },
  );
  if (evaluationRoute.status !== 204) throw new Error('GOAL_EVALUATION_ROUTE_SETUP_FAILED');
  const evaluationPrompt = await fetch(`${runtime.management.baseUrl}/api/v1/prompts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      promptId: 'prompt.goal-evaluation.e2e',
      stage: 'goal_evaluation',
      content: 'Goal evaluation policy. {{instruction}}',
      source: 'admin',
      publish: true,
    }),
  });
  if (evaluationPrompt.status !== 201) throw new Error('GOAL_EVALUATION_PROMPT_SETUP_FAILED');
  for (const stage of ['intent', 'goal', 'skill_selection', 'execution_decision'] as const) {
    const route = await fetch(`${runtime.management.baseUrl}/api/v1/models/routes/${stage}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider.e2e' }),
    });
    if (route.status !== 204) throw new Error(`TASK_DECISION_ROUTE_SETUP_FAILED:${stage}`);
    const prompt = await fetch(`${runtime.management.baseUrl}/api/v1/prompts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        promptId: `prompt.${stage}.e2e`,
        stage,
        content: `Structured ${stage} decision. {{instruction}}`,
        source: 'admin',
        publish: true,
      }),
    });
    if (prompt.status !== 201) throw new Error(`TASK_DECISION_PROMPT_SETUP_FAILED:${stage}`);
  }
});

afterAll(async () => {
  await runtime.close();
  modelServer.close();
  await once(modelServer, 'close');
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
    const auditResponse = await fetch(
      `${runtime.management.baseUrl}/api/v1/models/invocations?stage=skill_authoring`,
    );
    const audits = z
      .object({
        items: z.array(
          z.object({
            providerId: z.string(),
            model: z.string(),
            status: z.string(),
            promptId: z.string().optional(),
            promptVersion: z.number().optional(),
            rawResponse: z.unknown().optional(),
            inputTokens: z.number().optional(),
            outputTokens: z.number().optional(),
          }),
        ),
      })
      .parse(await auditResponse.json());
    expect(audits.items).toContainEqual(
      expect.objectContaining({
        providerId: 'provider.e2e',
        model: 'model-e2e',
        status: 'succeeded',
        promptId: 'prompt.skill-authoring.e2e',
        promptVersion: initialPromptVersion,
        inputTokens: 9,
        outputTokens: 4,
      }),
    );
    expect(JSON.stringify(audits)).not.toContain('e2e-only');
  });

  it('routes an other-vendor Provider through the non-OpenAI Messages adapter', async () => {
    const address = modelServer.address();
    if (address === null || typeof address === 'string')
      throw new Error('MODEL_ADDRESS_UNAVAILABLE');
    const providerId = `provider.vendor.${randomUUID()}`;
    expect(
      await fetch(`${runtime.management.baseUrl}/api/v1/models/providers/${providerId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Messages vendor',
          kind: 'other_vendor',
          apiStyle: 'anthropic_messages',
          baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
          model: 'vendor-model-e2e',
          enabled: true,
          timeoutMs: 2000,
          credentialHeaders: { 'x-api-key': 'vendor-e2e-only' },
        }),
      }),
    ).toMatchObject({ status: 204 });
    expect(
      await fetch(`${runtime.management.baseUrl}/api/v1/models/routes/skill_authoring`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerId }),
      }),
    ).toMatchObject({ status: 204 });
    try {
      const authored = await fetch(`${runtime.management.baseUrl}/api/v1/skills/author`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillId: `skill.vendor.${randomUUID()}`,
          naturalLanguageDescription: 'Create a detailed read-only device inspection Skill.',
          toolPolicy: { required: [], optional: [], forbidden: [] },
          runtimePolicy: { autoConfirmPlan: false },
          status: 'enabled',
          sourceKind: 'admin',
        }),
      });
      expect(authored.status).toBe(201);
      const audits = z
        .object({
          items: z.array(
            z.object({
              providerId: z.string(),
              status: z.string(),
              inputTokens: z.number().optional(),
              outputTokens: z.number().optional(),
            }),
          ),
        })
        .parse(
          await (
            await fetch(
              `${runtime.management.baseUrl}/api/v1/models/invocations?stage=skill_authoring`,
            )
          ).json(),
        );
      expect(audits.items).toContainEqual(
        expect.objectContaining({
          providerId,
          status: 'succeeded',
          inputTokens: 7,
          outputTokens: 3,
        }),
      );
    } finally {
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/models/routes/skill_authoring`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerId: 'provider.e2e' }),
        }),
      ).toMatchObject({ status: 204 });
    }
  });

  it('keeps automatic Prompt candidates inactive until publish and links new calls to the published version', async () => {
    const candidateResponse = await fetch(`${runtime.management.baseUrl}/api/v1/prompts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        promptId: 'prompt.skill-authoring.e2e',
        stage: 'skill_authoring',
        content: 'Candidate policy. {{instruction}}',
        source: 'auto_candidate',
        publish: false,
      }),
    });
    expect(candidateResponse.status).toBe(201);
    const candidate = z
      .object({ version: z.number().int().positive(), status: z.literal('candidate') })
      .parse(await candidateResponse.json());
    expect(candidate.version).toBe(initialPromptVersion + 1);
    const author = (label: string) =>
      fetch(`${runtime.management.baseUrl}/api/v1/skills/author`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillId: `skill.prompt.${label}.${randomUUID()}`,
          naturalLanguageDescription:
            'Create a detailed device inspection Skill with explicit input and output fields.',
          toolPolicy: { required: [], optional: [], forbidden: [] },
          runtimePolicy: { autoConfirmPlan: false },
          status: 'enabled',
          sourceKind: 'admin',
        }),
      });
    expect((await author('before')).status).toBe(201);
    const readVersions = async () =>
      z
        .object({ items: z.array(z.object({ promptVersion: z.number().optional() })) })
        .parse(
          await (
            await fetch(
              `${runtime.management.baseUrl}/api/v1/models/invocations?stage=skill_authoring`,
            )
          ).json(),
        ).items;
    expect((await readVersions()).at(-1)?.promptVersion).toBe(initialPromptVersion);
    const publish = await fetch(
      `${runtime.management.baseUrl}/api/v1/prompts/prompt.skill-authoring.e2e/publish/${String(candidate.version)}`,
      { method: 'POST' },
    );
    expect(publish.status).toBe(200);
    await expect(publish.json()).resolves.toMatchObject({
      version: initialPromptVersion + 2,
      previousVersion: initialPromptVersion + 1,
      status: 'enabled',
    });
    expect((await author('after')).status).toBe(201);
    expect((await readVersions()).at(-1)?.promptVersion).toBe(initialPromptVersion + 2);
    const effects = await fetch(
      `${runtime.management.baseUrl}/api/v1/prompts/prompt.skill-authoring.e2e/effects/${String(initialPromptVersion + 2)}`,
    );
    await expect(effects.json()).resolves.toMatchObject({ invocationCount: 1, successCount: 1 });
  });

  it('fails the stage without fallback and audits the configured upstream failure', async () => {
    const baseUrl = runtime.management.baseUrl;
    const modelAddress = modelServer.address();
    if (modelAddress === null || typeof modelAddress === 'string')
      throw new Error('MODEL_ADDRESS_UNAVAILABLE');
    const configure = await fetch(
      `${baseUrl}/api/v1/models/providers/${encodeURIComponent(failingProviderId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Failing model',
          kind: 'openai_compatible',
          apiStyle: 'openai_chat_completions',
          baseUrl: `http://127.0.0.1:${String(modelAddress.port)}/v1`,
          model: 'fail-model',
          enabled: true,
          timeoutMs: 2000,
          credentialHeaders: {},
        }),
      },
    );
    expect(configure.status).toBe(204);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/models/routes/skill_authoring`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerId: failingProviderId }),
        })
      ).status,
    ).toBe(204);
    const response = await fetch(`${baseUrl}/api/v1/skills/author`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId: `skill.failed.${randomUUID()}`,
        naturalLanguageDescription:
          'Create a detailed device inspection Skill with explicit input and output fields.',
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
        sourceKind: 'admin',
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'MODEL_INVOCATION_FAILED' },
    });
    const audits = z
      .object({
        items: z.array(
          z.object({
            providerId: z.string(),
            status: z.string(),
            errorCode: z.string().optional(),
          }),
        ),
      })
      .parse(
        await (await fetch(`${baseUrl}/api/v1/models/invocations?stage=skill_authoring`)).json(),
      );
    expect(audits.items.filter((item) => item.providerId === failingProviderId)).toEqual([
      expect.objectContaining({ status: 'failed', errorCode: 'MODEL_UPSTREAM_ERROR' }),
    ]);
    expect(
      (
        await fetch(`${baseUrl}/api/v1/models/routes/skill_authoring`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providerId: 'provider.e2e' }),
        })
      ).status,
    ).toBe(204);
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

  it('validates Workflow DSL against current PostgreSQL Skill and MCP Tool definitions', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.workflow.${randomUUID()}`;
    const skillId = `skill.workflow.${randomUUID()}`;
    try {
      expect(
        (
          await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              serverId,
              name: 'Workflow MCP',
              endpoint: mockMcp.endpoint.toString(),
              credentialHeaders: {},
            }),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await fetch(`${runtime.management.baseUrl}/api/v1/skills`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(skillInput(skillId, 'Workflow child')),
          })
        ).status,
      ).toBe(201);
      const response = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/validate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflowDefinitionId: `workflow.${randomUUID()}`,
          version: 1,
          goalId: 'goal.workflow',
          goalVersion: 1,
          entryNodeId: 'tool',
          exitNodeIds: ['result'],
          nodes: [
            {
              nodeId: 'tool',
              name: 'Read',
              type: 'mcp_tool',
              tool: { serverId, toolName: 'device_status' },
              arguments: { deviceId: 'device-1' },
            },
            { nodeId: 'skill', name: 'Child', type: 'skill_call', skillId, input: {} },
            {
              nodeId: 'result',
              name: 'Result',
              type: 'result',
              value: { op: 'ref', path: ['nodes', 'tool'] },
            },
          ],
          edges: [
            { sourceNodeId: 'tool', targetNodeId: 'skill' },
            { sourceNodeId: 'skill', targetNodeId: 'result' },
          ],
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ valid: true, errors: [] });
    } finally {
      await mockMcp.close();
    }
  });

  it('feeds invalid Workflow DSL back to the same model and persists the corrected plan', async () => {
    workflowPlanningCalls = 0;
    const response = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: `plan.e2e.${randomUUID()}`,
        workflowDefinitionId: 'workflow.planned.e2e',
        workflowVersion: 1,
        goalId: 'goal.planned.e2e',
        goalVersion: 1,
        planningInstruction: 'PLAN_WORKFLOW',
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      confirmationStatus: 'awaiting_confirmation',
      attemptCount: 2,
      definition: {
        workflowDefinitionId: 'workflow.planned.e2e',
        goalId: 'goal.planned.e2e',
        nodes: [expect.objectContaining({ type: 'result' })],
      },
    });
    expect(workflowPlanningCalls).toBe(2);
  });

  it('validates an admin DAG edit, revokes the old confirmation, then confirms and executes the revision', async () => {
    const sourcePlanId = `plan.admin.source.${randomUUID()}`;
    const revisedPlanId = `plan.admin.revised.${randomUUID()}`;
    const source = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId: sourcePlanId,
        workflowDefinitionId: 'workflow.planned.e2e',
        workflowVersion: 1,
        goalId: 'goal.planned.e2e',
        goalVersion: 1,
        planningInstruction: 'PLAN_WORKFLOW',
      }),
    });
    expect(source.status).toBe(201);
    expect(
      await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}/confirm`,
        { method: 'POST' },
      ),
    ).toMatchObject({ status: 200 });
    const revised = await fetch(
      `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}/revisions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          newPlanId: revisedPlanId,
          format: 'dag',
          definition: {
            workflowDefinitionId: 'workflow.planned.e2e',
            version: 2,
            goalId: 'goal.planned.e2e',
            goalVersion: 1,
            entryNodeId: 'result',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'result',
                name: 'Admin edited result',
                type: 'result',
                value: { op: 'literal', value: 'admin-dag-ok' },
              },
            ],
            edges: [],
          },
        }),
      },
    );
    expect(revised.status).toBe(201);
    await expect(revised.json()).resolves.toMatchObject({
      sourcePlanId,
      revisionKind: 'admin_dag',
      confirmationStatus: 'awaiting_confirmation',
    });
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({ confirmationStatus: 'superseded' });
    expect(
      await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(revisedPlanId)}/confirm`,
        { method: 'POST' },
      ),
    ).toMatchObject({ status: 200 });
    const executed = await fetch(
      `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(revisedPlanId)}/execute`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId: `instance.admin.${randomUUID()}`, input: {} }),
      },
    );
    expect(executed.status).toBe(201);
    await expect(executed.json()).resolves.toMatchObject({
      status: 'succeeded',
      result: 'admin-dag-ok',
    });
  });

  it('blocks an unconfirmed plan then executes its compiled LangGraph against a real MCP server', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.execution.${randomUUID()}`;
    const planId = `plan.execution.${randomUUID()}`;
    const workflowId = `workflow.execution.${randomUUID()}`;
    const goalId = `goal.execution.${randomUUID()}`;
    mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 1, goalId };
    try {
      const registration = await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverId,
          name: 'Workflow Execution MCP',
          endpoint: mockMcp.endpoint.toString(),
          credentialHeaders: {},
        }),
      });
      expect(registration.status).toBe(201);
      const planned = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId,
          workflowDefinitionId: workflowId,
          workflowVersion: 1,
          goalId,
          goalVersion: 1,
          planningInstruction: 'EXECUTE_MCP_WORKFLOW',
        }),
      });
      expect(planned.status).toBe(201);
      await expect(planned.json()).resolves.toMatchObject({
        confirmationStatus: 'awaiting_confirmation',
        definition: { workflowDefinitionId: workflowId },
      });

      const blocked = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: `blocked-${randomUUID()}`, input: {} }),
        },
      );
      expect(blocked.status).toBe(400);
      await expect(blocked.json()).resolves.toMatchObject({
        error: { code: 'WORKFLOW_PLAN_NOT_CONFIRMED' },
      });
      const confirmed = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/confirm`,
        { method: 'POST' },
      );
      expect(confirmed.status).toBe(200);
      const executed = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: `instance-${randomUUID()}`, input: {} }),
        },
      );
      expect(executed.status).toBe(201);
      await expect(executed.json()).resolves.toMatchObject({
        status: 'succeeded',
        result: {
          structuredContent: { deviceId: 'device-runtime', status: 'online' },
        },
        budgetUsage: { mcpCalls: 1, llmCalls: 0, cost: 1 },
        errors: {},
      });
      const repairedPlanId = `plan.execution.repaired.${randomUUID()}`;
      mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 2, goalId };
      const repaired = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId: repairedPlanId,
          workflowDefinitionId: workflowId,
          workflowVersion: 2,
          goalId,
          goalVersion: 1,
          planningInstruction: 'EXECUTE_MCP_WORKFLOW',
          sourceConfirmedPlanId: planId,
        }),
      });
      expect(repaired.status).toBe(201);
      await expect(repaired.json()).resolves.toMatchObject({
        confirmationStatus: 'confirmed',
        sourceConfirmedPlanId: planId,
        definition: { version: 2 },
      });
      const repairedExecution = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(repairedPlanId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: `instance-repaired-${randomUUID()}`, input: {} }),
        },
      );
      expect(repairedExecution.status).toBe(201);
      await expect(repairedExecution.json()).resolves.toMatchObject({ status: 'succeeded' });
      const tightSkillId = `skill.budget.${randomUUID()}`;
      const tightSkillRegistration = await fetch(`${runtime.management.baseUrl}/api/v1/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...skillInput(tightSkillId, 'Zero MCP budget'),
          runtimePolicy: { autoConfirmPlan: false, maxMcpCalls: 0 },
        }),
      });
      expect(tightSkillRegistration.status).toBe(201);
      const budgetPlanId = `plan.execution.budget.${randomUUID()}`;
      mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 3, goalId };
      const budgetPlan = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId: budgetPlanId,
          workflowDefinitionId: workflowId,
          workflowVersion: 3,
          goalId,
          goalVersion: 1,
          planningInstruction: 'EXECUTE_MCP_WORKFLOW',
          sourceConfirmedPlanId: repairedPlanId,
        }),
      });
      expect(budgetPlan.status).toBe(201);
      const budgetExecution = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(budgetPlanId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            instanceId: `instance-budget-${randomUUID()}`,
            input: {},
            skillIds: [tightSkillId],
          }),
        },
      );
      expect(budgetExecution.status).toBe(201);
      await expect(budgetExecution.json()).resolves.toMatchObject({
        status: 'failed',
        skillVersions: [{ skillId: tightSkillId, version: 1 }],
        budgetLimits: { maxMcpCalls: 0 },
        budgetUsage: { mcpCalls: 0, cost: 0 },
        terminationReason: 'mcp_calls_exhausted',
        errors: { budget: { code: 'WORKFLOW_MCP_CALL_BUDGET_EXHAUSTED' } },
      });
      const invocations = await runtime.listMcpInvocations(serverId);
      expect(invocations).toEqual([
        expect.objectContaining({
          toolName: 'device_status',
          arguments: { deviceId: 'device-runtime' },
          status: 'succeeded',
        }),
        expect.objectContaining({
          toolName: 'device_status',
          arguments: { deviceId: 'device-runtime' },
          status: 'succeeded',
        }),
      ]);
    } finally {
      mcpWorkflowTarget = undefined;
      await mockMcp.close();
    }
  });

  it('persists a LangGraph human interrupt and resumes without replaying the preceding MCP call', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.interrupt.${randomUUID()}`;
    const sourcePlanId = `plan.interrupt.source.${randomUUID()}`;
    const planId = `plan.interrupt.${randomUUID()}`;
    const workflowId = `workflow.interrupt.${randomUUID()}`;
    const goalId = `goal.interrupt.${randomUUID()}`;
    const instanceId = `instance.interrupt.${randomUUID()}`;
    mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 1, goalId };
    try {
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            serverId,
            name: 'Human interrupt MCP',
            endpoint: mockMcp.endpoint.toString(),
            credentialHeaders: {},
          }),
        }),
      ).toMatchObject({ status: 201 });
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            planId: sourcePlanId,
            workflowDefinitionId: workflowId,
            workflowVersion: 1,
            goalId,
            goalVersion: 1,
            planningInstruction: 'EXECUTE_MCP_WORKFLOW',
          }),
        }),
      ).toMatchObject({ status: 201 });
      const revision = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}/revisions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            newPlanId: planId,
            format: 'dsl',
            definition: {
              workflowDefinitionId: workflowId,
              version: 2,
              goalId,
              goalVersion: 1,
              entryNodeId: 'tool',
              exitNodeIds: ['result'],
              nodes: [
                {
                  nodeId: 'tool',
                  name: 'Read once',
                  type: 'mcp_tool',
                  tool: { serverId, toolName: 'device_status' },
                  arguments: { deviceId: 'device-human-interrupt' },
                },
                {
                  nodeId: 'confirm',
                  name: 'Human gate',
                  type: 'human_confirmation',
                  prompt: 'Return the observed device status?',
                },
                {
                  nodeId: 'result',
                  name: 'Result',
                  type: 'result',
                  value: { op: 'ref', path: ['nodes', 'tool'] },
                },
              ],
              edges: [
                { sourceNodeId: 'tool', targetNodeId: 'confirm' },
                { sourceNodeId: 'confirm', targetNodeId: 'result', outcome: 'success' },
                { sourceNodeId: 'confirm', targetNodeId: 'result', outcome: 'failure' },
              ],
            },
          }),
        },
      );
      expect(revision.status).toBe(201);
      expect(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/confirm`,
          { method: 'POST' },
        ),
      ).toMatchObject({ status: 200 });
      const interrupted = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId, input: {} }),
        },
      );
      expect(interrupted.status).toBe(201);
      await expect(interrupted.json()).resolves.toMatchObject({
        status: 'paused',
        pendingConfirmation: {
          nodeId: 'confirm',
          prompt: 'Return the observed device status?',
        },
      });
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(1);

      const resumed = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/instances/${encodeURIComponent(instanceId)}/human-confirmation`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      expect(resumed.status).toBe(200);
      await expect(resumed.json()).resolves.toMatchObject({
        status: 'succeeded',
        result: {
          structuredContent: { deviceId: 'device-human-interrupt', status: 'online' },
        },
      });
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(1);
    } finally {
      mcpWorkflowTarget = undefined;
      await mockMcp.close();
    }
  });

  it('uses the fixed LLM stage for the final execution-exception decision', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.exception.${randomUUID()}`;
    const sourcePlanId = `plan.exception.source.${randomUUID()}`;
    const planId = `plan.exception.${randomUUID()}`;
    const workflowId = `workflow.exception.${randomUUID()}`;
    const goalId = `goal.exception.${randomUUID()}`;
    mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 1, goalId };
    let closed = false;
    try {
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            serverId,
            name: 'Exception decision MCP',
            endpoint: mockMcp.endpoint.toString(),
            credentialHeaders: {},
          }),
        }),
      ).toMatchObject({ status: 201 });
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            planId: sourcePlanId,
            workflowDefinitionId: workflowId,
            workflowVersion: 1,
            goalId,
            goalVersion: 1,
            planningInstruction: 'EXECUTE_MCP_WORKFLOW',
          }),
        }),
      ).toMatchObject({ status: 201 });
      const revision = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}/revisions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            newPlanId: planId,
            format: 'dsl',
            definition: {
              workflowDefinitionId: workflowId,
              version: 2,
              goalId,
              goalVersion: 1,
              entryNodeId: 'tool',
              exitNodeIds: ['result'],
              nodes: [
                {
                  nodeId: 'tool',
                  name: 'Unavailable tool',
                  type: 'mcp_tool',
                  tool: { serverId, toolName: 'device_status' },
                  arguments: { deviceId: 'device-exception' },
                },
                {
                  nodeId: 'handler',
                  name: 'LLM exception decision',
                  type: 'error_handler',
                  handledNodeId: 'tool',
                  strategy: 'continue',
                },
                {
                  nodeId: 'result',
                  name: 'Recovered result',
                  type: 'result',
                  value: { op: 'literal', value: 'recovered-after-llm-decision' },
                },
              ],
              edges: [{ sourceNodeId: 'handler', targetNodeId: 'result' }],
            },
          }),
        },
      );
      expect(revision.status).toBe(201);
      expect(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/confirm`,
          { method: 'POST' },
        ),
      ).toMatchObject({ status: 200 });
      await mockMcp.close();
      closed = true;
      const execution = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: `instance.exception.${randomUUID()}`, input: {} }),
        },
      );
      expect(execution.status).toBe(201);
      await expect(execution.json()).resolves.toMatchObject({
        status: 'succeeded',
        result: 'recovered-after-llm-decision',
        errors: { tool: expect.any(Object) },
      });
      const decisions = z
        .object({ items: z.array(z.object({ stage: z.string(), status: z.string() })) })
        .parse(
          await (
            await fetch(
              `${runtime.management.baseUrl}/api/v1/models/invocations?stage=execution_decision`,
            )
          ).json(),
        );
      expect(decisions.items).toContainEqual(
        expect.objectContaining({ stage: 'execution_decision', status: 'succeeded' }),
      );
    } finally {
      mcpWorkflowTarget = undefined;
      if (!closed) await mockMcp.close();
    }
  });

  it('evaluates, replans outside LangGraph, auto-confirms an opted-in Skill, and tracks rounds', async () => {
    const submitted = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Create a context for the control loop.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.control.${randomUUID()}`;
    const skillId = `skill.control.${randomUUID()}`;
    const preparedTask = await fetch(
      `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(submitted.id)}`,
    ).then((response) => response.json() as Promise<{ goalId: string }>);
    const goalId = preparedTask.goalId;
    const workflowId = `workflow.control.${randomUUID()}`;
    const initialPlanId = `plan.control.${randomUUID()}`;
    const controlId = `control.${randomUUID()}`;
    controlEvaluationCalls = 0;
    mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 1, goalId };
    try {
      expect(
        (
          await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              serverId,
              name: 'Control MCP',
              endpoint: mockMcp.endpoint.toString(),
              credentialHeaders: {},
            }),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await fetch(`${runtime.management.baseUrl}/api/v1/skills`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...skillInput(skillId, 'Auto-confirm control'),
              runtimePolicy: { autoConfirmPlan: true, maxReplans: 1 },
            }),
          })
        ).status,
      ).toBe(201);
      const initialPlan = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId: initialPlanId,
          workflowDefinitionId: workflowId,
          workflowVersion: 1,
          goalId,
          goalVersion: 1,
          planningInstruction: 'EXECUTE_MCP_WORKFLOW',
        }),
      });
      expect(initialPlan.status).toBe(201);
      expect(
        (
          await fetch(
            `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(initialPlanId)}/confirm`,
            { method: 'POST' },
          )
        ).status,
      ).toBe(200);
      mcpWorkflowTarget = { serverId, workflowId, workflowVersion: 2, goalId };
      const control = await fetch(`${runtime.management.baseUrl}/api/v1/workflow-controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          controlId,
          contextId: submitted.contextId,
          goalId,
          goalVersion: 1,
          initialPlanId,
          input: {},
          skillIds: [skillId],
          planningInstruction: 'CONTROL_REPLAN',
        }),
      });
      expect(control.status).toBe(201);
      await expect(control.json()).resolves.toMatchObject({
        status: 'achieved',
        roundCount: 2,
        replanCount: 1,
      });
      const rounds = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflow-controls/${encodeURIComponent(controlId)}/rounds`,
      );
      await expect(rounds.json()).resolves.toMatchObject({
        items: [
          { roundIndex: 0, workflowVersion: 1, evaluation: { decision: 'replan' } },
          { roundIndex: 1, workflowVersion: 2, evaluation: { decision: 'achieved' } },
        ],
      });
      const storedGoal = await fetch(
        `${runtime.management.baseUrl}/api/v1/goals/${encodeURIComponent(goalId)}`,
      );
      await expect(storedGoal.json()).resolves.toMatchObject({ status: 'achieved' });
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(2);
      expect(controlEvaluationCalls).toBe(2);
    } finally {
      mcpWorkflowTarget = undefined;
      await mockMcp.close();
    }
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
    await expect(
      fetch(`${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`).then(
        (response) => response.json(),
      ),
    ).resolves.toMatchObject({
      goalId: expect.any(String),
      goalVersion: 1,
      phase: 'awaiting_plan_confirmation',
    });
    for (const stage of ['intent', 'goal', 'skill_selection'] as const) {
      const invocations = z
        .object({ items: z.array(z.object({ stage: z.string(), status: z.string() })) })
        .parse(
          await (
            await fetch(`${runtime.management.baseUrl}/api/v1/models/invocations?stage=${stage}`)
          ).json(),
        );
      expect(invocations.items).toContainEqual(
        expect.objectContaining({ stage, status: 'succeeded' }),
      );
    }

    const listed = await runtime.a2a.client.listTasks({
      tenant: '',
      contextId,
      status: TaskState.TASK_STATE_INPUT_REQUIRED,
      pageToken: '',
      statusTimestampAfter: undefined,
      includeArtifacts: true,
    });
    expect(listed.tasks.map((task) => task.id)).toContain(taskId);

    const sourcePlanId = await attachPlannedTask(taskId);
    const revised = await sendFollowUp(taskId, contextId, 'revise_plan', 'Add a safety check.');
    expectTaskState(revised, TaskState.TASK_STATE_INPUT_REQUIRED);
    const taskAfterRevision = await fetch(
      `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
    ).then((response) => response.json() as Promise<{ planId: string }>);
    expect(taskAfterRevision.planId).not.toBe(sourcePlanId);
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({ confirmationStatus: 'superseded' });
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(taskAfterRevision.planId)}`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({
      sourcePlanId,
      revisionKind: 'natural_language',
      confirmationStatus: 'awaiting_confirmation',
      definition: { version: 2 },
    });
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
    await attachPlannedTask(submitted.id);
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

function embeddedOperation(
  messages: readonly Readonly<{ content?: string }>[] | undefined,
  operation: string,
): unknown {
  const content = messages
    ?.map((message) => message.content)
    .find((candidate) => candidate?.includes(`"operation":"${operation}"`) === true);
  const start = content?.indexOf('{"operation":') ?? -1;
  if (content === undefined || start < 0) throw new Error(`MODEL_OPERATION_MISSING:${operation}`);
  return JSON.parse(content.slice(start)) as unknown;
}

function respondStructured(response: ServerResponse, content: unknown): void {
  response.end(
    JSON.stringify({
      id: 'structured-decision-e2e',
      model: 'model-e2e',
      choices: [{ message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
}

async function startModelLoopback(): Promise<Server> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        model?: string;
        messages?: { content?: string }[];
      };
      response.setHeader('content-type', 'application/json');
      if (body.model === 'fail-model') {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: 'unavailable' }));
        return;
      }
      if (request.url?.endsWith('/messages') === true) {
        response.end(
          JSON.stringify({
            id: 'vendor-message-e2e',
            model: 'vendor-model-e2e',
            content: [{ type: 'text', text: JSON.stringify(generatedSkillMetadata()) }],
            usage: { input_tokens: 7, output_tokens: 3 },
          }),
        );
        return;
      }
      if (request.url?.endsWith('/chat/completions') === true) {
        const intentDecisionRequest = body.messages?.some(
          (message) => message.content?.includes('decide_task_intent') === true,
        );
        const goalDecisionRequest = body.messages?.some(
          (message) => message.content?.includes('formulate_goal') === true,
        );
        const skillSelectionRequest = body.messages?.some(
          (message) => message.content?.includes('select_skill') === true,
        );
        const exceptionDecisionRequest = body.messages?.some(
          (message) => message.content?.includes('decide_execution_exception') === true,
        );
        const workflowRequest =
          body.messages?.some((message) => message.content?.includes('PLAN_WORKFLOW') === true) ===
          true;
        const taskWorkflowRequest = body.messages?.some(
          (message) => message.content?.includes('TASK_ATTACHED_PLAN') === true,
        );
        const naturalRevisionRequest =
          body.messages?.some(
            (message) => message.content?.includes('natural_language_plan_revision') === true,
          ) === true;
        const mcpExecutionRequest =
          body.messages?.some(
            (message) => message.content?.includes('EXECUTE_MCP_WORKFLOW') === true,
          ) === true;
        const controlReplanRequest =
          body.messages?.some((message) => message.content?.includes('CONTROL_REPLAN') === true) ===
          true;
        const controlEvaluationRequest =
          body.messages?.some((message) => message.content?.includes('CONTROL_GOAL') === true) ===
          true;
        if (intentDecisionRequest === true) {
          respondStructured(response, {
            intent: 'execute',
            summary: 'The request requires task execution.',
          });
          return;
        }
        if (goalDecisionRequest === true) {
          const requestData = z
            .object({ requestText: z.string() })
            .parse(embeddedOperation(body.messages, 'formulate_goal'));
          const controlGoal = requestData.requestText.includes('control loop');
          respondStructured(response, {
            title: controlGoal ? 'Control Goal' : 'Execute the requested task',
            description: controlGoal
              ? 'CONTROL_GOAL collect two observations.'
              : 'Complete the user request using an enabled Skill.',
            constraints: [],
            successCriteria: [
              controlGoal
                ? 'Two Workflow rounds are evaluated.'
                : 'A validated result is returned.',
            ],
            requiresInput: false,
          });
          return;
        }
        if (skillSelectionRequest === true) {
          const requestData = embeddedOperation(body.messages, 'select_skill');
          const candidates = z
            .object({
              candidates: z.array(
                z.looseObject({
                  skillId: z.string(),
                  name: z.string(),
                  semanticScore: z.number(),
                  createdAt: z.string(),
                }),
              ),
            })
            .parse(requestData).candidates;
          const semanticLeaders = [...candidates]
            .sort((left, right) => right.semanticScore - left.semanticScore)
            .filter(
              (candidate, _index, sorted) => candidate.semanticScore === sorted[0]?.semanticScore,
            );
          const deviceLeaders = semanticLeaders.filter((candidate) =>
            candidate.name.toLowerCase().includes('zebra'),
          );
          const preferred = deviceLeaders.length > 0 ? deviceLeaders : semanticLeaders;
          const selected = [...preferred].sort((left, right) =>
            left.createdAt.localeCompare(right.createdAt),
          )[preferred.length - 1];
          if (selected === undefined) throw new Error('NO_SKILL_SELECTION_CANDIDATE');
          respondStructured(response, {
            selectedSkillId: selected.skillId,
            decisionSummary: 'LLM selected from retrieval and the persisted metric snapshot.',
          });
          return;
        }
        if (exceptionDecisionRequest === true) {
          respondStructured(response, {
            strategy: 'continue',
            summary: 'Continue through the validated error-handler path.',
          });
          return;
        }
        if (controlEvaluationRequest) {
          controlEvaluationCalls += 1;
          const content =
            controlEvaluationCalls === 1
              ? {
                  decision: 'replan',
                  summary: 'A second observation is required.',
                  replanInstruction: 'Run the next immutable Workflow version.',
                }
              : { decision: 'achieved', summary: 'Two evaluated observations satisfy the Goal.' };
          response.end(
            JSON.stringify({
              id: 'goal-evaluation-e2e',
              model: 'model-e2e',
              choices: [{ message: { content: JSON.stringify(content) } }],
              usage: { prompt_tokens: 12, completion_tokens: 6 },
            }),
          );
          return;
        }
        if (naturalRevisionRequest) {
          const requestData = z
            .object({ sourceDefinition: z.record(z.string(), z.unknown()) })
            .parse(embeddedOperation(body.messages, 'natural_language_plan_revision'));
          const source = requestData.sourceDefinition;
          const content = {
            ...source,
            version: z.number().int().positive().parse(source['version']) + 1,
            entryNodeId: 'result',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'result',
                name: 'Revised result',
                type: 'result',
                value: { op: 'literal', value: 'safety-check-added' },
              },
            ],
            edges: [],
          };
          response.end(
            JSON.stringify({
              id: 'workflow-revision-e2e',
              model: 'model-e2e',
              choices: [{ message: { content: JSON.stringify(content) } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          );
          return;
        }
        if (taskWorkflowRequest === true) {
          const target = taskWorkflowTarget;
          if (target === undefined) throw new Error('TASK_WORKFLOW_TARGET_MISSING');
          respondStructured(response, {
            workflowDefinitionId: target.workflowId,
            version: 1,
            goalId: target.goalId,
            goalVersion: target.goalVersion,
            entryNodeId: 'result',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'result',
                name: 'Task result',
                type: 'result',
                value: { op: 'literal', value: true },
              },
            ],
            edges: [],
          });
          return;
        }
        if (workflowRequest) {
          workflowPlanningCalls += 1;
          const content =
            workflowPlanningCalls === 1
              ? { invalid: true }
              : {
                  workflowDefinitionId: 'workflow.planned.e2e',
                  version: 1,
                  goalId: 'goal.planned.e2e',
                  goalVersion: 1,
                  entryNodeId: 'result',
                  exitNodeIds: ['result'],
                  nodes: [
                    {
                      nodeId: 'result',
                      name: 'Result',
                      type: 'result',
                      value: { op: 'literal', value: true },
                    },
                  ],
                  edges: [],
                };
          response.end(
            JSON.stringify({
              id: 'workflow-chat-e2e',
              model: 'model-e2e',
              choices: [{ message: { content: JSON.stringify(content) } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
          );
          return;
        }
        if (mcpExecutionRequest || controlReplanRequest) {
          const target = mcpWorkflowTarget;
          if (target === undefined) throw new Error('MCP_WORKFLOW_TARGET_MISSING');
          const content = {
            workflowDefinitionId: target.workflowId,
            version: target.workflowVersion,
            goalId: target.goalId,
            goalVersion: 1,
            entryNodeId: 'tool',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'tool',
                name: 'Read device',
                type: 'mcp_tool',
                tool: { serverId: target.serverId, toolName: 'device_status' },
                arguments: { deviceId: 'device-runtime' },
              },
              {
                nodeId: 'result',
                name: 'Return MCP result',
                type: 'result',
                value: { op: 'ref', path: ['nodes', 'tool'] },
              },
            ],
            edges: [{ sourceNodeId: 'tool', targetNodeId: 'result' }],
          };
          response.end(
            JSON.stringify({
              id: 'workflow-mcp-e2e',
              model: 'model-e2e',
              choices: [{ message: { content: JSON.stringify(content) } }],
              usage: { prompt_tokens: 10, completion_tokens: 10 },
            }),
          );
          return;
        }
        response.end(
          JSON.stringify({
            id: 'chat-e2e',
            model: 'model-e2e',
            choices: [
              {
                message: {
                  content: JSON.stringify(generatedSkillMetadata()),
                  reasoning: 'excluded',
                },
              },
            ],
            usage: { prompt_tokens: 9, completion_tokens: 4 },
            private_reasoning: 'excluded',
          }),
        );
      } else {
        response.end(
          JSON.stringify({
            model: 'model-e2e',
            data: [{ embedding: [1, 0, 0] }],
            usage: { prompt_tokens: 2 },
          }),
        );
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
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

async function attachPlannedTask(taskId: string): Promise<string> {
  const task = await fetch(
    `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
  ).then((response) => response.json() as Promise<{ goalId: string; goalVersion: number }>);
  const planId = `plan.task.${randomUUID()}`;
  const workflowId = `workflow.task.${randomUUID()}`;
  taskWorkflowTarget = { workflowId, goalId: task.goalId, goalVersion: task.goalVersion };
  const planned = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      planId,
      workflowDefinitionId: workflowId,
      workflowVersion: 1,
      goalId: task.goalId,
      goalVersion: task.goalVersion,
      planningInstruction: 'TASK_ATTACHED_PLAN',
    }),
  });
  taskWorkflowTarget = undefined;
  if (planned.status !== 201) throw new Error(`TASK_PLAN_CREATE_FAILED:${String(planned.status)}`);
  const attached = await fetch(
    `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/plan`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId, goalId: task.goalId, goalVersion: task.goalVersion }),
    },
  );
  if (!attached.ok)
    throw new Error(`TASK_PLAN_ATTACH_FAILED:${String(attached.status)}:${await attached.text()}`);
  return planId;
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
