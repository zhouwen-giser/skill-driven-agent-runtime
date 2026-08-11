import { describe, expect, it, vi } from 'vitest';

import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  createAgentTask,
  createTaskExecutionAttempt,
  type McpInvocation,
  type TaskCapabilityBinding,
} from '../../domain/src/index.js';
import {
  RuntimeTaskCapabilityService,
  type RuntimeCapabilityResolution,
  type RuntimeMcpProviderBindingAdmissionVerifier,
  type TaskCapabilityAcceptanceStore,
} from '../src/index.js';

const timestamp = '2026-08-02T00:00:00.000Z';

function fixture(
  options: Readonly<{
    resolution?: RuntimeCapabilityResolution;
    invocations?: readonly McpInvocation[];
    providerBindingCurrent?: boolean;
    runtimeProviderBindingCurrent?: boolean;
    runtimeProviderBindingsConfigured?: boolean;
  }> = {},
) {
  let binding: TaskCapabilityBinding | undefined;
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
  const store: TaskCapabilityAcceptanceStore = {
    resolveExposure,
    accept: vi.fn<TaskCapabilityAcceptanceStore['accept']>((input) => {
      binding = input.binding;
      return Promise.resolve();
    }),
    findBinding: vi
      .fn<TaskCapabilityAcceptanceStore['findBinding']>()
      .mockImplementation(() => Promise.resolve(binding)),
    listAttempts: vi.fn<TaskCapabilityAcceptanceStore['listAttempts']>().mockResolvedValue([]),
    appendAttempt: vi
      .fn<TaskCapabilityAcceptanceStore['appendAttempt']>()
      .mockRejectedValue(new Error('not used')),
    updateLatestAttempt,
  };
  const assertRuntimeProviderBindingCurrent = vi.fn<
    RuntimeMcpProviderBindingAdmissionVerifier['assertCurrent']
  >(() =>
    options.runtimeProviderBindingCurrent === false
      ? Promise.reject(new Error('MCP_PROVIDER_BINDING_NOT_CURRENT'))
      : Promise.resolve(),
  );
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
    resolveExposure,
    updateLatestAttempt,
    assertRuntimeProviderBindingCurrent,
    task,
    inputAttempt,
    event,
  };
}

describe('RuntimeTaskCapabilityService', () => {
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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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
        providerInvocation({ ...result, brightnessPercent: 99 }, evidenceType),
      ]),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
    const sideEffectingInvocation: McpInvocation = {
      ...providerInvocation(result, evidenceType),
      executionSemantics: {
        ...providerInvocation(result, evidenceType).executionSemantics,
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
        [providerInvocation(result, evidenceType)],
      ),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_TERMINAL_GUARD_FAILED' });
  });
});

function providerInvocation(
  structuredContent: Readonly<Record<string, unknown>>,
  evidenceType: string,
): McpInvocation {
  return {
    invocationId: 'mcp-invocation-read-only',
    taskId: 'task-1',
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
