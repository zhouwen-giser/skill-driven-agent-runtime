import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, get, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { SendMessageRequest, type Task, TaskState } from '@a2a-js/sdk';
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
let replacementEvaluationCalls = 0;
let mcpWorkflowTarget:
  | Readonly<{ serverId: string; workflowId: string; workflowVersion: number; goalId: string }>
  | undefined;
let taskWorkflowTarget:
  Readonly<{ workflowId: string; goalId: string; goalVersion: number }> | undefined;
let skillCallWorkflowTarget:
  | Readonly<{ workflowId: string; goalId: string; goalVersion: number; skillId: string }>
  | undefined;

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
  for (const stage of [
    'intent',
    'goal',
    'skill_selection',
    'execution_decision',
    'result_processing',
  ] as const) {
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

  it('raises a low-quality warning without disabling or repairing the enabled Skill', async () => {
    const skillId = `skill.quality.warning.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Quality warning Skill'));
    for (const [index, score] of [0.3, 0.2, 0.1].entries()) {
      const recorded = await fetch(
        `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/quality-observations`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            skillVersion: 1,
            evaluationRef: `evaluation-quality-${String(index + 1)}`,
            score,
            successful: false,
          }),
        },
      );
      expect(recorded.status).toBe(201);
    }
    const warnings = z
      .object({
        items: z.array(
          z.object({
            skillId: z.string(),
            skillVersion: z.number(),
            kind: z.string(),
            status: z.string(),
            skillStatusAtCreation: z.string(),
            observationIds: z.array(z.string()),
          }),
        ),
      })
      .parse(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/skill-quality-warnings?skillId=${encodeURIComponent(skillId)}`,
        ).then((response) => response.json()),
      );
    expect(warnings.items).toMatchObject([
      {
        skillId,
        skillVersion: 1,
        kind: 'consecutive_low_score',
        status: 'active',
        skillStatusAtCreation: 'enabled',
      },
    ]);
    expect(warnings.items[0]?.observationIds).toHaveLength(3);
    const versions = z
      .object({
        items: z.array(
          z.object({ version: z.number(), status: z.string(), sourceKind: z.string() }),
        ),
      })
      .parse(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(skillId)}/versions`,
        ).then((response) => response.json()),
      );
    expect(versions.items).toEqual([
      expect.objectContaining({ version: 1, status: 'enabled', sourceKind: 'admin' }),
    ]);
    expect((await readAgentCard()).skills.map((skill) => skill.id)).toContain(skillId);
    await runtime.setSkillEnabled(skillId, false);
  });

  it('induces a frequent successful Workflow Template and tracks adjusted reuse effects', async () => {
    const skillId = `skill.template.reuse.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Template reuse Skill'));
    const execute = async () => {
      const submitted = await runtime.a2a.client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: `message-${randomUUID()}`,
            role: 'ROLE_USER',
            parts: [
              {
                text: `TEMPLATE_REUSE GLOBAL_SHARED_SKILL:${skillId}`,
                mediaType: 'text/plain',
              },
            ],
          },
          configuration: { returnImmediately: false },
        }),
      );
      if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
      expect(submitted.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
      await sendFollowUp(
        submitted.id,
        submitted.contextId,
        'confirm_plan',
        'Confirm template run.',
      );
      await waitForTaskState(submitted.id, TaskState.TASK_STATE_COMPLETED);
    };
    await execute();
    await execute();
    await execute();
    const induced = z
      .object({
        items: z.array(
          z.object({
            templateId: z.string(),
            version: z.number(),
            goalKey: z.string(),
            sourceExperienceIds: z.array(z.string()),
            sourceSuccessCount: z.number(),
            useCount: z.number(),
            successfulUseCount: z.number(),
          }),
        ),
      })
      .parse(
        await fetch(`${runtime.management.baseUrl}/api/v1/workflow-templates`).then((response) =>
          response.json(),
        ),
      );
    const template = induced.items.find((item) => item.goalKey.includes('template_reuse'));
    expect(template).toMatchObject({
      version: 1,
      sourceSuccessCount: 3,
      useCount: 0,
      successfulUseCount: 0,
    });
    expect(template?.sourceExperienceIds).toHaveLength(3);
    if (template === undefined) throw new Error('WORKFLOW_TEMPLATE_NOT_INDUCED');
    await execute();
    const updated = z
      .object({
        items: z.array(
          z.object({
            templateId: z.string(),
            useCount: z.number(),
            successfulUseCount: z.number(),
            averageUseDurationMs: z.number(),
          }),
        ),
      })
      .parse(
        await fetch(`${runtime.management.baseUrl}/api/v1/workflow-templates`).then((response) =>
          response.json(),
        ),
      );
    expect(updated.items.find((item) => item.templateId === template.templateId)).toMatchObject({
      useCount: 1,
      successfulUseCount: 1,
    });
    const uses = z
      .object({
        items: z.array(
          z.object({
            templateId: z.string(),
            templateVersion: z.number(),
            status: z.string(),
            workflowDefinitionId: z.string(),
            durationMs: z.number().optional(),
          }),
        ),
      })
      .parse(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/workflow-templates/${encodeURIComponent(template.templateId)}/uses`,
        ).then((response) => response.json()),
      );
    expect(uses.items).toMatchObject([
      {
        templateId: template.templateId,
        templateVersion: 1,
        status: 'succeeded',
      },
    ]);
    expect(uses.items[0]?.workflowDefinitionId).toContain('workflow-task-');
    await runtime.setSkillEnabled(skillId, false);
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

  it('executes skill_call as an independent LangGraph child Workflow using the current Skill version', async () => {
    const skillId = `skill.child.${randomUUID()}`;
    const first = await runtime.registerSkill({
      ...skillInput(skillId, 'Child Workflow Skill v1'),
      workflowGuidance: 'SKILL_CHILD_EXECUTION version one.',
    });
    expect(first.version).toBe(1);
    const planId = `plan.skill-call.${randomUUID()}`;
    const instanceId = `instance.skill-call-parent.${randomUUID()}`;
    skillCallWorkflowTarget = {
      workflowId: `workflow.skill-call.${randomUUID()}`,
      goalId: `goal.skill-call.${randomUUID()}`,
      goalVersion: 1,
      skillId,
    };
    const planned = await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        planId,
        workflowDefinitionId: skillCallWorkflowTarget.workflowId,
        workflowVersion: 1,
        goalId: skillCallWorkflowTarget.goalId,
        goalVersion: 1,
        planningInstruction: 'SKILL_CALL_PLAN',
      }),
    });
    skillCallWorkflowTarget = undefined;
    expect(planned.status).toBe(201);
    const second = await runtime.registerSkill({
      ...skillInput(skillId, 'Child Workflow Skill v2'),
      workflowGuidance: 'SKILL_CHILD_EXECUTION version two.',
    });
    expect(second.version).toBe(2);
    expect(
      await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/confirm`,
        { method: 'POST' },
      ),
    ).toMatchObject({ status: 200 });
    const execution = await fetch(
      `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(planId)}/execute`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instanceId, input: { deviceId: 'device-parent' } }),
      },
    );
    expect(execution.status).toBe(201);
    await expect(execution.json()).resolves.toMatchObject({
      instanceId,
      status: 'succeeded',
      result: { status: 'online' },
      skillVersions: [{ skillId, version: 2 }],
    });
    await expect(runtime.listSkillCallWorkflows(instanceId)).resolves.toEqual([
      expect.objectContaining({
        parentNodeId: 'child',
        skillId,
        skillVersion: 2,
        status: 'succeeded',
        evaluationSummary: expect.stringContaining(`${skillId}@2`),
      }),
    ]);
  });

  it('retrieves the same globally shared formal Skill for different user_id values', async () => {
    const skillId = `skill.shared.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Globally shared formal Skill'));
    for (const userId of ['shared-user-a', 'shared-user-b']) {
      const task = await runtime.a2a.client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: `message-${randomUUID()}`,
            role: 'ROLE_USER',
            parts: [{ text: `Use GLOBAL_SHARED_SKILL:${skillId}`, mediaType: 'text/plain' }],
            metadata: { user_id: userId },
          },
          configuration: { returnImmediately: false },
        }),
      );
      if (!('id' in task)) throw new Error('A2A_EXPECTED_TASK_RESULT');
      expect(task.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
      await expect(
        fetch(`${runtime.management.baseUrl}/api/v1/tasks/${task.id}`).then((response) =>
          response.json(),
        ),
      ).resolves.toMatchObject({ userId, selectedSkillId: skillId });
    }
  });

  it('rejects a generated Task plan when the selected Skill required Tool is missing', async () => {
    const skillId = `skill.required-tool.${randomUUID()}`;
    const serverId = `mcp.required-missing.${randomUUID()}`;
    await runtime.registerSkill({
      ...skillInput(skillId, 'Required Tool Skill'),
      toolPolicy: {
        required: [{ serverId, toolName: 'required_read' }],
        optional: [],
        forbidden: [],
      },
    });
    const task = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: `Use GLOBAL_SHARED_SKILL:${skillId}`, mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in task)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(task.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    await expect(
      fetch(`${runtime.management.baseUrl}/api/v1/tasks/${task.id}`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({
      phase: 'failed',
      selectedSkillId: skillId,
      phaseMessage: expect.stringContaining('TASK_PREPARATION_FAILED'),
    });
    await expect(runtime.listMcpInvocations(serverId)).resolves.toEqual([]);
    await runtime.setSkillEnabled(skillId, false);
  });

  it('replaces a failed selected Skill only through an alternative plan and fresh confirmation', async () => {
    replacementEvaluationCalls = 0;
    const primarySkillId = `skill.replace.primary.${randomUUID()}`;
    const alternativeSkillId = `skill.replace.alternative.${randomUUID()}`;
    await runtime.registerSkill(skillInput(primarySkillId, 'Replacement primary'));
    await runtime.registerSkill(skillInput(alternativeSkillId, 'Replacement alternative'));
    const relation = await fetch(`${runtime.management.baseUrl}/api/v1/skill-graph/relations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceSkillId: primarySkillId,
        targetSkillId: alternativeSkillId,
        relationType: 'alternative',
        metadata: { reason: 'E2E replacement' },
      }),
    });
    expect(relation.status).toBe(201);
    const submitted = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [
            {
              text: `replace failed skill GLOBAL_SHARED_SKILL:${primarySkillId}`,
              mediaType: 'text/plain',
            },
          ],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const initial = z
      .object({ planId: z.string(), skillSelectionId: z.string() })
      .parse(
        await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${submitted.id}`).then((response) =>
          response.json(),
        ),
      );
    await sendFollowUp(submitted.id, submitted.contextId, 'confirm_plan', 'Confirm primary.');
    await waitForTaskState(submitted.id, TaskState.TASK_STATE_INPUT_REQUIRED);
    const replacement = z
      .object({
        phase: z.string(),
        planId: z.string(),
        selectedSkillId: z.string(),
        selectedSkillVersion: z.number(),
        skillSelectionId: z.string(),
      })
      .parse(
        await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${submitted.id}`).then((response) =>
          response.json(),
        ),
      );
    expect(replacement).toMatchObject({
      phase: 'awaiting_plan_confirmation',
      selectedSkillId: alternativeSkillId,
      selectedSkillVersion: 1,
      skillSelectionId: initial.skillSelectionId,
    });
    expect(replacement.planId).not.toBe(initial.planId);
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(initial.planId)}`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({ confirmationStatus: 'superseded' });
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(replacement.planId)}`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({
      sourcePlanId: initial.planId,
      confirmationStatus: 'awaiting_confirmation',
    });
    const rounds = z
      .object({ items: z.array(z.object({ instanceId: z.string() })).min(1) })
      .parse(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/workflow-controls/${encodeURIComponent(`control-task-${submitted.id}`)}/rounds`,
        ).then((response) => response.json()),
      );
    const failedRound = rounds.items[0];
    if (failedRound === undefined) throw new Error('REPLACEMENT_FAILED_ROUND_REQUIRED');
    await expect(runtime.getWorkflowInstance(failedRound.instanceId)).resolves.toMatchObject({
      status: 'failed',
      errors: { runtime: expect.objectContaining({ code: expect.any(String) }) },
    });
    await sendFollowUp(submitted.id, submitted.contextId, 'confirm_plan', 'Confirm replacement.');
    const completed = await waitForTaskState(submitted.id, TaskState.TASK_STATE_COMPLETED);
    expect(completed.artifacts[0]?.parts[1]?.content).toMatchObject({
      $case: 'data',
      value: { status: 'online' },
    });
  });

  it('pauses before the next real MCP node and resumes without replay', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.control.${randomUUID()}`;
    const planId = `plan.control.${randomUUID()}`;
    try {
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            serverId,
            name: 'Execution control MCP',
            endpoint: mockMcp.endpoint.toString(),
            credentialHeaders: {},
          }),
        }),
      ).toMatchObject({ status: 201 });
      const taskRequest = SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Run controlled execution.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      });
      let taskId = '';
      let contextId = '';
      for await (const event of runtime.a2a.client.sendMessageStream(taskRequest)) {
        if (event.payload?.$case === 'task') {
          taskId = event.payload.value.id;
          contextId = event.payload.value.contextId;
        }
      }
      const preparedTask = z
        .object({ goalId: z.string(), goalVersion: z.number().int().positive() })
        .parse(await (await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`)).json());
      const sourcePlanId = await attachPlannedTask(taskId);
      const sourcePlan = z
        .object({
          definition: z.object({ workflowDefinitionId: z.string(), version: z.number().int() }),
        })
        .parse(
          await (
            await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plans/${sourcePlanId}`)
          ).json(),
        );
      const revision = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${sourcePlanId}/revisions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            newPlanId: planId,
            format: 'dag',
            definition: {
              workflowDefinitionId: sourcePlan.definition.workflowDefinitionId,
              version: sourcePlan.definition.version + 1,
              goalId: preparedTask.goalId,
              goalVersion: preparedTask.goalVersion,
              entryNodeId: 'slow',
              exitNodeIds: ['result'],
              nodes: [
                {
                  nodeId: 'slow',
                  name: 'Current call',
                  type: 'mcp_tool',
                  tool: { serverId, toolName: 'device_status' },
                  arguments: { deviceId: 'first', delayMs: 300 },
                },
                {
                  nodeId: 'next',
                  name: 'Next call',
                  type: 'mcp_tool',
                  tool: { serverId, toolName: 'device_status' },
                  arguments: { deviceId: 'second' },
                },
                {
                  nodeId: 'result',
                  name: 'Result',
                  type: 'result',
                  value: { op: 'literal', value: 'controlled' },
                },
              ],
              edges: [
                { sourceNodeId: 'slow', targetNodeId: 'next' },
                { sourceNodeId: 'next', targetNodeId: 'result' },
              ],
            },
          }),
        },
      );
      expect(revision.status).toBe(201);
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/workflows/plans/${planId}/confirm`, {
          method: 'POST',
        }),
      ).toMatchObject({ status: 200 });
      const attached = await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}/plan`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planId,
          goalId: preparedTask.goalId,
          goalVersion: preparedTask.goalVersion,
        }),
      });
      const attachedBody = await attached.json();
      if (attached.status !== 200)
        throw new Error(`ATTACH_CONTROL_PLAN_FAILED:${JSON.stringify(attachedBody)}`);
      await sendFollowUp(taskId, contextId, 'confirm_plan', 'Confirm.');
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      const pausedTask = await sendFollowUp(taskId, contextId, 'pause', 'Pause.');
      expectTaskState(pausedTask, TaskState.TASK_STATE_INPUT_REQUIRED);
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(1);
      const resumedTask = await sendFollowUp(taskId, contextId, 'resume', 'Resume.');
      expectTaskState(resumedTask, TaskState.TASK_STATE_WORKING);
      await waitForTaskState(taskId, TaskState.TASK_STATE_COMPLETED);
      const afterCancel = await runtime.listMcpInvocations(serverId);
      expect(afterCancel).toHaveLength(2);
      expect(afterCancel.at(-1)).toMatchObject({ status: 'succeeded', toolName: 'device_status' });
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
          data: { structuredContent: { deviceId: 'device-runtime', status: 'online' } },
          errors: [],
          contextTruncated: false,
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
          data: {
            structuredContent: { deviceId: 'device-human-interrupt', status: 'online' },
          },
          errors: [],
          contextTruncated: false,
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

  it('invalidates old execution evidence after a Goal Patch and forces fresh plan confirmation', async () => {
    const submitted = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Inspect the device status.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const prepared = await fetch(
      `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(submitted.id)}`,
    ).then((response) => response.json() as Promise<{ goalId: string; goalVersion: number }>);
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.goal-patch.${randomUUID()}`;
    const workflowId = `workflow.goal-patch.${randomUUID()}`;
    const sourcePlanId = `plan.goal-patch.source.${randomUUID()}`;
    const instanceId = `instance.goal-patch.source.${randomUUID()}`;
    mcpWorkflowTarget = {
      serverId,
      workflowId,
      workflowVersion: 1,
      goalId: prepared.goalId,
    };
    try {
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            serverId,
            name: 'Goal Patch MCP',
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
            goalId: prepared.goalId,
            goalVersion: prepared.goalVersion,
            planningInstruction: 'EXECUTE_MCP_WORKFLOW',
          }),
        }),
      ).toMatchObject({ status: 201 });
      expect(
        await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${submitted.id}/plan`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            planId: sourcePlanId,
            goalId: prepared.goalId,
            goalVersion: prepared.goalVersion,
          }),
        }),
      ).toMatchObject({ status: 200 });
      expect(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}/confirm`,
          { method: 'POST' },
        ),
      ).toMatchObject({ status: 200 });
      const oldExecution = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId, input: {} }),
        },
      );
      expect(oldExecution.status).toBe(201);
      await expect(oldExecution.json()).resolves.toMatchObject({ status: 'succeeded' });
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(1);

      const patchedTaskResult = await sendFollowUp(
        submitted.id,
        submitted.contextId,
        'patch_goal',
        'Also return the temperature.',
      );
      expectTaskState(patchedTaskResult, TaskState.TASK_STATE_WORKING);
      const patches = z
        .object({ items: z.array(z.unknown()) })
        .parse(
          await (
            await fetch(
              `${runtime.management.baseUrl}/api/v1/goals/${encodeURIComponent(prepared.goalId)}/patches`,
            )
          ).json(),
        );
      const patch = z
        .object({
          patchId: z.string(),
          fromVersion: z.literal(1),
          toVersion: z.literal(2),
          newPlanId: z.string(),
          invalidatedPlanIds: z.array(z.string()),
          invalidatedInstanceIds: z.array(z.string()),
          compensationWarnings: z.array(z.string()),
        })
        .parse(patches.items.at(-1));
      expect(patch.invalidatedPlanIds).toContain(sourcePlanId);
      expect(patch.invalidatedInstanceIds).toContain(instanceId);
      expect(patch.compensationWarnings.join(' ')).toContain('no automatic compensation');
      await expect(
        fetch(
          `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(sourcePlanId)}`,
        ).then((response) => response.json()),
      ).resolves.toMatchObject({ confirmationStatus: 'invalidated' });
      const patchedTask = await fetch(
        `${runtime.management.baseUrl}/api/v1/tasks/${submitted.id}`,
      ).then((response) => response.json() as Promise<Record<string, unknown>>);
      expect(patchedTask).toMatchObject({ phase: 'planning', goalVersion: 2 });
      expect(patchedTask).not.toHaveProperty('planId');
      const blocked = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(patch.newPlanId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: `blocked.patch.${randomUUID()}`, input: {} }),
        },
      );
      expect(blocked.status).toBe(400);
      await expect(blocked.json()).resolves.toMatchObject({
        error: { code: 'WORKFLOW_PLAN_NOT_CONFIRMED' },
      });
      expect(
        await fetch(
          `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(patch.newPlanId)}/confirm`,
          { method: 'POST' },
        ),
      ).toMatchObject({ status: 200 });
      const newExecution = await fetch(
        `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(patch.newPlanId)}/execute`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ instanceId: `instance.patch.${randomUUID()}`, input: {} }),
        },
      );
      expect(newExecution.status).toBe(201);
      await expect(newExecution.json()).resolves.toMatchObject({
        status: 'succeeded',
        result: 'goal-patch-replanned',
      });
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(1);
    } finally {
      mcpWorkflowTarget = undefined;
      await mockMcp.close();
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
          { roundIndex: 0, workflowVersion: 1, evaluation: { decision: 'adjust_plan' } },
          { roundIndex: 1, workflowVersion: 2, evaluation: { decision: 'achieved' } },
        ],
      });
      const storedGoal = await fetch(
        `${runtime.management.baseUrl}/api/v1/goals/${encodeURIComponent(goalId)}`,
      );
      await expect(storedGoal.json()).resolves.toMatchObject({ status: 'achieved' });
      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(2);
      expect(controlEvaluationCalls).toBe(2);
      const successorTask = await runtime.a2a.client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: `message-${randomUUID()}`,
            contextId: submitted.contextId,
            role: 'ROLE_USER',
            parts: [{ text: 'Summarize the completed observations.', mediaType: 'text/plain' }],
          },
          configuration: { returnImmediately: false },
        }),
      );
      if (!('id' in successorTask)) throw new Error('A2A_EXPECTED_TASK_RESULT');
      const successor = z
        .object({ goalId: z.string() })
        .parse(
          await (
            await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${successorTask.id}`)
          ).json(),
        );
      expect(successor.goalId).not.toBe(goalId);
      await expect(
        fetch(`${runtime.management.baseUrl}/api/v1/contexts/${submitted.contextId}/goals`).then(
          (response) => response.json(),
        ),
      ).resolves.toMatchObject({
        goals: [
          expect.objectContaining({ goalId, status: 'achieved' }),
          expect.objectContaining({ goalId: successor.goalId, previousGoalId: goalId }),
        ],
        transitions: [
          expect.objectContaining({
            fromGoalId: goalId,
            toGoalId: successor.goalId,
            relationship: 'related_successor',
          }),
        ],
      });
    } finally {
      mcpWorkflowTarget = undefined;
      await mockMcp.close();
    }
  });

  it('projects a Goal-evaluation capability gap onto the persisted A2A Task', async () => {
    const submitted = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Create a capability gap control task.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    await attachPlannedTask(submitted.id);
    await sendFollowUp(submitted.id, submitted.contextId, 'confirm_plan', 'Confirm.');
    const controlId = `control-task-${submitted.id}`;
    const projected = await waitForTaskState(submitted.id, TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(projected.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(projected.status?.message?.parts[0]?.content).toMatchObject({
      value: 'Required capability is unavailable: Read device pressure.',
    });
    expect(projected.metadata).toMatchObject({
      internalPhase: 'capability_gap',
      capabilityGap: {
        evaluationSummary: 'No registered MCP tool can read device pressure.',
        missingCapability: 'Read device pressure.',
        suggestedToolContract: {
          name: 'read_pressure',
          description: 'Read pressure for one device.',
          inputSchema: { type: 'object', required: ['deviceId'] },
        },
      },
    });
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/workflow-controls/${encodeURIComponent(controlId)}/rounds`,
      ).then((rounds) => rounds.json()),
    ).resolves.toMatchObject({
      items: [
        {
          evaluation: {
            decision: 'capability_gap',
            missingCapability: 'Read device pressure.',
          },
        },
      ],
    });
  });

  it('stores source-linked memory and retrieves it globally across user identities', async () => {
    const source = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Record a source task for device 17.', mediaType: 'text/plain' }],
          metadata: { user_id: 'memory-user-a' },
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in source)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const other = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Start an unrelated task.', mediaType: 'text/plain' }],
          metadata: { user_id: 'memory-user-b' },
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in other)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const memoryId = `memory.global.${randomUUID()}`;
    const created = await fetch(`${runtime.management.baseUrl}/api/v1/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        memoryId,
        type: 'fact',
        content: { deviceId: 'device-17', sourceUserId: 'memory-user-a' },
        summary: 'The target device is device-17.',
        sourceRefs: [source.id],
        confidence: 0.95,
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      memoryId,
      status: 'active',
      sourceRefs: [source.id],
    });
    const search = await fetch(
      `${runtime.management.baseUrl}/api/v1/memories/search?q=${encodeURIComponent('target device')}&limit=5`,
    );
    expect(search.status).toBe(200);
    const hits = z
      .object({
        items: z.array(
          z.object({
            item: z.object({
              memoryId: z.string(),
              content: z.record(z.string(), z.unknown()),
              sourceRefs: z.array(z.string()),
            }),
            score: z.number(),
          }),
        ),
      })
      .parse(await search.json()).items;
    expect(hits.find((hit) => hit.item.memoryId === memoryId)).toMatchObject({
      item: { memoryId, content: { deviceId: 'device-17' }, sourceRefs: [source.id] },
      score: 1,
    });
  });

  it('infers missing Goal input from global memory before asking an explicit question', async () => {
    const source = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Provide evidence for remembered device 17.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in source)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const memoryId = `memory.inference.${randomUUID()}`;
    expect(
      (
        await fetch(`${runtime.management.baseUrl}/api/v1/memories`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            memoryId,
            type: 'fact',
            content: { deviceId: 'device-17' },
            summary: 'The remembered target is device-17.',
            sourceRefs: [source.id],
            confidence: 0.98,
          }),
        })
      ).status,
    ).toBe(201);

    const inferred = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Inspect the remembered target.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in inferred)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(inferred.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(inferred.status?.message?.parts[0]?.content).toMatchObject({
      value: 'Plan confirmation required.',
    });
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(inferred.id)}/input-inferences`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({
      items: [
        {
          outcome: 'inferred',
          inferredGoal: { description: 'Inspect device-17 using the remembered target.' },
          usedSources: [{ sourceId: `memory:${memoryId}`, kind: 'global_memory' }],
        },
      ],
    });

    const unresolved = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Inspect the unknown target.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in unresolved)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(unresolved.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    expect(unresolved.status?.message?.parts[0]?.content).toMatchObject({
      value: 'Which device should be inspected?',
    });
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
      const policyUpdate = await fetch(
        `${runtime.management.baseUrl}/api/v1/system/evolution-policy`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ successThreshold: 3 }),
        },
      );
      expect(policyUpdate.status).toBe(200);
      const existingSkillId = `skill.existing.${serverId}`;
      await runtime.registerSkill({
        ...skillInput(existingSkillId, 'Existing device status capability'),
        toolPolicy: {
          required: [{ serverId, toolName: 'device_status' }],
          optional: [],
          forbidden: [],
        },
      });
      const executeHistory = async (marker: string) => {
        const submitted = await runtime.a2a.client.sendMessage(
          SendMessageRequest.fromJSON({
            message: {
              messageId: `message-${randomUUID()}`,
              role: 'ROLE_USER',
              parts: [
                {
                  text: `${marker} GLOBAL_SHARED_SKILL:${existingSkillId}`,
                  mediaType: 'text/plain',
                },
              ],
            },
            configuration: { returnImmediately: false },
          }),
        );
        if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
        expect(submitted.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
        await sendFollowUp(submitted.id, submitted.contextId, 'confirm_plan', 'Confirm history.');
        await waitForTaskState(submitted.id, TaskState.TASK_STATE_COMPLETED);
      };
      await executeHistory('HISTORICAL_REPLAY_SUCCESS');
      await executeHistory('HISTORICAL_REPLAY_FAILURE');
      const formalSkillsBefore = await readFormalSkillIds();
      const createAndComplete = async (taskId: string, forceSimulationFailure = false) => {
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
              inputSchema: {
                type: 'object',
                properties: {
                  deviceId: { type: 'string' },
                  ...(forceSimulationFailure
                    ? { forceSimulationFailure: { type: 'boolean' } }
                    : {}),
                },
                required: ['deviceId'],
              },
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
            skill: z.object({
              status: z.literal('expired'),
              capabilityFingerprint: z.string(),
            }),
            experience: z.object({ successful: z.literal(true) }),
            formalizationCandidate: z
              .object({
                candidateId: z.string(),
                status: z.enum(['awaiting_simulation', 'validation_failed', 'published']),
                successfulExperienceCount: z.number(),
                publishedSkillId: z.string().optional(),
                inductionReport: z
                  .object({
                    consistent: z.boolean(),
                    stable: z.boolean(),
                    generalizable: z.boolean(),
                    duplicateScore: z.number(),
                    evolutionKind: z.enum(['new_skill', 'new_version']),
                    targetSkillId: z.string(),
                    boundaryDecisionSummary: z.string(),
                    decisionSummary: z.string(),
                  })
                  .optional(),
                validationReport: z
                  .object({
                    allPassed: z.boolean(),
                    cases: z.array(z.object({ kind: z.string(), passed: z.boolean() })),
                  })
                  .optional(),
                proposedSkill: z
                  .object({
                    skillId: z.string(),
                    name: z.string(),
                    summary: z.string(),
                    description: z.string(),
                    capabilities: z.array(z.string()),
                    workflowGuidance: z.string(),
                    outputInstruction: z.string(),
                    inputSchema: z.unknown(),
                    outputSchema: z.unknown(),
                    tools: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
                  })
                  .optional(),
              })
              .optional(),
          })
          .parse(await completedResponse.json());
      };

      const first = await createAndComplete(`task-temp-${randomUUID()}`);
      expect(first.formalizationCandidate).toBeUndefined();
      expect(await readFormalSkillIds()).toEqual(formalSkillsBefore);
      const second = await createAndComplete(`task-temp-${randomUUID()}`);
      expect(second.formalizationCandidate).toBeUndefined();
      expect(await readFormalSkillIds()).toEqual(formalSkillsBefore);
      const third = await createAndComplete(`task-temp-${randomUUID()}`);
      expect(third.formalizationCandidate).toMatchObject({
        status: 'published',
        successfulExperienceCount: 3,
        publishedSkillId: existingSkillId,
        inductionReport: {
          consistent: true,
          stable: true,
          generalizable: true,
          duplicateScore: 0.95,
          evolutionKind: 'new_version',
          targetSkillId: existingSkillId,
        },
        validationReport: { allPassed: true },
      });
      expect(
        third.formalizationCandidate?.validationReport?.cases.map((item) => item.kind),
      ).toEqual([
        'static_validation',
        'source_experience',
        'source_experience',
        'source_experience',
        'historical_replay',
        'historical_replay',
        'normal',
        'boundary',
        'exception',
      ]);
      const triggers = z
        .object({
          items: z.array(
            z.object({
              successfulExperienceCount: z.number(),
              configuredThreshold: z.number(),
              decision: z.string(),
            }),
          ),
        })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/evolution-triggers?capabilityFingerprint=${encodeURIComponent(third.skill.capabilityFingerprint)}`,
          ).then((response) => response.json()),
        );
      expect(triggers.items).toMatchObject([
        { successfulExperienceCount: 1, configuredThreshold: 3, decision: 'below_threshold' },
        { successfulExperienceCount: 2, configuredThreshold: 3, decision: 'below_threshold' },
        { successfulExperienceCount: 3, configuredThreshold: 3, decision: 'candidate_created' },
      ]);
      const formalSkillsAfter = await readFormalSkillIds();
      expect(formalSkillsAfter).toEqual(formalSkillsBefore);
      const versions = z
        .object({ items: z.array(z.object({ skillId: z.string(), version: z.number() })) })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(existingSkillId)}/versions`,
          ).then((response) => response.json()),
        );
      expect(versions.items.map((item) => item.version).sort()).toEqual([1, 2]);
      expect((await readAgentCard()).skills.map((skill) => skill.id)).toContain(existingSkillId);
      const failedFirst = await createAndComplete(`task-temp-failed-${randomUUID()}`, true);
      expect(failedFirst.formalizationCandidate).toBeUndefined();
      const failedSecond = await createAndComplete(`task-temp-failed-${randomUUID()}`, true);
      expect(failedSecond.formalizationCandidate).toBeUndefined();
      const failedThird = await createAndComplete(`task-temp-failed-${randomUUID()}`, true);
      expect(failedThird.formalizationCandidate).toMatchObject({
        status: 'validation_failed',
        successfulExperienceCount: 3,
        validationReport: { allPassed: false },
      });
      expect(failedThird.formalizationCandidate?.publishedSkillId).toBeUndefined();
      expect(failedThird.formalizationCandidate?.validationReport?.cases).toContainEqual(
        expect.objectContaining({ kind: 'normal', passed: false }),
      );
      const versionsAfterFailure = z
        .object({ items: z.array(z.object({ skillId: z.string(), version: z.number() })) })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(existingSkillId)}/versions`,
          ).then((response) => response.json()),
        );
      expect(versionsAfterFailure.items.map((item) => item.version).sort()).toEqual([1, 2]);
      const failedProposedSkill = failedThird.formalizationCandidate?.proposedSkill;
      if (failedProposedSkill === undefined) throw new Error('FAILED_DRAFT_SKILL_MISSING');
      const correctedSkill = {
        ...failedProposedSkill,
        inputSchema: {
          type: 'object',
          properties: {
            deviceId: { type: 'string' },
            forceSimulationFailure: { type: 'boolean' },
          },
          required: ['deviceId', 'forceSimulationFailure'],
        },
      };
      const correctedResponse = await fetch(
        `${runtime.management.baseUrl}/api/v1/skill-formalization-candidates/${encodeURIComponent(failedThird.formalizationCandidate?.candidateId ?? '')}/corrections`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            actor: 'operator@example.test',
            summary: 'Require the boundary discriminator before calling the Tool.',
            proposedSkill: correctedSkill,
          }),
        },
      );
      expect(correctedResponse.status).toBe(200);
      const corrected = z
        .object({
          candidate: z.object({
            status: z.literal('published'),
            publishedSkillId: z.literal(existingSkillId),
            publishedSkillVersion: z.literal(3),
            validationReport: z.object({ allPassed: z.literal(true) }),
          }),
          correction: z.object({
            correctionId: z.string(),
            actor: z.literal('operator@example.test'),
            summary: z.string(),
            diff: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() })),
            outcome: z.literal('published'),
            validationReport: z.object({ allPassed: z.literal(true) }),
          }),
        })
        .parse(await correctedResponse.json());
      expect(corrected.correction.diff).toContainEqual(
        expect.objectContaining({ path: '/inputSchema/required' }),
      );
      const correctionHistory = z
        .object({
          items: z.array(
            z.object({
              correctionId: z.string(),
              actor: z.string(),
              outcome: z.string(),
              diff: z.array(z.object({ path: z.string() })),
            }),
          ),
        })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/skill-formalization-candidates/${encodeURIComponent(failedThird.formalizationCandidate?.candidateId ?? '')}/corrections`,
          ).then((response) => response.json()),
        );
      expect(correctionHistory.items).toMatchObject([
        {
          correctionId: corrected.correction.correctionId,
          actor: 'operator@example.test',
          outcome: 'published',
        },
      ]);
      const versionsAfterCorrection = z
        .object({ items: z.array(z.object({ version: z.number() })) })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(existingSkillId)}/versions`,
          ).then((response) => response.json()),
        );
      expect(versionsAfterCorrection.items.map((item) => item.version).sort()).toEqual([1, 2, 3]);
      const disabled = await fetch(
        `${runtime.management.baseUrl}/api/v1/skills/${encodeURIComponent(existingSkillId)}/disable`,
        { method: 'POST' },
      );
      expect(disabled.status).toBe(200);
    } finally {
      await fetch(`${runtime.management.baseUrl}/api/v1/system/evolution-policy`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ successThreshold: 2 }),
      });
      await mockMcp.close();
    }
  });

  it('resolves a capability gap into a confirmed task-scoped Temporary Skill execution', async () => {
    const mockMcp = await startMcpLoopbackServer();
    const serverId = `mcp.temporary.execution.${randomUUID()}`;
    try {
      const registration = await fetch(`${runtime.management.baseUrl}/api/v1/mcp/servers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serverId,
          name: 'Temporary execution MCP',
          endpoint: mockMcp.endpoint.toString(),
          credentialHeaders: {},
        }),
      });
      expect(registration.status).toBe(201);
      const formalSkillsBefore = await readFormalSkillIds();
      const cardBefore = (await readAgentCard()).skills.map((skill) => skill.id);

      const submitted = await runtime.a2a.client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: `message-${randomUUID()}`,
            role: 'ROLE_USER',
            parts: [
              {
                text: `Read the device with TEMPORARY_TOOL:${serverId}/device_status`,
                mediaType: 'text/plain',
              },
            ],
          },
          configuration: { returnImmediately: false },
        }),
      );
      if (!('id' in submitted)) throw new Error('A2A_EXPECTED_TASK_RESULT');
      expect(submitted.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
      const storedBefore = z
        .object({
          temporarySkillId: z.string(),
          selectedSkillId: z.string().optional(),
          phase: z.literal('awaiting_plan_confirmation'),
        })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(submitted.id)}`,
          ).then((response) => response.json()),
        );
      expect(storedBefore.selectedSkillId).toBeUndefined();
      await expect(runtime.listMcpInvocations(serverId)).resolves.toEqual([]);
      expect((await readAgentCard()).skills.map((skill) => skill.id)).toEqual(cardBefore);

      await sendFollowUp(
        submitted.id,
        submitted.contextId,
        'confirm_plan',
        'Confirm the task-scoped plan.',
      );
      await waitForTaskState(submitted.id, TaskState.TASK_STATE_COMPLETED);

      expect(await runtime.listMcpInvocations(serverId)).toHaveLength(1);
      const completedTask = z
        .object({ goalId: z.string() })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(submitted.id)}`,
          ).then((response) => response.json()),
        );
      const evolutionEvidence = z
        .object({
          items: z.array(
            z.object({
              taskId: z.string(),
              goal: z.object({ goalId: z.string(), successCriteria: z.array(z.string()) }),
              workflow: z.object({ nodes: z.array(z.unknown()) }),
              tools: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
              result: z.unknown(),
              evaluation: z.object({ decision: z.string(), summary: z.string() }),
              successful: z.boolean(),
            }),
          ),
        })
        .parse(
          await fetch(
            `${runtime.management.baseUrl}/api/v1/goals/${encodeURIComponent(completedTask.goalId)}/evolution-experiences`,
          ).then((response) => response.json()),
        );
      expect(evolutionEvidence.items).toContainEqual(
        expect.objectContaining({
          taskId: submitted.id,
          goal: expect.objectContaining({ goalId: completedTask.goalId }),
          tools: [{ serverId, toolName: 'device_status' }],
          evaluation: expect.objectContaining({ decision: 'achieved' }),
          successful: true,
        }),
      );
      const temporarySkills = await waitForTemporarySkillStatus(submitted.id, 'expired');
      expect(temporarySkills.items).toContainEqual(
        expect.objectContaining({
          temporarySkillId: storedBefore.temporarySkillId,
          taskId: submitted.id,
          status: 'expired',
        }),
      );
      expect(await readFormalSkillIds()).toEqual(formalSkillsBefore);
      expect((await readAgentCard()).skills.map((skill) => skill.id)).toEqual(cardBefore);
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
    await runtime.requestInput(taskId, 'Provide the target device identifier.');
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

  it('automatically cancels a confirmation wait using the managed unified timeout', async () => {
    const policyUrl = `${runtime.management.baseUrl}/api/v1/system/task-wait-policy`;
    try {
      expect(
        await fetch(policyUrl, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ timeoutSeconds: 1 }),
        }),
      ).toMatchObject({ status: 200 });
      const request = SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Prepare a timeout test plan.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      });
      let taskId = '';
      for await (const event of runtime.a2a.client.sendMessageStream(request)) {
        if (event.payload?.$case === 'task') taskId = event.payload.value.id;
      }
      expect(taskId).not.toBe('');
      let task = await runtime.a2a.client.getTask({ tenant: '', id: taskId });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (task.status?.state === TaskState.TASK_STATE_CANCELED) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
        task = await runtime.a2a.client.getTask({ tenant: '', id: taskId });
      }
      expect(task.status?.state).toBe(TaskState.TASK_STATE_CANCELED);
      await expect(
        fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`).then((response) =>
          response.json(),
        ),
      ).resolves.toMatchObject({
        phase: 'canceled',
        errorCode: 'TASK_WAIT_TIMEOUT',
        phaseMessage: 'Task canceled after the unified wait timeout.',
      });
    } finally {
      await fetch(policyUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeoutSeconds: 300 }),
      });
    }
  });

  it('uses one authoritative Task path for management confirm, reject, and plan revision', async () => {
    const createPlanned = async () => {
      const result = await runtime.a2a.client.sendMessage(
        SendMessageRequest.fromJSON({
          message: {
            messageId: `message-${randomUUID()}`,
            role: 'ROLE_USER',
            parts: [{ text: 'Prepare a managed action plan.', mediaType: 'text/plain' }],
          },
          configuration: { returnImmediately: false },
        }),
      );
      if (!('id' in result)) throw new Error('A2A_EXPECTED_TASK_RESULT');
      const planId = await attachPlannedTask(result.id);
      return { task: result, planId };
    };
    const action = (taskId: string, body: unknown) =>
      fetch(`${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const confirmed = await createPlanned();
    const confirmResponse = await action(confirmed.task.id, {
      action: 'confirm_plan',
      messageText: 'Confirm from management.',
    });
    expect(confirmResponse.status).toBe(200);
    await expect(confirmResponse.json()).resolves.toMatchObject({ phase: 'executing' });
    await expect(
      runtime.a2a.client.getTask({ tenant: '', id: confirmed.task.id }),
    ).resolves.toMatchObject({ status: { state: TaskState.TASK_STATE_WORKING } });

    const rejected = await createPlanned();
    const rejectResponse = await action(rejected.task.id, {
      action: 'reject_plan',
      messageText: 'Reject from management.',
    });
    expect(rejectResponse.status).toBe(200);
    await expect(rejectResponse.json()).resolves.toMatchObject({ phase: 'canceled' });
    await expect(
      runtime.a2a.client.getTask({ tenant: '', id: rejected.task.id }),
    ).resolves.toMatchObject({ status: { state: TaskState.TASK_STATE_CANCELED } });

    const revised = await createPlanned();
    const reviseResponse = await action(revised.task.id, {
      action: 'revise_plan',
      messageText: 'Add a management safety check.',
    });
    expect(reviseResponse.status).toBe(200);
    await expect(reviseResponse.json()).resolves.toMatchObject({
      phase: 'awaiting_plan_confirmation',
      planId: expect.not.stringMatching(revised.planId),
    });
    await expect(
      runtime.a2a.client.getTask({ tenant: '', id: revised.task.id }),
    ).resolves.toMatchObject({
      status: { state: TaskState.TASK_STATE_INPUT_REQUIRED },
    });
  });

  it('reuses one active Goal across multiple A2A Tasks in the same context', async () => {
    const first = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Begin a multi-step inspection.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in first)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const second = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          contextId: first.contextId,
          role: 'ROLE_USER',
          parts: [{ text: 'Continue with the next device.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in second)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const readGoal = (taskId: string) =>
      fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`).then(
        (response) => response.json() as Promise<{ goalId: string; goalVersion: number }>,
      );
    const [firstTask, secondTask] = await Promise.all([readGoal(first.id), readGoal(second.id)]);
    expect(secondTask).toMatchObject({
      goalId: firstTask.goalId,
      goalVersion: firstTask.goalVersion,
    });
    await expect(
      fetch(`${runtime.management.baseUrl}/api/v1/contexts/${first.contextId}/goals`).then(
        (response) => response.json(),
      ),
    ).resolves.toMatchObject({
      goals: [expect.objectContaining({ goalId: firstTask.goalId, status: 'active' })],
      transitions: [],
    });
  });

  it('cancels an active Goal and every Task that shares it through A2A', async () => {
    const first = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Begin cancelable work.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in first)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const second = await runtime.a2a.client.sendMessage(
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          contextId: first.contextId,
          role: 'ROLE_USER',
          parts: [{ text: 'Continue cancelable work.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately: false },
      }),
    );
    if (!('id' in second)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    const firstTask = z
      .object({ goalId: z.string() })
      .parse(await (await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${first.id}`)).json());
    const canceled = await sendFollowUp(
      first.id,
      first.contextId,
      'cancel_goal',
      'Cancel the entire Goal.',
    );
    expectTaskState(canceled, TaskState.TASK_STATE_CANCELED);
    await expect(runtime.a2a.client.getTask({ tenant: '', id: second.id })).resolves.toMatchObject({
      status: { state: TaskState.TASK_STATE_CANCELED },
    });
    await expect(
      fetch(`${runtime.management.baseUrl}/api/v1/goals/${firstTask.goalId}`).then((response) =>
        response.json(),
      ),
    ).resolves.toMatchObject({ status: 'canceled' });
    await expect(
      fetch(`${runtime.management.baseUrl}/api/v1/goals/${firstTask.goalId}/cancellations`).then(
        (response) => response.json(),
      ),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          reason: 'Cancel the entire Goal.',
          canceledTaskIds: expect.arrayContaining([first.id, second.id]),
        }),
      ],
    });
  });

  it('stores create/update Skill requests as drafts without exposing them in Agent Card', async () => {
    const skillId = `skill.enabled.${randomUUID()}`;
    await runtime.registerSkill(skillInput(skillId, 'Enabled skill'));
    const draftedSkillId = `skill.a2a.draft.${randomUUID()}`;
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
    const cardBeforePublication = (await readAgentCard()).skills.map((skill) => skill.id);
    expect(cardBeforePublication).toContain(skillId);
    expect(cardBeforePublication).not.toContain(draftedSkillId);
    const draftId = `draft-${result.id}`;
    await expect(
      fetch(
        `${runtime.management.baseUrl}/api/v1/skill-drafts/${encodeURIComponent(draftId)}`,
      ).then((response) => response.json()),
    ).resolves.toMatchObject({ draftId, status: 'draft', requestedBy: 'anonymous' });
    const directBypass = await fetch(`${runtime.management.baseUrl}/api/v1/skills/author`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillId: draftedSkillId,
        naturalLanguageDescription: 'Attempt to bypass the persisted A2A draft publication path.',
        toolPolicy: { required: [], optional: [], forbidden: [] },
        runtimePolicy: { autoConfirmPlan: false },
        status: 'enabled',
        sourceKind: 'a2a_draft',
      }),
    });
    expect(directBypass.status).toBe(400);
    await expect(directBypass.json()).resolves.toMatchObject({
      error: { code: 'SKILL_A2A_DRAFT_MANAGEMENT_PUBLICATION_REQUIRED' },
    });
    expect((await readAgentCard()).skills.map((skill) => skill.id)).not.toContain(draftedSkillId);
    const publication = await fetch(
      `${runtime.management.baseUrl}/api/v1/skill-drafts/${encodeURIComponent(draftId)}/publish`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          actor: 'operator@example.test',
          skillId: draftedSkillId,
          toolPolicy: { required: [], optional: [], forbidden: [] },
          runtimePolicy: { autoConfirmPlan: false },
          status: 'enabled',
        }),
      },
    );
    expect(publication.status).toBe(200);
    await expect(publication.json()).resolves.toMatchObject({
      draft: {
        draftId,
        status: 'published',
        publishedBy: 'operator@example.test',
        publishedSkillId: draftedSkillId,
        publishedSkillVersion: 1,
      },
      skill: {
        skillId: draftedSkillId,
        version: 1,
        status: 'enabled',
        sourceKind: 'a2a_draft',
        validationPassed: true,
      },
    });
    expect((await readAgentCard()).skills.map((skill) => skill.id)).toContain(draftedSkillId);
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
    const completed = await waitForTaskState(submitted.id, TaskState.TASK_STATE_COMPLETED);
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
    await expect(
      fetch(`${runtime.management.baseUrl}/api/v1/tasks/${submitted.id}/processed-results`).then(
        (response) => response.json(),
      ),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          output: { text: 'Device is online.', structured: { status: 'online' } },
          facts: [expect.objectContaining({ name: 'status', value: 'online' })],
          valuable: true,
          memoryCandidates: [expect.objectContaining({ kind: 'fact' })],
        }),
      ],
    });
  });

  it('auto-confirms an opted-in Skill and returns equivalent synchronous and asynchronous results', async () => {
    const skillId = `skill.auto-task.${randomUUID()}`;
    await runtime.registerSkill({
      ...skillInput(skillId, 'Zebra Auto Task'),
      runtimePolicy: { autoConfirmPlan: true },
    });
    const request = (returnImmediately: boolean) =>
      SendMessageRequest.fromJSON({
        message: {
          messageId: `message-${randomUUID()}`,
          role: 'ROLE_USER',
          parts: [{ text: 'Run the zebra auto task.', mediaType: 'text/plain' }],
        },
        configuration: { returnImmediately },
      });

    const synchronous = await runtime.a2a.client.sendMessage(request(false));
    if (!('id' in synchronous)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(synchronous.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const synchronousData = synchronous.artifacts[0]?.parts[1]?.content;
    expect(synchronousData).toMatchObject({ $case: 'data', value: { status: 'online' } });

    const asynchronous = await runtime.a2a.client.sendMessage(request(true));
    if (!('id' in asynchronous)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(asynchronous.id).not.toBe(synchronous.id);
    const completed = await waitForTaskState(asynchronous.id, TaskState.TASK_STATE_COMPLETED);
    expect(completed.artifacts[0]?.parts[1]?.content).toEqual(synchronousData);

    for (const taskId of [synchronous.id, asynchronous.id]) {
      const task = z
        .object({ planId: z.string(), selectedSkillId: z.string() })
        .parse(
          await fetch(`${runtime.management.baseUrl}/api/v1/tasks/${taskId}`).then((response) =>
            response.json(),
          ),
        );
      expect(task.selectedSkillId).toBe(skillId);
      await expect(
        fetch(
          `${runtime.management.baseUrl}/api/v1/workflows/plans/${encodeURIComponent(task.planId)}`,
        ).then((response) => response.json()),
      ).resolves.toMatchObject({ confirmationStatus: 'confirmed' });
    }
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
        const goalInputInferenceRequest = body.messages?.some(
          (message) => message.content?.includes('infer_missing_goal_input') === true,
        );
        const goalContinuityRequest = body.messages?.some(
          (message) => message.content?.includes('decide_goal_continuity') === true,
        );
        const resultProcessingRequest = body.messages?.some(
          (message) => message.content?.includes('process_workflow_result') === true,
        );
        const goalPatchDecisionRequest = body.messages?.some(
          (message) => message.content?.includes('generate_goal_patch') === true,
        );
        const goalPatchReplanRequest = body.messages?.some(
          (message) => message.content?.includes('goal_patch_replan') === true,
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
        const skillCallWorkflowRequest = body.messages?.some(
          (message) => message.content?.includes('SKILL_CALL_PLAN') === true,
        );
        const skillChildExecutionRequest = body.messages?.some(
          (message) => message.content?.includes('SKILL_CHILD_EXECUTION') === true,
        );
        const primarySkillFailureRequest = body.messages?.some(
          (message) => message.content?.includes('FAIL_PRIMARY_SKILL_EXECUTION') === true,
        );
        const initialTaskPlanRequest = body.messages?.some(
          (message) => message.content?.includes('task_initial_plan') === true,
        );
        const temporarySkillResolutionRequest = body.messages?.some(
          (message) => message.content?.includes('resolve_temporary_skill') === true,
        );
        const skillInductionRequest = body.messages?.some(
          (message) => message.content?.includes('induce_skill_from_experience') === true,
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
        const workflowControlReplanRequest = body.messages?.some(
          (message) =>
            message.content?.includes('workflow_control_replan') === true &&
            message.content.includes('replacementSkill'),
        );
        const controlEvaluationRequest =
          body.messages?.some((message) => message.content?.includes('CONTROL_GOAL') === true) ===
          true;
        const capabilityGapEvaluationRequest =
          body.messages?.some(
            (message) => message.content?.includes('CAPABILITY_GAP_GOAL') === true,
          ) === true;
        const autoTaskEvaluationRequest =
          body.messages?.some((message) => message.content?.includes('AUTO_TASK_GOAL') === true) ===
          true;
        const replacementEvaluationRequest = body.messages?.some(
          (message) => message.content?.includes('REPLACE_SKILL_GOAL') === true,
        );
        const genericTaskEvaluationRequest =
          body.messages?.some(
            (message) => message.content?.includes('"workflow":{"instanceId"') === true,
          ) === true;
        if (primarySkillFailureRequest === true) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'Primary Skill execution failed.' }));
          return;
        }
        if (intentDecisionRequest === true) {
          respondStructured(response, {
            intent: 'execute',
            summary: 'The request requires task execution.',
          });
          return;
        }
        if (resultProcessingRequest === true) {
          respondStructured(response, {
            text: 'Device is online.',
            structured: { status: 'online' },
            keyFacts: [{ name: 'status', value: 'online', confidence: 1 }],
            valueAssessment: { valuable: true, summary: 'Current device state is useful.' },
            memoryCandidates: [
              { kind: 'fact', content: 'The device was online.', confidence: 0.9 },
            ],
          });
          return;
        }
        if (skillChildExecutionRequest === true) {
          respondStructured(response, { status: 'online' });
          return;
        }
        if (goalInputInferenceRequest === true) {
          const requestData = z
            .object({
              requestText: z.string(),
              evidence: z.array(
                z.object({ sourceId: z.string(), kind: z.string(), summary: z.string() }),
              ),
            })
            .parse(embeddedOperation(body.messages, 'infer_missing_goal_input'));
          if (requestData.requestText.includes('unknown target')) {
            respondStructured(response, {
              outcome: 'input_required',
              decisionSummary: 'Available evidence does not identify the requested target.',
              usedSourceIds: [],
              clarificationQuestion: 'Which device should be inspected?',
            });
            return;
          }
          const memory = requestData.evidence.find((item) => item.kind === 'global_memory');
          if (memory === undefined) throw new Error('INFERENCE_MEMORY_EVIDENCE_REQUIRED');
          respondStructured(response, {
            outcome: 'inferred',
            decisionSummary: 'The high-confidence global memory identifies device-17.',
            usedSourceIds: [memory.sourceId],
            inferredGoal: {
              title: 'Inspect remembered target',
              description: 'Inspect device-17 using the remembered target.',
              constraints: [],
              successCriteria: ['Device inspection returned'],
            },
          });
          return;
        }
        if (goalDecisionRequest === true) {
          const requestData = z
            .object({ requestText: z.string() })
            .parse(embeddedOperation(body.messages, 'formulate_goal'));
          const controlGoal = requestData.requestText.includes('control loop');
          const capabilityGapGoal = requestData.requestText.includes('capability gap control');
          const autoTaskGoal = requestData.requestText.includes('zebra auto task');
          const replaceSkillGoal = requestData.requestText.includes('replace failed skill');
          const historicalReplaySuccess = requestData.requestText.includes(
            'HISTORICAL_REPLAY_SUCCESS',
          );
          const historicalReplayFailure = requestData.requestText.includes(
            'HISTORICAL_REPLAY_FAILURE',
          );
          const templateReuse = requestData.requestText.includes('TEMPLATE_REUSE');
          const temporaryTool = /TEMPORARY_TOOL:([^/\s]+)\/([^\s]+)/.exec(requestData.requestText);
          const temporaryServerId = temporaryTool?.[1] ?? '';
          const temporaryToolName = temporaryTool?.[2] ?? '';
          const sharedSkill = /GLOBAL_SHARED_SKILL:([A-Za-z0-9._-]+)/.exec(
            requestData.requestText,
          )?.[1];
          const requiresInput =
            requestData.requestText.includes('remembered target') ||
            requestData.requestText.includes('unknown target');
          respondStructured(response, {
            title:
              controlGoal || capabilityGapGoal || autoTaskGoal
                ? 'Control Goal'
                : 'Execute the requested task',
            description: autoTaskGoal
              ? 'AUTO_TASK_GOAL zebra return device status.'
              : replaceSkillGoal
                ? `REPLACE_SKILL_GOAL GLOBAL_SHARED_SKILL:${sharedSkill ?? 'missing'}`
                : sharedSkill !== undefined
                  ? `${historicalReplaySuccess ? 'HISTORICAL_REPLAY_SUCCESS ' : historicalReplayFailure ? 'HISTORICAL_REPLAY_FAILURE ' : templateReuse ? 'TEMPLATE_REUSE ' : ''}GLOBAL_SHARED_SKILL:${sharedSkill}`
                  : capabilityGapGoal
                    ? 'CAPABILITY_GAP_GOAL requires device pressure.'
                    : controlGoal
                      ? 'CONTROL_GOAL collect two observations.'
                      : temporaryTool !== null
                        ? `TEMPORARY_SKILL_GOAL:${temporaryServerId}/${temporaryToolName}`
                        : 'Complete the user request using an enabled Skill.',
            constraints: [],
            successCriteria: [
              controlGoal || capabilityGapGoal || autoTaskGoal
                ? 'Two Workflow rounds are evaluated.'
                : 'A validated result is returned.',
            ],
            requiresInput,
            ...(requiresInput ? { clarificationQuestion: 'The target is missing.' } : {}),
          });
          return;
        }
        if (temporarySkillResolutionRequest === true) {
          const requestData = z
            .object({
              goalDescription: z.string(),
              tools: z.array(
                z.object({ serverId: z.string(), toolName: z.string(), description: z.string() }),
              ),
            })
            .parse(embeddedOperation(body.messages, 'resolve_temporary_skill'));
          const requested = /TEMPORARY_SKILL_GOAL:([^/\s]+)\/([^\s]+)/.exec(
            requestData.goalDescription,
          );
          if (requested === null) throw new Error('TEMPORARY_TOOL_MARKER_MISSING');
          const requestedServerId = requested[1] ?? '';
          const requestedToolName = requested[2] ?? '';
          const selected = requestData.tools.find(
            (tool) => tool.serverId === requestedServerId && tool.toolName === requestedToolName,
          );
          if (selected === undefined) throw new Error('REQUESTED_TEMPORARY_TOOL_MISSING');
          respondStructured(response, {
            serverId: selected.serverId,
            toolName: selected.toolName,
            name: 'Task-scoped device status',
            description: 'Use the registered device Tool for this Task only.',
            outputSchema: { type: 'object' },
            decisionSummary: 'No formal Skill matched; the registered Tool closes the gap.',
          });
          return;
        }
        if (skillInductionRequest === true) {
          const requestData = z
            .object({
              sourceSkills: z.array(
                z.object({
                  tools: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
                  inputSchema: z.unknown(),
                  outputSchema: z.unknown(),
                }),
              ),
              currentSkills: z.array(z.object({ skillId: z.string(), version: z.number() })),
            })
            .parse(embeddedOperation(body.messages, 'induce_skill_from_experience'));
          const source = requestData.sourceSkills[0];
          const tool = source?.tools[0];
          if (source === undefined || tool === undefined)
            throw new Error('SKILL_INDUCTION_SOURCE_REQUIRED');
          const existingSkillId = `skill.existing.${tool.serverId}`;
          const existing = requestData.currentSkills.find(
            (skill) => skill.skillId === existingSkillId,
          );
          const forceSimulationFailure = JSON.stringify(source.inputSchema).includes(
            'forceSimulationFailure',
          );
          respondStructured(response, {
            consistent: true,
            stable: true,
            generalizable: true,
            ...(existing === undefined ? {} : { duplicateSkillId: existing.skillId }),
            duplicateScore: existing === undefined ? 0 : 0.95,
            evolutionKind: existing === undefined ? 'new_skill' : 'new_version',
            targetSkillId: existing?.skillId ?? `skill.evolved.${tool.serverId}`,
            boundaryDecisionSummary:
              existing === undefined
                ? 'No current Skill has the same capability boundary.'
                : 'The capability boundary is unchanged and execution guidance improved.',
            decisionSummary: 'Repeated successful executions define a stable reusable Skill.',
            proposedSkill: {
              skillId: existing?.skillId ?? `skill.evolved.${tool.serverId}`,
              name: 'Evolved device status',
              summary: 'Read device status from the registered Tool.',
              description: 'Read the current state of one device using the registered MCP Tool.',
              capabilities: ['device-status'],
              workflowGuidance: 'Call the required Tool once and return its structured result.',
              outputInstruction: 'Return the structured device state.',
              inputSchema: source.inputSchema,
              outputSchema: source.outputSchema,
              tools: [tool],
            },
            supplementalCases: [
              {
                caseId: 'normal-device',
                kind: 'normal',
                input: { deviceId: 'device-simulation' },
                expectedOutcome: forceSimulationFailure ? 'failure' : 'success',
              },
              {
                caseId: 'boundary-missing-device',
                kind: 'boundary',
                input: {},
                expectedOutcome: 'failure',
              },
              {
                caseId: 'exception-invalid-input',
                kind: 'exception',
                input: {},
                expectedOutcome: 'failure',
              },
            ],
          });
          return;
        }
        if (goalContinuityRequest === true) {
          respondStructured(response, {
            relationship: 'related_successor',
            decisionSummary: 'The new request is a related next phase of the completed Goal.',
          });
          return;
        }
        if (goalPatchDecisionRequest === true) {
          respondStructured(response, {
            changes: {
              constraints: ['read-only', 'include temperature'],
              successCriteria: ['Return status and temperature.'],
            },
            decisionSummary: 'Added temperature to the active Goal.',
          });
          return;
        }
        if (skillSelectionRequest === true) {
          const requestData = embeddedOperation(body.messages, 'select_skill');
          const candidates = z
            .object({
              goalDescription: z.string(),
              candidates: z.array(
                z.looseObject({
                  skillId: z.string(),
                  name: z.string(),
                  autoConfirmPlan: z.boolean(),
                  semanticScore: z.number(),
                  createdAt: z.string(),
                }),
              ),
            })
            .parse(requestData);
          const eligibleCandidates = candidates.goalDescription.includes('AUTO_TASK_GOAL')
            ? candidates.candidates.filter((candidate) => candidate.autoConfirmPlan)
            : candidates.candidates.filter((candidate) => !candidate.autoConfirmPlan);
          const requestedSharedSkill = /GLOBAL_SHARED_SKILL:([A-Za-z0-9._-]+)/.exec(
            candidates.goalDescription,
          )?.[1];
          const exactSharedCandidate = eligibleCandidates.find(
            (candidate) => candidate.skillId === requestedSharedSkill,
          );
          const semanticLeaders = [...eligibleCandidates]
            .sort((left, right) => right.semanticScore - left.semanticScore)
            .filter(
              (candidate, _index, sorted) => candidate.semanticScore === sorted[0]?.semanticScore,
            );
          const deviceLeaders = semanticLeaders.filter((candidate) =>
            candidate.name.toLowerCase().includes('zebra'),
          );
          const preferred = deviceLeaders.length > 0 ? deviceLeaders : semanticLeaders;
          const selected =
            exactSharedCandidate ??
            [...preferred].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[
              preferred.length - 1
            ];
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
        if (goalPatchReplanRequest === true) {
          const requestData = z
            .object({
              workflowIdentity: z.object({
                workflowDefinitionId: z.string(),
                version: z.number(),
                goalId: z.string(),
                goalVersion: z.number(),
              }),
            })
            .parse(embeddedOperation(body.messages, 'goal_patch_replan'));
          respondStructured(response, {
            ...requestData.workflowIdentity,
            entryNodeId: 'result',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'result',
                name: 'Patched Goal result',
                type: 'result',
                value: { op: 'literal', value: 'goal-patch-replanned' },
              },
            ],
            edges: [],
          });
          return;
        }
        if (workflowControlReplanRequest === true) {
          const requestData = z
            .object({
              workflowIdentity: z.object({
                workflowDefinitionId: z.string(),
                version: z.number(),
                goalId: z.string(),
                goalVersion: z.number(),
              }),
              replacementSkill: z
                .object({ skillId: z.string(), skillVersion: z.number() })
                .optional(),
            })
            .parse(embeddedOperation(body.messages, 'workflow_control_replan'));
          respondStructured(response, {
            ...requestData.workflowIdentity,
            entryNodeId: 'result',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'result',
                name: 'Replacement result',
                type: 'result',
                value: {
                  op: 'literal',
                  value: requestData.replacementSkill?.skillId ?? 'replanned',
                },
              },
            ],
            edges: [],
          });
          return;
        }
        if (initialTaskPlanRequest === true) {
          const requestData = z
            .object({
              workflowIdentity: z.object({
                workflowDefinitionId: z.string(),
                version: z.number(),
                goalId: z.string(),
                goalVersion: z.number(),
              }),
              goalDescription: z.string(),
              selectedTemporarySkill: z
                .object({
                  temporarySkillId: z.string(),
                  tools: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
                })
                .optional(),
              selectedSkill: z
                .object({
                  skillId: z.string(),
                  toolPolicy: z.object({
                    required: z.array(z.object({ serverId: z.string(), toolName: z.string() })),
                  }),
                })
                .optional(),
            })
            .parse(embeddedOperation(body.messages, 'task_initial_plan'));
          const failPrimary = requestData.goalDescription.includes('REPLACE_SKILL_GOAL');
          const temporaryTool = requestData.selectedTemporarySkill?.tools[0];
          const historicalTool = requestData.selectedSkill?.toolPolicy.required[0];
          const historicalSuccess = requestData.goalDescription.includes(
            'HISTORICAL_REPLAY_SUCCESS',
          );
          const historicalFailure = requestData.goalDescription.includes(
            'HISTORICAL_REPLAY_FAILURE',
          );
          const historical = historicalSuccess || historicalFailure;
          respondStructured(response, {
            ...requestData.workflowIdentity,
            entryNodeId:
              failPrimary || historicalFailure
                ? 'execute'
                : temporaryTool !== undefined || historicalSuccess
                  ? 'tool'
                  : 'result',
            exitNodeIds: ['result'],
            nodes:
              historical && historicalTool !== undefined
                ? [
                    ...(historicalFailure
                      ? [
                          {
                            nodeId: 'execute',
                            name: 'Reproduce historical failure',
                            type: 'llm',
                            instruction: 'FAIL_PRIMARY_SKILL_EXECUTION',
                            responseSchema: { type: 'object' },
                          },
                        ]
                      : []),
                    {
                      nodeId: 'tool',
                      name: 'Historical device call',
                      type: 'mcp_tool',
                      tool: historicalTool,
                      arguments: { deviceId: 'device-history' },
                    },
                    {
                      nodeId: 'result',
                      name: 'Historical result',
                      type: 'result',
                      value: { op: 'ref', path: ['nodes', 'tool'] },
                    },
                  ]
                : temporaryTool !== undefined
                  ? [
                      {
                        nodeId: 'tool',
                        name: 'Execute task-scoped Tool',
                        type: 'mcp_tool',
                        tool: temporaryTool,
                        arguments: { deviceId: 'device-temporary' },
                      },
                      {
                        nodeId: 'result',
                        name: 'Return Temporary Skill result',
                        type: 'result',
                        value: { op: 'ref', path: ['nodes', 'tool'] },
                      },
                    ]
                  : failPrimary
                    ? [
                        {
                          nodeId: 'execute',
                          name: 'Fail primary Skill execution',
                          type: 'llm',
                          instruction: 'FAIL_PRIMARY_SKILL_EXECUTION',
                          responseSchema: { type: 'object' },
                        },
                        {
                          nodeId: 'result',
                          name: 'Primary result',
                          type: 'result',
                          value: { op: 'ref', path: ['nodes', 'execute'] },
                        },
                      ]
                    : [
                        {
                          nodeId: 'result',
                          name: 'Initial Task result',
                          type: 'result',
                          value: { op: 'literal', value: 'online' },
                        },
                      ],
            edges: historical
              ? historicalFailure
                ? [
                    { sourceNodeId: 'execute', targetNodeId: 'tool' },
                    { sourceNodeId: 'tool', targetNodeId: 'result' },
                  ]
                : [{ sourceNodeId: 'tool', targetNodeId: 'result' }]
              : temporaryTool !== undefined
                ? [{ sourceNodeId: 'tool', targetNodeId: 'result' }]
                : failPrimary
                  ? [{ sourceNodeId: 'execute', targetNodeId: 'result' }]
                  : [],
          });
          return;
        }
        if (autoTaskEvaluationRequest) {
          respondStructured(response, {
            decision: 'achieved',
            summary: 'The auto-confirmed Task result satisfies the Goal.',
          });
          return;
        }
        if (replacementEvaluationRequest) {
          replacementEvaluationCalls += 1;
          respondStructured(
            response,
            replacementEvaluationCalls === 1
              ? {
                  decision: 'replace_skill',
                  summary: 'The initial Skill failed and an enabled alternative is required.',
                  actionInstruction: 'Use the selected alternative Skill.',
                }
              : { decision: 'achieved', summary: 'The replacement Skill satisfied the Goal.' },
          );
          return;
        }
        if (capabilityGapEvaluationRequest) {
          respondStructured(response, {
            decision: 'capability_gap',
            summary: 'No registered MCP tool can read device pressure.',
            missingCapability: 'Read device pressure.',
            suggestedToolContract: {
              name: 'read_pressure',
              description: 'Read pressure for one device.',
              inputSchema: { type: 'object', required: ['deviceId'] },
            },
          });
          return;
        }
        if (controlEvaluationRequest) {
          controlEvaluationCalls += 1;
          const content =
            controlEvaluationCalls === 1
              ? {
                  decision: 'adjust_plan',
                  summary: 'A second observation is required.',
                  actionInstruction: 'Run the next immutable Workflow version.',
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
        if (genericTaskEvaluationRequest) {
          respondStructured(response, {
            decision: 'achieved',
            summary: 'The Task Workflow result satisfies the Goal.',
          });
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
        if (skillCallWorkflowRequest === true) {
          const target = skillCallWorkflowTarget;
          if (target === undefined) throw new Error('SKILL_CALL_WORKFLOW_TARGET_MISSING');
          respondStructured(response, {
            workflowDefinitionId: target.workflowId,
            version: 1,
            goalId: target.goalId,
            goalVersion: target.goalVersion,
            entryNodeId: 'child',
            exitNodeIds: ['result'],
            nodes: [
              {
                nodeId: 'child',
                name: 'Execute child Skill',
                type: 'skill_call',
                skillId: target.skillId,
                input: { deviceId: 'device-child' },
              },
              {
                nodeId: 'result',
                name: 'Return child result',
                type: 'result',
                value: { op: 'ref', path: ['nodes', 'child'] },
              },
            ],
            edges: [{ sourceNodeId: 'child', targetNodeId: 'result' }],
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
  if (!attached.ok) {
    const current = await fetch(
      `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
    ).then((response) => response.text());
    throw new Error(
      `TASK_PLAN_ATTACH_FAILED:${String(attached.status)}:${await attached.text()}:CURRENT=${current}`,
    );
  }
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

async function waitForTaskState(taskId: string, expected: TaskState): Promise<Task> {
  let task = await runtime.a2a.client.getTask({ tenant: '', id: taskId });
  for (let attempt = 0; attempt < 100 && task.status?.state !== expected; attempt += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    task = await runtime.a2a.client.getTask({ tenant: '', id: taskId });
  }
  expect(task.status?.state).toBe(expected);
  return task;
}

async function waitForTemporarySkillStatus(taskId: string, expected: string) {
  const schema = z.object({
    items: z.array(
      z.object({ temporarySkillId: z.string(), status: z.string(), taskId: z.string() }),
    ),
  });
  const read = async () =>
    schema.parse(
      await fetch(
        `${runtime.management.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}/temporary-skills`,
      ).then((response) => response.json()),
    );
  let result = await read();
  for (
    let attempt = 0;
    attempt < 100 && !result.items.some((item) => item.status === expected);
    attempt += 1
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    result = await read();
  }
  expect(result.items.some((item) => item.status === expected)).toBe(true);
  return result;
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
