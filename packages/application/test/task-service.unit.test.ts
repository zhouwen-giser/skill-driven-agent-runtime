import { describe, expect, it } from 'vitest';

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
  type AgentTaskRepository,
  type ContextTaskQueue,
  type ConversationContextRepository,
  type IdentifierGenerator,
  type RuntimeEventPublisher,
  type RuntimeTaskEvent,
  type SkillDraftRepository,
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
    const harness = createHarness();
    const submitted = await harness.service.submit({ messageText: 'Inspect.', metadata: {} });
    harness.operations.length = 0;

    const canceled = await harness.service.cancel(submitted.task.taskId);
    expect(canceled.phase).toBe('canceled');
    expect(harness.operations).toEqual([
      'task.save:task-1:canceled',
      'event:task.phase_changed:task-1',
    ]);
  });

  it('uses an atomic runtime cancellation projection when an active control owns the Task', async () => {
    const harness = createHarness('resumed', true);
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
      capabilityGap: {
        missingCapability: 'Read device pressure.',
        suggestedToolContract: { name: 'read_pressure' },
      },
    });
    expect(harness.events.at(-1)?.summary).toContain('No registered tool');
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

    expect(harness.operations).toEqual(['plan.cancel:plan-parent']);
  });
});

function createHarness(
  resumeDisposition: 'resumed' | 'replan_required' = 'resumed',
  runtimeCancellation = false,
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
      return Promise.resolve();
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
  return {
    service: new TaskService({
      contexts: contextRepository,
      tasks: taskRepository,
      queue,
      events: publisher,
      skillDrafts,
      taskInputs,
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
      planActions: {
        confirm: (task) => {
          operations.push(`plan.confirm:${task.planId ?? 'missing'}`);
          return Promise.resolve('task_plan');
        },
        reject: (task) => {
          operations.push(`plan.reject:${task.planId ?? 'missing'}`);
          return Promise.resolve();
        },
        executeConfirmed: () => Promise.resolve(),
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
  };
}
