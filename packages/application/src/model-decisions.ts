import { z } from 'zod';
import type { WorkflowRecoveryOption } from '../../domain/src/index.js';

import type { SkillSelectionDecider, StructuredModelProvider } from './ports.js';
import type { MemoryService } from './memory-service.js';

const IntentDecisionSchema = z
  .object({
    intent: z.enum(['execute', 'create_skill', 'update_skill']),
    summary: z.string().min(1),
  })
  .strict();
const intentResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'summary'],
  properties: {
    intent: { enum: ['execute', 'create_skill', 'update_skill'] },
    summary: { type: 'string', minLength: 1 },
  },
} as const;

const GoalDecisionSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    constraints: z.array(z.string()),
    successCriteria: z.array(z.string()),
    requiresInput: z.boolean(),
    clarificationQuestion: z.string().min(1).optional(),
  })
  .strict();
const goalResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'constraints', 'successCriteria', 'requiresInput'],
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    constraints: { type: 'array', items: { type: 'string' } },
    successCriteria: { type: 'array', items: { type: 'string' } },
    requiresInput: { type: 'boolean' },
    clarificationQuestion: { type: 'string', minLength: 1 },
  },
} as const;
const GoalContinuityDecisionSchema = z
  .object({
    relationship: z.enum(['related_successor', 'unrelated_new']),
    decisionSummary: z.string().min(1),
  })
  .strict();
const goalContinuityResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['relationship', 'decisionSummary'],
  properties: {
    relationship: { enum: ['related_successor', 'unrelated_new'] },
    decisionSummary: { type: 'string', minLength: 1 },
  },
} as const;

const SkillSelectionDecisionSchema = z
  .object({ selectedSkillId: z.string().min(1), decisionSummary: z.string().min(1) })
  .strict();
const skillSelectionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['selectedSkillId', 'decisionSummary'],
  properties: {
    selectedSkillId: { type: 'string', minLength: 1 },
    decisionSummary: { type: 'string', minLength: 1 },
  },
} as const;
const ExceptionDecisionSchema = z
  .object({
    strategy: z.enum(['terminate', 'continue', 'goto']),
    summary: z.string().min(1),
    recoveryAction: z
      .enum(['retry', 'change_arguments', 'alternative_tool', 'invoke_skill'])
      .optional(),
    targetNodeId: z.string().min(1).optional(),
  })
  .strict();
const exceptionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['strategy', 'summary'],
  properties: {
    strategy: { enum: ['terminate', 'continue', 'goto'] },
    summary: { type: 'string', minLength: 1 },
    recoveryAction: {
      enum: ['retry', 'change_arguments', 'alternative_tool', 'invoke_skill'],
    },
    targetNodeId: { type: 'string', minLength: 1 },
  },
} as const;

export interface IntentDecision {
  readonly intent: 'execute' | 'create_skill' | 'update_skill';
  readonly summary: string;
}

export interface GoalDecision {
  readonly title: string;
  readonly description: string;
  readonly constraints: readonly string[];
  readonly successCriteria: readonly string[];
  readonly requiresInput: boolean;
  readonly clarificationQuestion?: string;
}

export interface GoalContinuityDecision {
  readonly relationship: 'related_successor' | 'unrelated_new';
  readonly decisionSummary: string;
}

export class StructuredTaskDecisionService {
  readonly #model: StructuredModelProvider;
  readonly #memories: Pick<MemoryService, 'searchForStage'> | undefined;
  constructor(model: StructuredModelProvider, memories?: Pick<MemoryService, 'searchForStage'>) {
    this.#model = model;
    this.#memories = memories;
  }

  async decideIntent(
    input: Readonly<{ requestText: string; contextSummary?: string }>,
  ): Promise<IntentDecision> {
    const memoryContext = await this.#memories?.searchForStage('intent', input.requestText);
    const raw = await this.#model.generateStructured({
      stage: 'intent',
      instruction: JSON.stringify({
        operation: 'decide_task_intent',
        ...input,
        memoryContext: toMemoryContext(memoryContext),
      }),
      responseSchema: intentResponseSchema,
      correctionErrors: [],
    });
    return IntentDecisionSchema.parse(raw);
  }

  async formulateGoal(
    input: Readonly<{ requestText: string; contextSummary?: string }>,
  ): Promise<GoalDecision> {
    const result = GoalDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'goal',
        instruction: JSON.stringify({ operation: 'formulate_goal', ...input }),
        responseSchema: goalResponseSchema,
        correctionErrors: [],
      }),
    );
    if (result.requiresInput !== (result.clarificationQuestion !== undefined))
      throw new ModelDecisionError(
        'GOAL_CLARIFICATION_SHAPE_INVALID',
        'A clarification question is required exactly when more input is required.',
      );
    return {
      title: result.title,
      description: result.description,
      constraints: result.constraints,
      successCriteria: result.successCriteria,
      requiresInput: result.requiresInput,
      ...(result.clarificationQuestion === undefined
        ? {}
        : { clarificationQuestion: result.clarificationQuestion }),
    };
  }

  async decideGoalContinuity(
    input: Readonly<{
      requestText: string;
      previousGoal: Readonly<{
        goalId: string;
        title: string;
        description: string;
        constraints: readonly string[];
        successCriteria: readonly string[];
        status: string;
      }>;
    }>,
  ): Promise<GoalContinuityDecision> {
    return GoalContinuityDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'goal',
        instruction: JSON.stringify({ operation: 'decide_goal_continuity', ...input }),
        responseSchema: goalContinuityResponseSchema,
        correctionErrors: [],
      }),
    );
  }
}

