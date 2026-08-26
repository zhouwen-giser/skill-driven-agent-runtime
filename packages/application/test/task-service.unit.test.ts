import { describe, expect, it, vi } from 'vitest';

import { AjvJsonSchemaValidator } from '../../json-schema-adapter/src/index.js';

import {
  transitionTask,
  createTaskInputRequest,
  type AgentTask,
  type ConversationContext,
  type SkillDraft,
  type SkillInputResolutionRecord,
  type TaskExecutionAttempt,
  type TaskInputRequest,
  type TaskInputResponse,
} from '../../domain/src/index.js';
import {
  ANONYMOUS_USER_ID,
  MAX_TASK_INPUT_RESPONSE_CHARACTERS,
  TaskService,
  RuntimeTaskCapabilityService,
  type AgentTaskRepository,
  type ContextTaskQueue,
  type ConversationContextRepository,
  type IdentifierGenerator,
  type InitialTaskAdmissionRecord,
  type InitialTaskAdmissionStore,
  type RuntimeEventPublisher,
  type RuntimeTaskEvent,
  type GovernedControlPermission,
  type GovernedControlPrincipal,
  type SkillDraftRepository,
  type TaskServiceDependencies,
  type TaskInputRepository,
} from '../src/index.js';

const timestamp = '2026-07-11T10:00:00.000Z';

