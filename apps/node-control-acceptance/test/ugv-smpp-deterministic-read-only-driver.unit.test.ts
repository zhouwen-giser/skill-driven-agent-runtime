import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  deriveFrozenMcpCatalogAuthority,
  type McpProtocolDiscoverySnapshot,
  type McpTool,
} from '../../../packages/domain/src/index.js';
import {
  executeUgvDeterministicReadOnly,
  type UgvDeterministicReadOnlyConfiguration,
} from '../src/ugv-smpp-deterministic-read-only-driver.js';
import {
  stableIdentifier,
  type UgvReadOnlyGovernanceAuthority,
} from '../src/ugv-smpp-read-only-authority.js';

const NOW = '2026-08-12T08:00:00.000Z';
const VALID_UNTIL = '2026-08-12T09:00:00.000Z';
const PROVIDER_TIME = '2026-08-12T08:00:00.123456+00:00';
const CONTROL = 'http://127.0.0.1:21080';
const RUNTIME = 'http://127.0.0.1:21081';
const CONTROL_TOKEN = 'node-control-token-never-report';
const RUNTIME_SERVICE_TOKEN = 'runtime-service-token-never-report';
const COGNITIVE_TOKEN = 'runtime-cognitive-token-never-report';
const RESOURCE_ID = 'vehicle:ugv1';
const SERVER_ID = 'ugv-smpp-runtime';
const PROVIDER_ID = 'isr.vehicle.ugv.ugv1';
const EXTERNAL_SERVER_ID = 'production-ugv-direct-1';
const BINDING_ID = 'mcp-binding-ugv-smpp';
const CAPABILITY_ID = 'vehicle.ugv.read-state';
const CAPABILITY_BINDING_ID = 'capability-binding-vehicle.ugv.read-state-v1';
const SKILL_ID = 'ugv.get-state';
const TOOL_NAME = 'vehicle_get_state';
const EVIDENCE_TYPE = 'vehicle.state.observation';
const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);

