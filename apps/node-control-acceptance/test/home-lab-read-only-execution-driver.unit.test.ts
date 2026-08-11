import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  executeHomeLabReadOnlyCapabilities,
  HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS,
  homeLabReadOnlyConfigurationFromEnvironment,
  type HomeLabReadOnlyExecutionContract,
} from '../src/home-lab-read-only-execution-driver.js';

const NOW = '2026-08-10T12:00:00.000Z';
const PROVIDER_NOW = '2026-08-10T12:00:00.123456+00:00';
const PROVIDER_RECORDED_AT = '2026-08-10T12:00:00.123Z';
const VALID_UNTIL = '2026-08-10T13:00:00.000Z';
const CONTROL_TOKEN = 'node-control-secret-never-report';
const RUNTIME_COGNITIVE_TOKEN = 'runtime-cognitive-secret-never-report-0000';
const CONTROL_ORIGIN = 'http://127.0.0.1:21080';
const RUNTIME_ORIGIN = 'http://127.0.0.1:21081';
const CHECKSUM = 'a'.repeat(64);

describe('home-lab deterministic read-only execution driver', () => {
  it('selects only the exact get-state Tools from mixed read/write frozen catalogs', async () => {
    const api = new FakeReadOnlyApis();
    const report = await executeHomeLabReadOnlyCapabilities(configuration(), {
      fetch: api.fetch,
      now: () => NOW,
    });

    expect(report.readOnlyExecutionPlaneReady).toBe(true);
    expect(report.executions).toHaveLength(2);
    expect(report.executions.map((item) => item.kind)).toEqual(['main_light', 'climate']);
    expect(report.executions.map((item) => item.toolName)).toEqual([
      'light_get_state',
      'climate_get_state',
    ]);
    expect(report.executions).toEqual([
      expect.objectContaining({
        capabilityBindingId: 'capability-binding-home.light.read-state-v1',
        capabilityBindingVersion: 1,
        capabilityId: 'home.light.read-state',
        skillId: 'home.light.get-state',
        mcpProviderBindingId: 'mcp-binding-ha-light-lab',
        providerId: 'ha-light-lab',
        resourceId: 'living-room-main-light',
        result: {
          power: 'off',
          reachable: true,
          observedAt: PROVIDER_NOW,
          resourceId: 'living-room-main-light',
          brightnessPercent: null,
        },
      }),
      expect.objectContaining({
        capabilityBindingId: 'capability-binding-home.climate.read-state-v1',
        capabilityBindingVersion: 1,
        capabilityId: 'home.climate.read-state',
        skillId: 'home.climate.get-state',
        mcpProviderBindingId: 'mcp-binding-ha-climate-lab',
        providerId: 'ha-climate-lab',
        resourceId: 'living-room-air-conditioner',
        result: {
          power: 'on',
          hvacMode: 'cool',
          reachable: true,
          observedAt: PROVIDER_NOW,
          resourceId: 'living-room-air-conditioner',
          temperatureUnit: '°C',
          targetTemperature: 24,
          currentTemperature: 25.1,
        },
      }),
    ]);
    expect(report.executions.every((item) => item.capabilityBindingHash.length === 64)).toBe(true);
    expect(report.executions.map((item) => item.evidence[0]?.observedAt)).toEqual([
      PROVIDER_NOW,
      PROVIDER_NOW,
    ]);
    expect(report.safety).toEqual({
      physicalWrites: 0,
      modelCalls: 0,
      mcpCalls: 2,
      onlyReadTools: true,
    });
    const posts = api.calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((call) => call.body?.['toolName'])).toEqual([
      'light_get_state',
      'climate_get_state',
    ]);
    expect(
      posts.every((call) => call.headers.get('idempotency-key') === call.body?.['taskId']),
    ).toBe(true);
    expect(
      posts.every(
        (call) => call.headers.get('authorization') === `Bearer ${RUNTIME_COGNITIVE_TOKEN}`,
      ),
    ).toBe(true);
    const firstPost = api.calls.findIndex((call) => call.method === 'POST');
    expect(firstPost).toBeGreaterThanOrEqual(12);
    expect(api.calls.slice(0, firstPost).every((call) => call.method === 'GET')).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(CONTROL_TOKEN);
    expect(serialized).not.toContain(RUNTIME_COGNITIVE_TOKEN);
    expect(serialized).not.toContain(CONTROL_ORIGIN);
    expect(serialized).not.toContain(RUNTIME_ORIGIN);
    expect(serialized).not.toContain('light.living_room');
    expect(serialized).not.toContain('climate.living_room');
  });

  it('fails before either invocation when a Provider Binding is stale', async () => {
    const api = new FakeReadOnlyApis({ staleBindingId: 'mcp-binding-ha-light-lab' });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({
      code: 'MCP_PROVIDER_BINDING_STALE',
    });
    expect(api.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('rejects a broken MCP invocation lineage after execution', async () => {
    const api = new FakeReadOnlyApis({ brokenInvocationLineage: true });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({
      code: 'MCP_INVOCATION_LINEAGE_INVALID',
    });
  });

  it('rejects Home Assistant entity IDs returned by the Execution Plane', async () => {
    const api = new FakeReadOnlyApis({ leakEntityId: true });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({
      code: 'HOME_ASSISTANT_ENTITY_ID_FORBIDDEN',
    });
  });

  it('preserves a nested public API error code without exposing the response body', async () => {
    const api = new FakeReadOnlyApis({ executionErrorCode: 'SKILL_SELECTION_NO_CANDIDATES' });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_SELECTION_NO_CANDIDATES' });
    expect(api.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('rejects ambiguous Provider evidence links in the Skill projection', async () => {
    const api = new FakeReadOnlyApis({ ambiguousSkillEvidenceReference: true });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING' });
  });

  it('rejects non-canonical Provider evidence link metadata', async () => {
    const api = new FakeReadOnlyApis({ brokenSkillEvidenceMetadata: true });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'SKILL_PROVIDER_EVIDENCE_REFERENCE_MISSING' });
  });

  it('rejects extra physical identity fields in the governed Workflow input envelope', async () => {
    const api = new FakeReadOnlyApis({ extraWorkflowInput: true });

    await expect(
      executeHomeLabReadOnlyCapabilities(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_EXECUTION_LINEAGE_INVALID' });
  });

  it('loads the dedicated Runtime cognitive bearer from a secret file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sdar-home-lab-cognitive-token-'));
    const tokenFile = path.join(directory, 'runtime-cognitive.token');
    try {
      await writeFile(tokenFile, `${RUNTIME_COGNITIVE_TOKEN}\n`, 'utf8');
      await expect(
        homeLabReadOnlyConfigurationFromEnvironment({
          SDAR_HOME_LAB_NODE_CONTROL_URL: CONTROL_ORIGIN,
          SDAR_HOME_LAB_NODE_CONTROL_TOKEN: CONTROL_TOKEN,
          SDAR_HOME_LAB_RUNTIME_URL: RUNTIME_ORIGIN,
          SDAR_HOME_LAB_RUNTIME_COGNITIVE_TOKEN_FILE: tokenFile,
          SDAR_HOME_LAB_RUN_ID: 'g07-token-file',
        }),
      ).resolves.toMatchObject({ runtimeCognitiveBearerToken: RUNTIME_COGNITIVE_TOKEN });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous inline and file Runtime cognitive bearer sources', async () => {
    await expect(
      homeLabReadOnlyConfigurationFromEnvironment({
        SDAR_HOME_LAB_NODE_CONTROL_URL: CONTROL_ORIGIN,
        SDAR_HOME_LAB_NODE_CONTROL_TOKEN: CONTROL_TOKEN,
        SDAR_HOME_LAB_RUNTIME_URL: RUNTIME_ORIGIN,
        SDAR_HOME_LAB_RUNTIME_COGNITIVE_TOKEN: RUNTIME_COGNITIVE_TOKEN,
        SDAR_HOME_LAB_RUNTIME_COGNITIVE_TOKEN_FILE: 'unused-token-file',
        SDAR_HOME_LAB_RUN_ID: 'g07-token-conflict',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_CONFIGURATION_INVALID' });
  });
});

function configuration() {
  return {
    nodeControlBaseUrl: CONTROL_ORIGIN,
    nodeControlBearerToken: CONTROL_TOKEN,
    runtimeManagementBaseUrl: RUNTIME_ORIGIN,
    runtimeCognitiveBearerToken: RUNTIME_COGNITIVE_TOKEN,
    runId: 'g07-unit-test-run',
  } as const;
}

interface RecordedCall {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body?: Readonly<Record<string, unknown>>;
}

interface ExecutionFixture {
  readonly task: Readonly<Record<string, unknown>>;
  readonly skillExecutions: Readonly<Record<string, unknown>>;
  readonly trace: Readonly<Record<string, unknown>>;
  readonly invocations: Readonly<Record<string, unknown>>;
}

class FakeReadOnlyApis {
  readonly calls: RecordedCall[] = [];
  readonly #fixtures = new Map<string, ExecutionFixture>();
  readonly #staleBindingId: string | undefined;
  readonly #brokenInvocationLineage: boolean;
  readonly #leakEntityId: boolean;
  readonly #executionErrorCode: string | undefined;
  readonly #ambiguousSkillEvidenceReference: boolean;
  readonly #brokenSkillEvidenceMetadata: boolean;
  readonly #extraWorkflowInput: boolean;

  constructor(
    options: Readonly<{
      staleBindingId?: string;
      brokenInvocationLineage?: boolean;
      leakEntityId?: boolean;
      executionErrorCode?: string;
      ambiguousSkillEvidenceReference?: boolean;
      brokenSkillEvidenceMetadata?: boolean;
      extraWorkflowInput?: boolean;
    }> = {},
  ) {
    this.#staleBindingId = options.staleBindingId;
    this.#brokenInvocationLineage = options.brokenInvocationLineage ?? false;
    this.#leakEntityId = options.leakEntityId ?? false;
    this.#executionErrorCode = options.executionErrorCode;
    this.#ambiguousSkillEvidenceReference = options.ambiguousSkillEvidenceReference ?? false;
    this.#brokenSkillEvidenceMetadata = options.brokenSkillEvidenceMetadata ?? false;
    this.#extraWorkflowInput = options.extraWorkflowInput ?? false;
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Readonly<Record<string, unknown>>)
        : undefined;
    this.calls.push({ method, url, headers, ...(body === undefined ? {} : { body }) });

    if (url.origin === CONTROL_ORIGIN) {
      if (headers.get('authorization') !== `Bearer ${CONTROL_TOKEN}`)
        return Promise.resolve(json({ code: 'UNAUTHORIZED' }, 401));
      return Promise.resolve(this.#control(url));
    }
    if (url.origin !== RUNTIME_ORIGIN) return Promise.resolve(json({ code: 'NOT_FOUND' }, 404));
    return Promise.resolve(method === 'POST' ? this.#execute(headers, body) : this.#runtime(url));
  };

  #control(url: URL): Response {
    const contract = contractForPath(url.pathname);
    if (contract === undefined) return json({ code: 'NOT_FOUND' }, 404);
    const authority = buildAuthority(contract);
    if (url.pathname.includes('/mcp-provider-bindings/')) {
      return json({
        ...authority.binding,
        availabilityValidUntil:
          authority.binding.bindingId === this.#staleBindingId
            ? '2026-08-10T11:59:59.000Z'
            : VALID_UNTIL,
      });
    }
    if (url.pathname.endsWith('/implementations'))
      return json({ items: [authority.implementation] });
    if (url.pathname.includes('/node-capabilities/')) return json(authority.capability);
    if (url.pathname.includes('/skills/')) return json(authority.governedSkill);
    return json({ code: 'NOT_FOUND' }, 404);
  }

  #runtime(url: URL): Response {
    const contract = contractForPath(url.pathname);
    if (url.pathname.includes('/skills/') && contract !== undefined)
      return json(buildAuthority(contract).runtimeSkill);
    if (url.pathname.includes('/mcp/servers/') && url.pathname.endsWith('/tools')) {
      const toolContract = HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS.find(
        (item) => item.localServerId === decodeURIComponent(url.pathname.split('/')[5] ?? ''),
      );
      if (toolContract === undefined) return json({ items: [] });
      const authority = buildAuthority(toolContract);
      return json({
        items: [
          authority.tool,
          {
            ...authority.tool,
            toolName:
              toolContract.kind === 'main_light' ? 'light_set_power' : 'climate_set_temperature',
            taskExecutionProfile: { taskBehavior: 'task_required' },
          },
        ],
      });
    }
    const taskMatch = /^\/api\/v1\/tasks\/([^/]+)$/u.exec(url.pathname);
    if (taskMatch !== null) return json(this.#requireFixture(taskMatch[1]).task);
    const executionsMatch = /^\/api\/v1\/tasks\/([^/]+)\/skill-executions$/u.exec(url.pathname);
    if (executionsMatch !== null)
      return json(this.#requireFixture(executionsMatch[1]).skillExecutions);
    const traceMatch = /^\/api\/v1\/workflows\/plans\/([^/]+)\/trace$/u.exec(url.pathname);
    if (traceMatch !== null) {
      const fixture = [...this.#fixtures.values()].find(
        (item) => item.trace['instance'] !== undefined && planId(item.trace) === traceMatch[1],
      );
      return fixture === undefined ? json({ code: 'NOT_FOUND' }, 404) : json(fixture.trace);
    }
    if (url.pathname === '/api/v1/mcp/invocations') {
      const taskId = url.searchParams.get('taskId') ?? '';
      return json(this.#requireFixture(taskId).invocations);
    }
    return json({ code: 'NOT_FOUND' }, 404);
  }

  #execute(headers: Headers, body: Readonly<Record<string, unknown>> | undefined): Response {
    if (headers.get('authorization') !== `Bearer ${RUNTIME_COGNITIVE_TOKEN}`)
      return json({ code: 'COGNITIVE_MANAGEMENT_UNAUTHORIZED' }, 401);
    if (headers.get('idempotency-key') !== body?.['taskId'])
      return json({ code: 'IDEMPOTENCY_KEY_REQUIRED' }, 400);
    const contract = HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS.find(
      (item) => item.capabilityId === body['capabilityId'],
    );
    if (contract === undefined || body['toolName'] !== contract.toolName)
      return json({ code: 'DETERMINISTIC_READ_ONLY_CONTRACT_NOT_EXACT' }, 400);
    if (this.#executionErrorCode !== undefined)
      return json(
        {
          error: {
            code: this.#executionErrorCode,
            message: 'Redacted public API error.',
          },
        },
        400,
      );
    const taskId = String(body['taskId']);
    const contextId = String(body['contextId']);
    const goalId = `goal-${taskId}`;
    const planIdValue = `plan-${taskId}`;
    const instanceId = `workflow-instance-${taskId}`;
    const invocationId = `mcp-invocation-${taskId}`;
    const evidenceId = `provider-evidence-${taskId}`;
    const result: Record<string, unknown> = {
      ...(contract.kind === 'main_light'
        ? {
            power: 'off',
            reachable: true,
            observedAt: PROVIDER_NOW,
            resourceId: contract.resourceId,
            brightnessPercent: null,
          }
        : {
            power: 'on',
            hvacMode: 'cool',
            reachable: true,
            observedAt: PROVIDER_NOW,
            resourceId: contract.resourceId,
            temperatureUnit: '°C',
            targetTemperature: 24,
            currentTemperature: 25.1,
          }),
      ...(this.#leakEntityId && contract.kind === 'main_light'
        ? { entity_id: 'light.living_room' }
        : {}),
    };
    const providerId = providerIdFor(contract);
    const evidence = {
      evidenceId,
      evidenceType: contract.evidenceType,
      observedAt: PROVIDER_NOW,
      subjectRef: `resource:${contract.resourceId}`,
      producer: ['home-assistant', providerId],
      payloadRef: {
        kind: 'structured_content',
        jsonPointer: contract.kind === 'main_light' ? '/power' : '/hvacMode',
      },
    };
    const executionResponse = {
      schemaVersion: 'sdar.deterministic-read-only-capability-execution/v1',
      status: 'succeeded',
      execution: {
        taskId,
        capabilityBindingId: contract.capabilityBindingId,
        capabilityBindingVersion: 1,
        capabilityId: contract.capabilityId,
        capabilityVersion: contract.capabilityVersion,
        skillId: contract.skillId,
        skillVersion: contract.skillVersion,
        workflowPlanId: planIdValue,
        workflowInstanceId: instanceId,
        mcpProviderBindingId: contract.mcpProviderBindingId,
        mcpInvocationId: invocationId,
        providerId,
        serverId: contract.localServerId,
        toolName: contract.toolName,
        resourceId: contract.resourceId,
      },
      result,
      evidence: [
        {
          requirementId: 'evidence-1',
          evidenceType: contract.evidenceType,
          required: true,
          hardGate: true,
          satisfied: true,
          evidenceId,
          observedAt: PROVIDER_NOW,
          payloadRef: evidence.payloadRef,
        },
      ],
      safety: {
        executionMode: 'live',
        physicalWrites: 0,
        modelCalls: 0,
        mcpCalls: 1,
        identifierAuthority: 'public_resource_id',
      },
    };
    const providerResult = {
      content: [{ type: 'text', text: 'state returned' }],
      structuredContent: result,
      isError: false,
      evidence: [evidence],
    };
    this.#fixtures.set(taskId, {
      task: {
        taskId,
        contextId,
        requestMetadata: {
          'io.sdar/deterministicCapabilityExecution': {
            schemaVersion: '1.0',
            capabilityBindingId: contract.capabilityBindingId,
            capabilityBindingVersion: 1,
            capabilityId: contract.capabilityId,
            capabilityVersion: 1,
            skillId: contract.skillId,
            skillVersion: 1,
            mcpProviderBindingId: contract.mcpProviderBindingId,
            providerId,
            serverId: contract.localServerId,
            toolName: contract.toolName,
            resourceId: contract.resourceId,
          },
        },
        phase: 'completed',
        goalId,
        goalVersion: 1,
        planId: planIdValue,
        selectedSkillId: contract.skillId,
        selectedSkillVersion: 1,
        skillSelectionId: `selection-${taskId}`,
        skillInputResolutionId: `resolution-${taskId}`,
        output: { text: 'state returned', structured: result },
      },
      skillExecutions: {
        items: [
          {
            executionId: `skill-execution-${taskId}`,
            taskId,
            goalId,
            goalVersion: 1,
            skillId: contract.skillId,
            skillVersion: 1,
            workflowPlanId: planIdValue,
            status: 'completed',
            events: [],
            references: [
              reference('provider', contract.mcpProviderBindingId, 'mcp.provider_binding'),
              reference('evidence', contract.capabilityBindingId, 'node.capability_binding'),
              reference('resource', contract.resourceId, 'public.resource'),
              reference('outcome', invocationId, 'mcp.invocation'),
              reference(
                'evidence',
                `${evidenceId}/evidence-1`,
                contract.evidenceType,
                providerId,
                {
                  providerEvidenceId: this.#brokenSkillEvidenceMetadata
                    ? `broken-${evidenceId}`
                    : evidenceId,
                  requirementId: 'evidence-1',
                  matched: true,
                  hardGate: true,
                  jsonPointer: evidence.payloadRef.jsonPointer,
                },
                PROVIDER_RECORDED_AT,
              ),
              ...(this.#ambiguousSkillEvidenceReference && contract.kind === 'main_light'
                ? [
                    reference(
                      'evidence',
                      `${evidenceId}/duplicate`,
                      contract.evidenceType,
                      providerId,
                      {},
                      PROVIDER_RECORDED_AT,
                    ),
                  ]
                : []),
            ],
          },
        ],
      },
      trace: {
        instance: {
          instanceId,
          planId: planIdValue,
          goalId,
          goalVersion: 1,
          skillVersions: [{ skillId: contract.skillId, version: 1 }],
          budgetUsage: { llmCalls: 0, mcpCalls: 1 },
          status: 'succeeded',
          input: {
            context: {
              'public-resource-id': true,
              'provider-binding-freshness': true,
            },
            evidence: {},
            skillInput: { resourceId: contract.resourceId },
            ...(this.#extraWorkflowInput && contract.kind === 'main_light'
              ? { physicalResourceId: 'home-assistant-device-opaque' }
              : {}),
          },
          result,
        },
        events: [],
      },
      invocations: {
        items: [
          {
            invocationId:
              this.#brokenInvocationLineage && contract.kind === 'main_light'
                ? `broken-${invocationId}`
                : invocationId,
            taskId,
            contextId,
            executionMode: 'live',
            serverId: contract.localServerId,
            toolName: contract.toolName,
            arguments: { resourceId: contract.resourceId },
            result: providerResult,
            status: 'succeeded',
          },
        ],
      },
    });
    return json(executionResponse, 201);
  }

  #requireFixture(taskId: string | undefined): ExecutionFixture {
    const fixture = taskId === undefined ? undefined : this.#fixtures.get(taskId);
    if (fixture === undefined) throw new Error(`Missing fixture for ${String(taskId)}`);
    return fixture;
  }
}

function buildAuthority(contract: HomeLabReadOnlyExecutionContract) {
  const providerId = providerIdFor(contract);
  const inputSchema = {
    type: 'object',
    properties: { resourceId: { type: 'string', enum: [contract.resourceId] } },
    required: ['resourceId'],
    additionalProperties: false,
  };
  const outputSchema = {
    type: 'object',
    anyOf: [
      contract.kind === 'main_light'
        ? {
            type: 'object',
            required: ['resourceId', 'power', 'reachable', 'brightnessPercent', 'observedAt'],
            properties: {
              power: { enum: ['on', 'off', 'unknown', 'unavailable'], type: 'string' },
              reachable: { type: 'boolean' },
              observedAt: { type: 'string', format: 'date-time' },
              resourceId: { type: 'string' },
              brightnessPercent: { type: ['number', 'null'] },
            },
            additionalProperties: false,
          }
        : {
            type: 'object',
            required: [
              'resourceId',
              'power',
              'reachable',
              'hvacMode',
              'currentTemperature',
              'targetTemperature',
              'temperatureUnit',
              'observedAt',
            ],
            properties: {
              power: { enum: ['on', 'off', 'unknown', 'unavailable'], type: 'string' },
              hvacMode: { type: ['string', 'null'] },
              reachable: { type: 'boolean' },
              observedAt: { type: 'string', format: 'date-time' },
              resourceId: { type: 'string' },
              temperatureUnit: { type: 'string' },
              targetTemperature: { type: ['number', 'null'] },
              currentTemperature: { type: ['number', 'null'] },
            },
            additionalProperties: false,
          },
      {
        type: 'object',
        required: ['outcome', 'reasonCode', 'retryable', 'completedAt'],
        properties: {
          outcome: { type: 'string', minLength: 1 },
          retryable: { type: 'boolean' },
          reasonCode: { type: 'string', minLength: 1 },
          completedAt: { type: 'string', format: 'date-time' },
        },
        additionalProperties: true,
      },
    ],
  };
  const requiredTool = { serverId: contract.localServerId, toolName: contract.toolName };
  const usageSpecification = {
    apiVersion: 'sdar.io/v1alpha1',
    visibility: { userSelectable: true, composable: true, internalOnly: false },
    normative: {
      constraints: [],
      forbiddenActions: [],
      requiredConfirmations: [],
      noApplicableSkill: 'reject',
    },
    contextRequirements: [],
    taskBindings: [
      {
        bindingId: `task-binding-${contract.skillId}-v1`,
        taskType: contract.toolName,
        providerPolicy: {
          selection: 'required',
          preferredProviderIds: [],
          requiredProviderId: contract.localServerId,
          forbiddenProviderIds: [],
          requiredAttributes: ['task_behavior:synchronous_only'],
        },
      },
    ],
    adaptive: { instructions: [], optimizationHints: [], allowPreferredProviderFallback: false },
    modes: {
      supported: ['procedure'],
      defaultMode: 'procedure',
      procedure: { summary: 'Exact read.', instructions: ['Read once.'] },
    },
    evidencePolicy: {
      requirements: [
        {
          requirementId: 'evidence-1',
          evidenceType: contract.evidenceType,
          required: true,
          hardGate: true,
        },
      ],
      rejectSuccessWithoutRequiredEvidence: true,
    },
  };
  const outcomeSpecification = {
    schemaVersion: '1.0',
    skillId: contract.skillId,
    skillVersion: 1,
    effects: [`effect.${contract.kind}.state_read`],
    evidence: [contract.evidenceType],
    artifacts: [],
    taskGoalPolicy: {},
    confidencePolicy: {},
    sideEffectPolicy: { sideEffecting: false, confirmation: 'not_required' },
    specificationHash: `sha256:${CHECKSUM}`,
  };
  const providerPolicyOverride = {
    selection: 'required',
    mcpProviderBindingId: contract.mcpProviderBindingId,
    localServerId: contract.localServerId,
    mcpToolName: contract.toolName,
    allowedResourceIds: [contract.resourceId],
    requireActive: true,
    requireAvailable: true,
    requireUnexpiredFreshness: true,
    denyFallback: true,
  };
  return {
    binding: {
      bindingId: contract.mcpProviderBindingId,
      localServerId: contract.localServerId,
      originType: 'smpp_registry',
      smppSourceId: `smpp-source-${contract.kind}`,
      externalProviderId: providerId,
      externalServerId: `external-server-${contract.kind}`,
      registryRevision: 7,
      registryChecksum: CHECKSUM,
      catalogRevision: 'catalog-7',
      catalogChecksum: CHECKSUM,
      endpointRef: 'never-projected-endpoint-ref',
      status: 'active',
      availabilityStatus: 'available',
      availabilityValidUntil: VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: 1,
      revision: 3,
    },
    capability: {
      capabilityId: contract.capabilityId,
      version: 1,
      domain: contract.kind === 'main_light' ? 'home.light' : 'home.climate',
      name: 'Read state',
      description: 'Read one public resource.',
      inputSchema,
      outputSchema,
      successCriteria: [],
      requiredEvidence: [
        {
          type: 'required_evidence',
          evidenceType: contract.evidenceType,
          required: true,
          hardGate: true,
        },
      ],
      effects: [],
      artifacts: [],
      constraints: [
        {
          type: 'resource_policy',
          identifierAuthority: 'public_resource_id',
          selection: 'request_value',
          allowedResourceIds: [contract.resourceId],
          physicalResourceBinding: 'forbidden',
        },
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: contract.mcpProviderBindingId,
          localServerId: contract.localServerId,
          mcpToolName: contract.toolName,
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
        {
          type: 'exact_skill_version',
          skillId: contract.skillId,
          skillVersion: 1,
          taskType: contract.toolName,
        },
        { type: 'confirmation_policy', required: false, stage: 'not_applicable' },
      ],
      supportedModes: ['deterministic'],
      riskLevel: 'low',
      status: 'published',
      definitionHash: CHECKSUM,
    },
    implementation: {
      bindingId: contract.capabilityBindingId,
      capabilityId: contract.capabilityId,
      capabilityVersion: 1,
      implementationType: 'skill',
      implementationId: contract.skillId,
      implementationVersion: '1',
      role: 'primary',
      priority: 0,
      providerPolicyOverride,
      status: 'active',
      revision: 1,
    },
    governedSkill: {
      skillId: contract.skillId,
      version: 1,
      status: 'published',
      inputSchema,
      outputSchema,
      usageSpecification,
      outcomeSpecification,
      providerPolicy: { required: [requiredTool], optional: [], forbidden: [] },
      evidencePolicy: { requiredEvidence: [contract.evidenceType] },
    },
    runtimeSkill: {
      skillId: contract.skillId,
      version: 1,
      capabilities: [contract.capabilityId],
      inputSchema,
      outputSchema,
      toolPolicy: { required: [requiredTool], optional: [], forbidden: [] },
      runtimePolicy: { maxLlmCalls: 0, maxMcpCalls: 1 },
      usageSpecification,
      outcomeSpecification,
      status: 'enabled',
    },
    tool: {
      serverId: contract.localServerId,
      toolName: contract.toolName,
      inputSchema,
      outputSchema,
      protocolMode: 'frozen_v1',
      taskExecutionProfile: { taskBehavior: 'synchronous_only' },
    },
  } as const;
}

function contractForPath(pathname: string): HomeLabReadOnlyExecutionContract | undefined {
  return HOME_LAB_READ_ONLY_EXECUTION_CONTRACTS.find(
    (contract) =>
      pathname.includes(encodeURIComponent(contract.capabilityId)) ||
      pathname.includes(contract.capabilityId) ||
      pathname.includes(encodeURIComponent(contract.skillId)) ||
      pathname.includes(contract.skillId) ||
      pathname.includes(encodeURIComponent(contract.mcpProviderBindingId)) ||
      pathname.includes(contract.mcpProviderBindingId),
  );
}

function providerIdFor(contract: HomeLabReadOnlyExecutionContract): string {
  return contract.kind === 'main_light' ? 'ha-light-lab' : 'ha-climate-lab';
}

function reference(
  kind: string,
  referenceId: string,
  referenceType: string,
  sourceSystem = 'test',
  metadata: Readonly<Record<string, unknown>> = {},
  producedAt?: string,
) {
  return {
    kind,
    referenceId,
    referenceType,
    sourceSystem,
    metadata,
    ...(producedAt === undefined ? {} : { producedAt }),
  };
}

function planId(trace: Readonly<Record<string, unknown>>): string | undefined {
  const instance = trace['instance'];
  return typeof instance === 'object' && instance !== null && 'planId' in instance
    ? String(instance.planId)
    : undefined;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
