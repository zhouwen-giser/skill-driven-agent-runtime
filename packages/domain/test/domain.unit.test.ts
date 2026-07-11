import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_USER_ID,
  DomainError,
  attachActiveGoal,
  changeGoalStatus,
  completeTask,
  createAgentTask,
  createConversationContext,
  createGoal,
  isTerminalTaskPhase,
  transitionTask,
} from '../src/index.js';

const timestamp = '2026-07-11T10:00:00.000Z';

describe('ConversationContext and Goal domain ownership', () => {
  it('uses the fixed anonymous user when user_id is absent', () => {
    const context = createConversationContext({ contextId: 'context-1', timestamp });
    expect(context.userId).toBe(ANONYMOUS_USER_ID);
  });

  it('attaches an active Goal without mutating the original context', () => {
    const context = createConversationContext({
      contextId: 'context-1',
      userId: ' user-1 ',
      timestamp,
    });
    const goal = createGoal({
      goalId: 'goal-1',
      contextId: context.contextId,
      title: 'Inspect device',
      description: 'Inspect a device without side effects.',
      successCriteria: ['A structured status is returned.'],
      timestamp,
    });

    const updated = attachActiveGoal(context, goal, timestamp);
    expect(updated.activeGoal).toEqual(goal);
    expect(context.activeGoal).toBeUndefined();
    expect(updated.userId).toBe('user-1');
  });

  it('prevents a terminal Goal from changing status again', () => {
    const goal = createGoal({
      goalId: 'goal-1',
      contextId: 'context-1',
      title: 'Inspect device',
      description: 'Inspect it.',
      timestamp,
    });
    const achieved = changeGoalStatus(goal, 'achieved', timestamp);

    expect(() => changeGoalStatus(achieved, 'canceled', timestamp)).toThrow(DomainError);
  });
});

describe('AgentTask state machine', () => {
  it('moves through the deterministic planning and execution lifecycle', () => {
    const queued = createAgentTask({
      taskId: 'task-1',
      contextId: 'context-1',
      userId: ANONYMOUS_USER_ID,
      timestamp,
    });
    const loading = transitionTask(queued, 'context_loading', 'Loading context.', timestamp);
    const deliberating = transitionTask(loading, 'goal_deliberation', 'Resolving goal.', timestamp);
    const resolving = transitionTask(
      deliberating,
      'skill_resolution',
      'Resolving skills.',
      timestamp,
    );
    const planning = transitionTask(resolving, 'planning', 'Planning.', timestamp);
    const executing = transitionTask(planning, 'executing', 'Executing.', timestamp);
    const evaluating = transitionTask(executing, 'evaluating', 'Evaluating.', timestamp);
    const completed = completeTask(
      evaluating,
      { text: 'Online.', structured: { status: 'online' } },
      timestamp,
    );

    expect(completed.phase).toBe('completed');
    expect(completed.output).toEqual({ text: 'Online.', structured: { status: 'online' } });
    expect(isTerminalTaskPhase(completed.phase)).toBe(true);
    expect(queued.phase).toBe('queued');
  });

  it('rejects skipped or terminal-state transitions with a stable error code', () => {
    const queued = createAgentTask({
      taskId: 'task-1',
      contextId: 'context-1',
      userId: ANONYMOUS_USER_ID,
      timestamp,
    });

    expect(() => transitionTask(queued, 'completed', 'Invalid.', timestamp)).toThrow(
      expect.objectContaining({ code: 'TASK_PHASE_TRANSITION_INVALID' }),
    );
  });
});