describe('UGV deterministic read-only acceptance driver', () => {
  it('proves the exact real-plane lineage and idempotent replay with zero model/write calls', async () => {
    const api = new FakeUgvReadOnlyApis();
    const input = configuration({
      executionMode: 'simulation',
      simulationId: 'ugv-simulation-unit-1',
    });
    const report = await executeUgvDeterministicReadOnly(input, {
      fetch: api.fetch,
      now: () => NOW,
      governanceAuthority: api.governance,
    });

    expect(report).toMatchObject({
      status: 'passed',
      evidenceClass: 'real_simulation_sdar_and_external_smpp',
      mode: 'execute',
      executionMode: 'simulation',
      simulationId: 'ugv-simulation-unit-1',
      deterministicReadOnlyReady: false,
      restartRecoveryVerified: false,
      safety: {
        modelCalls: 0,
        physicalWrites: 0,
        mcpCalls: 1,
        onlyExplicitReadOnlyTools: true,
      },
    });
    expect(report.executions).toEqual([
      expect.objectContaining({
        operationName: TOOL_NAME,
        capabilityId: CAPABILITY_ID,
        capabilityBindingId: CAPABILITY_BINDING_ID,
        skillId: SKILL_ID,
        resourceId: RESOURCE_ID,
        schemaValidated: true,
        idempotentReplayVerified: true,
        remoteTaskCount: 0,
        catalog: expect.objectContaining({
          checksum: api.catalog.catalogChecksum,
          executionSemantics: 'explicit_read_only_synchronous',
          schemaAlignment: true,
        }),
        smppLineage: expect.objectContaining({
          externalProviderId: PROVIDER_ID,
          externalServerId: EXTERNAL_SERVER_ID,
          projectionContract: 'sdar-registry-v1',
        }),
      }),
    ]);
    expect(api.executionPosts).toBe(2);
    const expectedTaskId = stableIdentifier('task-ugv-read', input.runId, TOOL_NAME);
    expect(api.executionIdempotencyKeys).toEqual([expectedTaskId, expectedTaskId]);
    expect(api.executionTools).toEqual([TOOL_NAME, TOOL_NAME]);
    expect(api.callsBeforeFirstPost.every((call) => call.method === 'GET')).toBe(true);
    const serialized = JSON.stringify(report);
    for (const secret of [CONTROL_TOKEN, RUNTIME_SERVICE_TOKEN, COGNITIVE_TOKEN, CONTROL, RUNTIME])
      expect(serialized).not.toContain(secret);
  });

  it('verifies post-restart recovery using only persisted GET evidence and no new MCP dispatch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sdar-ugv-readonly-'));
    const checkpointFile = join(directory, 'checkpoint.json');
    const api = new FakeUgvReadOnlyApis();
    try {
      await executeUgvDeterministicReadOnly(configuration({ mode: 'execute', checkpointFile }), {
        fetch: api.fetch,
        now: () => NOW,
        governanceAuthority: api.governance,
      });
      const postsAfterExecute = api.executionPosts;
      const recovered = await executeUgvDeterministicReadOnly(
        configuration({
          mode: 'verify-restart',
          checkpointFile,
          restartEvidenceId: 'runtime-restart-observation-unit-1',
        }),
        {
          fetch: api.fetch,
          now: () => NOW,
          governanceAuthority: api.governance,
        },
      );

      expect(recovered).toMatchObject({
        status: 'passed',
        mode: 'verify-restart',
        deterministicReadOnlyReady: true,
        restartRecoveryVerified: true,
        restartEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        safety: { modelCalls: 0, physicalWrites: 0, mcpCalls: 1 },
      });
      expect(api.executionPosts).toBe(postsAfterExecute);
      const checkpoint = await readFile(checkpointFile, 'utf8');
      for (const secret of [
        CONTROL_TOKEN,
        RUNTIME_SERVICE_TOKEN,
        COGNITIVE_TOKEN,
        CONTROL,
        RUNTIME,
      ])
        expect(checkpoint).not.toContain(secret);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('fails closed on unknown semantics before either deterministic execution POST', async () => {
    const api = new FakeUgvReadOnlyApis({ unknownSemantics: true });

    await expect(
      executeUgvDeterministicReadOnly(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
        governanceAuthority: api.governance,
      }),
    ).rejects.toMatchObject({ code: 'UGV_TOOL_SEMANTICS_NOT_EXPLICIT_READ_ONLY' });
    expect(api.executionPosts).toBe(0);
  });

  it('requires the mandatory read-state governance contract before network access', async () => {
    const api = new FakeUgvReadOnlyApis({ noReadStateGovernance: true });

    await expect(
      executeUgvDeterministicReadOnly(configuration(), {
        fetch: api.fetch,
        now: () => NOW,
        governanceAuthority: api.governance,
      }),
    ).rejects.toMatchObject({ code: 'UGV_READ_STATE_GOVERNANCE_REQUIRED' });
    expect(api.calls).toHaveLength(0);
  });
});

function configuration(
  overrides: Partial<UgvDeterministicReadOnlyConfiguration> = {},
): UgvDeterministicReadOnlyConfiguration {
  return {
    nodeControlBaseUrl: CONTROL,
    nodeControlBearerToken: CONTROL_TOKEN,
    nodeControlRuntimeServiceToken: RUNTIME_SERVICE_TOKEN,
    runtimeManagementBaseUrl: RUNTIME,
    runtimeCognitiveBearerToken: COGNITIVE_TOKEN,
    governanceReportFile: 'not-read-by-fixture',
    runId: 'ugv-readonly-unit-fixture',
    ...overrides,
  };
}

interface FakeOptions {
  readonly unknownSemantics?: boolean;
  readonly noReadStateGovernance?: boolean;
}

interface Call {
  readonly method: string;
  readonly url: string;
}

class FakeUgvReadOnlyApis {
  readonly calls: Call[] = [];
  readonly executionIdempotencyKeys: string[] = [];
  readonly executionTools: string[] = [];
  readonly snapshot: McpProtocolDiscoverySnapshot;
  readonly tool: McpTool;
  readonly catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>;
  readonly governance: UgvReadOnlyGovernanceAuthority;
  private executionMode: 'live' | 'simulation' = 'live';
  private simulationId: string | undefined;

  constructor(options: FakeOptions = {}) {
    this.snapshot = snapshot();
    this.tool = tool(options.unknownSemantics === true);
    this.catalog = deriveFrozenMcpCatalogAuthority(this.snapshot, [this.tool], 1);
    this.governance = governance(this.catalog, options.noReadStateGovernance === true);
  }

