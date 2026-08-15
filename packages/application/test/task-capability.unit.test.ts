import { describe, expect, it, vi } from 'vitest';

import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  createAgentTask,
  createTaskExecutionAttempt,
  type McpInvocation,
  type TaskCapabilityBinding,
  type TaskCapabilityExecutionAttempt,
} from '../../domain/src/index.js';
import {
  canonicalHash,
  RuntimeTaskCapabilityService,
  type RuntimeCapabilityResolution,
  type RuntimeMcpProviderBindingAdmissionVerifier,
  type TaskCapabilityAcceptanceStore,
  type TaskCapabilityPhysicalDispatchEvidence,
  type TaskCapabilityPhysicalEvidenceSnapshot,
} from '../src/index.js';

const timestamp = '2026-08-02T00:00:00.000Z';

function fixture(
  options: Readonly<{
    resolution?: RuntimeCapabilityResolution;
    invocations?: readonly McpInvocation[];
    physicalEvidence?: TaskCapabilityPhysicalEvidenceSnapshot;
    providerBindingCurrent?: boolean;
    runtimeProviderBindingCurrent?: boolean;
    runtimeProviderBindingsConfigured?: boolean;
  }> = {},
) {
  let binding: TaskCapabilityBinding | undefined;
  let capabilityAttempt: TaskCapabilityExecutionAttempt | undefined;
  const resolution: RuntimeCapabilityResolution = options.resolution ?? {
    exposureId: 'device.inspect',
    exposureVersion: 1,
    requestedCapabilityId: 'device.inspect.capability',
    capabilityVersion: 3,
    requestSchema: {
      type: 'object',
      required: ['deviceId'],
      properties: { deviceId: { type: 'string' } },
      additionalProperties: false,
    },
    requesterPolicy: { allowAnonymous: false, allowedRequesterIds: ['operator-1'] },
    successCriteria: [{ type: 'field_equals', field: 'inspected', value: true }],
    requiredEvidence: [{ type: 'provider_result', field: 'inspectionEvidence' }],
    constraints: [{ type: 'authorization' }],
    implementationRefs: ['skill:device.inspect:3'],
    providerBindingRefs: ['provider-binding:inspection-primary'],
    providerPolicySnapshot: { policyHash: 'a'.repeat(64), route: { mode: 'strict' } },
  };
  const resolveExposure = vi
    .fn<TaskCapabilityAcceptanceStore['resolveExposure']>()
    .mockResolvedValue(resolution);
  const updateLatestAttempt = vi
    .fn<TaskCapabilityAcceptanceStore['updateLatestAttempt']>()
    .mockResolvedValue(undefined);
  const reconcileCanceledAttempts = vi
    .fn<TaskCapabilityAcceptanceStore['reconcileCanceledAttempts']>()
    .mockResolvedValue(0);
  const reconcileFailedAttempts = vi
    .fn<TaskCapabilityAcceptanceStore['reconcileFailedAttempts']>()
    .mockResolvedValue(0);
  const listAttempts = vi
    .fn<TaskCapabilityAcceptanceStore['listAttempts']>()
    .mockImplementation(() =>
      Promise.resolve(capabilityAttempt === undefined ? [] : [capabilityAttempt]),
    );
  const store: TaskCapabilityAcceptanceStore = {
    resolveExposure,
    accept: vi.fn<TaskCapabilityAcceptanceStore['accept']>((input) => {
      binding = input.binding;
      capabilityAttempt = input.capabilityAttempt;
      return Promise.resolve();
    }),
    findBinding: vi
      .fn<TaskCapabilityAcceptanceStore['findBinding']>()
      .mockImplementation(() => Promise.resolve(binding)),
    listAttempts,
    appendAttempt: vi
      .fn<TaskCapabilityAcceptanceStore['appendAttempt']>()
      .mockRejectedValue(new Error('not used')),
    updateLatestAttempt,
    reconcileCanceledAttempts,
    reconcileFailedAttempts,
  };
  const assertRuntimeProviderBindingCurrent = vi.fn<
    RuntimeMcpProviderBindingAdmissionVerifier['assertCurrent']
  >(() =>
    options.runtimeProviderBindingCurrent === false
      ? Promise.reject(new Error('MCP_PROVIDER_BINDING_NOT_CURRENT'))
      : Promise.resolve(),
  );
  const physicalEvidence = options.physicalEvidence;
  const service = new RuntimeTaskCapabilityService({
    store,
    schemas: new AjvJsonSchemaValidator(),
    ...(options.invocations === undefined
      ? {}
      : {
          evidence: {
            listInvocationsByTask: () => Promise.resolve(options.invocations ?? []),
          },
        }),
    ...(physicalEvidence === undefined
      ? {}
      : {
          physicalEvidence: {
            loadPhysicalEvidence: () => Promise.resolve(physicalEvidence),
          },
        }),
    ...((resolution.providerBindingRequirements?.length ?? 0) === 0
      ? {}
      : {
          providerBindings: {
            loadCurrentMcpProviderBinding: ({ bindingId, localServerId }) => {
              if (options.providerBindingCurrent === false)
                return Promise.reject(new Error('MCP_PROVIDER_BINDING_NOT_CURRENT'));
              return Promise.resolve({
                observedAt: timestamp,
                binding: {
                  bindingId: bindingId ?? 'binding-current',
                  revision: 1,
                  localServerId,
                  originType: 'direct' as const,
                  providerId: 'provider-current',
                  endpointRef: 'https://provider.example.test/mcp',
                  catalogRevision: '1.0.0:1',
                  catalogChecksum: 'a'.repeat(64),
                  operationCount: 1,
                  availabilityValidUntil: '2026-08-02T01:00:00.000Z',
                },
              });
            },
          },
          ...(options.runtimeProviderBindingsConfigured === false
            ? {}
            : {
                runtimeProviderBindings: {
                  assertCurrent: assertRuntimeProviderBindingCurrent,
                },
              }),
        }),
  });
  const task = createAgentTask({
    taskId: 'task-1',
    contextId: 'context-1',
    userId: 'operator-1',
    requestText: 'Inspect device alpha.',
    requestMetadata: {},
    timestamp,
  });
  const inputAttempt = createTaskExecutionAttempt({
    attemptId: 'task-attempt-1',
    taskId: task.taskId,
    contextId: task.contextId,
    reason: 'initial',
    createdAt: timestamp,
  });
  const event = {
    eventId: 'event-1',
    taskId: task.taskId,
    contextId: task.contextId,
    eventType: 'task.created' as const,
    timestamp,
    summary: 'Task accepted.',
  };
  return {
    service,
    resolution,
    resolveExposure,
    updateLatestAttempt,
    reconcileCanceledAttempts,
    reconcileFailedAttempts,
    listAttempts,
    assertRuntimeProviderBindingCurrent,
    task,
    inputAttempt,
    event,
  };
}

