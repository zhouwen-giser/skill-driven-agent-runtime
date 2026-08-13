import { Task, TaskState } from '@a2a-js/sdk';
import { describe, expect, it, vi } from 'vitest';

import type { McpToolExecutionSemantics } from '../../../packages/domain/src/index.js';
import {
  assertTaskModelInvocations,
  assertUgvSingleReadOnlyPlan,
  executeUgvA2AReadOnly,
  failedUgvA2AReport,
  ugvA2APendingFromEnvironment,
} from '../src/ugv-smpp-a2a-read-only-driver.js';
import {
  UGV_EMBEDDING_MODEL_STAGES,
  UGV_STRUCTURED_MODEL_STAGES,
  type UgvModelStageConformanceReport,
} from '../src/ugv-smpp-model-stage-conformance-contract.js';
import type {
  UgvReadOnlyAuthoritySnapshot,
  UgvReadOnlyGovernanceAuthority,
} from '../src/ugv-smpp-read-only-authority.js';

const authorityMocks = vi.hoisted(() => ({
  loadUgvReadOnlyAuthority: vi.fn<(...arguments_: unknown[]) => Promise<unknown>>(),
}));

vi.mock('../src/ugv-smpp-read-only-authority.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadUgvReadOnlyAuthority: authorityMocks.loadUgvReadOnlyAuthority };
});

const NOW = '2026-08-12T08:00:00.000Z';
const PROVIDER_ID = 'provider.production-real-model';
const MODEL = 'production-structured-model';
const SERVER_ID = 'ugv-smpp-runtime';
const TOOL_NAME = 'vehicle_get_state';
const READ_ONLY_SEMANTICS: McpToolExecutionSemantics = Object.freeze({
  execution: 'synchronous',
  effect: 'read_only',
  cancellation: 'unsupported',
  idempotency: 'none',
  replay: 'allowed',
  source: 'admin_override',
});
const REQUIRED_TASK_STAGES = Object.freeze([
  'task_understanding',
  'goal_contract_generation',
  'goal_planning',
  'skill_input_resolution',
  'workflow_planning',
  'result_processing',
  'goal_evaluation',
]);

