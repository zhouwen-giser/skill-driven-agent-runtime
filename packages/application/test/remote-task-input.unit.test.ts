import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteTaskBinding,
  createRemoteTaskInputLink,
  type RemoteTaskBinding,
  type RemoteTaskInputLink,
} from '../../domain/src/index.js';
import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';
import {
  RemoteTaskInputService,
  type RemoteTaskInputAttempt,
  type RemoteTaskInputRepository,
} from '../src/index.js';

describe('RemoteTaskInputService', () => {
  it('activates an input_required control as an existing Task input without planning', async () => {
    const binding = remoteBinding();
    let activated: Parameters<RemoteTaskInputRepository['activate']>[0] | undefined;
    const fixture = serviceFixture(binding, {
      activate(input) {
        activated = input;
        return Promise.resolve(true);
      },
    });

    await expect(
      fixture.service.process({
        eventId: 'control-event-1',
        bindingId: binding.bindingId,
        eventType: 'task.input_required',
      }),
    ).resolves.toBe('activated');

    expect(activated).toMatchObject({
      request: { taskId: 'task-1', source: 'remote_task', status: 'waiting' },
      link: {
        bindingId: 'binding-1',
        workflowNodeRunId: 'instance-1:node-1:1',
        status: 'waiting',
      },
    });
    expect(fixture.events).toHaveLength(1);
  });

  it('validates structured and deterministic single-field text elicitation responses', async () => {
    const binding = remoteBinding();
    const fixture = serviceFixture(binding);

    await expect(
      fixture.service.prepareResponse('input-request-1', {
        approval: { action: 'accept', content: { approved: true } },
      }),
    ).resolves.toEqual({
      approval: { action: 'accept', content: { approved: true } },
    });
    await expect(fixture.service.prepareResponse('input-request-1', 'yes')).rejects.toMatchObject({
      code: 'REMOTE_TASK_INPUT_SCHEMA_MISMATCH',
    });
    fixture.link = inputLink({
      requestedSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['answer'],
        properties: { answer: { type: 'string' } },
      },
    });
    await expect(fixture.service.prepareResponse('input-request-1', 'yes')).resolves.toEqual({
      approval: { action: 'accept', content: { answer: 'yes' } },
    });
  });

  it('records update acknowledgement and transport uncertainty then always re-arms polling', async () => {
    const binding = remoteBinding();
    const fixture = serviceFixture(binding);
    fixture.link = { ...fixture.link, status: 'answered' };

    await fixture.service.submitAnswer('input-request-1', {
      approval: { action: 'accept', content: { approved: true } },
    });
    expect(fixture.sender).toHaveBeenCalledTimes(1);
    expect(fixture.attempts[0]).toMatchObject({ status: 'acknowledged' });
    expect(fixture.pollJobs).toEqual([
      expect.objectContaining({ bindingId: 'binding-1', expectedVersion: 2 }),
    ]);

    fixture.binding = remoteBinding();
    fixture.link = { ...inputLink(), status: 'answered' };
    fixture.sender.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(
      fixture.service.submitAnswer('input-request-1', {
        approval: { action: 'accept', content: { approved: true } },
      }),
    ).resolves.toBeUndefined();
    expect(fixture.attempts.at(-1)).toMatchObject({
      status: 'provider_unreachable',
      errorCode: 'MCP_TASK_UPDATE_PROVIDER_UNREACHABLE',
    });
  });
});

