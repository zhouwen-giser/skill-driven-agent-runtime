import { describe, expect, it } from 'vitest';

import type { DeterministicCapabilityExecutionInput } from '../../../packages/management-api/src/index.js';
import {
  deriveFrozenMcpCatalogAuthority,
  type EvidenceJsonValue,
  type McpProtocolDiscoverySnapshot,
  type McpServer,
  type McpTool,
  type SkillVersion,
} from '../../../packages/domain/src/index.js';
import type {
  CapabilityAuthoritySnapshot,
  CurrentMcpProviderBindingAuthoritySnapshot,
} from '../../../packages/runtime-control-application/src/index.js';
import { admitManagedDeterministicReadOnlyCapability } from '../src/managed-deterministic-capability-admission.js';

const NOW = '2026-08-12T12:00:00.000Z';
const VALID_UNTIL = '2026-08-12T12:05:00.000Z';
const CHECKSUM = 'a'.repeat(64);

describe('managed deterministic capability admission', () => {
  it('admits one authority-exact UGV read-only contract and projects its Goal guards', () => {
    const fixture = exactFixture();

    const admitted = admitManagedDeterministicReadOnlyCapability(fixture);

    expect(admitted.evidenceTypes).toEqual(['vehicle.state.observation']);
    expect(admitted.readinessAttributes).toEqual(
      expect.arrayContaining([
        'task_behavior:synchronous_only',
        'effect:read_only',
        'execution:synchronous',
        `catalog_checksum:${fixture.providerBinding.binding.catalogChecksum}`,
      ]),
    );
    expect(admitted.goalConstraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"type":"provider_binding_policy"'),
        expect.stringContaining('"type":"side_effect_policy"'),
      ]),
    );
    expect(admitted.goalSuccessCriteria).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"type":"required_evidence_complete"'),
        expect.stringContaining('"evidenceType":"vehicle.state.observation"'),
      ]),
    );
  });

  it.each([
    ['side_effecting', 'mcp_declared'],
    ['unknown', 'default_unknown'],
  ] as const)('fails closed for %s Tool effect semantics', (effect, source) => {
    const fixture = exactFixture();
    const originalTool = fixture.runtimeTools[0];
    if (originalTool === undefined) throw new Error('TEST_TOOL_MISSING');
    const executionSemantics = {
      ...originalTool.executionSemantics,
      effect,
      source,
    } as McpTool['executionSemantics'];
    const runtimeTools = [
      {
        ...originalTool,
        executionSemantics,
        declaredExecutionSemantics: executionSemantics,
      },
    ];
    const catalog = deriveFrozenMcpCatalogAuthority(
      fixture.runtimeSnapshot,
      runtimeTools,
      fixture.runtimeServer.toolRevision,
    );
    const providerBinding = {
      ...fixture.providerBinding,
      binding: {
        ...fixture.providerBinding.binding,
        catalogChecksum: catalog.catalogChecksum,
      },
    };

    expect(() =>
      admitManagedDeterministicReadOnlyCapability({
        ...fixture,
        runtimeTools,
        providerBinding,
      }),
    ).toThrow(expect.objectContaining({ code: 'DETERMINISTIC_TOOL_SEMANTICS_NOT_READ_ONLY' }));
  });

  it('rejects a physical-write Capability before Skill or Workflow execution', () => {
    const fixture = exactFixture();
    const capability = withDefinition(fixture.capability, (definition) => ({
      ...definition,
      risk_level: 'medium',
      constraints: replaceConstraint(definition['constraints'], 'side_effect_policy', {
        type: 'side_effect_policy',
        sideEffecting: true,
      }),
    }));

    expect(() => admitManagedDeterministicReadOnlyCapability({ ...fixture, capability })).toThrow(
      expect.objectContaining({ code: 'DETERMINISTIC_CAPABILITY_NOT_ADMITTED' }),
    );
  });

  it('rejects resource, current Binding, evidence, and implementation drift', () => {
    const fixture = exactFixture();
    const cases: readonly Readonly<{
      mutate(): Parameters<typeof admitManagedDeterministicReadOnlyCapability>[0];
      code: string;
    }>[] = [
      {
        mutate: () => ({
          ...fixture,
          request: { ...fixture.request, resourceId: 'ugv-public-2' },
        }),
        code: 'DETERMINISTIC_RESOURCE_NOT_ADMITTED',
      },
      {
        mutate: () => ({
          ...fixture,
          providerBinding: {
            ...fixture.providerBinding,
            binding: {
              ...fixture.providerBinding.binding,
              availabilityValidUntil: NOW,
            },
          },
        }),
        code: 'DETERMINISTIC_PROVIDER_BINDING_NOT_CURRENT',
      },
      {
        mutate: () => ({
          ...fixture,
          capability: withDefinition(fixture.capability, (definition) => ({
            ...definition,
            required_evidence: [
              {
                type: 'required_evidence',
                evidenceType: 'vehicle.state.observation',
                required: true,
                hardGate: false,
              },
            ],
          })),
        }),
        code: 'DETERMINISTIC_EVIDENCE_CONTRACT_INVALID',
      },
      {
        mutate: () => ({
          ...fixture,
          capability: {
            ...fixture.capability,
            implementationBindings: fixture.capability.implementationBindings.map((binding) => ({
              ...binding,
              implementation_id: 'ugv.other-skill',
            })),
          },
        }),
        code: 'DETERMINISTIC_CAPABILITY_IMPLEMENTATION_NOT_EXACT',
      },
    ];

    for (const testCase of cases)
      expect(() => admitManagedDeterministicReadOnlyCapability(testCase.mutate())).toThrow(
        expect.objectContaining({ code: testCase.code }),
      );
  });
});