describe('UGV real-model A2A read-only acceptance driver', () => {
  it('reports missing real-model authority as pending without inventing execution evidence', () => {
    const disabled = ugvA2APendingFromEnvironment({ SDAR_UGV_REAL_MODEL_ENABLED: 'NO' }, NOW);
    expect(disabled).toMatchObject({
      status: 'pending',
      evidenceClass: 'unverified',
      reasonCode: 'UGV_REAL_MODEL_REQUIRED',
      a2aReadOnlyReady: false,
      externalOperations: { a2aRequests: 0, mcpCalls: 0, physicalWrites: 0 },
    });

    const incomplete = ugvA2APendingFromEnvironment({ SDAR_UGV_REAL_MODEL_ENABLED: 'YES' }, NOW);
    expect(incomplete).toMatchObject({
      status: 'pending',
      reasonCode: 'UGV_REAL_MODEL_CONFIGURATION_INCOMPLETE',
    });

    const missingConformance = ugvA2APendingFromEnvironment(
      {
        SDAR_UGV_REAL_MODEL_ENABLED: 'YES',
        SDAR_UGV_MODEL_PROVIDER_ID: PROVIDER_ID,
        SDAR_UGV_MODEL_BASE_URL: 'https://model.example.invalid/v1',
        SDAR_UGV_MODEL_NAME: MODEL,
        SDAR_UGV_MODEL_API_STYLE: 'openai_chat_completions',
        SDAR_UGV_MODEL_API_KEY: 'secret-never-report',
      },
      NOW,
    );
    expect(missingConformance).toMatchObject({
      status: 'pending',
      reasonCode: 'UGV_MODEL_STAGE_CONFORMANCE_REQUIRED',
    });
    expect(JSON.stringify(missingConformance)).not.toContain('secret-never-report');
    expect(JSON.stringify(missingConformance)).not.toContain('model.example.invalid');
  });

  it('records a redacted real-attempt failure without claiming read readiness', () => {
    expect(
      failedUgvA2AReport('UGV_A2A_TASK_NOT_COMPLETED', NOW, {
        taskId: 'task-a2a-failed',
        operationName: TOOL_NAME,
        mcpCalls: 1,
        physicalWrites: 0,
      }),
    ).toEqual({
      schemaVersion: 'sdar.ugv-smpp-a2a-read-only/v1',
      status: 'failed',
      evidenceClass: 'real_a2a_attempt_failed',
      observedAt: NOW,
      reasonCode: 'UGV_A2A_TASK_NOT_COMPLETED',
      a2aReadOnlyReady: false,
      execution: {
        taskId: 'task-a2a-failed',
        operationName: TOOL_NAME,
        mcpCalls: 1,
        physicalWrites: 0,
      },
      redaction: { secretsIncluded: false, endpointsIncluded: false },
    });
  });

  it('admits only one exact MCP node with the frozen explicit read-only semantics', () => {
    const authority = {
      target: { localServerId: SERVER_ID, toolName: TOOL_NAME },
      tool: { executionSemantics: READ_ONLY_SEMANTICS },
    } as const;
    const exact = plan(READ_ONLY_SEMANTICS);
    expect(() => {
      assertUgvSingleReadOnlyPlan(exact, authority);
    }).not.toThrow();
    expect(() => {
      assertUgvSingleReadOnlyPlan(plan({ ...READ_ONLY_SEMANTICS, effect: 'unknown' }), authority);
    }).toThrow(expect.objectContaining({ code: 'UGV_A2A_PLAN_NOT_EXACT_READ_ONLY' }));
    expect(() => {
      assertUgvSingleReadOnlyPlan(
        {
          ...exact,
          definition: {
            ...exact.definition,
            nodes: [
              ...exact.definition.nodes,
              {
                nodeId: 'write',
                type: 'mcp_tool',
                tool: { serverId: SERVER_ID, toolName: 'vehicle_navigate' },
              },
            ],
          },
        },
        authority,
      );
    }).toThrow(expect.objectContaining({ code: 'UGV_A2A_PLAN_NOT_EXACT_READ_ONLY' }));
  });

  it('requires exact task-linked real-provider model evidence for every cognitive stage', () => {
    const invocations = REQUIRED_TASK_STAGES.map((stage) => modelInvocation(stage));
    expect(
      assertTaskModelInvocations({ items: invocations }, 'task-a2a-1', PROVIDER_ID, MODEL),
    ).toMatchObject({ stages: [...REQUIRED_TASK_STAGES].sort() });
    expect(() =>
      assertTaskModelInvocations(
        { items: invocations.slice(0, -1) },
        'task-a2a-1',
        PROVIDER_ID,
        MODEL,
      ),
    ).toThrow(expect.objectContaining({ code: 'UGV_A2A_MODEL_STAGE_EVIDENCE_INCOMPLETE' }));
    expect(() =>
      assertTaskModelInvocations(
        { items: [...invocations.slice(0, -1), { ...invocations.at(-1), providerId: 'fixture' }] },
        'task-a2a-1',
        PROVIDER_ID,
        MODEL,
      ),
    ).toThrow(expect.objectContaining({ code: 'UGV_A2A_MODEL_INVOCATION_AUTHORITY_INVALID' }));
  });

  it('continues when initial WORKING reaches INPUT_REQUIRED through getTask', async () => {
    const continuationObserved = new Error('CONTINUATION_OBSERVED');
    const working = Task.fromJSON({
      id: 'task-boundary-1',
      contextId: 'context-boundary-1',
      status: { state: TaskState.TASK_STATE_WORKING },
      artifacts: [],
      history: [],
    });
    const inputRequired = Task.fromJSON({
      ...(Task.toJSON(working) as Record<string, unknown>),
      status: { state: TaskState.TASK_STATE_INPUT_REQUIRED },
      metadata: {
        'io.sdar/interaction': {
          kind: 'interactive_goal',
          state: 'goal_review',
          allowedActions: ['accept'],
        },
      },
    });
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(working)
      .mockRejectedValueOnce(continuationObserved);
    const getTask = vi.fn().mockResolvedValue(inputRequired);
    const delay = vi.fn(() => Promise.resolve());
    authorityMocks.loadUgvReadOnlyAuthority.mockResolvedValue(readOnlyAuthority());

    await expect(
      executeUgvA2AReadOnly(baseConfiguration(), {
        fetch: acceptanceFetch(),
        createA2AClient: () => Promise.resolve({ sendMessage, getTask }),
        now: () => NOW,
        randomId: () => 'boundary-random-id',
        delay,
        governanceAuthority: governanceAuthority(),
        modelConformance: modelConformance(),
      }),
    ).rejects.toBe(continuationObserved);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(getTask).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: {
        taskId: 'task-boundary-1',
        contextId: 'context-boundary-1',
        metadata: { sdar_action: 'provide_input' },
      },
    });
  });

  it('creates an immutable successor Exposure for a newer Capability version', async () => {
    const continuationObserved = new Error('SUCCESSOR_CONTINUATION_OBSERVED');
    const fetch = acceptanceFetch({ existingExposureVersion: 1 });
    const working = Task.fromJSON({
      id: 'task-successor-1',
      contextId: 'context-successor-1',
      status: { state: TaskState.TASK_STATE_WORKING },
      artifacts: [],
      history: [],
    });
    authorityMocks.loadUgvReadOnlyAuthority.mockResolvedValue({
      ...readOnlyAuthority(),
      target: {
        ...readOnlyAuthority().target,
        capabilityVersion: 2,
        skillVersion: 2,
      },
      capability: { ...readOnlyAuthority().capability, version: 2 },
    });

    await expect(
      executeUgvA2AReadOnly(baseConfiguration(), {
        fetch,
        createA2AClient: () =>
          Promise.resolve({
            sendMessage: vi
              .fn()
              .mockResolvedValueOnce(working)
              .mockRejectedValueOnce(continuationObserved),
            getTask: vi.fn().mockResolvedValue(
              Task.fromJSON({
                ...(Task.toJSON(working) as Record<string, unknown>),
                status: { state: TaskState.TASK_STATE_INPUT_REQUIRED },
                metadata: {
                  'io.sdar/interaction': {
                    kind: 'interactive_goal',
                    state: 'goal_review',
                    allowedActions: ['accept'],
                  },
                },
              }),
            ),
          }),
        now: () => NOW,
        randomId: () => 'successor-random-id',
        governanceAuthority: governanceAuthority(),
        modelConformance: modelConformance(),
      }),
    ).rejects.toBe(continuationObserved);

    const create = vi.mocked(fetch).mock.calls.find(([, init]) => {
      if (init?.method !== 'POST' || typeof init.body !== 'string') return false;
      const body = JSON.parse(init.body) as unknown;
      return typeof body === 'object' && body !== null && 'version' in body && body.version === 2;
    });
    expect(create).toBeDefined();
  });
});

