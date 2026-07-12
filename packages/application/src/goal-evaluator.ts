import { z } from 'zod';

import type { GoalEvaluationResult } from '../../domain/src/index.js';
import type { GoalEvaluator, StructuredModelProvider } from './ports.js';
import type { MemoryService } from './memory-service.js';

const GoalEvaluationSchema = z
  .object({
    decision: z.enum([
      'achieved',
      'request_input',
      'adjust_plan',
      'replace_skill',
      'invoke_additional_skill',
      'capability_gap',
      'unachievable',
    ]),
    summary: z.string().min(1),
    actionInstruction: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    missingCapability: z.string().min(1).optional(),
    suggestedToolContract: z
      .object({
        name: z.string().min(1),
        description: z.string().min(1),
        inputSchema: z.unknown(),
      })
      .strict()
      .optional(),
  })
  .strict();

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'summary'],
  properties: {
    decision: {
      enum: [
        'achieved',
        'request_input',
        'adjust_plan',
        'replace_skill',
        'invoke_additional_skill',
        'capability_gap',
        'unachievable',
      ],
    },
    summary: { type: 'string', minLength: 1 },
    actionInstruction: { type: 'string', minLength: 1 },
    question: { type: 'string', minLength: 1 },
    missingCapability: { type: 'string', minLength: 1 },
    suggestedToolContract: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'description', 'inputSchema'],
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1 },
        inputSchema: {},
      },
    },
  },
} as const;

export class StructuredGoalEvaluator implements GoalEvaluator {
  readonly #model: StructuredModelProvider;
  readonly #memories: Pick<MemoryService, 'searchForStage'> | undefined;
  constructor(model: StructuredModelProvider, memories?: Pick<MemoryService, 'searchForStage'>) {
    this.#model = model;
    this.#memories = memories;
  }

  async evaluate(input: Parameters<GoalEvaluator['evaluate']>[0]): Promise<GoalEvaluationResult> {
    const memoryContext = await this.#memories?.searchForStage(
      'goal_evaluation',
      input.goal.description,
    );
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
        memoryContext: (memoryContext ?? []).map((hit) => ({
          memoryId: hit.item.memoryId,
          type: hit.item.type,
          summary: hit.item.summary,
          content: hit.item.content,
          sourceRefs: hit.item.sourceRefs,
          confidence: hit.item.confidence,
          score: hit.score,
        })),
      }),
      responseSchema,
      correctionErrors: [],
    });
    const result = GoalEvaluationSchema.parse(raw);
    const planningDecisions = new Set(['adjust_plan', 'replace_skill', 'invoke_additional_skill']);
    if (planningDecisions.has(result.decision) && result.actionInstruction === undefined)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_ACTION_INSTRUCTION_REQUIRED',
        'A planning evaluation requires a structured action instruction.',
      );
    if (!planningDecisions.has(result.decision) && result.actionInstruction !== undefined)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_ACTION_INSTRUCTION_FORBIDDEN',
        'Only a planning evaluation may provide an action instruction.',
      );
    if (result.decision === 'request_input' && result.question === undefined)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_QUESTION_REQUIRED',
        'An input request requires a clear user question.',
      );
    if (result.decision !== 'request_input' && result.question !== undefined)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_QUESTION_FORBIDDEN',
        'Only an input request may provide a question.',
      );
    const hasCapabilityEvidence =
      result.missingCapability !== undefined || result.suggestedToolContract !== undefined;
    if (
      result.decision === 'capability_gap' &&
      (result.missingCapability === undefined || result.suggestedToolContract === undefined)
    )
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_CAPABILITY_EVIDENCE_REQUIRED',
        'A capability gap requires both the missing capability and suggested tool contract.',
      );
    if (result.decision !== 'capability_gap' && hasCapabilityEvidence)
      throw new GoalEvaluationError(
        'GOAL_EVALUATION_CAPABILITY_EVIDENCE_FORBIDDEN',
        'Only a capability gap may provide capability evidence.',
      );
    return {
      decision: result.decision,
      summary: result.summary,
      ...(result.actionInstruction === undefined
        ? {}
        : { actionInstruction: result.actionInstruction }),
      ...(result.question === undefined ? {} : { question: result.question }),
      ...(result.missingCapability === undefined
        ? {}
        : { missingCapability: result.missingCapability }),
      ...(result.suggestedToolContract === undefined
        ? {}
        : { suggestedToolContract: result.suggestedToolContract }),
    };
  }
}

export type GoalEvaluationErrorCode =
  | 'GOAL_EVALUATION_ACTION_INSTRUCTION_FORBIDDEN'
  | 'GOAL_EVALUATION_ACTION_INSTRUCTION_REQUIRED'
  | 'GOAL_EVALUATION_CAPABILITY_EVIDENCE_FORBIDDEN'
  | 'GOAL_EVALUATION_CAPABILITY_EVIDENCE_REQUIRED'
  | 'GOAL_EVALUATION_QUESTION_FORBIDDEN'
  | 'GOAL_EVALUATION_QUESTION_REQUIRED';
export class GoalEvaluationError extends Error {
  readonly code: GoalEvaluationErrorCode;
  constructor(code: GoalEvaluationErrorCode, message: string) {
    super(message);
    this.name = 'GoalEvaluationError';
    this.code = code;
  }
}
