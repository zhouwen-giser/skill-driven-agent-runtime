import { SendMessageRequest, Task, TaskState } from '@a2a-js/sdk';
import {
  AgentEvent,
  InMemoryTaskStore,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from '@a2a-js/sdk/server';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConfiguredBearerGovernedControlIdentity,
  ConfiguredTrustedIntranetGovernedControlIdentity,
} from '../../../apps/server/src/governed-control-management-identity.js';
import {
  InMemoryTaskStateNotifier,
  type ExternalTaskProjection,
  type ExternalTaskProjectionQuery,
  type ExternalTaskProjectionRepository,
  type SubmitTaskCommand,
} from '../../application/src/index.js';
import {
  createAgentTask,
  createConversationContext,
  transitionTask,
  type AgentTask,
} from '../../domain/src/index.js';
import {
  createProbeRequest,
  startA2aHttpSpike,
  streamPayloadCase,
  type A2aHttpSpikeHandle,
} from '../src/http-endpoint-spike.js';
import { buildAgentCard } from '../src/compatibility.js';
import { startA2AHttpEndpoint } from '../src/http-endpoint.js';
import { A2AProjectionTaskStore } from '../src/postgres-task-store.js';
import { ReplaySafeExecutionEventBusManager } from '../src/replay-safe-event-bus-manager.js';
import { TaskServiceAgentExecutor } from '../src/task-service-executor.js';