function baseConfiguration() {
  return {
    nodeControlBaseUrl: 'http://127.0.0.1:10082',
    nodeControlBearerToken: 'node-control-test-token',
    nodeControlRuntimeServiceToken: 'runtime-service-test-token',
    runtimeManagementBaseUrl: 'http://127.0.0.1:9998',
    a2aBaseUrl: 'http://127.0.0.1:9999',
    governanceReportFile: '/unused/governance.json',
    modelConformanceReportFile: '/unused/model-conformance.json',
    modelProviderId: PROVIDER_ID,
    modelBaseUrl: 'https://models.example.test/v1',
    modelName: MODEL,
    modelApiStyle: 'openai_chat_completions' as const,
    runId: 'boundary-regression-run',
    pollIntervalMs: 0,
    maxPolls: 1,
  };
}

function governanceAuthority(): UgvReadOnlyGovernanceAuthority {
  return {
    schemaVersion: 'sdar.ugv-smpp-capability-governance/v1',
    status: 'passed',
    observedAt: NOW,
    binding: {
      bindingId: 'binding-ugv-smpp',
      localServerId: SERVER_ID,
      revision: 1,
      registryRevision: 1,
      registryChecksum: '1'.repeat(64),
      catalogRevision: 'catalog-1',
      catalogChecksum: '2'.repeat(64),
      operationCount: 1,
      availabilityValidUntil: '2026-08-13T08:00:00.000Z',
    },
    resourcePolicy: {
      identifierAuthority: 'public_smpp_tool_schema',
      resourceId: 'vehicle-public-1',
      selection: 'single_schema_value',
    },
    catalog: {
      discoveredToolCount: 1,
      governedToolCount: 1,
      stagedControlToolCount: 0,
      unmappedToolNames: [],
    },
    firePolicy: {
      toolName: 'vehicle_fire_weapon',
      discovered: false,
      forbidden: true,
      capabilityCreated: false,
      skillCreated: false,
    },
    skills: [
      {
        skillId: 'ugv.get-state',
        skillVersion: 1,
        capabilityId: 'vehicle.ugv.read-state',
        toolName: TOOL_NAME,
        packageChecksum: '3'.repeat(64),
        inputSchemaSha256: '4'.repeat(64),
        outputSchemaSha256: '5'.repeat(64),
        action: 'reconciled',
        status: 'published',
      },
    ],
    capabilities: [
      {
        capabilityId: 'vehicle.ugv.read-state',
        capabilityVersion: 1,
        definitionHash: '6'.repeat(64),
        implementationBindingId: 'implementation-ugv-get-state',
        skillId: 'ugv.get-state',
        skillVersion: 1,
        toolName: TOOL_NAME,
        riskLevel: 'low',
        confirmation: 'not_required',
        remoteTerminalEvidenceRequired: false,
        readiness: 'available',
        readinessValidUntil: '2026-08-13T08:00:00.000Z',
      },
    ],
    stagedControls: [],
    redaction: {
      secretsIncluded: false,
      endpointsIncluded: false,
      downstreamDeviceIdsIncluded: false,
      mqttTopicsIncluded: false,
    },
  };
}

