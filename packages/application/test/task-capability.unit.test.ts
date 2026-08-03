import { describe, expect, it, vi } from 'vitest';

import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  createAgentTask,
  createTaskExecutionAttempt,
  type TaskCapabilityBinding,
} from '../../domain/src/index.js';
import {
  RuntimeTaskCapabilityService,
  type RuntimeCapabilityResolution,
  type TaskCapabilityAcceptanceStore,
} from '../src/index.js';

const timestamp = '2026-08-02T00:00:00.000Z';

function fixture() {
  let binding: TaskCapabilityBinding | undefined;
  const resolution: RuntimeCapabilityResolution = {
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
  const service = new RuntimeTaskCapabilityService({
    store,
    schemas: new AjvJsonSchemaValidator(),
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
  return { service, resolveExposure, updateLatestAttempt, task, inputAttempt, event };
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
});