describe('TaskService', () => {
  it('requires Goal-evaluation input requests to identify both control and round', () => {
    expect(() =>
      createTaskInputRequest({
        inputRequestId: 'input-request-1',
        taskId: 'task-1',
        contextId: 'context-1',
        source: 'goal_evaluation',
        question: 'Which device?',
        controlId: 'control-1',
        createdAt: timestamp,
      }),
    ).toThrow(expect.objectContaining({ code: 'TASK_INPUT_CONTROL_ROUND_INVALID' }));
  });
  it('uses the plan-bound formal Skill input even when a newer resolution exists', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({
      messageText: 'Inspect device-from-text.',
      metadata: { structured_input: { deviceId: 'device-22' } },
    });
    harness.tasks.set(submitted.task.taskId, {
      ...submitted.task,
      goalId: 'goal-1',
      goalVersion: 2,
      selectedSkillId: 'skill.inspect',
      selectedSkillVersion: 3,
      skillSelectionId: 'selection-1',
      skillInputResolutionId: 'resolution-1',
    });
    harness.skillInputResolutions.set(submitted.task.taskId, {
      resolutionId: 'resolution-1',
      taskId: submitted.task.taskId,
      goalId: 'goal-1',
      goalVersion: 2,
      skillId: 'skill.inspect',
      skillVersion: 3,
      structuredInput: { deviceId: 'device-22' },
      unresolvedFields: [],
      sourceRefs: ['a2a-metadata:structured_input'],
      decisionSummary: 'Resolved.',
      status: 'resolved',
      createdAt: timestamp,
    });
    harness.skillInputResolutions.set('newer-resolution', {
      resolutionId: 'resolution-2',
      taskId: submitted.task.taskId,
      goalId: 'goal-1',
      goalVersion: 2,
      skillId: 'skill.inspect',
      skillVersion: 3,
      structuredInput: { deviceId: 'device-newer-but-not-planned' },
      unresolvedFields: [],
      sourceRefs: ['task-input-response:newer'],
      decisionSummary: 'Created after the plan.',
      status: 'resolved',
      createdAt: '2026-07-11T10:00:01.000Z',
    });

    await expect(harness.service.executionInput(submitted.task.taskId)).resolves.toEqual({
      deviceId: 'device-22',
    });
  });
  it('creates default anonymous/context values, persists first, then enqueues by context', async () => {
    const harness = createHarness();
    const result = await harness.service.submit({
      messageText: 'Inspect device status.',
      metadata: {},
    });

    expect(result.createdContext).toBe(true);
    expect(result.context).toMatchObject({ contextId: 'context-1', userId: ANONYMOUS_USER_ID });
    expect(result.task).toMatchObject({
      taskId: 'task-1',
      contextId: 'context-1',
      userId: ANONYMOUS_USER_ID,
      phase: 'queued',
    });
    expect(harness.operations).toEqual([
      'context.save:context-1',
      'task.save:task-1:queued',
      'event:task.created:task-1',
      'queue:context-1:task-1',
    ]);
  });

  it('prepares an exact deterministic Task without enqueueing natural-language processing', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submitDeterministic({
      taskId: 'task-deterministic',
      contextId: 'context-deterministic',
      messageText: 'deterministic:binding:resource',
      metadata: {},
    });
    expect(harness.operations.some((operation) => operation.startsWith('queue:'))).toBe(false);
    expect(harness.attempts.values().next().value).toMatchObject({ status: 'completed' });

    const planning = await harness.service.prepareDeterministicExecution(submitted.task.taskId, {
      goalId: 'goal-deterministic',
      goalVersion: 1,
      skillId: 'skill.read-state',
      skillVersion: 1,
      selectionId: 'selection-deterministic',
    });
    expect(planning).toMatchObject({
      phase: 'planning',
      goalId: 'goal-deterministic',
      goalVersion: 1,
      selectedSkillId: 'skill.read-state',
      selectedSkillVersion: 1,
      skillSelectionId: 'selection-deterministic',
    });
    const attached = await harness.service.attachPlan(planning.taskId, {
      planId: 'plan-deterministic',
      goalId: 'goal-deterministic',
      goalVersion: 1,
      skillInputResolutionId: 'resolution-deterministic',
    });
    expect(attached.skillInputResolutionId).toBe('resolution-deterministic');
    await expect(
      harness.service.beginDeterministicExecution(planning.taskId),
    ).resolves.toMatchObject({ phase: 'executing', planId: 'plan-deterministic' });
  });

  it('routes an explicit Capability request through the atomic acceptance store without generic Task writes', async () => {
    let acceptedTask: AgentTask | undefined;
    const taskCapabilities = new RuntimeTaskCapabilityService({
      schemas: new AjvJsonSchemaValidator(),
      store: {
        describeExposure: () => Promise.resolve(undefined),
        resolveExposure: () =>
          Promise.resolve({
            exposureId: 'device.inspect',
            exposureVersion: 1,
            requestedCapabilityId: 'device.inspect.capability',
            capabilityVersion: 1,
            requestSchema: {
              type: 'object',
              required: ['deviceId'],
              properties: { deviceId: { type: 'string' } },
              additionalProperties: false,
            },
            successCriteria: [{ type: 'field_equals', field: 'inspected', value: true }],
            requiredEvidence: [{ type: 'provider_result', field: 'evidence' }],
            constraints: [],
            implementationRefs: ['skill:device.inspect:1'],
            providerBindingRefs: [],
          }),
        accept: (input) => {
          acceptedTask = input.task;
          return Promise.resolve();
        },
        findBinding: () => Promise.resolve(undefined),
        listAttempts: () => Promise.resolve([]),
        appendAttempt: () => Promise.reject(new Error('UNUSED')),
        updateLatestAttempt: () => Promise.resolve(),
        reconcileCanceledAttempts: () => Promise.resolve(0),
        reconcileFailedAttempts: () => Promise.resolve(0),
      },
    });
    const harness = createHarness('resumed', false, undefined, taskCapabilities);

    const result = await harness.service.submit({
      messageText: 'Inspect device alpha.',
      capabilityInput: { deviceId: 'alpha' },
      metadata: {
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-capability-1',
        },
      },
    });

    expect(acceptedTask).toEqual(result.task);
    expect(harness.tasks.size).toBe(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.operations).toEqual(['context.save:context-1', 'queue:context-1:task-1']);
  });

  it('turns a metadata-free natural-language request into one durable formal admission', async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({
        idempotencyKey: 'nlcap-request-1',
        requestedCapability: {
          exposureId: 'device.inspect',
          exposureVersion: 1,
          requestId: 'nlcap-request-1',
        },
        capabilityInput: { deviceId: 'alpha' },
      }),
    );
    const harness = createHarness('resumed', false, undefined, capabilityService(), {
      initialAdmissionEnabled: true,
      naturalLanguageCapabilityAdmissions: { resolve },
    });
    const command = {
      clientRequestId: 'sacs-message-1',
      messageText: 'Inspect device alpha.',
      metadata: {},
    } as const;

    const first = await harness.service.submit(command);
    const replay = await harness.service.submit(command);

    expect(resolve).toHaveBeenCalledWith({
      messageText: command.messageText,
      userId: ANONYMOUS_USER_ID,
      clientRequestId: command.clientRequestId,
      receivedAt: timestamp,
    });
    expect(first.admissionStatus).toBe('accepted');
    expect(replay).toMatchObject({
      admissionStatus: 'replayed',
      queueDispatchStatus: 'not_dispatched',
      task: { taskId: first.task.taskId },
    });
    expect(harness.admissions.size).toBe(1);
    expect(harness.operations.filter((value) => value.startsWith('admission:'))).toEqual([
      'admission:nlcap-request-1',
    ]);
  });

  it('preserves the durable conflict boundary when natural-language text changes for one client request', async () => {
    const resolve = vi.fn(() =>
      Promise.resolve({
        idempotencyKey: 'nlcap-request-conflict',
        requestedCapability: {
          exposureId: 'device.inspect',
          exposureVersion: 1,
          requestId: 'nlcap-request-conflict',
        },
        capabilityInput: { deviceId: 'alpha' },
      }),
    );
    const harness = createHarness('resumed', false, undefined, capabilityService(), {
      initialAdmissionEnabled: true,
      naturalLanguageCapabilityAdmissions: { resolve },
    });

    await harness.service.submit({
      clientRequestId: 'sacs-message-conflict',
      messageText: 'Inspect device alpha.',
      metadata: {},
    });

    await expect(
      harness.service.submit({
        clientRequestId: 'sacs-message-conflict',
        messageText: 'Inspect device beta.',
        metadata: {},
      }),
    ).rejects.toMatchObject({ code: 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT' });
    expect(harness.admissions.size).toBe(1);
    expect(harness.operations.filter((operation) => operation.startsWith('queue:'))).toHaveLength(
      1,
    );
  });

  it('never invokes natural-language resolution for a partially formal request', async () => {
    const resolve = vi.fn(() =>
      Promise.reject(new Error('UNEXPECTED_NATURAL_LANGUAGE_RESOLUTION')),
    );
    const harness = createHarness('resumed', false, undefined, capabilityService(), {
      initialAdmissionEnabled: true,
      naturalLanguageCapabilityAdmissions: { resolve },
    });

    await expect(
      harness.service.submit({
        clientRequestId: 'sacs-message-explicit',
        messageText: 'Inspect device alpha.',
        metadata: { idempotency_key: 'partial-formal-request' },
      }),
    ).resolves.toMatchObject({ task: { requestText: 'Inspect device alpha.' } });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('replays one durable initial admission across new SDK Task and Context ids without enqueueing twice', async () => {
    const taskCapabilities = capabilityService();
    const authoritativeContext: ConversationContext = {
      contextId: 'sdk-context-first',
      userId: 'operator-1',
      createdAt: '2026-07-11T09:59:00.000Z',
      updatedAt: '2026-07-11T09:59:00.000Z',
    };
    const harness = createHarness('resumed', false, undefined, taskCapabilities, {
      initialAdmissionEnabled: true,
      initialAdmissionContextOverride: authoritativeContext,
    });
    const command = {
      messageText: 'Inspect device alpha.',
      userId: 'operator-1',
      capabilityInput: { deviceId: 'alpha' },
      metadata: {
        structured_input: { deviceId: 'alpha' },
        idempotency_key: 'request-capability-replay',
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-capability-replay',
        },
      },
      initialAdmission: { idempotencyKey: 'request-capability-replay' },
    } as const;

    const accepted = await harness.service.submit({
      ...command,
      taskId: 'sdk-task-first',
      contextId: 'sdk-context-first',
    });
    const replayed = await harness.service.submit({
      ...command,
      taskId: 'sdk-task-retry',
      contextId: 'sdk-context-retry',
    });

    expect(accepted.admissionStatus).toBe('accepted');
    expect(accepted.queueDispatchStatus).toBe('enqueued');
    expect(accepted.context).toEqual(authoritativeContext);
    expect(replayed).toMatchObject({
      admissionStatus: 'replayed',
      queueDispatchStatus: 'not_dispatched',
      task: { taskId: 'sdk-task-first', contextId: 'sdk-context-first' },
      context: { contextId: 'sdk-context-first' },
    });
    expect(harness.admissions.size).toBe(1);
    expect(harness.tasks.size).toBe(1);
    expect(
      harness.operations.filter((operation) => operation.startsWith('admission:')),
    ).toHaveLength(1);
    expect(harness.operations.filter((operation) => operation.startsWith('queue:'))).toHaveLength(
      1,
    );

    harness.contexts.set(authoritativeContext.contextId, {
      ...authoritativeContext,
      userId: 'operator-corrupt',
    });
    await expect(
      harness.service.submit({
        ...command,
        taskId: 'sdk-task-corrupt-retry',
        contextId: 'sdk-context-corrupt-retry',
      }),
    ).rejects.toMatchObject({ code: 'TASK_INITIAL_ADMISSION_AUTHORITY_CORRUPT' });
  });

  it('defers a durable formal admission when immediate queue dispatch fails', async () => {
    const harness = createHarness('resumed', false, undefined, capabilityService(), {
      initialAdmissionEnabled: true,
      initialQueueFailure: true,
    });
    const command = {
      messageText: 'Inspect device alpha.',
      userId: 'operator-1',
      capabilityInput: { deviceId: 'alpha' },
      metadata: {
        structured_input: { deviceId: 'alpha' },
        idempotency_key: 'request-capability-deferred',
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-capability-deferred',
        },
      },
      initialAdmission: { idempotencyKey: 'request-capability-deferred' },
    } as const;

    const accepted = await harness.service.submit({
      ...command,
      taskId: 'sdk-task-deferred-first',
      contextId: 'sdk-context-deferred-first',
    });
    const replayed = await harness.service.submit({
      ...command,
      taskId: 'sdk-task-deferred-retry',
      contextId: 'sdk-context-deferred-retry',
    });

    expect(accepted).toMatchObject({
      admissionStatus: 'accepted',
      queueDispatchStatus: 'deferred_recovery',
      task: { taskId: 'sdk-task-deferred-first', phase: 'queued' },
    });
    expect(replayed).toMatchObject({
      admissionStatus: 'replayed',
      queueDispatchStatus: 'not_dispatched',
      task: { taskId: 'sdk-task-deferred-first', phase: 'queued' },
    });
    expect(harness.admissions.size).toBe(1);
    expect(harness.operations.filter((operation) => operation.startsWith('queue:'))).toHaveLength(
      1,
    );
  });

  it('keeps formal admission free of post-commit feedback and Skill-draft side effects', async () => {
    const observeSubmission = vi.fn(() => Promise.reject(new Error('FEEDBACK_WRITE_FAILED')));
    const harness = createHarness('resumed', false, undefined, capabilityService(), {
      initialAdmissionEnabled: true,
      feedback: {
        observeSubmission,
        observeRevision: () => Promise.reject(new Error('UNUSED')),
        observeSkillSwitch: () => Promise.reject(new Error('UNUSED')),
      },
    });
    const command = {
      messageText: 'Inspect device alpha.',
      capabilityInput: { deviceId: 'alpha' },
      metadata: {
        structured_input: { deviceId: 'alpha' },
        idempotency_key: 'request-capability-no-feedback',
        'io.sdar/requestedCapability': {
          exposureId: 'device.inspect',
          versionConstraint: '1',
          requestId: 'request-capability-no-feedback',
        },
      },
      initialAdmission: { idempotencyKey: 'request-capability-no-feedback' },
    } as const;

    await expect(harness.service.submit(command)).resolves.toMatchObject({
      admissionStatus: 'accepted',
      queueDispatchStatus: 'enqueued',
    });
    expect(observeSubmission).not.toHaveBeenCalled();
    const operationCount = harness.operations.length;

    await expect(
      harness.service.submit({
        ...command,
        metadata: {
          ...command.metadata,
          idempotency_key: 'request-capability-skill-draft',
          'io.sdar/requestedCapability': {
            ...command.metadata['io.sdar/requestedCapability'],
            requestId: 'request-capability-skill-draft',
          },
        },
        initialAdmission: { idempotencyKey: 'request-capability-skill-draft' },
        skillDraftIntent: 'create',
      }),
    ).rejects.toMatchObject({ code: 'TASK_INITIAL_ADMISSION_SKILL_DRAFT_UNSUPPORTED' });
    expect(harness.operations).toHaveLength(operationCount);
    expect(harness.drafts.size).toBe(0);
  });

  it('rejects the same initial admission key when canonical request content changes', async () => {
    const harness = createHarness('resumed', false, undefined, capabilityService(), {
      initialAdmissionEnabled: true,
    });
    const metadata = {
      structured_input: { deviceId: 'alpha' },
      idempotency_key: 'request-capability-conflict',
      'io.sdar/requestedCapability': {
        exposureId: 'device.inspect',
        versionConstraint: '1',
        requestId: 'request-capability-conflict',
      },
    } as const;
    await harness.service.submit({
      messageText: 'Inspect device alpha.',
      capabilityInput: { deviceId: 'alpha' },
      metadata,
      initialAdmission: { idempotencyKey: 'request-capability-conflict' },
    });

    await expect(
      harness.service.submit({
        messageText: 'Inspect device beta.',
        capabilityInput: { deviceId: 'alpha' },
        metadata,
        initialAdmission: { idempotencyKey: 'request-capability-conflict' },
      }),
    ).rejects.toMatchObject({ code: 'TASK_INITIAL_ADMISSION_IDEMPOTENCY_CONFLICT' });
    expect(harness.admissions.size).toBe(1);
    expect(harness.operations.filter((operation) => operation.startsWith('queue:'))).toHaveLength(
      1,
    );
  });

  it('fails closed instead of downgrading an explicit Capability request when admission is unavailable', async () => {
    const harness = createHarness();
    await expect(
      harness.service.submit({
        messageText: 'Inspect device alpha.',
        capabilityInput: { deviceId: 'alpha' },
        metadata: {
          'io.sdar/requestedCapability': {
            exposureId: 'device.inspect',
            versionConstraint: '1',
            requestId: 'request-capability-unavailable',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CAPABILITY_RUNTIME_NOT_COMPOSED' });
    expect(harness.contexts.size).toBe(0);
    expect(harness.tasks.size).toBe(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.operations).toEqual([]);
  });

  it('reuses the authoritative context user instead of changing ownership from new metadata', async () => {
    const harness = createHarness();
    harness.contexts.set('context-existing', {
      contextId: 'context-existing',
      userId: 'user-original',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const result = await harness.service.submit({
      contextId: 'context-existing',
      userId: 'user-other',
      messageText: 'Continue.',
      metadata: {},
    });

    expect(result.createdContext).toBe(false);
    expect(result.task.userId).toBe('user-original');
    expect(harness.operations).not.toContain('context.save:context-existing');
  });

  it('persists supplementary input and queues a distinct continuation attempt', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect it.', metadata: {} });
    let task = submitted.task;
    for (const phase of ['context_loading', 'goal_deliberation'] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);
    await harness.service.requestInput(task.taskId, 'Which device?', {
      source: 'goal_deliberation',
    });
    const request = [...harness.inputRequests.values()][0];
    if (request === undefined) throw new Error('INPUT_REQUEST_MISSING');

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'provide_input',
        inputRequestId: request.inputRequestId,
        messageText: 'device-17',
      }),
    ).resolves.toMatchObject({
      taskId: task.taskId,
      phase: 'goal_deliberation',
      phaseMessage: 'Supplementary input saved; continuation queued.',
    });
    expect(harness.inputRequests.get(request.inputRequestId)).toMatchObject({
      status: 'answered',
      answeredAt: timestamp,
    });
    expect([...harness.inputResponses.values()]).toEqual([
      expect.objectContaining({
        inputRequestId: request.inputRequestId,
        taskId: task.taskId,
        content: 'device-17',
      }),
    ]);
    expect([...harness.attempts.values()].map((attempt) => attempt.reason)).toEqual([
      'initial',
      'input_response',
    ]);
    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'provide_input',
        inputRequestId: request.inputRequestId,
        messageText: 'device-17 again',
      }),
    ).rejects.toMatchObject({ code: 'TASK_INPUT_NOT_PENDING' });
  });

  it('persists remote Task input as executing continuation without Goal replanning', async () => {
    const prepared = {
      approval: { action: 'accept', content: { approved: true } },
    };
    const harness = createHarness('resumed', false, () => Promise.resolve(prepared));
    const submitted = await harness.service.submit({ messageText: 'Run remote.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
      'awaiting_user_input',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);
    const request = createTaskInputRequest({
      inputRequestId: 'remote-input-1',
      taskId: task.taskId,
      contextId: task.contextId,
      source: 'remote_task',
      question: 'Approve?',
      createdAt: timestamp,
    });
    harness.inputRequests.set(request.inputRequestId, request);

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'provide_input',
        inputRequestId: request.inputRequestId,
        messageText: '',
        inputContent: prepared,
      }),
    ).resolves.toMatchObject({
      phase: 'executing',
      phaseMessage: 'Supplementary input saved; continuation queued.',
    });
    expect([...harness.inputResponses.values()]).toEqual([
      expect.objectContaining({ content: prepared }),
    ]);
    expect(harness.operations).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/plan\./u)]),
    );
  });

  it('keeps an accepted continuation attempt queued when immediate Redis dispatch fails', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect it.', metadata: {} });
    let task = submitted.task;
    for (const phase of ['context_loading', 'goal_deliberation'] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);
    await harness.service.requestInput(task.taskId, 'Which device?', {
      source: 'goal_deliberation',
    });
    const request = [...harness.inputRequests.values()][0];
    if (request === undefined) throw new Error('INPUT_REQUEST_MISSING');
    harness.queue.enqueue = () => Promise.reject(new Error('REDIS_UNAVAILABLE'));

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'provide_input',
        inputRequestId: request.inputRequestId,
        messageText: 'device-17',
      }),
    ).resolves.toMatchObject({ phase: 'goal_deliberation' });
    expect([...harness.attempts.values()].at(-1)).toMatchObject({
      reason: 'input_response',
      status: 'queued',
    });
  });

  it('rejects oversized supplementary input before answering or creating an attempt', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect it.', metadata: {} });
    let task = submitted.task;
    for (const phase of ['context_loading', 'goal_deliberation'] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);
    await harness.service.requestInput(task.taskId, 'Which device?', {
      source: 'goal_deliberation',
    });
    const request = [...harness.inputRequests.values()][0];
    if (request === undefined) throw new Error('INPUT_REQUEST_MISSING');

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'provide_input',
        inputRequestId: request.inputRequestId,
        messageText: 'x'.repeat(MAX_TASK_INPUT_RESPONSE_CHARACTERS + 1),
      }),
    ).rejects.toMatchObject({ code: 'TASK_INPUT_RESPONSE_TOO_LARGE' });
    expect(harness.inputRequests.get(request.inputRequestId)).toMatchObject({ status: 'waiting' });
    expect([...harness.attempts.values()]).toHaveLength(1);
  });

  it('rejects input for an expired request and for a request owned by another Task', async () => {
    const harness = createHarness();
    const first = await harness.service.submit({ messageText: 'First.', metadata: {} });
    const second = await harness.service.submit({ messageText: 'Second.', metadata: {} });
    for (const submitted of [first, second]) {
      let task = submitted.task;
      for (const phase of ['context_loading', 'goal_deliberation'] as const)
        task = transitionTask(task, phase, phase, timestamp);
      harness.tasks.set(task.taskId, task);
      await harness.service.requestInput(task.taskId, `Question for ${task.taskId}?`, {
        source: 'goal_deliberation',
      });
    }
    const requests = [...harness.inputRequests.values()];
    const firstRequest = requests.find((request) => request.taskId === first.task.taskId);
    const secondRequest = requests.find((request) => request.taskId === second.task.taskId);
    if (firstRequest === undefined || secondRequest === undefined)
      throw new Error('INPUT_REQUEST_MISSING');
    harness.inputRequests.set(firstRequest.inputRequestId, {
      ...firstRequest,
      status: 'expired',
    });
    await expect(
      harness.service.followUp({
        taskId: first.task.taskId,
        action: 'provide_input',
        inputRequestId: firstRequest.inputRequestId,
        messageText: 'late',
      }),
    ).rejects.toMatchObject({ code: 'TASK_INPUT_ALREADY_RESOLVED' });
    await expect(
      harness.service.followUp({
        taskId: first.task.taskId,
        action: 'provide_input',
        inputRequestId: secondRequest.inputRequestId,
        messageText: 'wrong task',
      }),
    ).rejects.toMatchObject({ code: 'TASK_INPUT_TASK_MISMATCH' });
  });

  it('persists a Skill request as a non-published draft before queueing', async () => {
    const harness = createHarness();
    const result = await harness.service.submit({
      messageText: 'Create a read-only device Skill.',
      metadata: {},
      skillDraftIntent: 'create',
    });

    expect(harness.drafts.get(`draft-${result.task.taskId}`)).toMatchObject({
      status: 'draft',
      intent: 'create',
      requestedBy: ANONYMOUS_USER_ID,
    });
    expect(harness.operations.indexOf('draft.save:draft-task-1')).toBeLessThan(
      harness.operations.indexOf('queue:context-1:task-1'),
    );
  });

  it('cancels a queued task and emits a phase event', async () => {
    const markLatestAttempt = vi.fn(() => Promise.resolve());
    const taskCapabilities = {
      prepareAcceptance: () => Promise.resolve(undefined),
      markLatestAttempt,
    } as unknown as RuntimeTaskCapabilityService;
    const harness = createHarness('resumed', false, undefined, taskCapabilities);
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    harness.operations.length = 0;

    const canceled = await harness.service.cancel(submitted.task.taskId);
    expect(canceled.phase).toBe('canceled');
    expect(harness.operations).toEqual([
      'task.save:task-1:canceled',
      'event:task.phase_changed:task-1',
    ]);
    expect(markLatestAttempt).toHaveBeenCalledWith('task-1', 'canceled', timestamp);
    await harness.service.cancel(submitted.task.taskId);
    expect(markLatestAttempt).toHaveBeenCalledTimes(2);
  });

  it('uses an atomic runtime cancellation projection when an active control owns the Task', async () => {
    const markLatestAttempt = vi.fn(() => Promise.resolve());
    const taskCapabilities = {
      prepareAcceptance: () => Promise.resolve(undefined),
      markLatestAttempt,
    } as unknown as RuntimeTaskCapabilityService;
    const harness = createHarness('resumed', true, undefined, taskCapabilities);
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-runtime', goalId: 'goal-runtime', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);
    harness.operations.length = 0;

    await expect(harness.service.cancel(task.taskId)).resolves.toMatchObject({
      phase: 'canceled',
      phaseMessage: 'Atomically canceled by runtime.',
    });
    expect(harness.operations).toEqual(['runtime.cancel:task-1']);
    expect(markLatestAttempt).toHaveBeenCalledWith('task-1', 'canceled', timestamp);
  });

  it('returns a stable application error for an unknown task', async () => {
    const harness = createHarness();
    await expect(harness.service.cancel('missing')).rejects.toEqual(
      expect.objectContaining({ code: 'TASK_NOT_FOUND' }),
    );
  });

  it('persists structured capability-gap evidence and emits an audit event', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Read pressure.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
      'evaluating',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);

    await expect(
      harness.service.reportCapabilityGap(task.taskId, {
        decision: 'capability_gap',
        summary: 'No registered tool can read pressure.',
        missingCapability: 'Read device pressure.',
        suggestedToolContract: {
          name: 'read_pressure',
          description: 'Read pressure for one device.',
          inputSchema: { type: 'object', required: ['deviceId'] },
        },
      }),
    ).resolves.toMatchObject({
      phase: 'capability_gap',
      errorCode: 'CAPABILITY_GAP',
      capabilityGap: {
        missingCapability: 'Read device pressure.',
        suggestedToolContract: { name: 'read_pressure' },
      },
    });
    expect(harness.events.at(-1)?.summary).toContain('No registered tool');

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'resume',
        messageText: 'A Tool is now registered.',
      }),
    ).rejects.toMatchObject({ code: 'TASK_TERMINAL_FOLLOW_UP_FORBIDDEN' });
    await expect(harness.service.cancel(task.taskId)).resolves.toMatchObject({
      phase: 'capability_gap',
      errorCode: 'CAPABILITY_GAP',
    });
    expect(harness.operations).not.toContain('plan.resume:undefined');
  });

  it('applies plan revision, confirmation, pause, and resume through domain transitions', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const) {
      task = transitionTask(task, phase, phase, timestamp);
    }
    harness.tasks.set(task.taskId, task);
    await harness.service.attachPlan(task.taskId, {
      planId: 'plan-1',
      goalId: 'goal-1',
      goalVersion: 1,
    });

    expect(
      await harness.service.followUp({
        taskId: task.taskId,
        action: 'revise_plan',
        messageText: 'Add safety checks.',
      }),
    ).toMatchObject({ phase: 'awaiting_plan_confirmation' });
    expect(
      await harness.service.followUp({
        taskId: task.taskId,
        action: 'confirm_plan',
        messageText: 'Confirm.',
      }),
    ).toMatchObject({ phase: 'executing' });
    expect(
      await harness.service.followUp({
        taskId: task.taskId,
        action: 'pause',
        messageText: 'Pause.',
      }),
    ).toMatchObject({ phase: 'paused' });
    expect(
      await harness.service.followUp({
        taskId: task.taskId,
        action: 'resume',
        messageText: 'Resume.',
      }),
    ).toMatchObject({ phase: 'executing' });
  });

  it('replans and requires fresh confirmation when the pause threshold was exceeded', async () => {
    const harness = createHarness('replan_required');
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
      'paused',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-long', goalId: 'goal-1', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);

    await expect(
      harness.service.followUp({ taskId: task.taskId, action: 'resume', messageText: 'Resume.' }),
    ).resolves.toMatchObject({
      phase: 'awaiting_plan_confirmation',
      planId: 'plan-2',
    });
    expect(harness.operations).toContain('plan.revise:plan-long');
  });

  it('binds a replacement Skill plan and always returns to fresh confirmation', async () => {
    const harness = createHarness();
    harness.tasks.set('task-replacement', {
      taskId: 'task-replacement',
      contextId: 'context-1',
      userId: 'user-1',
      requestText: 'Run.',
      requestMetadata: {},
      phase: 'executing',
      phaseMessage: 'Executing.',
      goalId: 'goal-1',
      goalVersion: 1,
      planId: 'plan-old',
      selectedSkillId: 'skill-old',
      selectedSkillVersion: 1,
      skillSelectionId: 'selection-1',
      skillInputResolutionId: 'resolution-old',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(
      harness.service.awaitReplacementConfirmation('task-replacement', {
        planId: 'plan-new',
        skillId: 'skill-alternative',
        skillVersion: 2,
        summary: 'Selected the enabled alternative.',
      }),
    ).resolves.toMatchObject({
      phase: 'awaiting_plan_confirmation',
      planId: 'plan-new',
      selectedSkillId: 'skill-alternative',
      selectedSkillVersion: 2,
      skillSelectionId: 'selection-1',
    });
    expect(harness.tasks.get('task-replacement')).not.toHaveProperty('skillInputResolutionId');
  });

  it('binds an evaluator replan while preserving Goal and Skill execution lineage', async () => {
    const harness = createHarness();
    harness.tasks.set('task-replan', {
      taskId: 'task-replan',
      contextId: 'context-1',
      userId: 'user-1',
      requestText: 'Run.',
      requestMetadata: {},
      phase: 'executing',
      phaseMessage: 'Executing.',
      goalId: 'goal-1',
      goalVersion: 1,
      planId: 'plan-old',
      selectedSkillId: 'skill-selected',
      selectedSkillVersion: 3,
      skillSelectionId: 'selection-1',
      userGoalPlanId: 'user-goal-plan-1',
      skillGoalId: 'skill-goal-1',
      skillAttemptId: 'skill-attempt-1',
      skillExecutionContractId: 'skill-execution-contract-1',
      skillInputResolutionId: 'skill-input-resolution-1',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await expect(
      harness.service.awaitWorkflowReplanConfirmation('task-replan', {
        planId: 'plan-replan',
        goalId: 'goal-1',
        goalVersion: 1,
        summary: 'Evaluation requires a revised plan.',
      }),
    ).resolves.toMatchObject({
      phase: 'awaiting_plan_confirmation',
      planId: 'plan-replan',
      goalId: 'goal-1',
      goalVersion: 1,
      selectedSkillId: 'skill-selected',
      selectedSkillVersion: 3,
      skillSelectionId: 'selection-1',
      userGoalPlanId: 'user-goal-plan-1',
      skillGoalId: 'skill-goal-1',
      skillAttemptId: 'skill-attempt-1',
      skillExecutionContractId: 'skill-execution-contract-1',
      skillInputResolutionId: 'skill-input-resolution-1',
    });
    expect(harness.operations).toContain('task.save:task-replan:planning');
    expect(harness.operations).toContain('task.save:task-replan:awaiting_plan_confirmation');
    await expect(
      harness.service.followUp({
        taskId: 'task-replan',
        action: 'confirm_plan',
        messageText: 'Confirm the revised plan.',
      }),
    ).resolves.toMatchObject({ phase: 'executing', planId: 'plan-replan' });
    expect(harness.operations).toContain('plan.confirm:plan-replan');
  });

  it('rejects a confirmation-bound plan through the shared follow-up transition', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);
    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'reject_plan',
        messageText: 'Reject.',
      }),
    ).resolves.toMatchObject({ phase: 'canceled', phaseMessage: 'Plan rejected.' });
    expect(harness.operations).toContain('plan.reject:missing');
  });

  it('moves an executing parent Task back to input-required plan confirmation for a child', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'executing',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);

    await expect(
      harness.service.requestNestedSkillConfirmation(task.taskId, {
        childPlanId: 'plan-child',
        childSkillId: 'skill.child',
        childSkillVersion: 2,
      }),
    ).resolves.toMatchObject({
      phase: 'awaiting_plan_confirmation',
      phaseMessage: expect.stringContaining('skill.child@2'),
    });
  });

  it('routes cancellation of a child-confirmation wait through execution control', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    harness.tasks.set(task.taskId, task);
    task = await harness.service.attachPlan(task.taskId, {
      planId: 'plan-parent',
      goalId: 'goal-parent',
      goalVersion: 1,
    });
    task = transitionTask(task, 'executing', 'executing', timestamp);
    harness.tasks.set(task.taskId, task);
    await harness.service.requestNestedSkillConfirmation(task.taskId, {
      childPlanId: 'plan-child',
      childSkillId: 'skill.child',
      childSkillVersion: 1,
    });

    await expect(harness.service.cancel(task.taskId)).resolves.toMatchObject({ phase: 'canceled' });
    expect(harness.operations).toContain('plan.cancel:plan-parent');
    expect(harness.operations.indexOf(`task.save:${task.taskId}:canceled`)).toBeLessThan(
      harness.operations.indexOf('plan.cancel:plan-parent'),
    );
  });

  it('serializes duplicate confirmation decisions and executes the plan action only once', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-parent', goalId: 'goal-parent', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);
    harness.operations.length = 0;

    const decisions = await Promise.allSettled([
      harness.service.followUp({
        taskId: task.taskId,
        action: 'confirm_plan',
        messageText: 'Confirm once.',
      }),
      harness.service.followUp({
        taskId: task.taskId,
        action: 'confirm_plan',
        messageText: 'Confirm twice.',
      }),
    ]);

    expect(decisions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'TASK_PLAN_DECISION_NOT_AWAITING' }),
      }),
    ]);
    expect(
      harness.operations.filter((operation) => operation === 'plan.confirm:plan-parent'),
    ).toEqual(['plan.confirm:plan-parent']);
  });

  it('projects authenticated authority after plan confirmation and before execution starts', async () => {
    const principal: GovernedControlPrincipal = Object.freeze({
      actorId: 'operator-1',
      kind: 'human',
      authenticationMethod: 'configured_bearer',
      permissions: new Set<GovernedControlPermission>(['physical_control.confirm']),
      requestId: 'request-confirm-1',
    });
    const harness = createHarness('resumed', false, undefined, undefined, {
      beforePlanExecution: (input) => {
        expect(Object.isFrozen(input)).toBe(true);
        expect(input).toMatchObject({
          task: { phase: 'awaiting_plan_confirmation', planId: 'plan-governed' },
          confirmationTarget: 'task_plan',
          confirmationAuthority: { principal },
        });
        harness.operations.push('before-plan-execution');
        return Promise.resolve();
      },
      executeConfirmed: () => {
        harness.operations.push('plan.execute');
        return Promise.resolve();
      },
    });
    const submitted = await harness.service.submit({ messageText: 'Navigate.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-governed', goalId: 'goal-1', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);
    harness.operations.length = 0;

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'confirm_plan',
        messageText: 'Confirm navigation.',
        confirmationAuthority: Object.freeze({ principal }),
      }),
    ).resolves.toMatchObject({ phase: 'executing' });

    expect(harness.operations).toEqual([
      'plan.confirm:plan-governed',
      'before-plan-execution',
      `task.save:${task.taskId}:executing`,
      `event:task.phase_changed:${task.taskId}`,
      'plan.execute',
    ]);
  });

  it('keeps the Task awaiting when projection fails and retries an already-confirmed plan idempotently', async () => {
    let confirmationWrites = 0;
    let planConfirmed = false;
    let projectionAttempts = 0;
    let executions = 0;
    const harness = createHarness('resumed', false, undefined, undefined, {
      confirm: () => {
        if (!planConfirmed) {
          planConfirmed = true;
          confirmationWrites += 1;
        }
        return Promise.resolve('task_plan');
      },
      beforePlanExecution: () => {
        projectionAttempts += 1;
        return projectionAttempts === 1
          ? Promise.reject(new Error('PROJECTOR_INTERRUPTED'))
          : Promise.resolve();
      },
      executeConfirmed: () => {
        executions += 1;
        return Promise.resolve();
      },
    });
    const submitted = await harness.service.submit({ messageText: 'Navigate.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-retry', goalId: 'goal-1', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);
    harness.operations.length = 0;

    const command = {
      taskId: task.taskId,
      action: 'confirm_plan' as const,
      messageText: 'Confirm navigation.',
    };
    await expect(harness.service.followUp(command)).rejects.toThrow('PROJECTOR_INTERRUPTED');
    await expect(harness.service.get(task.taskId)).resolves.toMatchObject({
      phase: 'awaiting_plan_confirmation',
    });
    expect(harness.operations).not.toContain(`task.save:${task.taskId}:executing`);
    expect(executions).toBe(0);

    await expect(harness.service.followUp(command)).resolves.toMatchObject({ phase: 'executing' });
    expect(confirmationWrites).toBe(1);
    expect(projectionAttempts).toBe(2);
    expect(executions).toBe(1);
  });

  it('does not project outer-plan authority for nested confirmation and rejects authority on other actions', async () => {
    const beforePlanExecution = vi.fn(() => Promise.resolve());
    const harness = createHarness('resumed', false, undefined, undefined, {
      confirm: () => Promise.resolve('nested_skill_plan'),
      beforePlanExecution,
    });
    const submitted = await harness.service.submit({ messageText: 'Run nested.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-parent', goalId: 'goal-1', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'confirm_plan',
        messageText: 'Confirm child.',
      }),
    ).resolves.toMatchObject({ phase: 'executing' });
    expect(beforePlanExecution).not.toHaveBeenCalled();

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'pause',
        messageText: 'Spoof authority.',
        confirmationAuthority: {
          principal: {
            actorId: 'metadata-attacker',
            kind: 'human',
            authenticationMethod: 'body',
            permissions: new Set(['physical_control.confirm']),
            requestId: 'spoofed',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'TASK_CONFIRMATION_AUTHORITY_ACTION_INVALID' });
  });

  it('rejects confirmation on an already canceled parent before any plan side effect', async () => {
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = { ...task, planId: 'plan-parent', goalId: 'goal-parent', goalVersion: 1 };
    harness.tasks.set(task.taskId, task);
    await harness.service.cancel(task.taskId);
    harness.operations.length = 0;

    await expect(
      harness.service.followUp({
        taskId: task.taskId,
        action: 'confirm_plan',
        messageText: 'This decision is stale.',
      }),
    ).rejects.toMatchObject({ code: 'TASK_PLAN_DECISION_NOT_AWAITING' });
    expect(harness.operations).not.toContain('plan.confirm:plan-parent');
  });

  it('releases the nested execution checkpoint after the unified wait timeout cancels a Task', async () => {
    const markLatestAttempt = vi.fn(() => Promise.resolve());
    const taskCapabilities = {
      prepareAcceptance: () => Promise.resolve(undefined),
      markLatestAttempt,
    } as unknown as RuntimeTaskCapabilityService;
    const harness = createHarness('resumed', false, undefined, taskCapabilities);
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    let task = submitted.task;
    for (const phase of [
      'context_loading',
      'goal_deliberation',
      'skill_resolution',
      'planning',
      'awaiting_plan_confirmation',
    ] as const)
      task = transitionTask(task, phase, phase, timestamp);
    task = {
      ...transitionTask(task, 'canceled', 'Timed out.', timestamp),
      planId: 'plan-parent',
      goalId: 'goal-parent',
      goalVersion: 1,
      errorCode: 'TASK_WAIT_TIMEOUT',
    };
    harness.tasks.set(task.taskId, task);
    harness.operations.length = 0;

    await harness.service.releaseTimedOutWait(task.taskId);

    expect(markLatestAttempt).toHaveBeenCalledWith(task.taskId, 'canceled', task.updatedAt);
    expect(harness.operations).toEqual(['plan.cancel:plan-parent']);
  });
});