function readOnlyAuthority(): UgvReadOnlyAuthoritySnapshot {
  return {
    target: {
      toolName: TOOL_NAME,
      capabilityId: 'vehicle.ugv.read-state',
      skillId: 'ugv.get-state',
      taskTypeId: 'task-type.vehicle.read-state',
      evidenceType: 'vehicle.state.observation',
      requestText: '查询无人车当前状态',
      capabilityVersion: 1,
      capabilityBindingId: 'implementation-ugv-get-state',
      capabilityBindingVersion: 1,
      capabilityDefinitionHash: '6'.repeat(64),
      skillVersion: 1,
      mcpProviderBindingId: 'binding-ugv-smpp',
      localServerId: SERVER_ID,
      resourceId: 'vehicle-public-1',
    },
    observedAt: NOW,
    capability: {
      capabilityId: 'vehicle.ugv.read-state',
      version: 1,
      name: 'Read UGV state',
      description: 'Read the current UGV state.',
      inputSchema: {
        type: 'object',
        properties: { resourceId: { type: 'string' } },
        required: ['resourceId'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
    },
  } as unknown as UgvReadOnlyAuthoritySnapshot;
}

function modelConformance(): UgvModelStageConformanceReport {
  const provider = {
    providerId: PROVIDER_ID,
    model: MODEL,
    apiStyle: 'openai_chat_completions' as const,
    connectivity: 'passed' as const,
    credentialsRedacted: true as const,
  };
  return {
    schemaVersion: 'sdar.ugv-smpp-model-stage-conformance/v1',
    status: 'passed',
    evidenceClass: 'real_model_provider',
    observedAt: NOW,
    provider,
    embeddingPrerequisite: {
      status: 'passed',
      provider,
      stages: UGV_EMBEDDING_MODEL_STAGES.map((stage) => ({
        stage,
        status: 'passed' as const,
        finiteVectorValidated: true as const,
        dimensions: 1024,
        boundedTimeout: true as const,
      })),
    },
    correctionPath: {
      exercised: true,
      invalidFirstResponseRejected: true,
      rejectionKind: 'application_schema_validation',
      correctedStructuredResponseValidated: true,
    },
    stages: UGV_STRUCTURED_MODEL_STAGES.map((stage) => ({
      stage,
      status: 'passed' as const,
      structuredOutputValidated: true as const,
      boundedTimeout: true as const,
      promptPublished: true as const,
    })),
  };
}

function acceptanceFetch(
  options: Readonly<{ existingExposureVersion?: number }> = {},
): typeof fetch {
  return vi.fn<typeof fetch>((input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const path = url.pathname;
    if (path === '/api/v1/models/providers')
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              providerId: PROVIDER_ID,
              kind: 'openai_compatible',
              apiStyle: 'openai_chat_completions',
              baseUrl: 'https://models.example.test/v1',
              model: MODEL,
              enabled: true,
              timeoutMs: 30_000,
            },
          ],
        }),
      );
    if (path === '/api/v1/models/routes')
      return Promise.resolve(
        jsonResponse({
          items: [
            ...UGV_STRUCTURED_MODEL_STAGES.map((stage) => ({
              stage,
              operation: 'structured_generation',
              providerId: PROVIDER_ID,
            })),
            ...UGV_EMBEDDING_MODEL_STAGES.map((stage) => ({
              stage,
              operation: 'embedding',
              providerId: PROVIDER_ID,
            })),
          ],
        }),
      );
    if (path.startsWith('/api/v1/prompts/current/')) {
      const stage = decodeURIComponent(path.slice('/api/v1/prompts/current/'.length));
      return Promise.resolve(
        jsonResponse({
          item: {
            promptId: `prompt.production.${stage}`,
            stage,
            version: 1,
            status: 'enabled',
          },
        }),
      );
    }
    if (path === '/api/v1/a2a-exposures' && init?.method !== 'POST') {
      if (options.existingExposureVersion === undefined)
        return Promise.resolve(jsonResponse({ items: [] }));
      const authority = readOnlyAuthority();
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              exposureId: 'a2a.vehicle.ugv.read-state',
              version: options.existingExposureVersion,
              capabilityId: authority.target.capabilityId,
              capabilityVersion: 1,
              agentSkillId: authority.target.capabilityId,
              name: authority.capability.name,
              description: authority.capability.description,
              tags: ['ugv', 'vehicle', 'read-only', authority.target.toolName],
              examples: [authority.target.requestText],
              inputModes: ['text/plain', 'application/json'],
              outputModes: ['application/json'],
              requestSchema: authority.capability.inputSchema,
              resultSchema: authority.capability.outputSchema,
              visibility: 'public',
              requesterPolicy: {
                allowAnonymous: false,
                allowedRequesterIds: ['ugv-a2a-read-only'],
              },
              readinessPublicationPolicy: 'publish_when_available',
              status: 'published',
              exposureHash: 'a'.repeat(64),
            },
          ],
        }),
      );
    }
    if (path === '/api/v1/a2a-exposures' && init?.method === 'POST') {
      if (typeof init.body !== 'string') throw new Error('Expected a JSON request body.');
      const draft = JSON.parse(init.body) as Readonly<Record<string, unknown>>;
      return Promise.resolve(jsonResponse({ ...draft, status: 'published' }, 201));
    }
    if (path.includes('/api/v1/a2a-exposures/') && init?.method === 'POST')
      return Promise.resolve(jsonResponse({ status: 'succeeded', result: {} }, 202));
    if (path === '/api/v1/a2a-agent-card-revisions/rebuild')
      return Promise.resolve(
        jsonResponse({ status: 'succeeded', result: { status: 'active' } }, 202),
      );
    if (path === '/.well-known/agent-card.json')
      return Promise.resolve(jsonResponse({ skills: [{ id: 'vehicle.ugv.read-state' }] }));
    if (path === '/api/v1/tasks/task-boundary-1' || path === '/api/v1/tasks/task-successor-1')
      return Promise.resolve(jsonResponse({ phase: 'awaiting_user_input' }));
    if (path === '/api/v1/mcp/invocations') return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.reject(new Error(`Unexpected test request: ${path}`));
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function plan(executionSemantics: McpToolExecutionSemantics) {
  return {
    definition: {
      nodes: [
        {
          nodeId: 'read',
          type: 'mcp_tool',
          tool: { serverId: SERVER_ID, toolName: TOOL_NAME },
          arguments: {
            resourceId: { op: 'ref', path: ['input', 'skillInput', 'resourceId'] },
          },
        },
        { nodeId: 'result', type: 'result', value: { op: 'ref', path: ['outputs', 'read'] } },
      ],
      edges: [{ sourceNodeId: 'read', targetNodeId: 'result' }],
    },
    toolExecutionSemantics: [
      {
        reference: { serverId: SERVER_ID, toolName: TOOL_NAME },
        executionSemantics,
      },
    ],
  } as const;
}

function modelInvocation(stage: string) {
  return {
    invocationId: `model-${stage}`,
    taskId: 'task-a2a-1',
    stage,
    providerId: PROVIDER_ID,
    model: MODEL,
    operation: 'structured_generation',
    promptId: `prompt.production.${stage}`,
    promptVersion: 1,
    structuredResult: { accepted: true },
    durationMs: 1,
    status: 'succeeded',
  } as const;
}
