import type { Goal } from './goal.js';
import { DomainError } from './errors.js';
import { normalizeUserId, requireIdentifier } from './identity.js';

export interface ConversationContext {
  readonly contextId: string;
  readonly userId: string;
  readonly activeGoal?: Goal;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateConversationContextInput {
  readonly contextId: string;
  readonly userId?: string;
  readonly timestamp: string;
}

export function createConversationContext(
  input: CreateConversationContextInput,
): ConversationContext {
  return {
    contextId: requireIdentifier(input.contextId, 'CONTEXT_ID_REQUIRED'),
    userId: normalizeUserId(input.userId),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function attachActiveGoal(
  context: ConversationContext,
  goal: Goal,
  timestamp: string,
): ConversationContext {
  if (goal.contextId !== context.contextId) {
    throw new DomainError(
      'GOAL_CONTEXT_MISMATCH',
      'Goal and ConversationContext must share contextId.',
      {
        contextId: context.contextId,
        goalContextId: goal.contextId,
      },
    );
  }
  return { ...context, activeGoal: goal, updatedAt: timestamp };
}