describe('A2A 1.0 HTTP endpoint compatibility', () => {
  let handle: A2aHttpSpikeHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it('discovers the Agent Card and completes a task through the official REST client', async () => {
    handle = await startA2aHttpSpike();
    const result = await handle.client.sendMessage(createProbeRequest());

    expect(result).toHaveProperty('id');
    if (!('id' in result)) throw new Error('A2A_EXPECTED_TASK_RESULT');
    expect(result.contextId).not.toBe('');
    expect(result.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const queried = await handle.client.getTask({ tenant: '', id: result.id });
    expect(queried.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
  });

  it('projects only the frozen safe P12 Artifact extension without changing formal Task states', async () => {
    handle = await startA2aHttpSpike({
      artifactProjectionProvider: {
        projectPublic: () =>
          Promise.resolve({
            publicCapabilitySummary: ['validated-planning-templates'],
            inputRequired: true,
            confirmation: true,
            formalTaskState: 'unchanged',
            safeEvidence: { artifactEnhancement: true },
            redactionPolicyVersion: 'artifact-exposure/1.1',
          }),
      },
    });
    const response = await fetch(`${handle.baseUrl}/.well-known/agent-card.json`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('urn:sdar:artifact-evidence:v1.1');
    expect(text).toContain('validated-planning-templates');
    expect(text).not.toMatch(/credential|model_route|candidate/iu);

    const result = await handle.client.sendMessage(createProbeRequest());
    expect(result).toHaveProperty('status.state', TaskState.TASK_STATE_COMPLETED);
  });

  it('publishes a safe server-resolved natural-language admission contract', async () => {
    handle = await startA2aHttpSpike({
      naturalLanguageAdmissionContractProvider: {
        findCurrent: () =>
          Promise.resolve({
            exposureId: 'a2a.embodied.move',
            exposureVersion: 2,
            capabilityId: 'embodied.move',
            capabilityVersion: 2,
            requestSchema: {
              type: 'object',
              required: ['resourceId', 'target'],
              additionalProperties: false,
            },
            requesterPolicy: { allowAnonymous: true, allowedRequesterIds: [] },
          }),
      },
    });

    const response = await fetch(`${handle.baseUrl}/.well-known/agent-card.json`);
    const card = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(card);

    expect(response.status).toBe(200);
    expect(card).toMatchObject({
      capabilities: {
        extensions: expect.arrayContaining([
          expect.objectContaining({
            uri: 'io.sdar/naturalLanguageCapabilityAdmission',
            required: false,
            params: {
              version: '1.0',
              inputMode: 'text/plain',
              externalCapabilityMetadataRequired: false,
              clientRequestIdentity: 'a2a.messageId',
              exposureId: 'a2a.embodied.move',
              exposureVersion: 2,
              capabilityId: 'embodied.move',
              capabilityVersion: 2,
              requestSchema: {
                type: 'object',
                required: ['resourceId', 'target'],
                additionalProperties: false,
              },
              requesterPolicy: { allowAnonymous: true, allowedRequesterIds: [] },
            },
          }),
        ]),
      },
    });
    expect(serialized).not.toMatch(/credential|token|bindingId|providerId/iu);
  });

  it('uses a Runtime-active Capability Agent Card instead of directly exposing internal Skills', async () => {
    handle = await startA2aHttpSpike({
      agentCardProvider: {
        findActive: () =>
          Promise.resolve(
            buildAgentCard([
              {
                id: 'capability.device.inspect',
                name: 'Inspect a device',
                description: 'Capability-governed inspection.',
                tags: ['capability:device.inspect'],
              },
            ]),
          ),
      },
    });
    const response = await fetch(`${handle.baseUrl}/.well-known/agent-card.json`);
    const card = (await response.json()) as { skills?: readonly { id?: string }[] };

    expect(response.status).toBe(200);
    expect(card.skills).toEqual([expect.objectContaining({ id: 'capability.device.inspect' })]);
    expect(card.skills?.map((skill) => skill.id)).not.toContain('skill.echo');
  });

  it('preserves the A2A 1.0.1 media type when the client requests it', async () => {
    handle = await startA2aHttpSpike();
    const response = await fetch(`${handle.baseUrl}/a2a/v1/message:send`, {
      method: 'POST',
      headers: {
        'A2A-Version': '1.0',
        'content-type': 'application/a2a+json',
      },
      body: JSON.stringify(SendMessageRequest.toJSON(createProbeRequest())),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/a2a\+json\b/u);
    await expect(response.json()).resolves.toHaveProperty('task.id');
  });

  it('retains application/json compatibility for the pinned HTTP+JSON TCK', async () => {
    handle = await startA2aHttpSpike();
    const response = await fetch(`${handle.baseUrl}/a2a/v1/message:send`, {
      method: 'POST',
      headers: {
        'A2A-Version': '1.0',
        'content-type': 'application/json',
      },
      body: JSON.stringify(SendMessageRequest.toJSON(createProbeRequest())),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json\b/u);
  });

  it('returns the original Task and normalized history when the SDK retries one durable admission with new generated ids', async () => {
    const authoritativeTasks = new Map<string, AgentTask>();
    const admissionTasks = new Map<string, AgentTask>();
    const generatedTaskIds: string[] = [];
    const generatedContextIds: string[] = [];
    let acceptedCount = 0;
    let replayedCount = 0;
    const tasks = {
      submit(command: SubmitTaskCommand) {
        const idempotencyKey = command.initialAdmission?.idempotencyKey;
        if (idempotencyKey === undefined) return Promise.reject(new Error('ADMISSION_KEY_MISSING'));
        generatedTaskIds.push(command.taskId ?? 'missing');
        generatedContextIds.push(command.contextId ?? 'missing');
        const existing = admissionTasks.get(idempotencyKey);
        if (existing !== undefined) {
          if (
            existing.requestText !== command.messageText ||
            JSON.stringify(command.capabilityInput) !== JSON.stringify({ deviceId: 'alpha' })
          )
            return Promise.reject(
              Object.assign(new Error('Initial admission idempotency conflict.'), {
                code: 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT' as const,
              }),
            );
          replayedCount += 1;
          return Promise.resolve({
            task: existing,
            context: createConversationContext({
              contextId: existing.contextId,
              userId: existing.userId,
              timestamp: existing.createdAt,
            }),
            createdContext: true,
            admissionStatus: 'replayed' as const,
            queueDispatchStatus: 'not_dispatched' as const,
          });
        }
        const context = createConversationContext({
          contextId: command.contextId ?? 'context-missing',
          ...(command.userId === undefined ? {} : { userId: command.userId }),
          timestamp: '2026-08-22T00:00:00.000Z',
        });
        let task = createAgentTask({
          taskId: command.taskId ?? 'task-missing',
          contextId: context.contextId,
          userId: context.userId,
          requestText: command.messageText,
          requestMetadata: command.metadata,
          timestamp: context.createdAt,
        });
        for (const phase of [
          'context_loading',
          'goal_deliberation',
          'skill_resolution',
          'planning',
          'awaiting_plan_confirmation',
        ] as const)
          task = transitionTask(task, phase, phase, context.createdAt);
        authoritativeTasks.set(task.taskId, task);
        admissionTasks.set(idempotencyKey, task);
        acceptedCount += 1;
        return Promise.resolve({
          task,
          context,
          createdContext: true,
          admissionStatus: 'accepted' as const,
          queueDispatchStatus: 'deferred_recovery' as const,
        });
      },
      get(taskId: string) {
        const task = authoritativeTasks.get(taskId);
        return task === undefined
          ? Promise.reject(new Error('TASK_NOT_FOUND'))
          : Promise.resolve(task);
      },
      followUp: () => Promise.reject(new Error('UNUSED')),
      cancel: () => Promise.reject(new Error('UNUSED')),
    };
    const projections = new CapturingProjectionRepository();
    const taskStore = new A2AProjectionTaskStore(projections, {
      findById: (taskId) => Promise.resolve(authoritativeTasks.get(taskId)),
    });
    const eventBusManager = new ReplaySafeExecutionEventBusManager();
    const executor = new TaskServiceAgentExecutor({
      tasks,
      notifier: new InMemoryTaskStateNotifier(),
    });
    handle = await startA2AHttpEndpoint({
      executor,
      taskStore,
      eventBusManager,
      skills: [
        {
          id: 'device.inspect',
          name: 'Inspect device',
          description: 'Idempotent admission contract probe.',
          tags: ['test'],
        },
      ],
    });
    const request = (
      messageId: string,
      deviceId = 'alpha',
      messageText = 'Inspect device alpha.',
    ) =>
      SendMessageRequest.fromJSON({
        message: {
          messageId,
          role: 'ROLE_USER',
          parts: [
            { text: messageText, mediaType: 'text/plain' },
            { data: { deviceId }, mediaType: 'application/json' },
          ],
          metadata: {
            user_id: 'operator-1',
            structured_input: { deviceId },
            idempotency_key: 'a2a-endpoint-replay-1',
            'io.sdar/requestedCapability': {
              exposureId: 'device.inspect',
              versionConstraint: '1',
              requestId: 'a2a-endpoint-replay-1',
            },
          },
        },
        configuration: { returnImmediately: false },
      });

    const results = await Promise.all([
      handle.client.sendMessage(request('message-admission-first')),
      handle.client.sendMessage(request('message-admission-retry-a')),
      handle.client.sendMessage(request('message-admission-retry-b')),
      handle.client.sendMessage(request('message-admission-retry-a')),
    ]);
    if (results.some((result) => !('id' in result))) throw new Error('A2A_TASK_EXPECTED');
    const taskResults = results.filter((result): result is Task => 'id' in result);
    const authority = taskResults[0];
    if (authority === undefined) throw new Error('A2A_TASK_EXPECTED');

    expect(generatedTaskIds).toHaveLength(4);
    expect(generatedContextIds).toHaveLength(4);
    expect(new Set(generatedTaskIds).size).toBe(4);
    expect(new Set(generatedContextIds).size).toBe(4);
    expect(taskResults.every((task) => task.id === authority.id)).toBe(true);
    expect(taskResults.every((task) => task.contextId === authority.contextId)).toBe(true);
    expect(
      taskResults.every((task) => task.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED),
    ).toBe(true);
    expect(authoritativeTasks.size).toBe(1);
    expect(projections.taskIds()).toEqual(new Set([authority.id]));
    expect({ acceptedCount, replayedCount }).toEqual({ acceptedCount: 1, replayedCount: 3 });

    const persisted = await handle.client.getTask({ tenant: '', id: authority.id });
    expect(persisted.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
    const messageCounts = persisted.history.reduce<Record<string, number>>((counts, message) => {
      counts[message.messageId] = (counts[message.messageId] ?? 0) + 1;
      return counts;
    }, {});
    expect(messageCounts).toEqual({
      'message-admission-first': 1,
      'message-admission-retry-a': 1,
      'message-admission-retry-b': 1,
    });
    expect(
      persisted.history.every(
        (message) => message.taskId === authority.id && message.contextId === authority.contextId,
      ),
    ).toBe(true);
    await Promise.resolve();
    for (const generatedTaskId of generatedTaskIds)
      expect(eventBusManager.getByTaskId(generatedTaskId) !== undefined).toBe(
        generatedTaskId === authority.id,
      );

    const conflictClient = handle.client;
    const conflicts = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        conflictClient.sendMessage(
          request(`message-admission-conflict-${String(index)}`, 'beta', 'Inspect device beta.'),
        ),
      ),
    );
    for (const conflict of conflicts) {
      if ('id' in conflict) throw new Error('A2A_CONFLICT_MESSAGE_EXPECTED');
      expect(conflict.metadata).toMatchObject({
        'io.sdar/error': {
          code: 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT',
          retryable: false,
        },
      });
    }
    expect(new Set(generatedTaskIds).size).toBe(104);
    expect(new Set(generatedContextIds).size).toBe(104);
    expect(authoritativeTasks.size).toBe(1);
    expect(projections.taskIds()).toEqual(new Set([authority.id]));
    expect({ acceptedCount, replayedCount }).toEqual({ acceptedCount: 1, replayedCount: 3 });
    await Promise.resolve();
    for (const generatedTaskId of generatedTaskIds)
      expect(eventBusManager.getByTaskId(generatedTaskId) !== undefined).toBe(
        generatedTaskId === authority.id,
      );
    executor.close();
  });

  it('authenticates a bearer exactly once before dispatching a Task follow-up', async () => {
    const token = 'ugv-confirmation-token-1234567890abcdef';
    const identity = new ConfiguredBearerGovernedControlIdentity({
      token,
      actorId: 'ugv-operator-1',
      permissions: ['physical_control.confirm'],
    });
    let identityResolutions = 0;
    let followUpExecutions = 0;
    const executor: AgentExecutor = {
      execute(request: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        if (request.task !== undefined) followUpExecutions += 1;
        eventBus.publish(
          AgentEvent.task(
            Task.fromJSON({
              id: request.taskId,
              contextId: request.contextId,
              status: {
                state: 'TASK_STATE_INPUT_REQUIRED',
                timestamp: '2026-08-21T00:00:00.000Z',
              },
              history: [],
              artifacts: [],
            }),
          ),
        );
        eventBus.finished();
        return Promise.resolve();
      },
      cancelTask: () => Promise.reject(new Error('UNUSED')),
    };
    handle = await startA2AHttpEndpoint({
      executor,
      taskStore: new InMemoryTaskStore(),
      skills: [
        {
          id: 'embodied.move_to',
          name: 'Move UGV',
          description: 'Authentication contract probe.',
          tags: ['ugv'],
        },
      ],
      confirmationPrincipalResolver: {
        resolve(input) {
          identityResolutions += 1;
          return identity.resolve(input);
        },
      },
    });

    const initial = await postA2AMessage(
      handle.baseUrl,
      SendMessageRequest.fromJSON({
        message: {
          messageId: 'message-auth-initial',
          role: 'ROLE_USER',
          parts: [{ text: 'Prepare a UGV plan.', mediaType: 'text/plain' }],
        },
      }),
      `Bearer ${token}`,
    );
    expect(initial.status).toBe(200);
    const initialBody = (await initial.json()) as {
      task?: Readonly<{ id?: string; contextId?: string }>;
    };
    const taskId = initialBody.task?.id;
    const contextId = initialBody.task?.contextId;
    if (taskId === undefined || contextId === undefined) throw new Error('A2A_AUTH_TASK_MISSING');
    const followUp = SendMessageRequest.fromJSON({
      message: {
        messageId: 'message-auth-confirm',
        taskId,
        contextId,
        role: 'ROLE_USER',
        parts: [{ text: 'Confirm the plan.', mediaType: 'text/plain' }],
        metadata: { sdar_action: 'confirm_plan' },
      },
    });

    const missing = await postA2AMessage(handle.baseUrl, followUp);
    expect(missing.status).toBe(401);
    const missingBody = await missing.text();
    expect(missingBody).toContain('GOVERNED_CONTROL_AUTHENTICATION_REQUIRED');
    expect(missingBody).not.toContain(token);
    expect(followUpExecutions).toBe(0);

    const wrong = await postA2AMessage(handle.baseUrl, followUp, 'Bearer wrong-token');
    expect(wrong.status).toBe(401);
    const wrongBody = await wrong.text();
    expect(wrongBody).not.toContain(token);
    expect(wrongBody).not.toContain('ugv-operator-1');
    expect(followUpExecutions).toBe(0);

    const correct = await postA2AMessage(handle.baseUrl, followUp, `Bearer ${token}`);
    expect(correct.status).toBe(200);
    expect(followUpExecutions).toBe(1);
    expect(identityResolutions).toBe(4);
  });

  it('accepts an anonymous initial A2A request in explicit trusted-intranet mode', async () => {
    const identity = new ConfiguredTrustedIntranetGovernedControlIdentity({
      actorId: 'ugv-local-operator',
      permissions: ['physical_control.confirm'],
    });
    let executions = 0;
    const executor: AgentExecutor = {
      execute(request: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        executions += 1;
        eventBus.publish(
          AgentEvent.task(
            Task.fromJSON({
              id: request.taskId,
              contextId: request.contextId,
              status: {
                state: 'TASK_STATE_INPUT_REQUIRED',
                timestamp: '2026-08-21T00:00:00.000Z',
              },
              history: [],
              artifacts: [],
            }),
          ),
        );
        eventBus.finished();
        return Promise.resolve();
      },
      cancelTask: () => Promise.reject(new Error('UNUSED')),
    };
    handle = await startA2AHttpEndpoint({
      executor,
      taskStore: new InMemoryTaskStore(),
      skills: [
        {
          id: 'embodied.move_to',
          name: 'Move UGV',
          description: 'Trusted intranet contract probe.',
          tags: ['ugv'],
        },
      ],
      confirmationPrincipalResolver: identity,
    });

    const initial = await postA2AMessage(
      handle.baseUrl,
      SendMessageRequest.fromJSON({
        message: {
          messageId: 'message-trusted-intranet-initial',
          role: 'ROLE_USER',
          parts: [{ text: 'Prepare a UGV plan.', mediaType: 'text/plain' }],
        },
      }),
    );

    expect(initial.status).toBe(200);
    expect(executions).toBe(1);
  });

  it('streams the standard task lifecycle without custom states', async () => {
    handle = await startA2aHttpSpike();
    const cases: string[] = [];
    const states: TaskState[] = [];

    for await (const event of handle.client.sendMessageStream(createProbeRequest())) {
      const payloadCase = streamPayloadCase(event);
      if (payloadCase !== undefined) cases.push(payloadCase);
      if (event.payload?.$case === 'statusUpdate' && event.payload.value.status !== undefined) {
        states.push(event.payload.value.status.state);
      }
    }

    expect(cases).toEqual(['task', 'statusUpdate', 'statusUpdate']);
    expect(states).toEqual([TaskState.TASK_STATE_WORKING, TaskState.TASK_STATE_COMPLETED]);
  });

  it('continues task execution after the streaming client disconnects', async () => {
    handle = await startA2aHttpSpike({ completionDelayMs: 80 });
    const stream = handle.client.sendMessageStream(createProbeRequest());
    const initial = await stream.next();
    expect(initial.done).toBe(false);
    expect(initial.value === undefined ? undefined : streamPayloadCase(initial.value)).toBe('task');
    if (initial.value?.payload?.$case !== 'task') throw new Error('A2A_EXPECTED_INITIAL_TASK');
    const taskId = initial.value.payload.value.id;

    await stream.return(undefined);
    const deadline = Date.now() + 2_000;
    let state: TaskState | undefined;
    do {
      const task = await handle.client.getTask({ tenant: '', id: taskId });
      state = task.status?.state;
      if (state === TaskState.TASK_STATE_COMPLETED) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    } while (Date.now() < deadline);

    expect(state).toBe(TaskState.TASK_STATE_COMPLETED);
  });
});

class CapturingProjectionRepository implements ExternalTaskProjectionRepository {
  readonly #projections = new Map<string, ExternalTaskProjection>();

  find(protocol: ExternalTaskProjection['protocol'], taskId: string) {
    return Promise.resolve(this.#projections.get(`${protocol}:${taskId}`));
  }

  save(projection: ExternalTaskProjection): Promise<void> {
    this.#projections.set(`${projection.protocol}:${projection.taskId}`, projection);
    return Promise.resolve();
  }

  list(
    _query: ExternalTaskProjectionQuery,
  ): Promise<Readonly<{ items: readonly ExternalTaskProjection[]; total: number }>> {
    void _query;
    const items = [...this.#projections.values()];
    return Promise.resolve({ items, total: items.length });
  }

  taskIds(): ReadonlySet<string> {
    return new Set([...this.#projections.values()].map((projection) => projection.taskId));
  }
}

function postA2AMessage(
  baseUrl: string,
  request: SendMessageRequest,
  authorization?: string,
): Promise<Response> {
  return fetch(`${baseUrl}/a2a/v1/message:send`, {
    method: 'POST',
    headers: {
      'A2A-Version': '1.0',
      'content-type': 'application/json',
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify(SendMessageRequest.toJSON(request)),
  });
}