export class StructuredSkillSelectionDecider implements SkillSelectionDecider {
  readonly #model: StructuredModelProvider;
  readonly #memories: Pick<MemoryService, 'searchForStage'> | undefined;
  constructor(model: StructuredModelProvider, memories?: Pick<MemoryService, 'searchForStage'>) {
    this.#model = model;
    this.#memories = memories;
  }

  async decide(input: Parameters<SkillSelectionDecider['decide']>[0]) {
    const memoryContext = await this.#memories?.searchForStage(
      'skill_selection',
      input.goalDescription,
    );
    return SkillSelectionDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'skill_selection',
        instruction: JSON.stringify({
          operation: 'select_skill',
          ...input,
          memoryContext: toMemoryContext(memoryContext),
        }),
        responseSchema: skillSelectionResponseSchema,
        correctionErrors: [],
      }),
    );
  }
}

export interface ExecutionExceptionDecisionInput {
  readonly handledNodeId: string;
  readonly error: Readonly<{ code: string; message: string }>;
  readonly allowedStrategies: readonly ('terminate' | 'continue' | 'goto')[];
  readonly gotoNodeId?: string;
  readonly allowedRecoveryOptions?: readonly WorkflowRecoveryOption[];
}

export class StructuredExecutionExceptionDecider {
  readonly #model: StructuredModelProvider;
  readonly #memories: Pick<MemoryService, 'searchForStage'> | undefined;
  constructor(model: StructuredModelProvider, memories?: Pick<MemoryService, 'searchForStage'>) {
    this.#model = model;
    this.#memories = memories;
  }

  async decide(input: ExecutionExceptionDecisionInput) {
    const memoryContext = await this.#memories?.searchForStage(
      'exception_handling',
      `${input.error.code} ${input.error.message}`,
    );
    const decision = ExceptionDecisionSchema.parse(
      await this.#model.generateStructured({
        stage: 'execution_decision',
        instruction: JSON.stringify({
          operation: 'decide_execution_exception',
          ...input,
          memoryContext: toMemoryContext(memoryContext),
        }),
        responseSchema: exceptionResponseSchema,
        correctionErrors: [],
      }),
    );
    if (!input.allowedStrategies.includes(decision.strategy))
      throw new ModelDecisionError(
        'EXECUTION_EXCEPTION_STRATEGY_INVALID',
        'The model selected an exception strategy outside the constrained choices.',
      );
    if (input.allowedRecoveryOptions !== undefined && decision.strategy === 'goto') {
      if (
        !input.allowedRecoveryOptions.some(
          (option) =>
            option.action === decision.recoveryAction &&
            option.targetNodeId === decision.targetNodeId,
        )
      )
        throw new ModelDecisionError(
          'EXECUTION_EXCEPTION_RECOVERY_INVALID',
          'The model selected a recovery action outside the immutable bounded choices.',
        );
    } else if (decision.recoveryAction !== undefined || decision.targetNodeId !== undefined)
      throw new ModelDecisionError(
        'EXECUTION_EXCEPTION_RECOVERY_INVALID',
        'Recovery fields are allowed only for a constrained goto decision.',
      );
    return decision;
  }
}

function toMemoryContext(hits: Awaited<ReturnType<MemoryService['searchForStage']>> | undefined) {
  return (hits ?? []).map((hit) => ({
    memoryId: hit.item.memoryId,
    type: hit.item.type,
    summary: hit.item.summary,
    content: hit.item.content,
    sourceRefs: hit.item.sourceRefs,
    confidence: hit.item.confidence,
    score: hit.score,
  }));
}

export class ModelDecisionError extends Error {
  readonly code:
    | 'EXECUTION_EXCEPTION_STRATEGY_INVALID'
    | 'EXECUTION_EXCEPTION_RECOVERY_INVALID'
    | 'GOAL_CLARIFICATION_SHAPE_INVALID';
  constructor(
    code:
      | 'EXECUTION_EXCEPTION_STRATEGY_INVALID'
      | 'EXECUTION_EXCEPTION_RECOVERY_INVALID'
      | 'GOAL_CLARIFICATION_SHAPE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ModelDecisionError';
    this.code = code;
  }
}