function exactFixture() {
  const request: DeterministicCapabilityExecutionInput = {
    taskId: 'task-ugv-read-state',
    contextId: 'context-ugv',
    capabilityBindingId: 'capability-binding-vehicle.ugv.read-state-v1',
    capabilityBindingVersion: 1,
    capabilityId: 'vehicle.ugv.read-state',
    capabilityVersion: 1,
    skillId: 'ugv.get-state',
    skillVersion: 1,
    mcpProviderBindingId: 'mcp-binding-ugv-smpp',
    providerId: 'ugv-provider',
    serverId: 'mcp-ugv-smpp',
    toolName: 'vehicle_get_state',
    resourceId: 'ugv-public-1',
    idempotencyKey: 'task-ugv-read-state',
  };
  const resourceSchema = { type: 'string', const: request.resourceId };
  const inputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: { resourceId: resourceSchema },
    required: ['resourceId'],
  };
  const outputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: { resourceId: resourceSchema, status: { type: 'string' } },
    required: ['resourceId', 'status'],
  };
  const executionSemantics = {
    effect: 'read_only',
    execution: 'synchronous',
    cancellation: 'unsupported',
    idempotency: 'client_request_key',
    replay: 'allowed',
    source: 'mcp_declared',
  } as const;
  const taskExecutionProfile = {
    profileVersion: '1.0',
    taskBehavior: 'synchronous_only',
    availability: 'dynamic',
    supportsScheduling: false,
    supportsMaxElapsed: false,
    supportsObservations: false,
    supportsInputRequired: false,
    idempotency: 'client_request_key',
  } as const;
  const runtimeTools: readonly McpTool[] = [
    {
      serverId: request.serverId,
      toolName: request.toolName,
      inputSchema,
      outputSchema,
      protocolMode: 'frozen_v1',
      executionSemantics,
      declaredExecutionSemantics: executionSemantics,
      taskExecutionProfile,
      discoveredAt: NOW,
    },
  ];
  const runtimeSnapshot: McpProtocolDiscoverySnapshot = {
    snapshotId: 'snapshot-ugv-1',
    serverId: request.serverId,
    protocolMode: 'frozen_v1',
    protocolVersion: '2025-03-26',
    baselineSha256: CHECKSUM,
    supportedVersions: ['2025-03-26'],
    capabilities: {},
    serverInfo: { name: 'ugv-smpp', version: '1.0.0' },
    taskNotifications: false,
    discoveredAt: NOW,
    validUntil: VALID_UNTIL,
    toolRevision: 1,
  };
  const catalog = deriveFrozenMcpCatalogAuthority(runtimeSnapshot, runtimeTools, 1);
  const runtimeServer: McpServer = {
    serverId: request.serverId,
    name: 'UGV SMPP',
    endpoint: 'http://192.168.1.7:19100/mcp',
    transport: 'streamable_http',
    status: 'enabled',
    toolRevision: 1,
    protocolMode: 'frozen_v1',
    currentProtocolSnapshotId: runtimeSnapshot.snapshotId,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const providerBinding: CurrentMcpProviderBindingAuthoritySnapshot = {
    observedAt: NOW,
    binding: {
      bindingId: request.mcpProviderBindingId,
      revision: 1,
      localServerId: request.serverId,
      originType: 'smpp_registry',
      providerId: request.providerId,
      externalProviderId: request.providerId,
      externalServerId: 'ugv-external-server',
      registryRevision: 1,
      registryChecksum: CHECKSUM,
      catalogRevision: catalog.catalogRevision,
      catalogChecksum: catalog.catalogChecksum,
      endpointRef: runtimeServer.endpoint,
      availabilityStatus: 'available' as const,
      availabilityValidUntil: VALID_UNTIL,
      catalogObservedAt: NOW,
      operationCount: catalog.operationCount,
    },
    sourceCandidateLineage: {
      smppSourceId: 'ugv-smpp-source',
      externalProviderId: request.providerId,
      externalServerId: 'ugv-external-server',
      registryRevision: 1,
      registryChecksum: CHECKSUM,
      nativeRevision: 1,
      nativeChecksum: CHECKSUM,
      projectionContract: 'sdar-registry-v1',
      candidateEndpoint: runtimeServer.endpoint,
    },
  };
  const providerPolicy = {
    mcpProviderBindingId: request.mcpProviderBindingId,
    localServerId: request.serverId,
    mcpToolName: request.toolName,
    allowedResourceIds: [request.resourceId],
    bindingRevision: 1,
    registryRevision: 1,
    registryChecksum: CHECKSUM,
    catalogRevision: catalog.catalogRevision,
    catalogChecksum: catalog.catalogChecksum,
    taskBehavior: 'synchronous_only',
    executionSemantics,
  };
  const skill: SkillVersion = {
    skillId: request.skillId,
    version: request.skillVersion,
    name: 'Read UGV state',
    summary: 'Read UGV state.',
    description: 'Read exact public UGV state.',
    capabilities: [request.capabilityId],
    workflowGuidance: 'Invoke exactly once.',
    outputInstruction: 'Return public output.',
    inputSchema,
    outputSchema,
    toolPolicy: {
      required: [{ serverId: request.serverId, toolName: request.toolName }],
      optional: [],
      forbidden: [{ serverId: request.serverId, toolName: 'vehicle_fire_weapon' }],
    },
    runtimePolicy: {
      autoConfirmPlan: false,
      maxReplans: 0,
      maxDurationSeconds: 60,
      maxLlmCalls: 0,
      maxMcpCalls: 1,
      cancelStrategy: 'wait_current',
    },
    status: 'enabled',
    sourceKind: 'admin',
    validationPassed: true,
    createdAt: NOW,
    outcomeSpecification: {
      schemaVersion: '1.0',
      skillId: request.skillId,
      skillVersion: request.skillVersion,
      effects: [`effect.${request.capabilityId}.observed`],
      evidence: ['vehicle.state.observation'],
      artifacts: [],
      taskGoalPolicy: {
        taskType: request.toolName,
        requestedCapabilityId: request.capabilityId,
        resourceId: request.resourceId,
        ...providerPolicy,
      },
      confidencePolicy: {
        rejectSuccessWithoutRequiredEvidence: true,
        requireSchemaValidation: true,
        mcpAcceptanceIsTerminalSuccess: false,
      },
      sideEffectPolicy: {
        sideEffecting: false,
        confirmation: 'not_required',
        normalizedObservationRequired: true,
      },
      specificationHash: `sha256:${CHECKSUM}`,
    },
    usageSpecification: {
      apiVersion: 'sdar.io/v1alpha1',
      visibility: { userSelectable: true, composable: true, internalOnly: false },
      normative: {
        constraints: ['Use exact public resource.'],
        forbiddenActions: ['No physical writes.'],
        requiredConfirmations: [],
        noApplicableSkill: 'reject',
      },
      adaptive: {
        instructions: ['Preserve exact authority.'],
        optimizationHints: [],
        allowPreferredProviderFallback: false,
      },
      contextRequirements: [
        {
          requirementId: 'public-resource-id',
          description: 'Exact public resource.',
          required: true,
          sourceOrder: ['authoritative_context', 'user_input'],
        },
        {
          requirementId: 'provider-binding-freshness',
          description: 'Current binding.',
          required: true,
          sourceOrder: ['authoritative_context'],
        },
      ],
      modes: {
        supported: ['procedure'],
        defaultMode: 'procedure',
        procedure: { summary: 'Exact read.', instructions: ['Invoke once.'] },
      },
      taskBindings: [
        {
          bindingId: 'task-binding-ugv-get-state-v1',
          taskType: request.toolName,
          providerPolicy: {
            selection: 'required',
            preferredProviderIds: [],
            requiredProviderId: request.serverId,
            forbiddenProviderIds: [],
            requiredAttributes: [
              'task_behavior:synchronous_only',
              'effect:read_only',
              'execution:synchronous',
              `catalog_checksum:${catalog.catalogChecksum}`,
            ],
          },
        },
      ],
      evidencePolicy: {
        requirements: [
          {
            requirementId: 'evidence-1',
            evidenceType: 'vehicle.state.observation',
            required: true,
            hardGate: true,
          },
        ],
        rejectSuccessWithoutRequiredEvidence: true,
      },
    },
  };
  const capability: CapabilityAuthoritySnapshot = {
    definition: {
      capability_id: request.capabilityId,
      version: request.capabilityVersion,
      domain: 'vehicle.ugv',
      name: 'Read UGV state',
      description: 'Read public UGV state.',
      input_schema: inputSchema,
      output_schema: outputSchema,
      success_criteria: [
        { type: 'output_schema_valid', required: true },
        { type: 'resource_identity_matches_request', required: true },
        { type: 'required_evidence_complete', required: true },
        { type: 'mcp_acceptance_is_terminal_success', value: false },
        { type: 'normalized_observation_present', required: true },
      ],
      required_evidence: [
        {
          type: 'required_evidence',
          evidenceType: 'vehicle.state.observation',
          required: true,
          hardGate: true,
        },
      ],
      effects: [`effect.${request.capabilityId}.observed`],
      artifacts: [],
      constraints: [
        {
          type: 'resource_policy',
          identifierAuthority: 'public_smpp_tool_schema',
          selection: 'exact_value',
          allowedResourceIds: [request.resourceId],
          downstreamResourceBinding: 'forbidden',
        },
        {
          type: 'provider_binding_policy',
          ...providerPolicy,
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
        {
          type: 'exact_skill_version',
          skillId: request.skillId,
          skillVersion: request.skillVersion,
          taskType: request.toolName,
        },
        {
          type: 'confirmation_policy',
          required: false,
          stage: 'not_applicable',
          autoConfirmPlan: false,
        },
        { type: 'side_effect_policy', sideEffecting: false },
      ],
      supported_modes: ['deterministic'],
      risk_level: 'low',
      status: 'published',
      definition_hash: CHECKSUM,
      previous_version: null,
      created_by: 'test',
      created_at: NOW,
      updated_at: NOW,
    },
    implementationBindings: [
      {
        binding_id: request.capabilityBindingId,
        revision: request.capabilityBindingVersion,
        capability_id: request.capabilityId,
        capability_version: request.capabilityVersion,
        implementation_type: 'skill',
        implementation_id: request.skillId,
        implementation_version: String(request.skillVersion),
        role: 'primary',
        priority: 0,
        activation_condition: null,
        provider_policy_override: {
          selection: 'required',
          mcpProviderBindingId: request.mcpProviderBindingId,
          localServerId: request.serverId,
          mcpToolName: request.toolName,
          allowedResourceIds: [request.resourceId],
          requireActive: true,
          requireAvailable: true,
          requireUnexpiredFreshness: true,
          denyFallback: true,
        },
        status: 'active',
        created_at: NOW,
      },
    ],
  };
  return {
    request,
    capability,
    providerBinding,
    skill,
    runtimeServer,
    runtimeTools,
    runtimeSnapshot,
    now: NOW,
  };
}

function withDefinition(
  capability: CapabilityAuthoritySnapshot,
  change: (
    definition: CapabilityAuthoritySnapshot['definition'],
  ) => CapabilityAuthoritySnapshot['definition'],
): CapabilityAuthoritySnapshot {
  return { ...capability, definition: change(capability.definition) };
}

function replaceConstraint(
  value: unknown,
  type: string,
  replacement: Readonly<Record<string, EvidenceJsonValue>>,
): readonly EvidenceJsonValue[] {
  if (!Array.isArray(value)) throw new Error('TEST_CAPABILITY_CONSTRAINTS_INVALID');
  return value.map((item: EvidenceJsonValue) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const constraint = item as Readonly<Record<string, EvidenceJsonValue>>;
    return constraint['type'] === type ? replacement : constraint;
  });
}