describe('RuntimeTaskCapabilityService', () => {
  it('projects exact frozen Task Capability authority into Skill usage context', async () => {
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'resource.read',
      exposureVersion: 1,
      requestedCapabilityId: 'resource.read.capability',
      capabilityVersion: 2,
      requestSchema: {
        type: 'object',
        required: ['resourceId'],
        properties: { resourceId: { const: 'resource:42' } },
        additionalProperties: false,
      },
      successCriteria: [{ type: 'output_schema_valid', required: true }],
      requiredEvidence: [
        {
          type: 'required_evidence',
          evidenceType: 'resource.state.observation',
          required: true,
          hardGate: true,
        },
      ],
      constraints: [
        {
          type: 'resource_policy',
          selection: 'exact_value',
          allowedResourceIds: ['resource:42'],
        },
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'binding-current',
          localServerId: 'server.example',
          bindingRevision: 1,
          catalogRevision: '1.0.0:1',
          catalogChecksum: 'a'.repeat(64),
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
        {
          type: 'exact_skill_version',
          skillId: 'resource.read',
          skillVersion: 2,
        },
        { type: 'confirmation_policy', required: false },
        { type: 'side_effect_policy', sideEffecting: false },
      ],
      implementationRefs: ['skill:resource.read:2'],
      providerBindingRefs: ['binding-current'],
      providerBindingRequirements: [
        { bindingId: 'binding-current', localServerId: 'server.example' },
      ],
    };
    const accepted = fixture({ resolution });
    const prepared = await accepted.service.prepareAcceptance({
      task: accepted.task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: resolution.exposureId,
          versionConstraint: '1',
          requestId: 'request-skill-usage-authority',
        },
      },
      capabilityInput: { resourceId: 'resource:42' },
      inputAttempt: accepted.inputAttempt,
      bindingId: 'task-capability-binding',
      capabilityAttemptId: 'capability-attempt-skill-usage',
      event: accepted.event,
    });
    if (prepared === undefined) throw new Error('Expected an explicit Capability binding.');
    await accepted.service.accept(prepared);

    await expect(
      accepted.service.resolveSkillUsageAuthority(accepted.task.taskId),
    ).resolves.toEqual({
      skillId: 'resource.read',
      skillVersion: 2,
      context: {
        observations: [
          {
            requirementId: 'public-resource-id',
            source: 'authoritative_context',
            status: 'available',
            evidenceRef: `task-capability-binding:task-capability-binding:hash:${prepared.binding.bindingHash}`,
          },
          {
            requirementId: 'provider-binding-freshness',
            source: 'authoritative_context',
            status: 'available',
            evidenceRef:
              'node-control-provider-binding:binding-current:revision:1:observed-at:2026-08-02T00:00:00.000Z',
          },
        ],
        risk: 'low',
        humanConfirmation: 'not_requested',
        taskAvailabilityArguments: {
          unresolved: false,
          value: { resourceId: 'resource:42' },
        },
        systemPolicy: {
          allowedModes: ['guidance', 'template', 'procedure'],
          requireProcedureForHighRisk: true,
          allowGuidanceWithIncompleteContext: false,
        },
      },
    });
    expect(accepted.assertRuntimeProviderBindingCurrent).toHaveBeenCalledTimes(2);
  });

  it('projects an exact physical side-effect policy as high-risk confirmation-pending context', async () => {
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'vehicle.navigate',
      exposureVersion: 1,
      requestedCapabilityId: 'vehicle.navigate.capability',
      capabilityVersion: 4,
      requestSchema: {
        type: 'object',
        required: ['resourceId'],
        properties: { resourceId: { const: 'vehicle:ugv-1' } },
        additionalProperties: false,
      },
      successCriteria: [{ type: 'output_schema_valid', required: true }],
      requiredEvidence: [
        {
          type: 'required_evidence',
          evidenceType: 'vehicle.task.terminal',
          required: true,
          hardGate: true,
        },
      ],
      constraints: [
        {
          type: 'resource_policy',
          selection: 'exact_value',
          allowedResourceIds: ['vehicle:ugv-1'],
        },
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'binding-current',
          localServerId: 'server.example',
          bindingRevision: 1,
          catalogRevision: '1.0.0:1',
          catalogChecksum: 'a'.repeat(64),
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
        { type: 'exact_skill_version', skillId: 'vehicle.navigate', skillVersion: 4 },
        { type: 'confirmation_policy', required: true, stage: 'before_execution' },
        {
          type: 'physical_side_effect_policy',
          sideEffecting: true,
          dispatchMaximum: 1,
          uncertainDispatchPolicy: 'reconcile_never_redispatch',
          remoteTaskTerminalEvidenceRequired: true,
        },
      ],
      implementationRefs: ['skill:vehicle.navigate:4'],
      providerBindingRefs: ['binding-current'],
      providerBindingRequirements: [
        { bindingId: 'binding-current', localServerId: 'server.example' },
      ],
    };
    const accepted = fixture({ resolution });
    const prepared = await accepted.service.prepareAcceptance({
      task: accepted.task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: resolution.exposureId,
          versionConstraint: '1',
          requestId: 'request-physical-skill-usage-authority',
        },
      },
      capabilityInput: { resourceId: 'vehicle:ugv-1' },
      inputAttempt: accepted.inputAttempt,
      bindingId: 'task-capability-physical-binding',
      capabilityAttemptId: 'capability-attempt-physical-skill-usage',
      event: accepted.event,
    });
    if (prepared === undefined) throw new Error('Expected an explicit Capability binding.');
    await accepted.service.accept(prepared);

    await expect(
      accepted.service.resolveSkillUsageAuthority(accepted.task.taskId),
    ).resolves.toMatchObject({
      skillId: 'vehicle.navigate',
      skillVersion: 4,
      context: {
        risk: 'high',
        humanConfirmation: 'pending',
        taskAvailabilityArguments: {
          unresolved: false,
          value: { resourceId: 'vehicle:ugv-1' },
        },
        systemPolicy: {
          allowedModes: ['guidance', 'template', 'procedure'],
          requireProcedureForHighRisk: true,
          allowGuidanceWithIncompleteContext: false,
        },
      },
    });
    expect(accepted.assertRuntimeProviderBindingCurrent).toHaveBeenCalledTimes(2);
  });

  it('delegates canceled-attempt recovery to the authoritative store', async () => {
    const { service, reconcileCanceledAttempts } = fixture();
    reconcileCanceledAttempts.mockResolvedValueOnce(2);

    await expect(service.reconcileCanceledAttempts()).resolves.toBe(2);
    expect(reconcileCanceledAttempts).toHaveBeenCalledTimes(1);
  });

  it('delegates failed-attempt recovery to the authoritative store', async () => {
    const { service, reconcileFailedAttempts } = fixture();
    reconcileFailedAttempts.mockResolvedValueOnce(3);

    await expect(service.reconcileFailedAttempts()).resolves.toBe(3);
    expect(reconcileFailedAttempts).toHaveBeenCalledTimes(1);
  });

  it('returns the latest active immutable proof only for an exact required Capability binding', async () => {
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'home-lab-a2a-living-room-read-state',
      exposureVersion: 1,
      requestedCapabilityId: 'home.living-room.read-state',
      capabilityVersion: 1,
      requestSchema: { type: 'object', additionalProperties: false },
      successCriteria: [{ type: 'field_equals', field: 'ok', value: true }],
      requiredEvidence: [],
      constraints: [],
      implementationRefs: ['skill:home.living-room.get-state:1'],
      providerBindingRefs: ['mcp-binding-ha-light-lab', 'mcp-binding-ha-climate-lab'],
    };
    const preparedFixture = fixture({ resolution });
    const prepared = await preparedFixture.service.prepareAcceptance({
      task: preparedFixture.task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: resolution.exposureId,
          versionConstraint: '1',
          requestId: 'request-terminal-proof',
        },
      },
      capabilityInput: {},
      inputAttempt: preparedFixture.inputAttempt,
      bindingId: 'binding-terminal-proof',
      capabilityAttemptId: 'capability-attempt-terminal-proof',
      event: preparedFixture.event,
    });
    if (prepared === undefined) throw new Error('Expected an explicit Capability binding.');
    await preparedFixture.service.accept(prepared);

    await expect(
      preparedFixture.service.assertTerminalSuccess(
        preparedFixture.task.taskId,
        { ok: true },
        {
          requiredBinding: {
            requestedCapabilityId: 'home.living-room.read-state',
            capabilityVersion: 1,
          },
        },
      ),
    ).resolves.toEqual({
      taskId: preparedFixture.task.taskId,
      bindingId: 'binding-terminal-proof',
      bindingHash: prepared.binding.bindingHash,
      attemptId: 'capability-attempt-terminal-proof',
      requestedCapabilityId: 'home.living-room.read-state',
      capabilityVersion: 1,
    });
  });

  it('fails closed when a strict terminal proof has no binding or the wrong Capability', async () => {
    const noBinding = fixture();
    await expect(
      noBinding.service.assertTerminalSuccess(
        'ordinary-task',
        {},
        {
          requiredBinding: {
            requestedCapabilityId: 'home.living-room.read-state',
            capabilityVersion: 1,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });

    const preparedFixture = fixture();
    const prepared = await preparedFixture.service.prepareAcceptance({
      task: preparedFixture.task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-terminal-proof-mismatch',
        },
      },
      capabilityInput: { deviceId: 'alpha' },
      inputAttempt: preparedFixture.inputAttempt,
      bindingId: 'binding-terminal-proof-mismatch',
      capabilityAttemptId: 'capability-attempt-terminal-proof-mismatch',
      event: preparedFixture.event,
    });
    if (prepared === undefined) throw new Error('Expected an explicit Capability binding.');
    await preparedFixture.service.accept(prepared);
    await expect(
      preparedFixture.service.assertTerminalSuccess(
        preparedFixture.task.taskId,
        {
          inspected: true,
          inspectionEvidence: {},
          policyEvidence: [{ type: 'authorization', satisfied: true }],
        },
        {
          requiredBinding: {
            requestedCapabilityId: 'home.living-room.read-state',
            capabilityVersion: 1,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
  });

  it('rejects a strict terminal proof when the latest Capability attempt is no longer active', async () => {
    const preparedFixture = fixture();
    const prepared = await preparedFixture.service.prepareAcceptance({
      task: preparedFixture.task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-terminal-proof-terminal-attempt',
        },
      },
      capabilityInput: { deviceId: 'alpha' },
      inputAttempt: preparedFixture.inputAttempt,
      bindingId: 'binding-terminal-proof-terminal-attempt',
      capabilityAttemptId: 'capability-attempt-terminal-proof-terminal-attempt',
      event: preparedFixture.event,
    });
    if (prepared === undefined) throw new Error('Expected an explicit Capability binding.');
    await preparedFixture.service.accept(prepared);
    vi.mocked(preparedFixture.listAttempts).mockResolvedValueOnce([
      {
        ...prepared.capabilityAttempt,
        status: 'succeeded',
        startedAt: timestamp,
        completedAt: timestamp,
      },
    ]);
    await expect(
      preparedFixture.service.assertTerminalSuccess(
        preparedFixture.task.taskId,
        {
          inspected: true,
          inspectionEvidence: {},
          policyEvidence: [{ type: 'authorization', satisfied: true }],
        },
        {
          requiredBinding: {
            requestedCapabilityId: 'device.inspect.capability',
            capabilityVersion: 3,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
  });

  it.each(['prepared', 'running', 'waiting'] as const)(
    'resolves the latest %s Capability attempt for MCP invocation lineage',
    async (status) => {
      const accepted = await acceptedDefaultCapability();
      vi.mocked(accepted.listAttempts).mockResolvedValueOnce([
        withAttemptStatus(accepted.prepared.capabilityAttempt, status),
      ]);

      await expect(
        accepted.service.resolveCurrentCapabilityAttemptId(accepted.task.taskId),
      ).resolves.toBe(accepted.prepared.capabilityAttempt.attemptId);
    },
  );

  it('rejects Capability attempt resolution when the bound Task has no attempt', async () => {
    const accepted = await acceptedDefaultCapability();
    vi.mocked(accepted.listAttempts).mockResolvedValueOnce([]);

    await expect(
      accepted.service.resolveCurrentCapabilityAttemptId(accepted.task.taskId),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_ATTEMPT_CONTEXT_INVALID' });
  });

  it('leaves an unbound Task without Capability attempt lineage', async () => {
    const unbound = fixture();

    await expect(
      unbound.service.resolveCurrentCapabilityAttemptId(unbound.task.taskId),
    ).resolves.toBeUndefined();
  });

  it.each(['succeeded', 'failed', 'canceled', 'superseded'] as const)(
    'rejects terminal %s Capability attempt resolution',
    async (status) => {
      const accepted = await acceptedDefaultCapability();
      vi.mocked(accepted.listAttempts).mockResolvedValueOnce([
        withAttemptStatus(accepted.prepared.capabilityAttempt, status),
      ]);

      await expect(
        accepted.service.resolveCurrentCapabilityAttemptId(accepted.task.taskId),
      ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_ATTEMPT_CONTEXT_INVALID' });
    },
  );

  it.each([
    ['Task identity', { taskId: 'task-other' }],
    ['Capability binding identity', { capabilityBindingId: 'binding-other' }],
  ] as const)('rejects latest-attempt %s mismatch', async (_case, mismatch) => {
    const accepted = await acceptedDefaultCapability();
    vi.mocked(accepted.listAttempts).mockResolvedValueOnce([
      { ...accepted.prepared.capabilityAttempt, ...mismatch },
    ]);

    await expect(
      accepted.service.resolveCurrentCapabilityAttemptId(accepted.task.taskId),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_ATTEMPT_CONTEXT_INVALID' });
  });

  it('leaves ordinary non-Capability Task terminal transitions untouched', async () => {
    const { service, updateLatestAttempt } = fixture();
    await expect(
      service.markLatestAttempt('ordinary-task', 'succeeded', timestamp),
    ).resolves.toBeUndefined();
    expect(updateLatestAttempt).not.toHaveBeenCalled();
  });

  it('freezes an explicit Exposure resolution while keeping ordinary requests compatible', async () => {
    const { service, resolveExposure, task, inputAttempt, event } = fixture();
    await expect(
      service.prepareAcceptance({
        task,
        metadata: {},
        capabilityInput: undefined,
        inputAttempt,
        bindingId: 'binding-unused',
        capabilityAttemptId: 'capability-attempt-unused',
        event,
      }),
    ).resolves.toBeUndefined();
    expect(resolveExposure).not.toHaveBeenCalled();

    const capabilityInput = { deviceId: 'alpha' };
    const prepared = await service.prepareAcceptance({
      task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-1',
        },
      },
      capabilityInput,
      inputAttempt,
      bindingId: 'binding-1',
      capabilityAttemptId: 'capability-attempt-1',
      event,
    });
    expect(prepared?.binding).toMatchObject({
      requestedCapabilityId: 'device.inspect.capability',
      capabilityVersion: 3,
      exposureId: 'device.inspect',
      exposureVersion: 1,
      inputSnapshot: { deviceId: 'alpha' },
    });
    expect(prepared?.binding.bindingHash).toMatch(/^[a-f0-9]{64}$/u);
    capabilityInput.deviceId = 'mutated';
    expect(prepared?.binding.inputSnapshot).toEqual({ deviceId: 'alpha' });
    const providerPolicy = prepared?.binding.providerPolicySnapshot as { route: object };
    expect(Object.isFrozen(providerPolicy)).toBe(true);
    expect(Object.isFrozen(providerPolicy.route)).toBe(true);
  });

  it('rejects malformed identity, requester policy, and invalid input before acceptance', async () => {
    const { service, task, inputAttempt, event } = fixture();
    const base = {
      task,
      capabilityInput: { deviceId: 'alpha' },
      inputAttempt,
      bindingId: 'binding-1',
      capabilityAttemptId: 'capability-attempt-1',
      event,
    };
    await expect(
      service.prepareAcceptance({
        ...base,
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: 'device.inspect',
            versionConstraint: '1',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_REQUEST_INVALID' });
    await expect(
      service.prepareAcceptance({
        ...base,
        task: { ...task, userId: 'other-operator' },
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: 'device.inspect',
            versionConstraint: '1',
            requestId: 'request-2',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_REQUESTER_FORBIDDEN' });
    await expect(
      service.prepareAcceptance({
        ...base,
        capabilityInput: { unexpected: true },
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: 'device.inspect',
            versionConstraint: '1',
            requestId: 'request-3',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_INPUT_INVALID' });
  });

  it('fails admission closed when an exact Provider Binding is no longer current', async () => {
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'device.current-binding',
      exposureVersion: 1,
      requestedCapabilityId: 'device.current-binding',
      capabilityVersion: 1,
      requestSchema: { type: 'object', additionalProperties: false },
      successCriteria: [{ type: 'field_equals', field: 'ok', value: true }],
      requiredEvidence: [],
      constraints: [],
      implementationRefs: ['skill:device.current-binding:1'],
      providerBindingRefs: ['binding-current'],
      providerBindingRequirements: [
        { bindingId: 'binding-current', localServerId: 'provider-server' },
      ],
    };
    const { service, task, inputAttempt, event } = fixture({
      resolution,
      providerBindingCurrent: false,
    });

    await expect(
      service.prepareAcceptance({
        task,
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: resolution.exposureId,
            versionConstraint: '1',
            requestId: 'request-current-binding',
          },
        },
        capabilityInput: {},
        inputAttempt,
        bindingId: 'task-capability-binding-current',
        capabilityAttemptId: 'capability-attempt-current',
        event,
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_PROVIDER_BINDING_NOT_CURRENT' });
  });

  it.each([
    ['Runtime catalog or endpoint authority drifts', { runtimeProviderBindingCurrent: false }],
    ['Runtime authority verifier is unavailable', { runtimeProviderBindingsConfigured: false }],
  ])('fails new Task admission closed when %s', async (_case, options) => {
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'device.runtime-current-binding',
      exposureVersion: 1,
      requestedCapabilityId: 'device.runtime-current-binding',
      capabilityVersion: 1,
      requestSchema: { type: 'object', additionalProperties: false },
      successCriteria: [{ type: 'field_equals', field: 'ok', value: true }],
      requiredEvidence: [],
      constraints: [],
      implementationRefs: ['skill:device.runtime-current-binding:1'],
      providerBindingRefs: ['binding-current'],
      providerBindingRequirements: [
        { bindingId: 'binding-current', localServerId: 'provider-server' },
      ],
    };
    const preparedFixture = fixture({ resolution, ...options });

    await expect(
      preparedFixture.service.prepareAcceptance({
        task: preparedFixture.task,
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: resolution.exposureId,
            versionConstraint: '1',
            requestId: 'request-runtime-current-binding',
          },
        },
        capabilityInput: {},
        inputAttempt: preparedFixture.inputAttempt,
        bindingId: 'task-capability-binding-runtime-current',
        capabilityAttemptId: 'capability-attempt-runtime-current',
        event: preparedFixture.event,
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_PROVIDER_BINDING_NOT_CURRENT' });
  });

  it('resolves each Provider in a multi-Provider Task from the immutable current authority snapshot', async () => {
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'home.multi-read',
      exposureVersion: 1,
      requestedCapabilityId: 'home.multi-read',
      capabilityVersion: 1,
      requestSchema: { type: 'object', additionalProperties: false },
      successCriteria: [{ type: 'field_equals', field: 'ok', value: true }],
      requiredEvidence: [],
      constraints: [],
      implementationRefs: ['skill:home.multi-read:1'],
      providerBindingRefs: ['binding-light', 'binding-climate'],
      providerBindingRequirements: [
        { bindingId: 'binding-light', localServerId: 'server-light' },
        { bindingId: 'binding-climate', localServerId: 'server-climate' },
      ],
    };
    const preparedFixture = fixture({ resolution });
    const prepared = await preparedFixture.service.prepareAcceptance({
      task: preparedFixture.task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: resolution.exposureId,
          versionConstraint: '1',
          requestId: 'request-multi-provider',
        },
      },
      capabilityInput: {},
      inputAttempt: preparedFixture.inputAttempt,
      bindingId: 'task-capability-binding-multi',
      capabilityAttemptId: 'capability-attempt-multi',
      event: preparedFixture.event,
    });
    if (prepared === undefined) throw new Error('Expected a multi-Provider binding.');
    expect(preparedFixture.assertRuntimeProviderBindingCurrent).toHaveBeenCalledTimes(2);
    expect(preparedFixture.assertRuntimeProviderBindingCurrent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ bindingId: 'binding-light', localServerId: 'server-light' }),
    );
    expect(preparedFixture.assertRuntimeProviderBindingCurrent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bindingId: 'binding-climate', localServerId: 'server-climate' }),
    );
    await preparedFixture.service.accept(prepared);

    await expect(
      preparedFixture.service.resolveCurrentProviderBindingId(
        preparedFixture.task.taskId,
        'server-light',
      ),
    ).resolves.toBe('binding-light');
    await expect(
      preparedFixture.service.resolveCurrentProviderBindingId(
        preparedFixture.task.taskId,
        'server-climate',
      ),
    ).resolves.toBe('binding-climate');
    await expect(
      preparedFixture.service.resolveCurrentProviderBindingId(
        preparedFixture.task.taskId,
        'server-unknown',
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_PROVIDER_BINDING_CONTEXT_INVALID' });
  });

  it('requires success criteria, evidence, and policy evidence before terminal success', async () => {
    const { service, task, inputAttempt, event } = fixture();
    const prepared = await service.prepareAcceptance({
      task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-terminal',
        },
      },
      capabilityInput: { deviceId: 'alpha' },
      inputAttempt,
      bindingId: 'binding-terminal',
      capabilityAttemptId: 'capability-attempt-terminal',
      event,
    });
    if (prepared === undefined) throw new Error('Expected an explicit Capability binding.');
    await service.accept(prepared);

    await expect(
      service.assertTerminalSuccess(task.taskId, { inspected: true }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
    await expect(
      service.assertTerminalSuccess(task.taskId, {
        inspected: true,
        inspectionEvidence: { providerRequestId: 'provider-request-1' },
        policyEvidence: [{ type: 'authorization', satisfied: true }],
      }),
    ).resolves.toMatchObject({ attemptId: 'capability-attempt-terminal' });
  });

  it('requires exact live Provider proof for both governed provider_result fields', async () => {
    const result = twoProviderResult();

    await expect(
      exerciseTwoProviderResult(twoProviderInvocations(result), result),
    ).resolves.toMatchObject({ attemptId: 'capability-attempt-two-provider-result' });
  });

  it('accepts strict Provider evidence only from the exact latest Capability attempt', async () => {
    const result = twoProviderResult();
    const capabilityAttemptId = 'capability-attempt-two-provider-result';

    await expect(
      exerciseTwoProviderResult(twoProviderInvocations(result, capabilityAttemptId), result, true),
    ).resolves.toMatchObject({ attemptId: capabilityAttemptId });
  });

  it('rejects prior-attempt Provider evidence from an otherwise exact Task-wide result set', async () => {
    const result = twoProviderResult();
    const latestCapabilityAttemptId = 'capability-attempt-two-provider-result';
    const [light, climate] = twoProviderInvocations(result, latestCapabilityAttemptId);

    await expect(
      exerciseTwoProviderResult(
        [{ ...light, capabilityAttemptId: 'capability-attempt-prior' }, climate],
        result,
        true,
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
  });

  it('rejects swapped Provider results', async () => {
    const result = twoProviderResult();
    const invocations = [
      providerResultInvocation({
        invocationId: 'mcp-invocation-light-swapped',
        serverId: 'home-lab-light-mcp',
        toolName: 'light_get_state',
        resourceId: 'living-room-main-light',
        structuredContent: result.climate,
        evidenceType: 'light.state.observation',
      }),
      providerResultInvocation({
        invocationId: 'mcp-invocation-climate-swapped',
        serverId: 'home-lab-climate-mcp',
        toolName: 'climate_get_state',
        resourceId: 'living-room-climate',
        structuredContent: result.mainLight,
        evidenceType: 'climate.state.observation',
      }),
    ];

    await expect(exerciseTwoProviderResult(invocations, result)).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
  });

  it.each([
    [
      'forged resource identity',
      (result: ReturnType<typeof twoProviderResult>) => [
        providerResultInvocation({
          invocationId: 'mcp-invocation-light-forged-resource',
          serverId: 'home-lab-light-mcp',
          toolName: 'light_get_state',
          resourceId: 'bedroom-light',
          structuredContent: result.mainLight,
          evidenceType: 'light.state.observation',
        }),
        twoProviderInvocations(result)[1],
      ],
    ],
    [
      'non-live execution',
      (result: ReturnType<typeof twoProviderResult>) => [
        providerResultInvocation({
          invocationId: 'mcp-invocation-light-simulated',
          serverId: 'home-lab-light-mcp',
          toolName: 'light_get_state',
          resourceId: 'living-room-main-light',
          structuredContent: result.mainLight,
          evidenceType: 'light.state.observation',
          executionMode: 'simulation',
        }),
        twoProviderInvocations(result)[1],
      ],
    ],
    [
      'forged Provider tool',
      (result: ReturnType<typeof twoProviderResult>) => [
        providerResultInvocation({
          invocationId: 'mcp-invocation-light-forged-tool',
          serverId: 'home-lab-light-mcp',
          toolName: 'light_set_power',
          resourceId: 'living-room-main-light',
          structuredContent: result.mainLight,
          evidenceType: 'light.state.observation',
        }),
        twoProviderInvocations(result)[1],
      ],
    ],
  ] as const)('rejects %s evidence', async (_case, buildInvocations) => {
    const result = twoProviderResult();
    await expect(exerciseTwoProviderResult(buildInvocations(result), result)).rejects.toMatchObject(
      { code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' },
    );
  });

  it('rejects missing exact Provider evidence', async () => {
    const result = twoProviderResult();
    const invocations = [
      providerResultInvocation({
        invocationId: 'mcp-invocation-light-without-evidence',
        serverId: 'home-lab-light-mcp',
        toolName: 'light_get_state',
        resourceId: 'living-room-main-light',
        structuredContent: result.mainLight,
        evidenceType: 'light.state.observation',
        includeEvidence: false,
      }),
      twoProviderInvocations(result)[1],
    ];

    await expect(exerciseTwoProviderResult(invocations, result)).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
  });

  it('rejects duplicate matching Provider invocation ambiguity', async () => {
    const result = twoProviderResult();
    const invocations = twoProviderInvocations(result);
    const duplicate = providerResultInvocation({
      invocationId: 'mcp-invocation-light-duplicate',
      serverId: 'home-lab-light-mcp',
      toolName: 'light_get_state',
      resourceId: 'living-room-main-light',
      structuredContent: result.mainLight,
      evidenceType: 'light.state.observation',
    });

    await expect(
      exerciseTwoProviderResult([...invocations, duplicate], result),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
  });

  it('verifies governed read-only terminal semantics against the exact Provider invocation', async () => {
    const result = {
      resourceId: 'living-room-main-light',
      power: 'on',
      reachable: true,
      brightnessPercent: 72,
      observedAt: timestamp,
    };
    const evidenceType = 'light.state.observation';
    const resolution: RuntimeCapabilityResolution = {
      exposureId: 'home-lab-a2a-light-read-state',
      exposureVersion: 1,
      requestedCapabilityId: 'home.light.read-state',
      capabilityVersion: 1,
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['resourceId'],
        properties: { resourceId: { const: 'living-room-main-light' } },
      },
      successCriteria: [
        { type: 'output_schema_valid', required: true },
        { type: 'resource_identity_matches_request', required: true },
        { type: 'required_evidence_complete', required: true },
      ],
      requiredEvidence: [
        { type: 'required_evidence', evidenceType, required: true, hardGate: true },
      ],
      constraints: [
        {
          type: 'resource_policy',
          identifierAuthority: 'public_resource_id',
          selection: 'request_value',
          allowedResourceIds: ['living-room-main-light'],
          physicalResourceBinding: 'forbidden',
        },
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'mcp-binding-ha-light-lab',
          localServerId: 'home-lab-light-mcp',
          mcpToolName: 'light_get_state',
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
        {
          type: 'exact_skill_version',
          skillId: 'home.light.get-state',
          skillVersion: 1,
          taskType: 'light_get_state',
        },
        { type: 'confirmation_policy', required: false, stage: 'not_applicable' },
      ],
      implementationRefs: ['skill:home.light.get-state:1'],
      providerBindingRefs: ['mcp-binding-ha-light-lab'],
      providerBindingRequirements: [
        {
          bindingId: 'mcp-binding-ha-light-lab',
          localServerId: 'home-lab-light-mcp',
        },
      ],
    };
    const invocation = providerInvocation(result, evidenceType);
    const { service, task, inputAttempt, event } = fixture({
      resolution,
      invocations: [invocation],
    });
    const prepared = await service.prepareAcceptance({
      task,
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: resolution.exposureId,
          versionConstraint: '1',
          requestId: 'request-read-only',
        },
      },
      capabilityInput: { resourceId: 'living-room-main-light' },
      inputAttempt,
      bindingId: 'binding-read-only',
      capabilityAttemptId: 'capability-attempt-read-only',
      event,
    });
    if (prepared === undefined) throw new Error('Expected a governed Capability binding.');
    await service.accept(prepared);

    await expect(
      service.assertTerminalSuccess(task.taskId, result, { outputSchemaValid: true }),
    ).resolves.toMatchObject({ attemptId: 'capability-attempt-read-only' });
    await expect(service.assertTerminalSuccess(task.taskId, result)).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
  });

  it('fails closed for missing Provider proof, transformed output, and write-side criteria', async () => {
    const result = {
      resourceId: 'living-room-main-light',
      power: 'off',
      reachable: true,
      brightnessPercent: 0,
      observedAt: timestamp,
    };
    const evidenceType = 'light.state.observation';
    const baseResolution: RuntimeCapabilityResolution = {
      exposureId: 'home-lab-a2a-light-read-state',
      exposureVersion: 1,
      requestedCapabilityId: 'home.light.read-state',
      capabilityVersion: 1,
      requestSchema: {
        type: 'object',
        required: ['resourceId'],
        properties: { resourceId: { type: 'string' } },
      },
      successCriteria: [
        { type: 'output_schema_valid', required: true },
        { type: 'resource_identity_matches_request', required: true },
        { type: 'required_evidence_complete', required: true },
      ],
      requiredEvidence: [
        { type: 'required_evidence', evidenceType, required: true, hardGate: true },
      ],
      constraints: [
        {
          type: 'provider_binding_policy',
          mcpProviderBindingId: 'mcp-binding-ha-light-lab',
          localServerId: 'home-lab-light-mcp',
          mcpToolName: 'light_get_state',
          requiredStatus: 'active',
          requiredAvailabilityStatus: 'available',
          requiredFreshness: 'unexpired',
          fallback: 'deny',
        },
      ],
      implementationRefs: ['skill:home.light.get-state:1'],
      providerBindingRefs: ['mcp-binding-ha-light-lab'],
      providerBindingRequirements: [
        {
          bindingId: 'mcp-binding-ha-light-lab',
          localServerId: 'home-lab-light-mcp',
        },
      ],
    };
    const exercise = async (
      resolution: RuntimeCapabilityResolution,
      invocations: readonly McpInvocation[],
    ) => {
      const preparedFixture = fixture({ resolution, invocations });
      const prepared = await preparedFixture.service.prepareAcceptance({
        task: preparedFixture.task,
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: resolution.exposureId,
            versionConstraint: '1',
            requestId: 'request-fail-closed',
          },
        },
        capabilityInput: { resourceId: 'living-room-main-light' },
        inputAttempt: preparedFixture.inputAttempt,
        bindingId: 'binding-fail-closed',
        capabilityAttemptId: 'capability-attempt-fail-closed',
        event: preparedFixture.event,
      });
      if (prepared === undefined) throw new Error('Expected a governed Capability binding.');
      await preparedFixture.service.accept(prepared);
      return preparedFixture.service.assertTerminalSuccess(preparedFixture.task.taskId, result, {
        outputSchemaValid: true,
      });
    };

    await expect(exercise(baseResolution, [])).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
    await expect(
      exercise(baseResolution, [
        providerInvocation(
          { ...result, brightnessPercent: 99 },
          evidenceType,
          'capability-attempt-fail-closed',
        ),
      ]),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
    const sideEffectingInvocation: McpInvocation = {
      ...providerInvocation(result, evidenceType, 'capability-attempt-fail-closed'),
      executionSemantics: {
        ...providerInvocation(result, evidenceType, 'capability-attempt-fail-closed')
          .executionSemantics,
        effect: 'side_effecting',
      },
    };
    await expect(exercise(baseResolution, [sideEffectingInvocation])).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
    await expect(
      exercise(
        {
          ...baseResolution,
          successCriteria: [
            ...baseResolution.successCriteria,
            { type: 'state_confirmation_matches_request', required: true },
            { type: 'baseline_restored', required: true },
          ],
        },
        [providerInvocation(result, evidenceType, 'capability-attempt-fail-closed')],
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
  });

  it('accepts one exact five-dispatch physical attempt while the final control is still claimed', async () => {
    await expect(exercisePhysicalTerminal(physicalScenario())).resolves.toMatchObject({
      attemptId: 'capability-attempt-physical',
      requestedCapabilityId: 'vehicle.navigate.exact',
    });
  });

  it.each([
    [
      'an invocation-less uncertain admission intent in the same attempt',
      (scenario: PhysicalScenario): PhysicalScenario => ({
        ...scenario,
        physicalEvidence: {
          ...scenario.physicalEvidence,
          dispatches: [
            ...scenario.physicalEvidence.dispatches,
            {
              invocationId: 'physical-invocation-orphan',
              invocationPresent: false,
              capabilityAttemptId: 'capability-attempt-physical',
              admission: {
                ...required(required(scenario.physicalEvidence.dispatches[0]).admission),
                intentId: 'physical-admission-orphan',
                invocationId: 'physical-invocation-orphan',
                status: 'uncertain',
                reasonCode: 'REMOTE_TASK_ADMISSION_DISPATCH_OUTCOME_UNCERTAIN',
              },
            },
          ],
        },
      }),
    ],
    [
      'a sixth or side-branch MCP node in the confirmed plan',
      (scenario: PhysicalScenario): PhysicalScenario => ({
        ...scenario,
        physicalEvidence: {
          ...scenario.physicalEvidence,
          plan: {
            ...required(scenario.physicalEvidence.plan),
            nodes: [
              ...required(scenario.physicalEvidence.plan).nodes,
              {
                nodeId: 'usage_task_5',
                ordinal: 7,
                type: 'mcp_tool',
                serverId: 'smpp-provider',
                toolName: 'vehicle_navigate',
                taskRequired: true,
              },
            ],
          },
        },
      }),
    ],
    [
      'an invocation that differs from the frozen forward two-metre input',
      (scenario: PhysicalScenario): PhysicalScenario => ({
        ...scenario,
        invocations: scenario.invocations.map((invocation, index) =>
          index === 2
            ? {
                ...invocation,
                arguments: {
                  resourceId: 'vehicle:ugv-1',
                  mission: { type: 'distance', direction: 'forward', distanceM: 1 },
                },
              }
            : invocation,
        ),
      }),
    ],
    [
      'an unprocessed intermediate terminal control',
      (scenario: PhysicalScenario): PhysicalScenario => ({
        ...scenario,
        physicalEvidence: {
          ...scenario.physicalEvidence,
          dispatches: scenario.physicalEvidence.dispatches.map((evidence, index) =>
            index === 1
              ? {
                  ...evidence,
                  remoteTask: {
                    ...required(evidence.remoteTask),
                    localState: 'terminal_event_claimed',
                    terminalEventStatus: 'claimed',
                    processedCompletedEventCount: 0,
                  },
                }
              : evidence,
          ),
        },
      }),
    ],
  ] as const)('rejects physical terminal success with %s', async (_case, mutate) => {
    await expect(exercisePhysicalTerminal(mutate(physicalScenario()))).rejects.toMatchObject({
      code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED',
    });
  });
});

interface PhysicalScenario {
  readonly resolution: RuntimeCapabilityResolution;
  readonly invocations: readonly McpInvocation[];
  readonly physicalEvidence: TaskCapabilityPhysicalEvidenceSnapshot;
}

function physicalScenario(): PhysicalScenario {
  const capabilityAttemptId = 'capability-attempt-physical';
  const planId = 'plan-physical-five-dispatch';
  const arguments_ = {
    resourceId: 'vehicle:ugv-1',
    mission: { type: 'distance', direction: 'forward', distanceM: 2 },
  } as const;
  const argumentsHash = canonicalHash(arguments_);
  const invocations = Array.from({ length: 5 }, (_, index): McpInvocation => {
    const invocationId = `physical-invocation-${String(index + 1)}`;
    return {
      invocationId,
      taskId: 'task-1',
      capabilityAttemptId,
      controlConfirmationId: `physical-confirmation-${String(index + 1)}`,
      controlProviderBindingId: 'binding-vehicle-navigate',
      controlArgumentsHash: argumentsHash,
      controlDispatchHash: physicalDispatchHash(index),
      contextId: 'context-1',
      executionMode: 'live',
      serverId: 'smpp-provider',
      toolName: 'vehicle_navigate',
      executionSemantics: {
        effect: 'side_effecting',
        execution: 'task_required',
        cancellation: 'task_cancel',
        idempotency: 'server_managed',
        replay: 'forbidden',
        source: 'mcp_declared',
      },
      arguments: arguments_,
      result: { remoteTask: { remoteTaskId: `remote-physical-${String(index + 1)}` } },
      status: 'succeeded',
      startedAt: physicalTime(index, 0),
      completedAt: physicalTime(index, 20),
      durationMs: 20,
    };
  });
  const dispatches = invocations.map((invocation, index) =>
    physicalDispatchEvidence(invocation, index, capabilityAttemptId, planId),
  );
  const planNodes = Array.from({ length: 5 }, (_, index) => ({
    nodeId: `usage_task_${String(index)}`,
    ordinal: index + 1,
    type: 'mcp_tool',
    serverId: 'smpp-provider',
    toolName: 'vehicle_navigate',
    taskRequired: true,
  }));
  const physicalEvidence: TaskCapabilityPhysicalEvidenceSnapshot = {
    plan: {
      planId,
      confirmationStatus: 'confirmed',
      workflowDefinitionId: 'workflow-physical-five-dispatch',
      workflowDefinitionVersion: 1,
      entryNodeId: 'usage_task_0',
      exitNodeIds: ['usage_success'],
      nodes: [
        ...planNodes,
        {
          nodeId: 'usage_success',
          ordinal: 6,
          type: 'result',
          taskRequired: false,
        },
      ],
      edges: [
        ...Array.from({ length: 4 }, (_, index) => ({
          sourceNodeId: `usage_task_${String(index)}`,
          targetNodeId: `usage_task_${String(index + 1)}`,
        })),
        { sourceNodeId: 'usage_task_4', targetNodeId: 'usage_success' },
      ],
    },
    dispatches,
  };
  return {
    resolution: physicalResolution(),
    invocations,
    physicalEvidence,
  };
}

function physicalResolution(): RuntimeCapabilityResolution {
  return {
    exposureId: 'vehicle-navigate-exact',
    exposureVersion: 1,
    requestedCapabilityId: 'vehicle.navigate.exact',
    capabilityVersion: 1,
    requestSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['resourceId', 'mission'],
      properties: {
        resourceId: { const: 'vehicle:ugv-1' },
        mission: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'direction', 'distanceM'],
          properties: {
            type: { const: 'distance' },
            direction: { const: 'forward' },
            distanceM: { const: 2 },
          },
        },
      },
    },
    successCriteria: [
      { type: 'output_schema_valid', required: true },
      { type: 'resource_identity_matches_request', required: true },
      { type: 'required_evidence_complete', required: true },
      { type: 'mcp_acceptance_is_terminal_success', value: false },
      { type: 'remote_task_identity_present', required: true },
      { type: 'remote_terminal_observation_present', required: true },
      { type: 'external_command_dispatch_count', minimum: 5, maximum: 5 },
    ],
    requiredEvidence: [
      {
        type: 'required_evidence',
        evidenceType: 'vehicle.task.terminal',
        required: true,
        hardGate: true,
      },
    ],
    constraints: [
      {
        type: 'resource_policy',
        identifierAuthority: 'public_smpp_tool_schema',
        selection: 'exact_value',
        allowedResourceIds: ['vehicle:ugv-1'],
        downstreamResourceBinding: 'forbidden',
      },
      {
        type: 'provider_binding_policy',
        mcpProviderBindingId: 'binding-vehicle-navigate',
        localServerId: 'smpp-provider',
        mcpToolName: 'vehicle_navigate',
        requiredStatus: 'active',
        requiredAvailabilityStatus: 'available',
        requiredFreshness: 'unexpired',
        fallback: 'deny',
      },
      {
        type: 'exact_skill_version',
        skillId: 'vehicle.navigate',
        skillVersion: 1,
        taskType: 'vehicle_navigate',
      },
      { type: 'confirmation_policy', required: true, stage: 'before_execution' },
      {
        type: 'physical_side_effect_policy',
        sideEffecting: true,
        dispatchMaximum: 5,
        uncertainDispatchPolicy: 'reconcile_never_redispatch',
        remoteTaskTerminalEvidenceRequired: true,
      },
      {
        type: 'bounded_movement_policy',
        toolName: 'vehicle_navigate',
        missionType: 'distance',
        missionTypeArgumentPath: ['mission', 'type'],
        directionArgumentPath: ['mission', 'direction'],
        distanceArgumentPath: ['mission', 'distanceM'],
        allowedDirections: ['backward', 'forward', 'left', 'right'],
        exclusiveMinimum: 0,
        maximumInclusive: 2,
        exactDirection: 'forward',
        exactDistancePerDispatch: 2,
        exactDispatchCount: 5,
        exactTotalDistance: 10,
        strictSequential: true,
        terminalBeforeNext: true,
      },
    ],
    implementationRefs: ['skill:vehicle.navigate:1'],
    providerBindingRefs: ['binding-vehicle-navigate'],
  };
}

function physicalDispatchEvidence(
  invocation: McpInvocation,
  index: number,
  capabilityAttemptId: string,
  planId: string,
): TaskCapabilityPhysicalDispatchEvidence {
  const final = index === 4;
  const invocationId = invocation.invocationId;
  const bindingId = `remote-binding-physical-${String(index + 1)}`;
  const nodeId = `usage_task_${String(index)}`;
  const nodeRunId = `${nodeId}:run:1`;
  return {
    invocationId,
    invocationPresent: true,
    capabilityAttemptId,
    confirmation: {
      confirmationId: required(invocation.controlConfirmationId),
      consumedInvocationId: invocationId,
      consumedDispatchHash: required(invocation.controlDispatchHash),
      consumedAt: physicalTime(index, 10),
    },
    admission: {
      intentId: `physical-admission-${String(index + 1)}`,
      invocationId,
      taskId: 'task-1',
      capabilityAttemptId,
      bindingId,
      recordedInvocationId: invocationId,
      materializedBindingId: bindingId,
      argumentsHash: required(invocation.controlArgumentsHash),
      dispatchHash: required(invocation.controlDispatchHash),
      workflowPlanId: planId,
      workflowNodeId: nodeId,
      workflowNodeRunId: nodeRunId,
      status: 'materialized',
    },
    remoteTask: {
      bindingId,
      remoteTaskId: `remote-physical-${String(index + 1)}`,
      mcpInvocationId: invocationId,
      workflowNodeId: nodeId,
      workflowNodeRunId: nodeRunId,
      workflowPlanId: planId,
      workflowDefinitionId: 'workflow-physical-five-dispatch',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'workflow-instance-physical',
      executionMode: 'live',
      protocolStatus: 'completed',
      localState: final ? 'terminal_event_claimed' : 'reentered',
      providerFailureCount: 0,
      providerEvidence: [
        {
          evidenceId: `physical-terminal-evidence-${String(index + 1)}`,
          evidenceType: 'vehicle.task.terminal',
          observedAt: physicalTime(index, 100),
          payloadRef: { kind: 'structured_content', jsonPointer: '' },
        },
      ],
      resultIsError: false,
      createdAt: physicalTime(index, 20),
      terminalAt: physicalTime(index, 100),
      acceptedObservationCount: 1,
      acceptedObservedAt: physicalTime(index, 20),
      unsafeObservationCount: 0,
      failedProtocolAttemptCount: 0,
      terminalEventCount: 1,
      processedCompletedEventCount: final ? 0 : 1,
      terminalEventCreatedAt: physicalTime(index, 100),
      ...(final ? {} : { terminalEventProcessedAt: physicalTime(index, 150) }),
      terminalEventStatus: final ? 'claimed' : 'processed',
      continuationAttemptCount: 1,
      waitingExternalContinuationCount: final ? 0 : 1,
      succeededContinuationCount: final ? 1 : 0,
    },
  };
}

function physicalDispatchHash(index: number): string {
  return `sha256:${(index + 1).toString(16).padStart(64, '0')}`;
}

function physicalTime(index: number, offsetMs: number): string {
  return new Date(Date.parse(timestamp) + index * 1_000 + offsetMs).toISOString();
}

async function exercisePhysicalTerminal(scenario: PhysicalScenario) {
  const preparedFixture = fixture({
    resolution: scenario.resolution,
    invocations: scenario.invocations,
    physicalEvidence: scenario.physicalEvidence,
  });
  const capabilityInput = {
    resourceId: 'vehicle:ugv-1',
    mission: { type: 'distance', direction: 'forward', distanceM: 2 },
  };
  const prepared = await preparedFixture.service.prepareAcceptance({
    task: preparedFixture.task,
    metadata: {
      'io.sdar/requestedCapability': {
        exposureId: scenario.resolution.exposureId,
        versionConstraint: '1',
        requestId: 'request-physical-five-dispatch',
      },
    },
    capabilityInput,
    inputAttempt: preparedFixture.inputAttempt,
    bindingId: 'binding-physical',
    capabilityAttemptId: 'capability-attempt-physical',
    event: preparedFixture.event,
  });
  if (prepared === undefined) throw new Error('Expected a physical Capability binding.');
  await preparedFixture.service.accept(prepared);
  preparedFixture.listAttempts.mockResolvedValue([
    {
      ...prepared.capabilityAttempt,
      planId: 'plan-physical-five-dispatch',
      status: 'waiting',
      startedAt: timestamp,
    },
  ]);
  return preparedFixture.service.assertTerminalSuccess(
    preparedFixture.task.taskId,
    { resourceId: 'vehicle:ugv-1', status: 'completed' },
    { outputSchemaValid: true },
  );
}

async function acceptedDefaultCapability() {
  const preparedFixture = fixture();
  const prepared = await preparedFixture.service.prepareAcceptance({
    task: preparedFixture.task,
    metadata: {
      'io.sdar/requestedCapability': {
        exposureId: preparedFixture.resolution.exposureId,
        versionConstraint: String(preparedFixture.resolution.exposureVersion),
        requestId: 'request-capability-attempt-context',
      },
    },
    capabilityInput: { deviceId: 'alpha' },
    inputAttempt: preparedFixture.inputAttempt,
    bindingId: 'binding-capability-attempt-context',
    capabilityAttemptId: 'capability-attempt-context',
    event: preparedFixture.event,
  });
  if (prepared === undefined) throw new Error('Expected a governed Capability binding.');
  await preparedFixture.service.accept(prepared);
  return { ...preparedFixture, prepared };
}

function withAttemptStatus(
  attempt: TaskCapabilityExecutionAttempt,
  status: TaskCapabilityExecutionAttempt['status'],
): TaskCapabilityExecutionAttempt {
  if (status === 'prepared') return attempt;
  if (status === 'running' || status === 'waiting')
    return { ...attempt, status, startedAt: timestamp };
  return { ...attempt, status, startedAt: timestamp, completedAt: timestamp };
}

function providerInvocation(
  structuredContent: Readonly<Record<string, unknown>>,
  evidenceType: string,
  capabilityAttemptId = 'capability-attempt-read-only',
): McpInvocation {
  return {
    invocationId: 'mcp-invocation-read-only',
    taskId: 'task-1',
    capabilityAttemptId,
    contextId: 'context-1',
    executionMode: 'live',
    serverId: 'home-lab-light-mcp',
    toolName: 'light_get_state',
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'allowed',
      source: 'mcp_declared',
    },
    arguments: { resourceId: 'living-room-main-light' },
    result: {
      content: [],
      structuredContent,
      isError: false,
      evidence: [
        {
          evidenceId: 'provider-evidence-read-only',
          evidenceType,
          observedAt: timestamp,
          payloadRef: { kind: 'structured_content', jsonPointer: '' },
        },
      ],
    },
    status: 'succeeded',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 1,
  };
}

function twoProviderResult() {
  return {
    mainLight: {
      resourceId: 'living-room-main-light',
      power: 'on',
      reachable: true,
      brightnessPercent: 72,
      observedAt: timestamp,
    },
    climate: {
      resourceId: 'living-room-climate',
      hvacMode: 'cool',
      targetTemperatureCelsius: 24,
      currentTemperatureCelsius: 27,
      observedAt: timestamp,
    },
  } as const;
}

function twoProviderResolution(): RuntimeCapabilityResolution {
  return {
    exposureId: 'home-lab-a2a-living-room-read-state',
    exposureVersion: 1,
    requestedCapabilityId: 'home.living-room.read-state',
    capabilityVersion: 1,
    requestSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['mainLightResourceId', 'climateResourceId'],
      properties: {
        mainLightResourceId: { const: 'living-room-main-light' },
        climateResourceId: { const: 'living-room-climate' },
      },
    },
    successCriteria: [{ type: 'required_evidence_complete', required: true }],
    requiredEvidence: [
      {
        type: 'provider_result',
        field: 'mainLight',
        inputField: 'mainLightResourceId',
        serverId: 'home-lab-light-mcp',
        toolName: 'light_get_state',
        evidenceType: 'light.state.observation',
        required: true,
        hardGate: true,
      },
      {
        type: 'provider_result',
        field: 'climate',
        inputField: 'climateResourceId',
        serverId: 'home-lab-climate-mcp',
        toolName: 'climate_get_state',
        evidenceType: 'climate.state.observation',
        required: true,
        hardGate: true,
      },
    ],
    constraints: [],
    implementationRefs: ['skill:home.living-room.get-state:1'],
    providerBindingRefs: ['mcp-binding-ha-light-lab', 'mcp-binding-ha-climate-lab'],
  };
}

function twoProviderInvocations(
  result: ReturnType<typeof twoProviderResult>,
  capabilityAttemptId = 'capability-attempt-two-provider-result',
): readonly [McpInvocation, McpInvocation] {
  return [
    providerResultInvocation({
      invocationId: 'mcp-invocation-light-read-only',
      serverId: 'home-lab-light-mcp',
      toolName: 'light_get_state',
      resourceId: 'living-room-main-light',
      structuredContent: result.mainLight,
      evidenceType: 'light.state.observation',
      capabilityAttemptId,
    }),
    providerResultInvocation({
      invocationId: 'mcp-invocation-climate-read-only',
      serverId: 'home-lab-climate-mcp',
      toolName: 'climate_get_state',
      resourceId: 'living-room-climate',
      structuredContent: result.climate,
      evidenceType: 'climate.state.observation',
      capabilityAttemptId,
    }),
  ];
}

function providerResultInvocation(
  input: Readonly<{
    invocationId: string;
    serverId: string;
    toolName: string;
    resourceId: string;
    structuredContent: Readonly<Record<string, unknown>>;
    evidenceType: string;
    capabilityAttemptId?: string;
    executionMode?: McpInvocation['executionMode'];
    includeEvidence?: boolean;
  }>,
): McpInvocation {
  return {
    invocationId: input.invocationId,
    taskId: 'task-1',
    contextId: 'context-1',
    capabilityAttemptId: input.capabilityAttemptId ?? 'capability-attempt-two-provider-result',
    executionMode: input.executionMode ?? 'live',
    serverId: input.serverId,
    toolName: input.toolName,
    executionSemantics: {
      effect: 'read_only',
      execution: 'synchronous',
      cancellation: 'unsupported',
      idempotency: 'none',
      replay: 'allowed',
      source: 'mcp_declared',
    },
    arguments: { resourceId: input.resourceId },
    result: {
      content: [],
      structuredContent: input.structuredContent,
      isError: false,
      evidence:
        input.includeEvidence === false
          ? []
          : [
              {
                evidenceId: `${input.invocationId}-evidence`,
                evidenceType: input.evidenceType,
                observedAt: timestamp,
                payloadRef: { kind: 'structured_content', jsonPointer: '' },
              },
            ],
    },
    status: 'succeeded',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 1,
  };
}

async function exerciseTwoProviderResult(
  invocations: readonly McpInvocation[],
  result: ReturnType<typeof twoProviderResult>,
  strict = false,
) {
  const resolution = twoProviderResolution();
  const preparedFixture = fixture({ resolution, invocations });
  const prepared = await preparedFixture.service.prepareAcceptance({
    task: preparedFixture.task,
    metadata: {
      'io.sdar/requestedCapability': {
        exposureId: resolution.exposureId,
        versionConstraint: '1',
        requestId: 'request-two-provider-result',
      },
    },
    capabilityInput: {
      mainLightResourceId: 'living-room-main-light',
      climateResourceId: 'living-room-climate',
    },
    inputAttempt: preparedFixture.inputAttempt,
    bindingId: 'binding-two-provider-result',
    capabilityAttemptId: 'capability-attempt-two-provider-result',
    event: preparedFixture.event,
  });
  if (prepared === undefined) throw new Error('Expected a two-Provider Capability binding.');
  await preparedFixture.service.accept(prepared);
  return preparedFixture.service.assertTerminalSuccess(
    preparedFixture.task.taskId,
    result,
    strict
      ? {
          requiredBinding: {
            requestedCapabilityId: resolution.requestedCapabilityId,
            capabilityVersion: resolution.capabilityVersion,
          },
        }
      : {},
  );
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected fixture value.');
  return value;
}
