import { z } from 'zod';

import type { GoalEvaluationResult } from '../../domain/src/index.js';
import type { GoalEvaluator, StructuredModelProvider } from './ports.js';

const GoalEvaluationSchema = z
  .object({
    decision: z.enum(['achieved', 'replan', 'unachievable']),
    summary: z.string().min(1),
    replanInstruction: z.string().min(1).optional(),
  })
  .strict();

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'summary'],
  properties: {
    decision: { enum: ['achieved', 'replan', 'unachievable'] },
    summary: { type: 'string', minLength: 1 },
    replanInstruction: { type: 'string', minLength: 1 },
  },
} as const;

export class StructuredGoalEvaluator implements GoalEvaluator {
  readonly #model: StructuredModelProvider;
  constructor(model: StructuredModelProvider) {
    this.#model = model;
  }

  async evaluate(input: Parameters<GoalEvaluator['evaluate']>[0]): Promise<GoalEvaluationResult> {
    const raw = await this.#model.generateStructured({
      stage: 'goal_evaluation',
      instruction: JSON.stringify({
        goal: {
          goalId: input.goal.goalId,
          version: input.goal.version,
          description: input.goal.description,
          constraints: input.goal.constraints,
          successCriteria: input.goal.successCriteria,
        },
        workflow: {
          instanceId: input.instance.instanceId,
          status: input.instance.status,
          result: input.instance.result,
          errors: input.instance.errors,
          budgetUsage: input.instance.budgetUsage,
          terminationReason: input.instance.terminationReason,
        },
      }),
      responseSchema,
      correctionErrors: [],
    });
    const result = GoalEvaluationSchema.parse(raw);
    if (result.decision === 'replan' && result.replanInstruction === undefined)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_REPLAN_INSTRUCTION_REQUIRED',
        'Replan evaluation requires a structured replan instruction.',
      );
    if (result.decision !== 'replan' && result.replanInstruction !== undefined)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_REPLAN_INSTRUCTION_FORBIDDEN',
        'Only a replan decision may provide a replan instruction.',
      );
    return {
      decision: result.decision,
      summary: result.summary,
      ...(result.replanInstruction === undefined
        ? {}
        : { replanInstruction: result.replanInstruction }),
    };
  }
}

export type GoalEvaluationErrorCode =
  'GOAL_EVALUATION_REPLAN_INSTRUCTION_FORBIDDEN' | 'GOAL_EVALUATION_REPLAN_INSTRUCTION_REQUIRED';
export class GoalEvaluationError extends Error {
  readonly code: GoalEvaluationErrorCode;
  constructor(code: GoalEvaluationErrorCode, message: string) {
    super(message);
    this.name = 'GoalEvaluationError';
    this.code = code;
  }
}