  get executionPosts(): number {
    return this.calls.filter((call) => call.method === 'POST').length;
  }

  get callsBeforeFirstPost(): readonly Call[] {
    const index = this.calls.findIndex((call) => call.method === 'POST');
    return index < 0 ? this.calls : this.calls.slice(0, index);
  }

  readonly fetch: typeof fetch = (input, init) => {
    const address =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(address);
    const method = init?.method ?? 'GET';
    this.calls.push({ method, url: url.toString() });
    if (method === 'POST') return Promise.resolve(this.execute(url, init));
    if (url.origin === CONTROL) return Promise.resolve(this.controlGet(url, init));
    if (url.origin === RUNTIME) return Promise.resolve(this.runtimeGet(url));
    return Promise.resolve(json({ code: 'UNEXPECTED_AUTHORITY' }, 500));
  };

  private controlGet(url: URL, init: RequestInit | undefined): Response {
    const headers = new Headers(init?.headers);
    if (url.pathname.startsWith('/internal/')) {
      if (headers.get('authorization') !== `Bearer ${RUNTIME_SERVICE_TOKEN}`)
        return json({ code: 'INVALID_RUNTIME_SERVICE_TOKEN' }, 401);
      return json(currentBinding(this.catalog));
    }
    if (headers.get('authorization') !== `Bearer ${CONTROL_TOKEN}`)
      return json({ code: 'INVALID_CONTROL_TOKEN' }, 401);
    if (url.pathname.endsWith('/implementations'))
      return json({ items: [implementation(this.catalog)] });
    if (url.pathname.includes('/node-capabilities/')) return json(capability(this.catalog));
    if (url.pathname.includes('/capability-readiness/')) return json(readiness());
    return json({ code: 'CONTROL_PATH_UNEXPECTED' }, 404);
  }

  private runtimeGet(url: URL): Response {
    const taskId = stableIdentifier('task-ugv-read', configuration().runId, TOOL_NAME);
    const goalId = deterministicGoalId(taskId);
    const planId = 'plan-ugv-read-1';
    const instanceId = 'workflow-instance-ugv-read-1';
    const invocationId = 'mcp-invocation-ugv-read-1';
    const result = structuredResult();
    if (url.pathname === `/api/v1/skills/${SKILL_ID}/versions/1`) return json(skill(this.catalog));
    if (url.pathname === '/api/v1/mcp/servers')
      return json({ items: [runtimeServer(this.snapshot)] });
    if (url.pathname === `/api/v1/mcp/servers/${SERVER_ID}/tools`)
      return json({ items: [this.tool] });
    if (url.pathname === `/api/v1/tasks/${taskId}`)
      return json(runtimeTask(taskId, goalId, planId, result));
    if (url.pathname === `/api/v1/goals/${goalId}`)
      return json({ goalId, contextId: contextId(), version: 1, status: 'achieved' });
    if (url.pathname === `/api/v1/workflows/plans/${planId}`)
      return json({ planId, goalId, goalVersion: 1, definition: { nodes: [], edges: [] } });
    if (url.pathname === `/api/v1/tasks/${taskId}/skill-executions`)
      return json({ items: [skillExecution(taskId, goalId, planId, invocationId)] });
    if (url.pathname === `/api/v1/workflows/plans/${planId}/trace`)
      return json(trace(goalId, planId, instanceId, result));
    if (url.pathname === '/api/v1/mcp/invocations')
      return json({
        items: [
          invocation(
            taskId,
            invocationId,
            result,
            this.tool,
            this.executionMode,
            this.simulationId,
          ),
        ],
      });
    if (url.pathname === '/api/v1/models/invocations') return json({ items: [] });
    if (url.pathname === `/api/v1/tasks/${taskId}/remote-task-lifecycle`)
      return json({ items: [] });
    return json({ code: 'RUNTIME_PATH_UNEXPECTED' }, 404);
  }