function createHarness(
  resumeDisposition: 'resumed' | 'replan_required' = 'resumed',
  runtimeCancellation = false,
  remotePrepare?: (inputRequestId: string, inputContent: unknown) => Promise<unknown>,
  taskCapabilities?: RuntimeTaskCapabilityService,
  options: Readonly<{
    beforePlanExecution?: NonNullable<TaskServiceDependencies['beforePlanExecution']>;
    confirm?: NonNullable<TaskServiceDependencies['planActions']>['confirm'];
    executeConfirmed?: NonNullable<TaskServiceDependencies['planActions']>['executeConfirmed'];
    initialAdmissionEnabled?: boolean;
    initialQueueFailure?: boolean;
    initialAdmissionContextOverride?: ConversationContext;
    feedback?: NonNullable<TaskServiceDependencies['feedback']>;
    naturalLanguageCapabilityAdmissions?: NonNullable<
      TaskServiceDependencies['naturalLanguageCapabilityAdmissions']
    >;
  }> = {},
): Readonly<{
  service: TaskService;
  contexts: Map<string, ConversationContext>;
  tasks: Map<string, AgentTask>;
  drafts: Map<string, SkillDraft>;
  events: RuntimeTaskEvent[];
  operations: string[];
  inputRequests: Map<string, TaskInputRequest>;
  inputResponses: Map<string, TaskInputResponse>;
  attempts: Map<string, TaskExecutionAttempt>;
  skillInputResolutions: Map<string, SkillInputResolutionRecord>;
  queue: ContextTaskQueue;
  admissions: Map<string, InitialTaskAdmissionRecord>;
}> {
  const contexts = new Map<string, ConversationContext>();
  const tasks = new Map<string, AgentTask>();
  const drafts = new Map<string, SkillDraft>();
  const events: RuntimeTaskEvent[] = [];
  const inputRequests = new Map<string, TaskInputRequest>();
  const inputResponses = new Map<string, TaskInputResponse>();
  const attempts = new Map<string, TaskExecutionAttempt>();
  const skillInputResolutions = new Map<string, SkillInputResolutionRecord>();
  const operations: string[] = [];
  const admissions = new Map<string, InitialTaskAdmissionRecord>();
  const contextRepository: ConversationContextRepository = {
    findById: (contextId) => Promise.resolve(contexts.get(contextId)),
    save: (context) => {
      contexts.set(context.contextId, context);
      operations.push(`context.save:${context.contextId}`);
      return Promise.resolve();
    },
  };
  const taskRepository: AgentTaskRepository = {
    findById: (taskId) => Promise.resolve(tasks.get(taskId)),
    findByPlanId: (planId) =>
      Promise.resolve([...tasks.values()].find((task) => task.planId === planId)),
    list: () => Promise.resolve([...tasks.values()]),
    save: (task) => {
      tasks.set(task.taskId, task);
      operations.push(`task.save:${task.taskId}:${task.phase}`);
      return Promise.resolve();
    },
  };
  const queue: ContextTaskQueue = {
    enqueue: ({ contextId, taskId }) => {
      operations.push(`queue:${contextId}:${taskId}`);
      return options.initialQueueFailure === true
        ? Promise.reject(new Error('QUEUE_TEMPORARILY_UNAVAILABLE'))
        : Promise.resolve();
    },
  };
  const publisher: RuntimeEventPublisher = {
    publish: (event) => {
      events.push(event);
      operations.push(`event:${event.eventType}:${event.taskId}`);
      return Promise.resolve();
    },
  };
  const skillDrafts: SkillDraftRepository = {
    findById: (draftId) => Promise.resolve(drafts.get(draftId)),
    listByContextId: (contextId) =>
      Promise.resolve([...drafts.values()].filter((draft) => draft.contextId === contextId)),
    save: (draft) => {
      drafts.set(draft.draftId, draft);
      operations.push(`draft.save:${draft.draftId}`);
      return Promise.resolve();
    },
    markPublished: () => Promise.reject(new Error('UNUSED')),
  };
  const taskInputs: TaskInputRepository = {
    createRequest: (request) => {
      inputRequests.set(request.inputRequestId, request);
      return Promise.resolve();
    },
    findRequest: (inputRequestId) => Promise.resolve(inputRequests.get(inputRequestId)),
    findPendingByTask: (taskId) =>
      Promise.resolve(
        [...inputRequests.values()].find(
          (request) => request.taskId === taskId && request.status === 'waiting',
        ),
      ),
    cancelPending: (taskId, status) => {
      for (const request of inputRequests.values())
        if (request.taskId === taskId && request.status === 'waiting')
          inputRequests.set(request.inputRequestId, { ...request, status });
      return Promise.resolve();
    },
    listResponses: (taskId) =>
      Promise.resolve(
        [...inputResponses.values()].filter((response) => response.taskId === taskId),
      ),
    createInitialAttempt: (attempt) => {
      attempts.set(attempt.attemptId, attempt);
      return Promise.resolve();
    },
    answerAndCreateAttempt: (input) => {
      const request = inputRequests.get(input.inputRequestId);
      if (request?.status !== 'waiting')
        return Promise.reject(new Error('TASK_INPUT_REQUEST_NOT_WAITING'));
      const task = tasks.get(input.taskId);
      if (task?.phase !== 'awaiting_user_input')
        return Promise.reject(new Error('TASK_INPUT_REQUEST_NOT_WAITING'));
      const continued = transitionTask(
        task,
        input.continuationPhase,
        input.phaseMessage,
        input.answeredAt,
      );
      inputRequests.set(input.inputRequestId, {
        ...request,
        status: 'answered',
        answeredAt: input.answeredAt,
      });
      inputResponses.set(input.response.inputResponseId, input.response);
      attempts.set(input.attempt.attemptId, input.attempt);
      tasks.set(input.taskId, continued);
      return Promise.resolve(continued);
    },
    listQueuedAttempts: (limit) =>
      Promise.resolve(
        [...attempts.values()].filter((attempt) => attempt.status === 'queued').slice(0, limit),
      ),
    findAttempt: (attemptId) => Promise.resolve(attempts.get(attemptId)),
    findResponseForAttempt: () => Promise.resolve(undefined),
    updateAttempt: (attemptId, status, updatedAt, errorCode) => {
      const attempt = attempts.get(attemptId);
      if (attempt === undefined) return Promise.reject(new Error('ATTEMPT_NOT_FOUND'));
      attempts.set(attemptId, {
        ...attempt,
        status,
        ...(status === 'running' ? { startedAt: updatedAt } : { completedAt: updatedAt }),
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      return Promise.resolve();
    },
  };
  let contextSequence = 0;
  let taskSequence = 0;
  let eventSequence = 0;
  const ids: IdentifierGenerator = {
    nextId: (kind) => {
      if (kind === 'context') return `context-${String(++contextSequence)}`;
      if (kind === 'task') return `task-${String(++taskSequence)}`;
      return `${kind}-${String(++eventSequence)}`;
    },
  };
  const initialAdmissions: InitialTaskAdmissionStore | undefined = options.initialAdmissionEnabled
    ? {
        findByIdempotencyKey: (idempotencyKey) => Promise.resolve(admissions.get(idempotencyKey)),
        acceptInitial: (input) => {
          const existing = admissions.get(input.idempotencyKey);
          if (existing !== undefined)
            return Promise.resolve({
              status: existing.requestHash === input.requestHash ? 'replayed' : 'conflict',
              record: existing,
            });
          const record: InitialTaskAdmissionRecord = Object.freeze({
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            taskId: input.capabilityAcceptance.task.taskId,
            contextId: input.context.contextId,
            capabilityBindingId: input.capabilityAcceptance.binding.bindingId,
            capabilityAttemptId: input.capabilityAcceptance.capabilityAttempt.attemptId,
            createdContext: !contexts.has(input.context.contextId),
            acceptedAt: input.acceptedAt,
          });
          const authoritativeContext = options.initialAdmissionContextOverride ?? input.context;
          contexts.set(input.context.contextId, authoritativeContext);
          tasks.set(input.capabilityAcceptance.task.taskId, input.capabilityAcceptance.task);
          admissions.set(input.idempotencyKey, record);
          operations.push(`admission:${input.idempotencyKey}`);
          return Promise.resolve({ status: 'accepted', record, context: authoritativeContext });
        },
      }
    : undefined;
  return {
    service: new TaskService({
      contexts: contextRepository,
      tasks: taskRepository,
      queue,
      events: publisher,
      skillDrafts,
      taskInputs,
      ...(taskCapabilities === undefined ? {} : { taskCapabilities }),
      ...(initialAdmissions === undefined ? {} : { initialAdmissions }),
      ...(options.naturalLanguageCapabilityAdmissions === undefined
        ? {}
        : {
            naturalLanguageCapabilityAdmissions: options.naturalLanguageCapabilityAdmissions,
          }),
      ...(options.feedback === undefined ? {} : { feedback: options.feedback }),
      ...(remotePrepare === undefined
        ? {}
        : { remoteTaskInputs: { prepareResponse: remotePrepare } }),
      skillInputs: {
        find: (resolutionId) =>
          Promise.resolve(
            [...skillInputResolutions.values()].find(
              (record) => record.resolutionId === resolutionId,
            ),
          ),
      },
      clock: { now: () => timestamp },
      ids,
      ...(options.beforePlanExecution === undefined
        ? {}
        : { beforePlanExecution: options.beforePlanExecution }),
      planActions: {
        confirm:
          options.confirm ??
          ((task) => {
            operations.push(`plan.confirm:${task.planId ?? 'missing'}`);
            return Promise.resolve('task_plan');
          }),
        reject: (task) => {
          operations.push(`plan.reject:${task.planId ?? 'missing'}`);
          return Promise.resolve();
        },
        executeConfirmed: options.executeConfirmed ?? (() => Promise.resolve()),
        reviseNaturalLanguage: (task) => {
          operations.push(`plan.revise:${task.planId ?? 'missing'}`);
          return Promise.resolve({
            planId: 'plan-2',
            goalId: task.goalId ?? 'goal-1',
            goalVersion: task.goalVersion ?? 1,
          });
        },
        patchGoal: () => Promise.resolve(),
        pause: () => Promise.resolve(),
        commitRuntimeCancellation: (task) => {
          if (!runtimeCancellation) return Promise.resolve(false);
          operations.push(`runtime.cancel:${task.taskId}`);
          tasks.set(task.taskId, {
            ...task,
            phase: 'canceled',
            phaseMessage: 'Atomically canceled by runtime.',
            errorCode: 'RUNTIME_CANCELED',
            updatedAt: timestamp,
          });
          return Promise.resolve(true);
        },
        cancel: (task) => {
          operations.push(`plan.cancel:${task.planId ?? 'missing'}`);
          return Promise.resolve();
        },
        resume: () => Promise.resolve(resumeDisposition),
        cancelGoal: () => Promise.resolve(),
      },
    }),
    contexts,
    tasks,
    drafts,
    events,
    operations,
    inputRequests,
    inputResponses,
    attempts,
    skillInputResolutions,
    queue,
    admissions,
  };
}

function capabilityService(): RuntimeTaskCapabilityService {
  return new RuntimeTaskCapabilityService({
    schemas: new AjvJsonSchemaValidator(),
    store: {
      describeExposure: () => Promise.resolve(undefined),
      resolveExposure: () =>
        Promise.resolve({
          exposureId: 'device.inspect',
          exposureVersion: 1,
          requestedCapabilityId: 'device.inspect.capability',
          capabilityVersion: 1,
          requestSchema: {
            type: 'object',
            required: ['deviceId'],
            properties: { deviceId: { type: 'string' } },
            additionalProperties: false,
          },
          successCriteria: [{ type: 'field_equals', field: 'inspected', value: true }],
          requiredEvidence: [{ type: 'provider_result', field: 'evidence' }],
          constraints: [],
          implementationRefs: ['skill:device.inspect:1'],
          providerBindingRefs: [],
        }),
      accept: () => Promise.reject(new Error('INITIAL_ADMISSION_STORE_MUST_ACCEPT_ATOMICALLY')),
      findBinding: () => Promise.resolve(undefined),
      listAttempts: () => Promise.resolve([]),
      appendAttempt: () => Promise.reject(new Error('UNUSED')),
      updateLatestAttempt: () => Promise.resolve(),
      reconcileCanceledAttempts: () => Promise.resolve(0),
      reconcileFailedAttempts: () => Promise.resolve(0),
    },
  });
}
