import { createGoal, type Goal, type GoalTransitionRecord } from '../../domain/src/index.js';
import type { Clock, ConversationContextRepository, GoalRepository } from './ports.js';

export class GoalService {
  readonly #goals: GoalRepository;
  readonly #contexts: ConversationContextRepository;
  readonly #clock: Clock;
  constructor(
    dependencies: Readonly<{
      goals: GoalRepository;
      contexts: ConversationContextRepository;
      clock: Clock;
    }>,
  ) {
    this.#goals = dependencies.goals;
    this.#contexts = dependencies.contexts;
    this.#clock = dependencies.clock;
  }

  async create(
    input: Readonly<{
      goalId: string;
      contextId: string;
      title: string;
      description: string;
      constraints?: readonly string[];
      successCriteria?: readonly string[];
      previousGoalId?: string;
      transition?: GoalTransitionRecord;
    }>,
  ): Promise<Goal> {
    if ((await this.#contexts.findById(input.contextId)) === undefined)
      throw new GoalServiceError('GOAL_CONTEXT_NOT_FOUND', 'Conversation context was not found.');
    if ((await this.#goals.findById(input.goalId)) !== undefined)
      throw new GoalServiceError('GOAL_ALREADY_EXISTS', 'Goal already exists.');
    const goal = createGoal({ ...input, timestamp: this.#clock.now() });
    await this.#goals.save(goal, input.transition);
    return goal;
  }

  async get(goalId: string): Promise<Goal> {
    const goal = await this.#goals.findById(goalId);
    if (goal === undefined) throw new GoalServiceError('GOAL_NOT_FOUND', 'Goal was not found.');
    return goal;
  }

  findActiveByContextId(contextId: string): Promise<Goal | undefined> {
    return this.#goals.findActiveByContextId(contextId);
  }

  findLatestByContextId(contextId: string): Promise<Goal | undefined> {
    return this.#goals.findLatestByContextId(contextId);
  }

  async history(contextId: string) {
    return {
      goals: await this.#goals.listByContextId(contextId),
      transitions: await this.#goals.listTransitions(contextId),
    };
  }
}

export type GoalServiceErrorCode =
  'GOAL_ALREADY_EXISTS' | 'GOAL_CONTEXT_NOT_FOUND' | 'GOAL_NOT_FOUND';
export class GoalServiceError extends Error {
  readonly code: GoalServiceErrorCode;
  constructor(code: GoalServiceErrorCode, message: string) {
    super(message);
    this.name = 'GoalServiceError';
    this.code = code;
  }
}