function serviceFixture(
  initialBinding: RemoteTaskBinding,
  overrides: Partial<RemoteTaskInputRepository> = {},
) {
  const state: {
    binding: RemoteTaskBinding;
    link: RemoteTaskInputLink;
    attempts: RemoteTaskInputAttempt[];
  } = { binding: initialBinding, link: inputLink(), attempts: [] };
  const events: unknown[] = [];
  const pollJobs: unknown[] = [];
  const sender = vi.fn().mockResolvedValue({ acknowledged: true, protocolRevision: '2026-test' });
  const repository: RemoteTaskInputRepository = {
    activate: () => Promise.resolve(true),
    findLink: () => Promise.resolve(state.link),
    recordUpdateOutcome(input) {
      state.attempts.push(input.attempt);
      state.link = { ...state.link, status: input.status, updatedAt: input.observedAt };
      state.binding = {
        ...state.binding,
        localState: 'polling',
        nextPollAt: input.observedAt,
        updatedAt: input.observedAt,
        version: state.binding.version + 1,
      };
      return Promise.resolve({ applied: true, binding: state.binding });
    },
    listAttempts: () => Promise.resolve(state.attempts),
    ...overrides,
  };
  let clockIndex = 0;
  const service = new RemoteTaskInputService({
    continuations: {
      claimControl: () =>
        Promise.resolve({
          eventId: 'control-event-1',
          bindingId: 'binding-1',
          type: 'task.input_required',
          remoteRevision: 'remote-revision-1',
          resultHash: 'a'.repeat(64),
          payload: inputRequiredPayload(),
          status: 'claimed',
          createdAt: '2026-07-17T00:00:00.000Z',
          claimedAt: '2026-07-17T00:00:01.000Z',
        }),
    },
    remoteTasks: { findById: () => Promise.resolve(state.binding) },
    inputs: repository,
    tasks: { findById: () => Promise.resolve(undefined) },
    events: {
      publish(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    sender: { updateRemoteTask: sender },
    pollQueue: {
      enqueue(job) {
        pollJobs.push(job);
        return Promise.resolve();
      },
      state: () => Promise.resolve('missing'),
      listDeadLetters: () => Promise.resolve([]),
      retryDeadLetter: () => Promise.resolve(),
    },
    schemas: new AjvJsonSchemaValidator(),
    serial: { run: (_contextId, operation) => operation() },
    clock: {
      now: () => new Date(Date.UTC(2026, 6, 17, 0, 0, clockIndex++)).toISOString(),
    },
    ids: {
      nextInputRequestId: () => 'input-request-new',
      nextClaimToken: () => 'claim-1',
      nextProtocolAttemptId: () => `protocol-attempt-${String(state.attempts.length + 1)}`,
      nextEventId: () => 'runtime-event-1',
    },
  });
  return {
    service,
    events,
    pollJobs,
    sender,
    get attempts() {
      return state.attempts;
    },
    get link() {
      return state.link;
    },
    set link(value: RemoteTaskInputLink) {
      state.link = value;
    },
    set binding(value: RemoteTaskBinding) {
      state.binding = value;
    },
  };
}

function remoteBinding(): RemoteTaskBinding {
  const binding = {
    ...createRemoteTaskBinding({
      bindingId: 'binding-1',
      serverId: 'mcp-server-1',
      operationName: 'approve',
      remoteTaskId: 'remote-task-1',
      agentTaskId: 'task-1',
      contextId: 'context-1',
      goalId: 'goal-1',
      goalVersion: 1,
      workflowPlanId: 'plan-1',
      workflowDefinitionId: 'workflow-1',
      workflowDefinitionVersion: 1,
      workflowInstanceId: 'instance-1',
      workflowNodeId: 'node-1',
      workflowNodeRunId: 'instance-1:node-1:1',
      mcpInvocationId: 'invocation-1',
      protocolStatus: 'input_required',
      protocolRevision: '2026-test',
      tasksSchemaRevision: 'schema-test',
      protocolContract: {
        mode: 'frozen_v1',
        protocolVersion: '2026-test',
        baselineSha256: 'a'.repeat(64),
        serverDiscoverySnapshotId: 'snapshot-1',
      },
      taskBehavior: 'server_directed',
      taskCancellation: 'task_cancel',
      runtimeRevision: '1',
      remoteRevision: 'remote-revision-1',
      executionContext: { mode: 'live' },
      authoritySnapshot: testAuthoritySnapshot('mcp-server-1', 'credential-1'),
      credentialRevision: 'credential-1',
      sessionRevision: 'session-1',
      lastProviderUpdatedAt: '2026-07-17T00:00:00.000Z',
      pollIntervalMs: 1_000,
      createdAt: '2026-07-17T00:00:00.000Z',
    }),
  };
  delete binding.nextPollAt;
  return { ...binding, localState: 'awaiting_input' };
}

function testAuthoritySnapshot(serverId: string, credentialRevision: string) {
  return {
    schemaVersion: '1.0' as const,
    capturedAt: '2026-07-17T00:00:00.000Z',
    runtime: {
      serverId,
      endpoint: `https://${serverId}.test/mcp`,
      serverUpdatedAt: credentialRevision,
      toolRevision: 1,
      protocolSnapshotId: 'snapshot-1',
      catalogRevision: 'catalog-revision-1',
      catalogChecksum: 'c'.repeat(64),
      operationCount: 1,
    },
  };
}

function inputLink(input: Readonly<{ requestedSchema?: unknown }> = {}): RemoteTaskInputLink {
  return createRemoteTaskInputLink({
    inputRequestId: 'input-request-1',
    controlEventId: 'control-event-1',
    bindingId: 'binding-1',
    remoteTaskId: 'remote-task-1',
    workflowInstanceId: 'instance-1',
    workflowNodeId: 'node-1',
    workflowNodeRunId: 'instance-1:node-1:1',
    remoteRevision: 'remote-revision-1',
    resultHash: 'a'.repeat(64),
    inputRequests: {
      approval: {
        method: 'elicitation/create',
        params: {
          message: 'Approve?',
          requestedSchema: input.requestedSchema ?? {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: { approved: { type: 'boolean' } },
          },
        },
      },
    },
    createdAt: '2026-07-17T00:00:00.000Z',
  });
}

function inputRequiredPayload() {
  return {
    remoteTaskId: 'remote-task-1',
    status: 'input_required',
    createdAt: '2026-07-17T00:00:00.000Z',
    lastUpdatedAt: '2026-07-17T00:00:00.000Z',
    ttlMs: null,
    protocolRevision: '2026-test',
    tasksSchemaRevision: 'schema-test',
    inputRequests: inputLink().inputRequests,
  };
}
