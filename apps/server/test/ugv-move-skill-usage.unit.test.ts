import { describe, expect, it, vi } from 'vitest';

import type { TaskCapabilitySkillUsageAuthority } from '../../../packages/application/src/index.js';
import {
  createTaskCapabilityBinding,
  hashCanonicalEvidenceJson,
  type McpInvocation,
  type SkillTaskBinding,
  type TaskCapabilityBinding,
} from '../../../packages/domain/src/index.js';
import {
  createUgvSimulationTargetPolicy,
  projectUgvMoveSkillUsageContext,
  resolveUgvMoveSkillUsageContext,
  UgvMoveSkillTaskReadinessAdapter,
} from '../src/ugv-move-skill-usage.js';

import { selectedUgvTaskOperation } from './ugv-move-workflow-test-fixture.js';

describe('UGV move formal Skill Usage adapter', () => {
  it('projects the exact alias resolution into formal ready Task binding evidence', async () => {
    const selected = selectedUgvTaskOperation();
    const resolve = vi.fn().mockResolvedValue({
      selected,
      adaptedInput: {
        resourceId: selected.resource.resourceId,
        target: { longitude: 112, latitude: 28, frame: 'WGS84' },
        providerArguments: selected.resolvedArguments,
        argumentsHash: selected.argumentsHash,
      },
    });
    const adapter = new UgvMoveSkillTaskReadinessAdapter({ resolve });

    const readiness = await adapter.inspect({
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskBindings: [binding()],
      allowPreferredProviderFallback: false,
      arguments: { unresolved: false, value: skillInput() },
      executionContext: { mode: 'simulation', simulationId: 'sim-uap-p2-b03' },
    });

    expect(resolve).toHaveBeenCalledWith({
      skillInput: skillInput(),
      executionContext: { mode: 'simulation', simulationId: 'sim-uap-p2-b03' },
    });
    expect(readiness).toEqual({
      overall: 'ready',
      bindings: [
        expect.objectContaining({
          bindingId: 'move-resource',
          taskType: 'embodied.move',
          disposition: 'ready',
          confirmationRequired: true,
          selectedProviderId: 'ugv-runtime-1',
          selectedOperationName: 'vehicle_navigate',
          selectedProtocolMode: 'frozen_v1',
          candidates: [
            expect.objectContaining({
              providerId: 'ugv-runtime-1',
              operationName: 'vehicle_navigate',
              disposition: 'ready',
              selected: true,
              attributes: expect.arrayContaining([
                'task_behavior:task_required',
                'observations',
                'task_notifications',
              ]),
            }),
          ],
        }),
      ],
    });
  });

  it('fails before readiness for unresolved input, fallback, replay mode, or a different binding', async () => {
    const resolve = vi.fn();
    const adapter = new UgvMoveSkillTaskReadinessAdapter({ resolve });
    const baseline = {
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskBindings: [binding()],
      allowPreferredProviderFallback: false,
      arguments: { unresolved: false as const, value: skillInput() },
      executionContext: { mode: 'simulation' as const, simulationId: 'sim-uap-p2-b03' },
    };

    await expect(
      adapter.inspect({
        ...baseline,
        arguments: { unresolved: true, knownArguments: {}, unresolvedPaths: ['$'] },
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    await expect(
      adapter.inspect({ ...baseline, allowPreferredProviderFallback: true }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    await expect(
      adapter.inspect({
        ...baseline,
        executionContext: { mode: 'historical-replay', simulationId: 'replay-only' },
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    await expect(
      adapter.inspect({
        ...baseline,
        taskBindings: [{ ...binding(), taskType: 'vehicle_navigate' }],
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves all three contexts from one durable taskless qualification receipt and policy', async () => {
    const binding = capabilityBinding();
    const authority = capabilityAuthority(binding);
    const receipt = qualificationReceipt();
    const listInvocations = vi.fn().mockResolvedValue([receipt]);

    const resolved = await resolveUgvMoveSkillUsageContext({
      authority,
      binding,
      invocations: { listInvocations },
      clock: { now: () => NOW },
    });

    const resultHash = hashCanonicalEvidenceJson(receipt.result);
    const targetPolicy = binding.constraintSnapshot.find(
      (constraint) => constraint['type'] === 'ugv_simulation_target_policy',
    );
    expect(targetPolicy).toEqual({
      type: 'ugv_simulation_target_policy',
      policyId: POLICY_ID,
      revision: 2,
      executionMode: 'simulation',
      resourceId: 'vehicle:ugv1',
      frame: 'WGS84',
      targetAuthority: 'task_capability_input_snapshot',
      targetDerivation: 'forbidden',
      distanceLimit: 'none',
      altitudePolicy: 'not_commanded_not_terminally_evaluated',
      forbiddenRegions: [],
    });
    expect(listInvocations).toHaveBeenCalledOnce();
    expect(listInvocations).toHaveBeenCalledWith(SERVER_ID);
    expect(resolved.observations).toEqual([
      {
        requirementId: 'current-position',
        source: 'read_only_query',
        status: 'available',
        evidenceRef: `mcp-invocation:${INVOCATION_ID}:result-hash:${resultHash}:context:current-position`,
      },
      {
        requirementId: 'resource-state',
        source: 'read_only_query',
        status: 'available',
        evidenceRef: `mcp-invocation:${INVOCATION_ID}:result-hash:${resultHash}:context:resource-state`,
      },
      {
        requirementId: 'permission-context',
        source: 'authoritative_context',
        status: 'available',
        evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}:policy-id:${POLICY_ID}:revision:2:policy-hash:${hashCanonicalEvidenceJson(targetPolicy)}:context:permission-context`,
      },
    ]);
    expect(resolved.taskAvailabilityArguments).toEqual({
      unresolved: false,
      value: binding.inputSnapshot,
    });
    expect(resolved.humanConfirmation).toBe('pending');
    expect(resolved.systemPolicy).toEqual({
      allowedModes: ['template', 'procedure'],
      preferredMode: 'procedure',
      requireProcedureForHighRisk: true,
      allowGuidanceWithIncompleteContext: false,
    });
  });

  it('fails closed for missing, duplicate, or wrong receipt authority', async () => {
    const cases = [
      { label: 'missing receipt', invocations: [] },
      {
        label: 'duplicate receipt',
        invocations: [qualificationReceipt(), qualificationReceipt({ invocationId: 'qualify-2' })],
      },
      {
        label: 'wrong Provider identity',
        invocations: [qualificationReceipt({ providerId: 'isr.vehicle.ugv.other' })],
      },
      {
        label: 'wrong simulation run',
        invocations: [qualificationReceipt({ simulationId: 'sim-other' })],
      },
      {
        label: 'wrong arguments',
        invocations: [qualificationReceipt({ include: ['chassis'] })],
      },
      {
        label: 'control-bearing receipt',
        invocations: [qualificationReceipt({ controlConfirmationId: 'confirmation-1' })],
      },
      {
        label: 'task-scoped receipt',
        invocations: [qualificationReceipt({ taskId: 'task-1' })],
      },
    ];
    for (const item of cases) {
      const binding = capabilityBinding();
      await expect(
        resolveUgvMoveSkillUsageContext({
          authority: capabilityAuthority(binding),
          binding,
          invocations: { listInvocations: () => Promise.resolve(item.invocations) },
          clock: { now: () => NOW },
        }),
        item.label,
      ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    }
  });

  it('accepts the exact 3 second planning boundary and fails closed at 3001ms', async () => {
    const admittedBinding = capabilityBinding({ boundAt: EXACT_BOUNDARY_NOW });
    await expect(
      resolveUgvMoveSkillUsageContext({
        authority: capabilityAuthority(admittedBinding),
        binding: admittedBinding,
        invocations: { listInvocations: () => Promise.resolve([qualificationReceipt()]) },
        clock: { now: () => EXACT_BOUNDARY_NOW },
      }),
    ).resolves.toMatchObject({
      observations: [
        { requirementId: 'current-position', status: 'available' },
        { requirementId: 'resource-state', status: 'available' },
        { requirementId: 'permission-context', status: 'available' },
      ],
    });
    await expect(
      resolveUgvMoveSkillUsageContext({
        authority: capabilityAuthority(admittedBinding),
        binding: admittedBinding,
        invocations: { listInvocations: () => Promise.resolve([qualificationReceipt()]) },
        clock: { now: () => EXPIRED_PLANNING_NOW },
      }),
    ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_QUALIFICATION_STALE' });
  });

  it('accepts Provider mission ready state 0 but rejects running or paused qualification', async () => {
    const binding = capabilityBinding();
    for (const missionState of [0, -1, 3, 4, 5])
      await expect(
        resolveUgvMoveSkillUsageContext({
          authority: capabilityAuthority(binding),
          binding,
          invocations: {
            listInvocations: () => Promise.resolve([qualificationReceipt({ missionState })]),
          },
          clock: { now: () => NOW },
        }),
      ).resolves.toBeDefined();
    for (const missionState of [1, 2])
      await expect(
        resolveUgvMoveSkillUsageContext({
          authority: capabilityAuthority(binding),
          binding,
          invocations: {
            listInvocations: () => Promise.resolve([qualificationReceipt({ missionState })]),
          },
          clock: { now: () => NOW },
        }),
      ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
  });

  it('fails closed for missing, duplicate, or drifted permission policy', async () => {
    for (const binding of [
      capabilityBinding({ omitTargetPolicy: true }),
      capabilityBinding({ duplicateTargetPolicy: true }),
      capabilityBinding({ policy: { ...targetPolicy(), targetAuthority: 'request_metadata' } }),
    ]) {
      await expect(
        resolveUgvMoveSkillUsageContext({
          authority: capabilityAuthority(binding),
          binding,
          invocations: { listInvocations: () => Promise.resolve([qualificationReceipt()]) },
          clock: { now: () => NOW },
        }),
      ).rejects.toMatchObject({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' });
    }
  });

  it('keeps the former context-only projector fail closed', () => {
    expect(() =>
      projectUgvMoveSkillUsageContext(capabilityAuthority(capabilityBinding()).context),
    ).toThrow(expect.objectContaining({ code: 'UGV_MOVE_SKILL_USAGE_AUTHORITY_REQUIRED' }));
  });
});

function binding(): SkillTaskBinding {
  return Object.freeze({
    bindingId: 'move-resource',
    taskType: 'embodied.move',
    providerPolicy: Object.freeze({
      selection: 'dynamic',
      preferredProviderIds: Object.freeze([]),
      forbiddenProviderIds: Object.freeze([]),
      requiredAttributes: Object.freeze(['observations', 'task_notifications']),
    }),
  });
}

function skillInput() {
  return Object.freeze({
    resourceId: 'vehicle:ugv1',
    target: Object.freeze({ x: 112, y: 28, frame: 'WGS84' }),
  });
}

const RUN_ID = 'uap-p3-b02-run-1';
const SERVER_ID = 'ugv-runtime-1';
const PROVIDER_BINDING_ID = 'binding-ugv-runtime-1';
const INVOCATION_ID = 'qualification-invocation-1';
const POLICY_ID = 'ugv-agent-profile/explicit-wgs84-target';
const NOW = '2026-08-21T12:00:03.000Z';
const EXACT_BOUNDARY_NOW = '2026-08-21T12:00:04.000Z';
const EXPIRED_PLANNING_NOW = '2026-08-21T12:00:04.001Z';
const INITIAL_POSITION = Object.freeze({ longitude: 106.813_980_425_914_1, latitude: 29.720_4 });

function deriveTarget() {
  return Object.freeze({ x: 106.8134463, y: 29.72034353, frame: 'WGS84' as const });
}

function targetPolicy() {
  return createUgvSimulationTargetPolicy({ policyId: POLICY_ID, revision: 2 });
}

function capabilityBinding(
  options: Readonly<{
    target?: Readonly<{ x: number; y: number; frame: 'WGS84' }>;
    policy?: Readonly<Record<string, unknown>>;
    omitTargetPolicy?: boolean;
    duplicateTargetPolicy?: boolean;
    boundAt?: string;
  }> = {},
): TaskCapabilityBinding {
  const policy = options.policy ?? targetPolicy();
  const constraints: Readonly<Record<string, unknown>>[] = [
    {
      type: 'resource_policy',
      identifierAuthority: 'public_smpp_tool_schema',
      selection: 'exact_value',
      allowedResourceIds: ['vehicle:ugv1'],
      downstreamResourceBinding: 'forbidden',
    },
    {
      type: 'provider_binding_policy',
      mcpProviderBindingId: PROVIDER_BINDING_ID,
      localServerId: SERVER_ID,
      mcpToolName: 'vehicle_navigate',
      requiredStatus: 'active',
      requiredAvailabilityStatus: 'available',
      requiredFreshness: 'unexpired',
      fallback: 'deny',
    },
    {
      type: 'exact_skill_version',
      skillId: 'embodied.move_to',
      skillVersion: 1,
      taskType: 'embodied.move',
    },
    { type: 'confirmation_policy', required: true, stage: 'before_execution' },
    {
      type: 'physical_side_effect_policy',
      sideEffecting: true,
      dispatchMaximum: 1,
      uncertainDispatchPolicy: 'reconcile_never_redispatch',
      remoteTaskTerminalEvidenceRequired: true,
    },
    { type: 'runtime_execution_mode_policy', mode: 'simulation', simulationId: RUN_ID },
    ...(options.omitTargetPolicy ? [] : [policy]),
    ...(options.duplicateTargetPolicy ? [policy] : []),
  ];
  return createTaskCapabilityBinding({
    bindingId: 'capability-binding-1',
    taskId: 'task-1',
    requestedCapabilityId: 'embodied.move',
    capabilityVersion: 2,
    inputSnapshot: Object.freeze({
      resourceId: 'vehicle:ugv1',
      target: Object.freeze({ ...(options.target ?? deriveTarget()) }),
    }),
    successCriteriaSnapshot: Object.freeze([
      Object.freeze({ type: 'output_schema_valid', required: true }),
    ]),
    evidenceRequirementSnapshot: Object.freeze([
      Object.freeze({
        type: 'required_evidence',
        evidenceType: 'position.observation',
        required: true,
        hardGate: true,
      }),
    ]),
    constraintSnapshot: Object.freeze(constraints),
    initialImplementationRefs: Object.freeze(['skill:embodied.move_to:1']),
    providerPolicySnapshot: Object.freeze({
      currentProviderBindings: Object.freeze([
        Object.freeze({
          binding: Object.freeze({ bindingId: PROVIDER_BINDING_ID, localServerId: SERVER_ID }),
        }),
      ]),
    }),
    boundAt: options.boundAt ?? '2026-08-21T12:00:02.000Z',
  });
}

function capabilityAuthority(binding: TaskCapabilityBinding): TaskCapabilitySkillUsageAuthority {
  return Object.freeze({
    skillId: 'embodied.move_to',
    skillVersion: 1,
    context: Object.freeze({
      observations: Object.freeze([
        Object.freeze({
          requirementId: 'public-resource-id',
          source: 'authoritative_context' as const,
          status: 'available' as const,
          evidenceRef: `task-capability-binding:${binding.bindingId}:hash:${binding.bindingHash}`,
        }),
        Object.freeze({
          requirementId: 'provider-binding-freshness',
          source: 'authoritative_context' as const,
          status: 'available' as const,
          evidenceRef: `node-control-provider-binding:${PROVIDER_BINDING_ID}:revision:7:observed-at:2026-08-21T12:00:02.500Z`,
        }),
      ]),
      risk: 'high',
      humanConfirmation: 'pending',
      taskAvailabilityArguments: Object.freeze({
        unresolved: false as const,
        value: binding.inputSnapshot as Readonly<Record<string, unknown>>,
      }),
      runtimeExecutionContext: Object.freeze({ mode: 'simulation', simulationId: RUN_ID }),
      systemPolicy: Object.freeze({
        allowedModes: Object.freeze(['guidance', 'template', 'procedure'] as const),
        requireProcedureForHighRisk: true,
        allowGuidanceWithIncompleteContext: false,
      }),
    }),
  });
}

function qualificationReceipt(
  options: Readonly<{
    invocationId?: string;
    simulationId?: string;
    include?: readonly string[];
    providerId?: string;
    taskId?: string;
    controlConfirmationId?: string;
    missionState?: number;
  }> = {},
): McpInvocation {
  const result = Object.freeze({
    content: Object.freeze([]),
    isError: false,
    structuredContent: Object.freeze({
      identity: Object.freeze({
        providerId: options.providerId ?? 'isr.vehicle.ugv.ugv1',
        resourceId: 'vehicle:ugv1',
        vehicleType: 'ugv',
        executionMode: 'simulation',
      }),
      connectivity: Object.freeze({
        mqttConnected: true,
        deviceMcpConnected: true,
        deviceAvailable: true,
        packetLossRate: 0,
        averageRoundTripTimeMs: 20,
      }),
      freshness: Object.freeze({
        chassisObservedAt: '2026-08-21T12:00:01.000Z',
        healthObservedAt: '2026-08-21T12:00:01.000Z',
        missionObservedAt: '2026-08-21T12:00:01.000Z',
      }),
      chassis: Object.freeze({
        position: INITIAL_POSITION,
        speedKmh: 0,
        mission: Object.freeze({ state: options.missionState ?? 4 }),
      }),
      health: Object.freeze({
        chassisErrorCodes: Object.freeze([]),
        payloadErrorCodes: Object.freeze([]),
        components: Object.freeze({
          communications: 'normal',
          gnss: 'normal',
          navigation: 'normal',
        }),
      }),
      revision: 'd'.repeat(64),
      observedAt: '2026-08-21T12:00:01.000Z',
      mqttIngressSequence: 42,
    }),
  });
  return Object.freeze({
    invocationId: options.invocationId ?? INVOCATION_ID,
    ...(options.taskId === undefined ? {} : { taskId: options.taskId }),
    ...(options.controlConfirmationId === undefined
      ? {}
      : { controlConfirmationId: options.controlConfirmationId }),
    executionMode: 'simulation',
    simulationId: options.simulationId ?? RUN_ID,
    serverId: SERVER_ID,
    toolName: 'vehicle_get_state',
    executionSemantics: Object.freeze({
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'server_managed',
      replay: 'allowed',
      source: 'mcp_declared',
    }),
    arguments: Object.freeze({
      resourceId: 'vehicle:ugv1',
      include: Object.freeze([...(options.include ?? ['chassis', 'health'])]),
    }),
    result,
    status: 'succeeded',
    startedAt: '2026-08-21T12:00:00.800Z',
    completedAt: '2026-08-21T12:00:01.000Z',
    durationMs: 200,
  });
}
