import type {
  InteractiveGoalSessionService,
  InteractiveGoalSessionView,
} from './interactive-goal-session-service.js';
import type {
  InteractivePlanningSessionService,
  InteractivePlanningSessionView,
} from './interactive-planning-session-service.js';

export type InteractiveActionRouteResult =
  | Readonly<{ kind: 'goal'; view: InteractiveGoalSessionView }>
  | Readonly<{ kind: 'planning'; view: InteractivePlanningSessionView }>;

/**
 * Resolves the current interactive authority for a Task and applies one continuation
 * against the exact session revision observed by the router.
 */
export class InteractiveActionRouter {
  readonly #goalSessions: Pick<InteractiveGoalSessionService, 'getByTask' | 'applyAction'>;
  readonly #planningSessions: Pick<InteractivePlanningSessionService, 'getByTask' | 'applyAction'>;

  constructor(
    dependencies: Readonly<{
      goalSessions: Pick<InteractiveGoalSessionService, 'getByTask' | 'applyAction'>;
      planningSessions: Pick<InteractivePlanningSessionService, 'getByTask' | 'applyAction'>;
    }>,
  ) {
    this.#goalSessions = dependencies.goalSessions;
    this.#planningSessions = dependencies.planningSessions;
  }

  async route(
    input: Readonly<{
      taskId: string;
      idempotencyKey: string;
      actorId: string;
      content: unknown;
    }>,
  ): Promise<InteractiveActionRouteResult | undefined> {
    const planning = await this.#planningSessions.getByTask(input.taskId);
    if (planning?.session.state === 'plan_review') {
      const action = planningActionFor(input.content);
      return {
        kind: 'planning',
        view: await this.#planningSessions.applyAction({
          sessionId: planning.session.sessionId,
          expectedVersion: planning.session.version,
          idempotencyKey: input.idempotencyKey,
          actorId: input.actorId,
          action: action.action,
          payload: action.payload,
        }),
      };
    }
    const goal = await this.#goalSessions.getByTask(input.taskId);
    if (
      goal === undefined ||
      (goal.session.state !== 'understand' && goal.session.state !== 'goal_review')
    ) {
      return undefined;
    }
    const action = goalActionFor(goal.session.state, input.content);
    return {
      kind: 'goal',
      view: await this.#goalSessions.applyAction({
        sessionId: goal.session.sessionId,
        expectedVersion: goal.session.version,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId,
        action: action.action,
        payload: action.payload,
      }),
    };
  }
}

function goalActionFor(
  state: 'understand' | 'goal_review',
  content: unknown,
): Readonly<{
  action: 'answer' | 'accept' | 'patch' | 'reject' | 'restart_understanding' | 'cancel';
  payload: Readonly<Record<string, unknown>>;
}> {
  if (isRecord(content)) {
    const action = content['action'];
    if (
      action === 'answer' ||
      action === 'accept' ||
      action === 'patch' ||
      action === 'reject' ||
      action === 'restart_understanding' ||
      action === 'cancel'
    ) {
      const payload = content['payload'];
      return {
        action,
        payload: isRecord(payload)
          ? payload
          : action === 'answer'
            ? { answer: content['answer'] }
            : {},
      };
    }
  }
  if (state === 'understand') return { action: 'answer', payload: { answer: content } };
  if (typeof content === 'string' && content.trim().toLocaleLowerCase() === 'accept') {
    return { action: 'accept', payload: {} };
  }
  throw new Error('INTERACTIVE_GOAL_ACTION_REQUIRED');
}

function planningActionFor(content: unknown): Readonly<{
  action: 'accept' | 'patch' | 'reject' | 'cancel';
  payload: Readonly<Record<string, unknown>>;
}> {
  if (isRecord(content)) {
    const action = content['action'];
    if (action === 'accept' || action === 'patch' || action === 'reject' || action === 'cancel') {
      const payload = content['payload'];
      return {
        action,
        payload: isRecord(payload)
          ? payload
          : action === 'patch' && typeof content['instruction'] === 'string'
            ? { instruction: content['instruction'] }
            : {},
      };
    }
  }
  if (typeof content === 'string') {
    const normalized = content.trim();
    if (normalized.toLocaleLowerCase() === 'accept') return { action: 'accept', payload: {} };
    if (normalized !== '') return { action: 'patch', payload: { instruction: normalized } };
  }
  throw new Error('INTERACTIVE_PLANNING_ACTION_REQUIRED');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
