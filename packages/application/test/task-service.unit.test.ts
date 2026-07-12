import { describe, expect, it } from 'vitest';

import {
  transitionTask,
  type AgentTask,
  type ConversationContext,
  type SkillDraft,
} from '../../domain/src/index.js';
import {
  ANONYMOUS_USER_ID,
  TaskService,
  type AgentTaskRepository,
  type ContextTaskQueue,
  type ConversationContextRepository,
  type IdentifierGenerator,
  type RuntimeEventPublisher,
  type RuntimeTaskEvent,
  type SkillDraftRepository,
} from '../src/index.js';

const timestamp = '2026-07-11T10:00:00.000Z';

describe('TaskService', () => {
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

  it('returns a stable application error for an unknown task', async () => {
    const harness = createHarness();
    await expect(harness.service.cancel('missing')).rejects.toEqual(
      expect.objectContaining({ code: 'TASK_NOT_FOUND' }),
    );
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
});

function createHarness(resumeDisposition: 'resumed' | 'replan_required' = 'resumed'): Readonly<{
  service: TaskService;
  contexts: Map<string, ConversationContext>;
  tasks: Map<string, AgentTask>;
  drafts: Map<string, SkillDraft>;
  events: RuntimeTaskEvent[];
  operations: string[];
}> {
  const contexts = new Map<string, ConversationContext>();
  const tasks = new Map<string, AgentTask>();
  const drafts = new Map<string, SkillDraft>();
  const events: RuntimeTaskEvent[] = [];
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
  };
  let contextSequence = 0;
  let taskSequence = 0;
  let eventSequence = 0;
  const ids: IdentifierGenerator = {
    nextId: (kind) => {
      if (kind === 'context') return `context-${String(++contextSequence)}`;
      if (kind === 'task') return `task-${String(++taskSequence)}`;
      return `event-${String(++eventSequence)}`;
    },
  };
  return {
    service: new TaskService({
      contexts: contextRepository,
      tasks: taskRepository,
      queue,
      events: publisher,
      skillDrafts,
      clock: { now: () => timestamp },
      ids,
      planActions: {
        confirm: (planId) => {
          operations.push(`plan.confirm:${planId}`);
          return Promise.resolve();
        },
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
        cancel: () => Promise.resolve(),
        resume: () => Promise.resolve(resumeDisposition),
      },
    }),
    contexts,
    tasks,
    drafts,
    events,
    operations,
  };
}