  private execute(_url: URL, init: RequestInit | undefined): Response {
    const headers = new Headers(init?.headers);
    if (headers.get('authorization') !== `Bearer ${COGNITIVE_TOKEN}`)
      return json({ code: 'INVALID_COGNITIVE_TOKEN' }, 401);
    if (typeof init?.body !== 'string') return json({ code: 'BODY_REQUIRED' }, 400);
    const parsed: unknown = JSON.parse(init.body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return json({ code: 'BODY_INVALID' }, 400);
    const body = parsed as Readonly<Record<string, unknown>>;
    if (headers.get('idempotency-key') !== body['taskId'])
      return json({ code: 'DETERMINISTIC_IDEMPOTENCY_IDENTITY_MISMATCH' }, 409);
    if (typeof body['toolName'] !== 'string') return json({ code: 'TOOL_REQUIRED' }, 400);
    this.executionMode = body['executionMode'] === 'simulation' ? 'simulation' : 'live';
    this.simulationId = typeof body['simulationId'] === 'string' ? body['simulationId'] : undefined;
    this.executionIdempotencyKeys.push(headers.get('idempotency-key') ?? '');
    this.executionTools.push(body['toolName']);
    return json(executionResponse(body), 201);
  }
}

function snapshot(): McpProtocolDiscoverySnapshot {
  return {
    snapshotId: 'snapshot-ugv-1',
    serverId: SERVER_ID,
    protocolMode: 'frozen_v1',
    protocolVersion: '2025-11-25',
    baselineSha256: CHECKSUM_A,
    supportedVersions: ['2025-11-25'],
    capabilities: {},
    serverInfo: { name: 'ugv-smpp', version: '1' },
    taskNotifications: false,
    discoveredAt: NOW,
    validUntil: VALID_UNTIL,
    toolRevision: 1,
  };
}

function tool(unknownSemantics: boolean): McpTool {
  const semantics = unknownSemantics
    ? {
        effect: 'unknown' as const,
        execution: 'unknown' as const,
        cancellation: 'unknown' as const,
        idempotency: 'unknown' as const,
        replay: 'unknown' as const,
        source: 'default_unknown' as const,
      }
    : {
        effect: 'read_only' as const,
        execution: 'synchronous' as const,
        cancellation: 'unsupported' as const,
        idempotency: 'none' as const,
        replay: 'allowed' as const,
        source: 'admin_override' as const,
      };
  return {
    serverId: SERVER_ID,
    toolName: TOOL_NAME,
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    protocolMode: 'frozen_v1',
    executionSemantics: semantics,
    ...(unknownSemantics ? {} : { adminExecutionSemanticsOverride: semantics }),
    taskExecutionProfile: {
      profileVersion: '1.0',
      taskBehavior: 'synchronous_only',
      availability: 'not_supported',
      supportsScheduling: false,
      supportsMaxElapsed: false,
      supportsObservations: false,
      supportsInputRequired: false,
      idempotency: 'none',
    },
    discoveredAt: NOW,
  };
}

function governance(
  catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>,
  empty: boolean,
): UgvReadOnlyGovernanceAuthority {
  return {
    schemaVersion: 'sdar.ugv-smpp-capability-governance/v1',
    status: 'passed',
    observedAt: NOW,
    binding: {
      bindingId: BINDING_ID,
      localServerId: SERVER_ID,
      revision: 1,
      registryRevision: 1,
      registryChecksum: CHECKSUM_A,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      operationCount: catalog.operationCount,
      availabilityValidUntil: VALID_UNTIL,
    },
    resourcePolicy: {
      identifierAuthority: 'public_smpp_tool_schema',
      resourceId: RESOURCE_ID,
      selection: 'single_schema_value',
    },
    catalog: {
      discoveredToolCount: 1,
      governedToolCount: empty ? 1 : 1,
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
    skills: empty
      ? [
          {
            skillId: 'ugv.navigate',
            skillVersion: 1,
            capabilityId: 'vehicle.ugv.navigate',
            toolName: 'vehicle_navigate',
            packageChecksum: CHECKSUM_A,
            inputSchemaSha256: CHECKSUM_A,
            outputSchemaSha256: CHECKSUM_B,
            action: 'imported',
            status: 'published',
          },
        ]
      : [
          {
            skillId: SKILL_ID,
            skillVersion: 1,
            capabilityId: CAPABILITY_ID,
            toolName: TOOL_NAME,
            packageChecksum: CHECKSUM_A,
            inputSchemaSha256: CHECKSUM_A,
            outputSchemaSha256: CHECKSUM_B,
            action: 'imported',
            status: 'published',
          },
        ],
    capabilities: empty
      ? [
          {
            capabilityId: 'vehicle.ugv.navigate',
            capabilityVersion: 1,
            definitionHash: CHECKSUM_A,
            implementationBindingId: 'capability-binding-navigate',
            skillId: 'ugv.navigate',
            skillVersion: 1,
            toolName: 'vehicle_navigate',
            riskLevel: 'medium',
            confirmation: 'required',
            remoteTerminalEvidenceRequired: true,
            readiness: 'available',
            readinessValidUntil: VALID_UNTIL,
          },
        ]
      : [
          {
            capabilityId: CAPABILITY_ID,
            capabilityVersion: 1,
            definitionHash: CHECKSUM_A,
            implementationBindingId: CAPABILITY_BINDING_ID,
            skillId: SKILL_ID,
            skillVersion: 1,
            toolName: TOOL_NAME,
            riskLevel: 'low',
            confirmation: 'not_required',
            remoteTerminalEvidenceRequired: false,
            readiness: 'available',
            readinessValidUntil: VALID_UNTIL,
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

function currentBinding(catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>) {
  return {
    observedAt: NOW,
    binding: {
      bindingId: BINDING_ID,
      revision: 1,
      localServerId: SERVER_ID,
      originType: 'smpp_registry',
      providerId: PROVIDER_ID,
      externalProviderId: PROVIDER_ID,
      externalServerId: EXTERNAL_SERVER_ID,
      registryRevision: 1,
      registryChecksum: CHECKSUM_A,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      endpointRef: 'https://ugv-runtime.invalid/mcp',
      availabilityValidUntil: VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: catalog.operationCount,
    },
    sourceCandidateLineage: {
      smppSourceId: 'ugv-smpp',
      externalProviderId: PROVIDER_ID,
      externalServerId: EXTERNAL_SERVER_ID,
      registryRevision: 1,
      registryChecksum: CHECKSUM_A,
      nativeRevision: 1,
      nativeChecksum: CHECKSUM_B,
      projectionContract: 'sdar-registry-v1',
      candidateEndpoint: 'https://ugv-runtime.invalid/mcp',
    },
  };
}

function runtimeServer(discovery: McpProtocolDiscoverySnapshot) {
  return {
    serverId: SERVER_ID,
    name: 'UGV SMPP Runtime',
    endpoint: 'https://ugv-runtime.invalid/mcp',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    protocolMode: 'frozen_v1',
    currentProtocolSnapshotId: discovery.snapshotId,
    createdAt: NOW,
    updatedAt: NOW,
    currentDiscovery: discovery,
  };
}

function capability(catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>) {
  return {
    capabilityId: CAPABILITY_ID,
    version: 1,
    name: 'Read UGV state',
    description: 'Return the current governed UGV state.',
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    successCriteria: [
      { type: 'output_schema_valid', required: true },
      { type: 'required_evidence_complete', required: true },
    ],
    requiredEvidence: [
      { type: 'required_evidence', evidenceType: EVIDENCE_TYPE, required: true, hardGate: true },
    ],
    effects: ['observe.vehicle.state'],
    artifacts: ['vehicle.state'],
    constraints: [
      {
        type: 'resource_policy',
        identifierAuthority: 'public_resource_id',
        selection: 'exact_value',
        allowedResourceIds: [RESOURCE_ID],
      },
      {
        type: 'provider_binding_policy',
        mcpProviderBindingId: BINDING_ID,
        localServerId: SERVER_ID,
        mcpToolName: TOOL_NAME,
        bindingRevision: 1,
        catalogRevision: catalog.catalogRevision,
        catalogChecksum: catalog.catalogChecksum,
        taskBehavior: 'synchronous_only',
        executionSemantics: tool(false).executionSemantics,
        requiredStatus: 'active',
        requiredAvailabilityStatus: 'available',
        requiredFreshness: 'unexpired',
        fallback: 'deny',
      },
      { type: 'exact_skill_version', skillId: SKILL_ID, skillVersion: 1, taskType: TOOL_NAME },
      {
        type: 'confirmation_policy',
        required: false,
        stage: 'not_applicable',
        autoConfirmPlan: false,
      },
      { type: 'side_effect_policy', sideEffecting: false },
    ],
    supportedModes: ['deterministic'],
    riskLevel: 'low',
    status: 'published',
    definitionHash: CHECKSUM_A,
  };
}

function implementation(catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>) {
  return {
    bindingId: CAPABILITY_BINDING_ID,
    revision: 1,
    capabilityId: CAPABILITY_ID,
    capabilityVersion: 1,
    implementationType: 'skill',
    implementationId: SKILL_ID,
    implementationVersion: '1',
    role: 'primary',
    priority: 0,
    providerPolicyOverride: {
      selection: 'required',
      mcpProviderBindingId: BINDING_ID,
      localServerId: SERVER_ID,
      mcpToolName: TOOL_NAME,
      catalogChecksum: catalog.catalogChecksum,
    },
    status: 'active',
  };
}

function readiness() {
  return {
    capabilityId: CAPABILITY_ID,
    capabilityVersion: 1,
    status: 'available',
    validUntil: VALID_UNTIL,
    availableImplementations: [CAPABILITY_BINDING_ID],
    unavailableImplementations: [],
  };
}

function skill(catalog: ReturnType<typeof deriveFrozenMcpCatalogAuthority>) {
  const requiredAttributes = [
    'task_behavior:synchronous_only',
    'effect:read_only',
    'execution:synchronous',
    `catalog_checksum:${catalog.catalogChecksum}`,
  ];
  return {
    skillId: SKILL_ID,
    version: 1,
    name: 'Read UGV state',
    summary: 'Read UGV state.',
    description: 'Read one exact public UGV resource.',
    capabilities: [CAPABILITY_ID],
    workflowGuidance: 'Use the exact read Tool.',
    outputInstruction: 'Return structured state.',
    inputSchema: inputSchema(),
    outputSchema: outputSchema(),
    toolPolicy: {
      required: [{ serverId: SERVER_ID, toolName: TOOL_NAME }],
      optional: [],
      forbidden: [{ serverId: SERVER_ID, toolName: 'vehicle_fire_weapon' }],
    },
    runtimePolicy: {
      autoConfirmPlan: false,
      maxReplans: 0,
      maxDurationSeconds: 30,
      maxLlmCalls: 0,
      maxMcpCalls: 1,
    },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: NOW,
    usageSpecification: {
      modes: { supported: ['procedure'], defaultMode: 'procedure' },
      taskBindings: [
        {
          taskType: TOOL_NAME,
          providerPolicy: {
            selection: 'required',
            requiredProviderId: SERVER_ID,
            preferredProviderIds: [],
            forbiddenProviderIds: [],
            requiredAttributes,
          },
        },
      ],
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'vehicle-state',
            evidenceType: EVIDENCE_TYPE,
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
    outcomeSpecification: {
      evidence: [EVIDENCE_TYPE],
      sideEffectPolicy: { sideEffecting: false, confirmation: 'not_required' },
    },
  };
}

function executionResponse(body: Record<string, unknown>) {
  const result = structuredResult();
  return {
    schemaVersion: 'sdar.deterministic-read-only-capability-execution/v1',
    status: 'succeeded',
    execution: {
      taskId: body['taskId'],
      capabilityBindingId: body['capabilityBindingId'],
      capabilityBindingVersion: body['capabilityBindingVersion'],
      capabilityId: body['capabilityId'],
      capabilityVersion: body['capabilityVersion'],
      skillId: body['skillId'],
      skillVersion: body['skillVersion'],
      mcpProviderBindingId: body['mcpProviderBindingId'],
      providerId: body['providerId'],
      serverId: body['serverId'],
      toolName: body['toolName'],
      resourceId: body['resourceId'],
      workflowPlanId: 'plan-ugv-read-1',
      workflowInstanceId: 'workflow-instance-ugv-read-1',
      mcpInvocationId: 'mcp-invocation-ugv-read-1',
    },
    result,
    evidence: [
      {
        requirementId: 'vehicle-state',
        evidenceType: EVIDENCE_TYPE,
        required: true,
        hardGate: true,
        satisfied: true,
        evidenceId: 'evidence-ugv-state-1',
        observedAt: PROVIDER_TIME,
        payloadRef: { kind: 'structured_content', jsonPointer: '' },
      },
    ],
    safety: {
      executionMode: body['executionMode'] ?? 'live',
      ...(body['simulationId'] === undefined ? {} : { simulationId: body['simulationId'] }),
      physicalWrites: 0,
      modelCalls: 0,
      mcpCalls: 1,
      identifierAuthority: 'public_resource_id',
    },
  };
}

function runtimeTask(taskId: string, goalId: string, planId: string, result: unknown) {
  return {
    taskId,
    contextId: contextId(),
    requestMetadata: {
      'io.sdar/deterministicCapabilityExecution': {
        capabilityBindingId: CAPABILITY_BINDING_ID,
        capabilityBindingVersion: 1,
        capabilityId: CAPABILITY_ID,
        capabilityVersion: 1,
        skillId: SKILL_ID,
        skillVersion: 1,
        mcpProviderBindingId: BINDING_ID,
        providerId: PROVIDER_ID,
        serverId: SERVER_ID,
        toolName: TOOL_NAME,
        resourceId: RESOURCE_ID,
      },
    },
    phase: 'completed',
    goalId,
    goalVersion: 1,
    planId,
    selectedSkillId: SKILL_ID,
    selectedSkillVersion: 1,
    skillSelectionId: 'skill-selection-1',
    skillInputResolutionId: 'skill-input-resolution-1',
    output: { text: 'UGV state returned.', structured: result },
  };
}

function skillExecution(taskId: string, goalId: string, planId: string, invocationId: string) {
  return {
    executionId: 'skill-execution-ugv-read-1',
    taskId,
    goalId,
    goalVersion: 1,
    skillId: SKILL_ID,
    skillVersion: 1,
    workflowPlanId: planId,
    status: 'completed',
    references: [
      { kind: 'provider', referenceId: BINDING_ID, referenceType: 'mcp.provider_binding' },
      {
        kind: 'evidence',
        referenceId: CAPABILITY_BINDING_ID,
        referenceType: 'node.capability_binding',
      },
      { kind: 'resource', referenceId: RESOURCE_ID, referenceType: 'public.resource' },
      { kind: 'outcome', referenceId: invocationId, referenceType: 'mcp.invocation' },
    ],
  };
}

function trace(goalId: string, planId: string, instanceId: string, result: unknown) {
  return {
    instance: {
      instanceId,
      planId,
      goalId,
      goalVersion: 1,
      skillVersions: [{ skillId: SKILL_ID, version: 1 }],
      budgetUsage: { llmCalls: 0, mcpCalls: 1 },
      status: 'succeeded',
      input: { resourceId: RESOURCE_ID },
      result,
    },
    events: [{ type: 'workflow.completed' }],
  };
}

function invocation(
  taskId: string,
  invocationId: string,
  result: unknown,
  currentTool: McpTool,
  executionMode: 'live' | 'simulation',
  simulationId?: string,
) {
  return {
    invocationId,
    taskId,
    contextId: contextId(),
    executionMode,
    ...(simulationId === undefined ? {} : { simulationId }),
    serverId: SERVER_ID,
    toolName: TOOL_NAME,
    executionSemantics: currentTool.executionSemantics,
    arguments: { resourceId: RESOURCE_ID },
    result: {
      structuredContent: result,
      isError: false,
      evidence: [
        {
          evidenceId: 'evidence-ugv-state-1',
          evidenceType: EVIDENCE_TYPE,
          observedAt: PROVIDER_TIME,
          subjectRef: `resource:${RESOURCE_ID}`,
          producer: ['ugv-runtime', PROVIDER_ID],
          payloadRef: { kind: 'structured_content', jsonPointer: '' },
        },
      ],
    },
    status: 'succeeded',
  };
}

function inputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { resourceId: { const: RESOURCE_ID } },
    required: ['resourceId'],
  };
}

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { resourceId: { const: RESOURCE_ID }, state: { type: 'string' } },
    required: ['resourceId', 'state'],
  };
}

function structuredResult() {
  return { resourceId: RESOURCE_ID, state: 'idle' };
}

function contextId(): string {
  return stableIdentifier('context-ugv-read', configuration().runId, TOOL_NAME);
}

function deterministicGoalId(taskId: string): string {
  return `goal-deterministic-${createHash('sha256').update(taskId).digest('hex').slice(0, 32)}`;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
